/**
 * Paper 同步 service
 *
 * 把外部源（Zotero 父条目元数据 / Review 引文反推 / 未来的 workspace
 * papers.jsonl）的论文记录幂等地写进 `papers` 表，作为 App 级稳定论文索引。
 *
 * 去重 key 优先级：`doi → zoteroKey → (title+year)`。
 *
 * 字段合并策略（"补空不覆盖"）：
 *   - 现有行已有非空字段时，不被新输入覆盖（保护人工编辑 / 更权威源）
 *   - 现有行字段为空时，由新输入补齐
 *   - authors：现有行非空数组则保留；现有为空时用新输入
 *   - source 优先级（zotero > workspace-jsonl > review-citation）目前**仅用于
 *     批内同 key 多输入排序**；与现有行的合并仍走"补空不覆盖"。
 *     未来若需要"高优先级源可覆盖低优先级源"，加 confidence/source 列再扩展。
 *
 * 不做：
 *   - 不删行：jsonl 移除 / Zotero 删除都不动 `papers`，避免 evidence_refs 悬空
 *   - 不软删：软删走 `softDeletePaper`，是用户显式操作
 *   - 不解析 author 表：authors 仍是 JSON 数组（仓储层负责）
 *
 * 失败语义：单条转换失败（缺 title 等）→ 计入 skipped，不抛错；DB 层异常
 * 仍向上抛，由调用方决定 warn / retry。
 */

import type { Paper } from '@asci/shared'

import type { RepoDb } from './internal/repo-db.ts'
import {
  createPaper,
  getPaperByDoi,
  findPaperByZoteroKey,
  listPapers,
  updatePaper,
} from './repositories/paper-repository.ts'

/** 同步源（影响批内同 key 排序；不影响"补空不覆盖"合并规则） */
export type PaperSyncSource = 'workspace-jsonl' | 'zotero' | 'review-citation'

/** 同步输入：调用方把各源转成此结构 */
export interface PaperSyncInput {
  source: PaperSyncSource
  /** title 必填；其余可选 */
  title: string
  authors?: string[]
  abstract?: string | null
  year?: number | null
  venue?: string | null
  doi?: string | null
  url?: string | null
  zoteroKey?: string | null
}

export interface PaperSyncResult {
  created: number
  updated: number
  /** 缺 title 或归一化后无可用去重 key 时跳过 */
  skipped: number
  /** 每条输入对应的 paper.id；input 顺序与本数组一一对应，skipped 输入对应 null */
  paperIds: Array<Paper['id'] | null>
}

const SOURCE_PRIORITY: Record<PaperSyncSource, number> = {
  zotero: 3,
  'workspace-jsonl': 2,
  'review-citation': 1,
}

/**
 * 批量同步入口
 *
 * 流程：
 *   1) 过滤无 title 的脏输入
 *   2) 按 (doi / zoteroKey / titleYearKey) 分组合并，组内按 source 优先级取 base，
 *      其他条目以"补空"姿态合并进 base
 *   3) 对每个合并后的输入：先按 doi → zoteroKey 查现有行；命中则 update（补空），
 *      未命中则 create
 *   4) 整批同事务（任一插入失败回滚）
 *
 * 返回的 `paperIds[i]` 与入参 `inputs[i]` 一一对应（skipped 项为 null），便于
 * 调用方在事务外把 paperId 写到 evidence_refs 上。
 */
export function syncPapers(db: RepoDb, inputs: readonly PaperSyncInput[]): PaperSyncResult {
  const result: PaperSyncResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    paperIds: new Array(inputs.length).fill(null),
  }
  if (inputs.length === 0) return result

  // 1) 过滤无 title
  const valid: Array<{ idx: number; input: PaperSyncInput }> = []
  inputs.forEach((input, idx) => {
    if (!input.title || input.title.trim().length === 0) {
      result.skipped++
      return
    }
    valid.push({ idx, input })
  })
  if (valid.length === 0) return result

  // 2) 分组合并：组内按 source 优先级排序，第一条作为 base，后续以"补空"合并
  //    分组 key 顺序与去重一致：doi → zoteroKey → titleYearKey
  const groups = new Map<string, Array<{ idx: number; input: PaperSyncInput }>>()
  for (const entry of valid) {
    const key = computeGroupKey(entry.input)
    if (!key) {
      result.skipped++
      continue
    }
    const arr = groups.get(key)
    if (arr) arr.push(entry)
    else groups.set(key, [entry])
  }

  // 3) 同事务批量写
  db.transaction(() => {
    for (const entries of groups.values()) {
      // 排序：source 优先级降序；批内同优先级保持入参顺序
      entries.sort((a, b) => SOURCE_PRIORITY[b.input.source] - SOURCE_PRIORITY[a.input.source])
      // 组内合并成单条 effective input（base = 最高优先级；其他条目补空 base）
      const merged = mergeGroup(entries.map((e) => e.input))

      // 归一化 DOI：DOI spec 大小写无关，统一存归一形式才能跨批稳定 dedup
      const normalizedDoi = normalizeDoi(merged.doi)

      // 4) 写库：先 doi 反查，再 zoteroKey 反查，再 title+year 兜底扫
      let existing: Paper | null = null
      if (normalizedDoi) existing = getPaperByDoi(db, normalizedDoi)
      if (!existing && merged.zoteroKey) existing = findPaperByZoteroKey(db, merged.zoteroKey)
      if (!existing && !normalizedDoi && !merged.zoteroKey) {
        existing = findByTitleYear(db, merged.title, merged.year ?? null)
      }

      let paper: Paper
      if (existing) {
        const patch = buildUpdatePatch(existing, merged, normalizedDoi)
        if (hasAnyPatchField(patch)) {
          paper = updatePaper(db, existing.id, patch)
          result.updated++
        } else {
          paper = existing
        }
      } else {
        paper = createPaper(db, {
          title: merged.title,
          authors: merged.authors ?? [],
          abstract: merged.abstract ?? undefined,
          year: merged.year ?? undefined,
          venue: merged.venue ?? undefined,
          doi: normalizedDoi ?? undefined,
          url: merged.url ?? undefined,
          zoteroKey: merged.zoteroKey ?? undefined,
        })
        result.created++
      }
      for (const entry of entries) {
        result.paperIds[entry.idx] = paper.id
      }
    }
  })()

  return result
}

/**
 * 组 key：doi（小写归一）→ zoteroKey → titleYearKey
 *
 * 三者都没有有效值 → null（调用方计入 skipped）。
 * 注意：title-only（无 year）也允许成组，因为部分 review 引文确实查不到 year，
 * 总比直接丢弃强；误合并风险接受。
 */
function computeGroupKey(input: PaperSyncInput): string | null {
  const doi = normalizeDoi(input.doi)
  if (doi) return `doi:${doi}`
  const z = input.zoteroKey?.trim()
  if (z) return `zk:${z}`
  const title = normalizeTitle(input.title)
  if (!title) return null
  const year = typeof input.year === 'number' ? String(input.year) : ''
  return `ty:${title}|${year}`
}

/** DOI 归一：去前缀、小写、trim；空串返回 null */
function normalizeDoi(doi: string | null | undefined): string | null {
  if (!doi) return null
  let s = doi.trim().toLowerCase()
  if (!s) return null
  // 去 https://doi.org/ / doi: 前缀
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  s = s.replace(/^doi:\s*/, '')
  return s.length > 0 ? s : null
}

/** Title 归一：lowercase + 标点替换为空格 + 折叠空白
 * 注意：标点必须替换为空格而非删除，否则 `Long-Context` 与 `long context`
 * 会落到不同的归一形式，破坏跨批 dedup。
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 组内合并：以第一条（已按 source 优先级排序）为 base，
 * 其他条目仅补 base 中为空 / 缺失的字段。
 */
function mergeGroup(items: PaperSyncInput[]): PaperSyncInput {
  const base: PaperSyncInput = { ...items[0]! }
  // doi/zoteroKey 在去重时已归一，但 base 字段保留原始大小写
  for (let i = 1; i < items.length; i++) {
    const cur = items[i]!
    if (!isNonEmptyArray(base.authors) && isNonEmptyArray(cur.authors)) base.authors = cur.authors
    if (!isNonEmptyStr(base.abstract) && isNonEmptyStr(cur.abstract)) base.abstract = cur.abstract!
    if (base.year == null && cur.year != null) base.year = cur.year
    if (!isNonEmptyStr(base.venue) && isNonEmptyStr(cur.venue)) base.venue = cur.venue!
    if (!isNonEmptyStr(base.doi) && isNonEmptyStr(cur.doi)) base.doi = cur.doi!
    if (!isNonEmptyStr(base.url) && isNonEmptyStr(cur.url)) base.url = cur.url!
    if (!isNonEmptyStr(base.zoteroKey) && isNonEmptyStr(cur.zoteroKey)) base.zoteroKey = cur.zoteroKey!
  }
  return base
}

/** 现有行 + 合并输入 → updatePaper 入参（仅含"补空"字段） */
function buildUpdatePatch(
  existing: Paper,
  merged: PaperSyncInput,
  normalizedDoi: string | null,
): Parameters<typeof updatePaper>[2] {
  const patch: Parameters<typeof updatePaper>[2] = {}
  if (!isNonEmptyArray(existing.authors) && isNonEmptyArray(merged.authors)) {
    patch.authors = merged.authors
  }
  if (!isNonEmptyStr(existing.abstract) && isNonEmptyStr(merged.abstract))
    patch.abstract = merged.abstract!
  if (existing.year == null && merged.year != null) patch.year = merged.year
  if (!isNonEmptyStr(existing.venue) && isNonEmptyStr(merged.venue)) patch.venue = merged.venue!
  if (!isNonEmptyStr(existing.doi) && normalizedDoi) patch.doi = normalizedDoi
  if (!isNonEmptyStr(existing.url) && isNonEmptyStr(merged.url)) patch.url = merged.url!
  if (!isNonEmptyStr(existing.zoteroKey) && isNonEmptyStr(merged.zoteroKey))
    patch.zoteroKey = merged.zoteroKey!
  return patch
}

/**
 * Title+year 兜底扫描
 *
 * 仅当一组输入既无 DOI 又无 zoteroKey 时调用 —— 这是慢路径，扫全表 + 内存归一
 * 比较。可见 Paper 总量在桌面端规模合理（万级以内），不引索引。
 */
function findByTitleYear(db: RepoDb, title: string, year: number | null): Paper | null {
  const target = normalizeTitle(title)
  if (!target) return null
  for (const p of listPapers(db)) {
    if (normalizeTitle(p.title) !== target) continue
    if (year != null && p.year != null && p.year !== year) continue
    return p
  }
  return null
}

function hasAnyPatchField(patch: Parameters<typeof updatePaper>[2]): boolean {
  return Object.keys(patch).length > 0
}

function isNonEmptyStr(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trim().length > 0
}

function isNonEmptyArray<T>(arr: T[] | undefined | null): arr is T[] {
  return Array.isArray(arr) && arr.length > 0
}

/** 便于测试单独调用归一化逻辑 */
export const __testing__ = {
  computeGroupKey,
  normalizeDoi,
  normalizeTitle,
  mergeGroup,
}
