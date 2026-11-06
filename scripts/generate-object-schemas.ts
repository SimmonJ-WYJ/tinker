/**
 * O1 对象标准 schema 生成器（issue #419 / ADR-009）
 *
 * 从 packages/shared/src/types/ 的 TS interface（唯一真相源）生成
 * 仓库根 schema/ 下的 *.schema.json（tracked，对外开放契约）：
 *   - schema/objects/*.schema.json —— 6 个核心对象
 *   - schema/manifest.schema.json —— 导出包清单（DO-2）
 *
 * 运行：bun scripts/generate-object-schemas.ts
 * 守门：generate-object-schemas.test.ts 断言"重新生成 ≡ 已提交"，
 *       TS 类型改动后忘记重跑本脚本会在 CI 失败。
 *
 * 语言中立（issue #419 follow-up）：
 *   - `jsDoc: 'none'` —— 不解析 TS 的中文 JSDoc 注释，schema **不输出任何
 *     description**，只承载结构（type / required / enum / $ref ...）。
 *     字段语义文档以 TS interface 注释（中文，IDE 内可见）为准；schema 作为
 *     对外开放契约保持语言中立，避免中文混入对外标准、也无需双语维护。
 *
 * 后处理（见 ADR-009 要点 2）：
 *   - branded string（如 ObjectId 的 `string & { __brand }`）是编译期防误用手段，
 *     不属于对外契约——凡 definition 含 `__brand` 即降级为纯 { type: 'string' }，
 *     按结构判别而非维护类型名名单，新 brand 出现时自动覆盖。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createFormatter,
  createParser,
  createProgram,
  SchemaGenerator,
  type CompletedConfig,
  type Schema,
} from 'ts-json-schema-generator'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

interface SchemaEntry {
  typeName: string
  /** 相对仓库根 schema/ 目录的输出路径 */
  fileName: string
}

/** 6 个核心对象 + 导出包清单：TS 类型名 → schema 文件路径（kebab-case）
 * （CitationRelation 0.4 功能废弃后移除，#718） */
export const OBJECT_SCHEMAS: ReadonlyArray<SchemaEntry> = [
  { typeName: 'Paper', fileName: 'objects/paper.schema.json' },
  { typeName: 'EvidenceRef', fileName: 'objects/evidence-ref.schema.json' },
  { typeName: 'Note', fileName: 'objects/note.schema.json' },
  { typeName: 'EvidenceSet', fileName: 'objects/evidence-set.schema.json' },
  { typeName: 'Review', fileName: 'objects/review.schema.json' },
  { typeName: 'Proposal', fileName: 'objects/proposal.schema.json' },
  // 导出包清单（DO-2）：导入方先校验清单再解析数据文件
  { typeName: 'ExportManifest', fileName: 'manifest.schema.json' },
]

export const SCHEMA_OUT_DIR = join(REPO_ROOT, 'schema')

const SCHEMA_ID_BASE = 'https://opensci.io/asci/schema/'

/** branded string 定义降级为纯 string（brand 字段不进对外契约）；按 __brand 结构判别 */
function stripBrandedIds(schema: Schema): void {
  const definitions = schema.definitions as Record<string, unknown> | undefined
  if (!definitions) return
  for (const [name, definition] of Object.entries(definitions)) {
    if (JSON.stringify(definition).includes('"__brand"')) {
      definitions[name] = { type: 'string' }
    }
  }
}

/** 生成全部 schema，返回 文件路径（相对 schema/）→ 序列化 JSON 内容（含末尾换行） */
export function generateObjectSchemas(): Map<string, string> {
  // 一次构建 TS Program（覆盖 packages/shared 全部类型），7 个类型共享，避免重复编译
  const config: CompletedConfig = {
    tsconfig: join(REPO_ROOT, 'packages/shared/tsconfig.json'),
    additionalProperties: false,
    skipTypeCheck: true,
    sortProps: true,
    // ↓ CompletedConfig 必填项，取库默认值
    expose: 'export',
    topRef: true,
    // 不解析 JSDoc：schema 不输出中文 description，保持语言中立（见文件头）
    jsDoc: 'none',
    markdownDescription: false,
    extraTags: [],
    functions: 'comment',
    discriminatorType: 'json-schema',
    encodeRefs: true,
    minify: false,
  }
  const program = createProgram(config)
  const generator = new SchemaGenerator(
    program,
    createParser(program, config),
    createFormatter(config),
    config,
  )

  const result = new Map<string, string>()
  for (const { typeName, fileName } of OBJECT_SCHEMAS) {
    const generated = generator.createSchema(typeName)
    stripBrandedIds(generated)
    // $id 置于首位（共享 Program 无法按文件配 schemaId，生成后逐文件补）
    const schema = { $id: `${SCHEMA_ID_BASE}${fileName}`, ...generated }
    result.set(fileName, `${JSON.stringify(schema, null, 2)}\n`)
  }
  return result
}

if (import.meta.main) {
  for (const [fileName, content] of generateObjectSchemas()) {
    const outPath = join(SCHEMA_OUT_DIR, fileName)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, content)
    console.log(`已生成 schema/${fileName}`)
  }
}
