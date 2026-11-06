/**
 * 工作区论文库索引读写
 *
 * 文件位置：~/.asci/agent-workspaces/{slug}/papers.jsonl（每行一条 WorkspacePaperEntry）
 *
 * 写入入口：
 *   - appendOrMerge(slug, papers, sessionId)  ← 由 paper-result-recorder 在 session 落地后调用
 *   - update(slug, key, patch)                 ← 用户在 UI 改标注 / 系统副作用回填
 *   - batchUpdate(slug, keys, patch)
 *
 * 关键不变量：
 *   1. 用户标注层（status/starred/tags/note/noteRelPath/pdfRelPath/linkedZoteroKey）
 *      只能由 update / batchUpdate 修改，appendOrMerge 永不覆盖
 *   2. 论文身份字段（title/authors/year/venue/url/abstract/extra）由 appendOrMerge
 *      在"字段更全"时升级（用 isRicher 判断）
 *   3. 当前实现是纯同步 fs，Electron 主进程下天然串行；无需额外锁
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PaperRecord, WorkspacePaperEntry, WorkspacePapersFilter, WorkspacePaperPatch } from '@asci/shared'
import { normalizeDoi, sanitizeText } from '@asci/shared'
import { getWorkspacePapersPath } from './config-paths'

// ===== 公共 API =====

/**
 * 把一组 PaperRecord 按 key 去重合并到工作区索引。
 * 同步版本：内部用 fs 同步 IO，Electron 主进程下天然串行。
 *
 * opts.onlyExisting：true 时只刷新已存在条目（缺失 key 直接跳过、不新建）。
 *   用于 retrieve 后的自动回流——只让已加入文献库的条目随新检索刷新身份字段
 *   （abstract/venue/citations 缺→有），绝不为「未加入」论文凭检索结果新建条目
 *   （规避历史上自动回流抠 DOI 片段产生大量占位条目的问题，见 #702）。
 */
export function appendOrMerge(
  slug: string,
  papers: PaperRecord[],
  sessionId: string,
  opts?: { onlyExisting?: boolean },
): WorkspacePaperEntry[] {
  if (papers.length === 0) return []
  const filePath = getWorkspacePapersPath(slug)
  // onlyExisting 回流：文献库还没有任何条目时无可刷新，直接短路——省掉 retrieve 热路径上
  // 对整份 jsonl 的 read+parse（多数检索命中 0 条已加入条目，见 #702）。
  if (opts?.onlyExisting && !existsSync(filePath)) return []
  mkdirSync(dirname(filePath), { recursive: true })

  const existing = readAll(filePath)
  const byKey = new Map<string, WorkspacePaperEntry>()
  for (const e of existing) byKey.set(e.key, e)

  // 记录哪些 key 在本批处理中被改动过
  const touchedKeys = new Set<string>()

  for (const raw of papers) {
    // 入口处做 DOI / 标识符规范化，防止脏 DOI（带反引号、冒号、引号等
    // markdown 残余）进入 jsonl 后再也匹配不上 wiki 索引
    const p = sanitizeRecord(raw)
    const key = recordKey(p)
    if (!key) continue
    const prev = byKey.get(key)

    if (prev) {
      // 升级路径
      const isNewSessionHit = !prev.sessionRefs.includes(sessionId)
      const richer = isRicherIdentity(p, prev)
      // #685：「缺摘要 → 有摘要」单独放行回填——补一个缺失摘要是最高价值的升级，
      // 不应被 isRicherIdentity 的 +2 门槛挡掉（旧条目已有作者/年/刊/url 时，仅 +abstract
      // 只值 +1 分过不了门槛）。单独只回填 abstract，不借 identityFromRecord 覆盖其它身份
      // 字段，避免用更稀疏的 incoming 把更全的现有 title/authors 等冲掉。
      const gainedAbstract =
        !(prev.abstract || '').trim() && !!(p.abstract || '').trim()
      const merged: WorkspacePaperEntry = {
        ...prev,
        // 论文身份字段：字段更全的覆盖
        ...(richer ? identityFromRecord(p) : {}),
        // 摘要单独回填（仅在未走整体升级时补，避免重复）
        ...(!richer && gainedAbstract ? { abstract: p.abstract } : {}),
        // 系统字段：lastSeenAt 取较新值（单调不减）。同一篇可能在一批里出现多条
        // （reflow 重 merge 整个 session 历史时，同论文跨 turn 多次命中），且 records 按
        // ts 降序传入 → 最后处理的是最旧记录，若无条件覆盖会让 lastSeenAt 回退到最旧 ts，
        // 进而扰乱 list() 的 lastSeenAt 降序排序。
        lastSeenAt: prev.lastSeenAt > p.ts ? prev.lastSeenAt : p.ts,
        seenCount: isNewSessionHit ? prev.seenCount + 1 : prev.seenCount,
        sessionRefs: isNewSessionHit ? [...prev.sessionRefs, sessionId] : prev.sessionRefs,
      }
      byKey.set(key, merged)
      touchedKeys.add(key)
    } else {
      // onlyExisting：仅刷新模式下跳过新建（不为「未加入」论文凭检索结果建条目）
      if (opts?.onlyExisting) continue
      // 新建路径
      const fresh: WorkspacePaperEntry = {
        ...identityFromRecord(p),
        status: 'unread',
        starred: false,
        tags: [],
        note: null,
        noteRelPath: null,
        pdfRelPath: null,
        linkedZoteroKey: null,
        key,
        firstSeenAt: p.ts,
        lastSeenAt: p.ts,
        sessionRefs: [sessionId],
        seenCount: 1,
      }
      byKey.set(key, fresh)
      touchedKeys.add(key)
    }
  }

  // onlyExisting 回流大多命中 0 条（多数检索结果尚未加入文献库），跳过重写省掉
  // retrieve 热路径上的无谓 read-rewrite。仅限 onlyExisting：默认路径即便 0 改动也要
  // writeAll 一次——readAll 静默丢损坏行，写回顺带压实脏数据（头注释「下一次写入即可自愈」），
  // 此自愈副作用不能因本短路丢失。
  if (opts?.onlyExisting && touchedKeys.size === 0) return []

  writeAll(filePath, [...byKey.values()])
  // 只返回本次处理中被改动的条目（最终状态）
  const touched = Array.from(touchedKeys).map((k) => byKey.get(k)!).filter(Boolean)
  return touched
}

/** 列出工作区论文，支持基础筛选 */
export function list(slug: string, filter: WorkspacePapersFilter): WorkspacePaperEntry[] {
  const all = readAll(getWorkspacePapersPath(slug))
  let result = all

  if (filter.status && filter.status.length > 0) {
    const set = new Set(filter.status)
    result = result.filter((e) => set.has(e.status))
  }
  if (filter.starred !== undefined) {
    result = result.filter((e) => e.starred === filter.starred)
  }
  if (filter.tags && filter.tags.length > 0) {
    const wanted = filter.tags
    result = result.filter((e) => wanted.every((t) => e.tags.includes(t)))
  }
  if (filter.keyword && filter.keyword.trim()) {
    const kw = filter.keyword.toLowerCase()
    result = result.filter((e) =>
      e.title.toLowerCase().includes(kw) ||
      e.authors.some((a) => a.toLowerCase().includes(kw)) ||
      // 摘要清洗后再匹配：标签/实体不干扰关键词命中（历史脏数据也能命中净文本）
      sanitizeText(e.abstract).toLowerCase().includes(kw),
    )
  }

  // 默认按 lastSeenAt 倒序
  result.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0))

  const offset = filter.offset ?? 0
  const limit = filter.limit ?? Infinity
  return result.slice(offset, offset + limit)
}

/** 取单条 */
export function get(slug: string, key: string): WorkspacePaperEntry | null {
  const all = readAll(getWorkspacePapersPath(slug))
  return all.find((e) => e.key === key) ?? null
}

/** 改单条标注层。不存在的 key 抛错。 */
export function update(slug: string, key: string, patch: WorkspacePaperPatch): WorkspacePaperEntry {
  const filePath = getWorkspacePapersPath(slug)
  const all = readAll(filePath)
  const idx = all.findIndex((e) => e.key === key)
  if (idx < 0) throw new Error(`论文条目不存在: ${key}`)
  const merged = applyPatch(all[idx]!, patch)
  all[idx] = merged
  writeAll(filePath, all)
  return merged
}

/** 批量改 */
export function batchUpdate(slug: string, keys: string[], patch: WorkspacePaperPatch): WorkspacePaperEntry[] {
  if (keys.length === 0) return []
  const filePath = getWorkspacePapersPath(slug)
  const all = readAll(filePath)
  const keySet = new Set(keys)
  const touched: WorkspacePaperEntry[] = []
  for (let i = 0; i < all.length; i++) {
    if (keySet.has(all[i]!.key)) {
      all[i] = applyPatch(all[i]!, patch)
      touched.push(all[i]!)
    }
  }
  writeAll(filePath, all)
  return touched
}

// ===== 内部工具 =====

function applyPatch(entry: WorkspacePaperEntry, patch: WorkspacePaperPatch): WorkspacePaperEntry {
  return {
    ...entry,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.starred !== undefined ? { starred: patch.starred } : {}),
    ...(patch.tags !== undefined ? { tags: [...patch.tags] } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.noteRelPath !== undefined ? { noteRelPath: patch.noteRelPath } : {}),
    ...(patch.pdfRelPath !== undefined ? { pdfRelPath: patch.pdfRelPath } : {}),
    ...(patch.linkedZoteroKey !== undefined ? { linkedZoteroKey: patch.linkedZoteroKey } : {}),
  }
}

function readAll(filePath: string): WorkspacePaperEntry[] {
  if (!existsSync(filePath)) return []
  const out: WorkspacePaperEntry[] = []
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      const raw = JSON.parse(line) as WorkspacePaperEntry
      // 兜底：旧数据或外部来源可能把 authors 存为 string 而非 string[]
      raw.authors = normalizeAuthors(raw.authors)
      out.push(raw)
    } catch {
      // 损坏行跳过
    }
  }
  return out
}

/** 将 authors 字段从 string | string[] | unknown 规范为 string[] */
function normalizeAuthors(authors: unknown): string[] {
  if (Array.isArray(authors)) return authors.filter((a): a is string => typeof a === 'string')
  if (typeof authors === 'string' && authors.trim()) {
    return authors.split(/[,，;；、]/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

function writeAll(filePath: string, entries: WorkspacePaperEntry[]): void {
  const text = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '')
  writeFileSync(filePath, text, 'utf-8')
}

function identityFromRecord(p: PaperRecord): Pick<WorkspacePaperEntry,
  'title' | 'authors' | 'year' | 'venue' | 'doi' | 'url' | 'abstract' | 'extra'
> {
  return {
    title: p.title,
    authors: [...p.authors],
    year: p.year,
    venue: p.venue,
    doi: p.doi,
    url: p.url,
    abstract: p.abstract,
    extra: p.extra,
  }
}

function isRicherIdentity(incoming: PaperRecord, existing: WorkspacePaperEntry): boolean {
  // 占位标题被真标题替换
  const placeholders = new Set(['(无标题)', '(DOI 片段)'])
  if (placeholders.has(existing.title) && !placeholders.has(incoming.title)) return true
  // 否则按字段填充度打分（差距 ≥2 才升级，避免无谓覆盖）
  // 作者数独立计分，不只是 0/1
  const score = (e: { authors: string[]; year: number | null; venue: string | null; url: string | null; abstract: string | null }): number =>
    (e.authors.length > 1 ? Math.min(e.authors.length, 3) : 0) + // 作者数 ≥2 才记分，最多 3 分
    (e.year ? 1 : 0) +
    (e.venue ? 1 : 0) +
    (e.url ? 1 : 0) +
    (e.abstract ? 1 : 0)
  return score(incoming) >= score(existing) + 2
}

/**
 * 入口规范化：清洗 doi 与 extra 中的其它身份字段。
 *
 * 历史脏数据（带反引号 / 冒号 / markdown 残余的 doi）进入 jsonl 后，recordKey
 * 形如 `doi:10.x.y\``，与 wiki 索引中干净的 `doi:10.x.y` 永远匹配不上，
 * 综述时全部走 abstract 兜底。在 ingress 统一 normalize 后，下一次写入即可
 * 自愈（旧条目仍是脏 key，但新数据合并时会以新 key 创建干净副本）。
 */
function sanitizeRecord(p: PaperRecord): PaperRecord {
  const cleanDoi = normalizeDoi(p.doi)
  const extra = (p.extra ?? {}) as Record<string, unknown>
  const cleanedExtra: Record<string, unknown> = { ...extra }
  // extra 中可能藏有 doi（部分 connector 把 doi 也塞 extra），同样过一遍
  if (typeof extra.doi === 'string') {
    const eDoi = normalizeDoi(extra.doi)
    if (eDoi) cleanedExtra.doi = eDoi
    else delete cleanedExtra.doi
  }
  // arxivId / paperId / pmid / openalexId：trim + 去尾随反引号即可
  const stringIdKeys = ['paperId', 'arxivId', 'pmid', 'openalexId'] as const
  for (const k of stringIdKeys) {
    const v = extra[k]
    if (typeof v === 'string') {
      const cleaned = v.trim().replace(/[\s.,;:`'"]+$/, '')
      if (cleaned) cleanedExtra[k] = cleaned
      else delete cleanedExtra[k]
    }
  }
  // 摘要清洗：剥 JATS / HTML 标签、解实体、去不可见符，写入 jsonl 即净（下游 MCP /
  //   渲染读到的就是干净文本，无需在读出层再清洗）。纯标签摘要清成 '' → null。
  const cleanAbstract = p.abstract != null ? sanitizeText(p.abstract) || null : null
  return { ...p, doi: cleanDoi, abstract: cleanAbstract, extra: cleanedExtra }
}

/**
 * 与 paper-result-recorder.ts:818 的 recordKey 等价（v1 直接复制实现，避免循环依赖）。
 * 注意：调用前应先经过 sanitizeRecord，确保 r.doi 已规范化。
 */
function recordKey(r: PaperRecord): string | null {
  if (r.doi) return `doi:${r.doi.toLowerCase()}`
  const extra = (r.extra ?? {}) as Record<string, unknown>
  if (typeof extra.paperId === 'string') return `pid:${extra.paperId}`
  if (typeof extra.arxivId === 'string') return `arx:${extra.arxivId}`
  if (typeof extra.pmid === 'string') return `pmid:${extra.pmid}`
  if (typeof extra.openalexId === 'string') return `oa:${extra.openalexId}`
  if (r.title && r.title !== '(无标题)' && r.title !== '(DOI 片段)') {
    // title 走 sanitizeText，与 paper-result-recorder recordKey 等价：旧脏标题与新净标题哈希一致
    return `t:${sanitizeText(r.title).toLowerCase()}|y:${r.year ?? ''}`
  }
  return null
}

// ===== 测试导出 =====

export const __testing__ = { isRicherIdentity, recordKey, sanitizeRecord }
