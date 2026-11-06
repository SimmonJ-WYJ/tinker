/**
 * 数据导出服务（DO-2，issue #419）—— 一键导出全部本地研究数据为 zip 导出包
 *
 * 流程（设计见 docs/specs/data-export-do2-spec.md §4.2）：
 *   1. 经各 repository 全量读取 5 类持久对象（含软删，EvidenceSet 跨全部 workspace）
 *   2. 逐条 ajv 校验（O1 schema，esbuild json loader 内联进 main.cjs）；
 *      任一失败抛 ExportValidationError，**不落盘**（D5：中止导出，不产出半成品）
 *   3. Review 正文按 resolveReviewBodyPath 收集进包内 reviews/bodies/，
 *      导出 JSON 的 bodyPath 改写为包内相对路径（不泄漏用户文件系统结构）；
 *      正文缺失记入 manifest.warnings（非致命）
 *   4. fflate.zipSync 组包写入 outPath
 *
 * Proposal 不导出：0.3 已将 Proposal 功能移出（PRD Epic 3 Out of Scope），
 * proposal.schema.json 仅供 #243 文档化。
 * CitationRelation 不导出：0.4 功能废弃（#718，从未有 UI 写入路径，导出恒为
 * 空数组），随 schema / repository 一并从契约移除，导出范围收敛为 5 类。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

import type { ExportManifest, ExportManifestFileEntry, Review } from '@asci/shared'
import { nowIso } from '@asci/shared'
import Ajv from 'ajv'
import { strToU8, zipSync } from 'fflate'

import manifestSchema from '../../../../../../schema/manifest.schema.json'
import evidenceRefSchema from '../../../../../../schema/objects/evidence-ref.schema.json'
import evidenceSetSchema from '../../../../../../schema/objects/evidence-set.schema.json'
import noteSchema from '../../../../../../schema/objects/note.schema.json'
import paperSchema from '../../../../../../schema/objects/paper.schema.json'
import proposalSchema from '../../../../../../schema/objects/proposal.schema.json'
import reviewSchema from '../../../../../../schema/objects/review.schema.json'
import type { RepoDb } from './internal/repo-db.ts'
import { listEvidenceRefs } from './repositories/evidence-ref-repository.ts'
import { listEvidenceSets } from './repositories/evidence-set-repository.ts'
import { listNotes } from './repositories/note-repository.ts'
import { listPapers } from './repositories/paper-repository.ts'
import { listReviews } from './repositories/review-repository.ts'
import { resolveReviewBodyPath } from './review-body-service.ts'

/** 导出对象逐条校验失败 —— D5 语义：中止导出，不落盘 */
export class ExportValidationError extends Error {
  constructor(
    /** 失败对象类型（zip 内数据文件名，如 `papers.json`） */
    readonly dataFile: string,
    /** 失败对象 ID */
    readonly objectId: string,
    /** ajv errorsText 摘要 */
    readonly detail: string,
  ) {
    super(`导出校验失败：${dataFile} 内对象 ${objectId} 不符合 O1 schema —— ${detail}`)
    this.name = 'ExportValidationError'
  }
}

export interface ExportMyDataInput {
  /** zip 落盘绝对路径（由 Save As 对话框给出） */
  outPath: string
  /** 写入 manifest 的应用版本（app.getVersion()；测试注入任意值） */
  appVersion: string
  /** 导出时间 ISO 8601；缺省取当前时刻（测试注入固定值） */
  exportedAt?: string
}

export interface ExportMyDataOutput {
  /** 全部数据文件的对象总条数 */
  objectCount: number
  /** manifest.warnings 副本（如综述正文缺失） */
  warnings: string[]
}

/** 导出目标：zip 内数据文件 ↔ schema ↔ 读取方式 */
interface ExportTarget {
  dataFile: string
  schemaFile: string
  schema: Record<string, unknown>
  load: (db: RepoDb) => Array<{ id: string }>
  /** 该类型需收集正文文件并改写 bodyPath（目前仅 reviews，见 collectReviews） */
  collectBodies?: true
}

const EXPORT_TARGETS: ExportTarget[] = [
  {
    dataFile: 'papers.json',
    schemaFile: 'schema/objects/paper.schema.json',
    schema: paperSchema,
    load: (db) => listPapers(db, { includeDeleted: true }),
  },
  {
    dataFile: 'evidence-refs.json',
    schemaFile: 'schema/objects/evidence-ref.schema.json',
    schema: evidenceRefSchema,
    load: (db) => listEvidenceRefs(db, { includeDeleted: true }),
  },
  {
    dataFile: 'notes.json',
    schemaFile: 'schema/objects/note.schema.json',
    schema: noteSchema,
    load: (db) => listNotes(db, { includeDeleted: true }),
  },
  {
    dataFile: 'evidence-sets.json',
    schemaFile: 'schema/objects/evidence-set.schema.json',
    schema: evidenceSetSchema,
    load: (db) => listEvidenceSets(db, { includeDeleted: true }),
  },
  {
    dataFile: 'reviews.json',
    schemaFile: 'schema/objects/review.schema.json',
    schema: reviewSchema,
    load: (db) => listReviews(db, { includeDeleted: true }),
    collectBodies: true,
  },
]

/**
 * zip 内嵌的 O1 schema 副本（自描述：离线即可校验），布局与仓库 schema/ 一致。
 * 数据文件对应的 schema 直接由 EXPORT_TARGETS 推导（单一事实源）；
 * 此处只单列"无数据文件但仍内嵌"的两份：manifest 自身 + proposal（功能 0.3 移出，不导出）。
 */
const EXTRA_SCHEMAS: ReadonlyArray<{ path: string; schema: Record<string, unknown> }> = [
  { path: 'schema/manifest.schema.json', schema: manifestSchema },
  { path: 'schema/objects/proposal.schema.json', schema: proposalSchema },
]

/** Review 正文收集结果：改写后的对象 + 包内正文文件 + 缺失警告 */
interface CollectedReviews {
  reviews: Review[]
  bodyFiles: Array<{ path: string; content: string }>
  warnings: string[]
}

function collectReviews(rawReviews: Review[]): CollectedReviews {
  const reviews: Review[] = []
  const bodyFiles: CollectedReviews['bodyFiles'] = []
  const warnings: string[] = []
  for (const review of rawReviews) {
    const bodyPath = resolveReviewBodyPath(review)
    if (!bodyPath) {
      warnings.push(`review ${review.id} 正文文件缺失，导出仅含元数据`)
      reviews.push({ ...review, bodyPath: undefined })
      continue
    }
    const ext = basename(bodyPath).endsWith('.md') ? 'md' : 'html'
    const zipPath = `reviews/bodies/${review.id}.${ext}`
    bodyFiles.push({ path: zipPath, content: readFileSync(bodyPath, 'utf-8') })
    // bodyPath 改写为包内相对路径：不泄漏用户文件系统结构，且导入方可直接定位
    reviews.push({ ...review, bodyPath: zipPath })
  }
  return { reviews, bodyFiles, warnings }
}

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/**
 * 一键导出全部本地研究数据为 zip 导出包。
 *
 * @throws ExportValidationError 任一对象不符合 O1 schema（不落盘）
 * @throws Error 文件系统写入失败等
 */
export function exportMyData(db: RepoDb, input: ExportMyDataInput): ExportMyDataOutput {
  const ajv = new Ajv()
  const zipEntries: Record<string, Uint8Array> = {}
  const manifestFiles: ExportManifestFileEntry[] = []
  const warnings: string[] = []
  let objectCount = 0

  for (const target of EXPORT_TARGETS) {
    let objects = target.load(db)
    if (target.collectBodies) {
      const collected = collectReviews(objects as Review[])
      objects = collected.reviews
      warnings.push(...collected.warnings)
      for (const file of collected.bodyFiles) {
        zipEntries[file.path] = strToU8(file.content)
      }
    }

    // 序列化一次，校验的就是真正落入 zip 的形态（undefined 字段剔除等）
    const text = jsonText(objects)
    const serialized = JSON.parse(text) as unknown[]
    const validate = ajv.compile(target.schema)
    serialized.forEach((object, index) => {
      if (!validate(object)) {
        throw new ExportValidationError(
          target.dataFile,
          objects[index]?.id ?? '-',
          ajv.errorsText(validate.errors),
        )
      }
    })

    zipEntries[target.dataFile] = strToU8(text)
    manifestFiles.push({ path: target.dataFile, schema: target.schemaFile, count: objects.length })
    objectCount += objects.length
  }

  const manifest: ExportManifest = {
    exportFormatVersion: 1,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt ?? nowIso(),
    files: manifestFiles,
    warnings,
  }
  const validateManifest = ajv.compile(manifestSchema)
  if (!validateManifest(manifest)) {
    throw new ExportValidationError('manifest.json', '-', ajv.errorsText(validateManifest.errors))
  }
  zipEntries['manifest.json'] = strToU8(jsonText(manifest))

  for (const { schemaFile, schema } of EXPORT_TARGETS) {
    zipEntries[schemaFile] = strToU8(jsonText(schema))
  }
  for (const { path, schema } of EXTRA_SCHEMAS) {
    zipEntries[path] = strToU8(jsonText(schema))
  }

  writeFileSync(input.outPath, zipSync(zipEntries))
  return { objectCount, warnings }
}
