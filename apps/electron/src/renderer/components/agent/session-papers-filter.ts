/**
 * Session 检索结果筛选 / 排序 / 提取来源 的纯函数集合
 *
 * 抽出来便于单测和复用；UI（SessionPapersPanel）只负责 atom ↔ Props 转换和渲染。
 */

import type { PaperRecord, WorkspacePaperEntry, NormalizedPaperSource, VenueTier } from '@asci/shared'
import { normalizePaperSource, sanitizeText } from '@asci/shared'
import type {
  SessionPapersFilter,
  SessionPapersSortMode,
} from '@/atoms/session-papers-filter-atoms'
import { readCitedBy, readScoreObject, recordKey } from './session-papers-utils'

/** session 面板核心数据单元：一条 record（必有）+ 可选 entry（已入工作区） */
export interface MergedPaperItem {
  record: PaperRecord
  entry: WorkspacePaperEntry | undefined
}

/** entry 字段优先，缺失时用 record 兜底。null = 字段未知 */
export function getYear(item: MergedPaperItem): number | null {
  return item.entry?.year ?? item.record.year ?? null
}

function getAbstract(item: MergedPaperItem): string | null {
  const raw = item.entry?.abstract ?? item.record.abstract ?? null
  // 清洗后判空：纯标签摘要（如 `<jats:p></jats:p>`）清成 '' 不算有摘要
  const a = sanitizeText(raw)
  return a.length > 0 ? a : null
}

function getCitations(item: MergedPaperItem): number | null {
  return readCitedBy(item.entry) ?? readCitedBy(item.record)
}

export function getSource(item: MergedPaperItem): NormalizedPaperSource {
  return normalizePaperSource(item.record.source)
}

export function applyFilter(items: MergedPaperItem[], f: SessionPapersFilter): MergedPaperItem[] {
  // 选中分区集合大写归一化只做一次，避免在逐条过滤里重复转换
  const jcrWanted = f.jcrPartitions.map((q) => q.toUpperCase())
  return items.filter((item) => {
    // 年份区间：null 字段在限制存在时一律视为不满足（避免老论文混入"近 5 年"）
    if (f.yearMin != null || f.yearMax != null) {
      const y = getYear(item)
      if (y == null) return false
      if (f.yearMin != null && y < f.yearMin) return false
      if (f.yearMax != null && y > f.yearMax) return false
    }

    // 来源白名单
    if (f.sources.length > 0) {
      if (!f.sources.includes(getSource(item))) return false
    }

    // 引用量阈值（readCitedBy 已把 0/缺失统一返回 null；筛选时视为不满足）
    if (f.minCitations != null) {
      const c = getCitations(item)
      if (c == null || c < f.minCitations) return false
    }

    // 相关度最小阈值（缺失视为不满足，避免无评分论文混入筛选结果）
    if (f.minRelevance != null) {
      const r = getRelevanceScore(item)
      if (r == null || r < f.minRelevance) return false
    }

    // JCR 分区白名单（缺分区数据视为不满足）；大写包含匹配，同卡片 jcrPartitionClass 口径
    if (jcrWanted.length > 0) {
      const jcr = getJcrPartition(item)
      if (jcr == null) return false
      const upper = jcr.toUpperCase()
      if (!jcrWanted.some((q) => upper.includes(q))) return false
    }

    // 影响因子阈值（IF 缺失或解析失败视为不满足）
    if (f.minImpactFactor != null) {
      const iv = getImpactFactor(item)
      if (iv == null || iv < f.minImpactFactor) return false
    }

    // Venue 等级白名单（缺失 / unknown 视为不满足）
    if (f.venueTiers.length > 0) {
      const tier = getVenueTier(item)
      if (tier == null || !f.venueTiers.includes(tier)) return false
    }

    // 摘要可用性
    if (f.abstractOnly) {
      if (getAbstract(item) == null) return false
    }

    return true
  })
}

/**
 * 从 item 的 extra 读取"相关度"=对题度（0-100 整数或 null）。
 * 优先级 finalRelevance（LLM 语义分×100，rerank 后写入）→ keywordRelevance
 * （关键词命中×100，未 rerank 的尾部）→ relevance（F22 综合分,兜底)。
 * finalRelevance / keywordRelevance 都是"对题度"同轴：精确命中一篇论文 → ~100。
 * relevance(F22) 是质量综合分,仅在前两者都缺时兜底。
 */
function getRelevanceScore(item: MergedPaperItem): number | null {
  const extra = (item.entry?.extra ?? item.record.extra) as Record<string, unknown> | undefined
  if (!extra) return null
  // 七维 score.finalScore 优先（已切到该线路）；旧 finalRelevance/keyword/F22 仅兜底
  const sc = readScoreObject(extra)
  const v = sc && typeof sc.finalScore === 'number'
    ? sc.finalScore
    : (extra.finalRelevance ?? extra.keywordRelevance ?? extra.relevance)
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export { getRelevanceScore }

/** 读取 extra（entry 优先，record 兜底），口径与 getRelevanceScore 一致 */
function getExtra(item: MergedPaperItem): Record<string, unknown> | undefined {
  return (item.entry?.extra ?? item.record.extra) as Record<string, unknown> | undefined
}

/** EasyScholar 期刊排名信息（extra.journalRank，检索后处理补全） */
function getJournalRank(item: MergedPaperItem): { jcrPartition?: unknown; impactFactor?: unknown } | null {
  const jr = getExtra(item)?.journalRank
  if (!jr || typeof jr !== 'object') return null
  return jr as { jcrPartition?: unknown; impactFactor?: unknown }
}

/** JCR 分区原文（如 "Q1"）；缺失 → null */
export function getJcrPartition(item: MergedPaperItem): string | null {
  const v = getJournalRank(item)?.jcrPartition
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

/** 影响因子数值（journalRank 内为字符串，需解析）；缺失 / 非有限数 → null */
export function getImpactFactor(item: MergedPaperItem): number | null {
  const raw = getJournalRank(item)?.impactFactor
  if (raw == null) return null
  const v = Number.parseFloat(String(raw))
  return Number.isFinite(v) ? v : null
}

/** JCR 分区 → 质量分（Q1=4 优 … Q4=1 差），desc 排序 = Q1 在前；无法解析 → null 沉底 */
function jcrQualityRank(item: MergedPaperItem): number | null {
  const jcr = getJcrPartition(item)
  if (jcr == null) return null
  const m = /Q([1-4])/i.exec(jcr)
  return m ? 5 - Number(m[1]) : null
}

/** Venue 等级 → 质量分（top=4 … weak=1），desc 排序 = top 在前；unknown/缺失 → null 沉底 */
const VENUE_TIER_RANK: Record<string, number> = { top: 4, strong: 3, normal: 2, weak: 1 }
function venueTierRank(item: MergedPaperItem): number | null {
  const tier = getVenueTier(item)
  return tier == null ? null : VENUE_TIER_RANK[tier] ?? null
}

/** score 推断的 venue 等级；缺失 / 'unknown' 一律返回 null（筛选时视为不满足） */
export function getVenueTier(item: MergedPaperItem): VenueTier | null {
  const sc = readScoreObject(getExtra(item))
  const tier = sc?.venueTier
  if (tier === 'top' || tier === 'strong' || tier === 'normal' || tier === 'weak') return tier
  return null
}

/**
 * 排序；liveTurnId 非空时（检索流式期间）把该轮 live 记录浮顶 —— 未打分的
 * live 记录在 relevance-desc 下会沉底不可见，浮顶让"边检索边进来"的结果
 * 立即可见；canonical 落地（liveTurnId 转空）后自然回到相关度位置。
 */
export function applySort(
  items: MergedPaperItem[],
  mode: SessionPapersSortMode,
  liveTurnId?: string,
): MergedPaperItem[] {
  const sorted = sortByMode(items, mode)
  if (!liveTurnId) return sorted
  const live = sorted.filter((m) => m.record.turn_id === liveTurnId)
  if (live.length === 0) return sorted
  return [...live, ...sorted.filter((m) => m.record.turn_id !== liveTurnId)]
}

/**
 * 确定性 tie-breaker：主排序键相等时，依次按 引用量↓ → 年份↓ → 稳定身份(recordKey)↑
 * 决出确定顺序，消除"并列时保留输入顺序"导致的检索结果抖动。
 *
 * 背景：同质对题池里大量论文 score.finalScore 完全并列（如 5 篇并列 79.9），
 * JS Array.sort 稳定排序会保留输入顺序，而输入顺序来自并发召回的到达时序，两次
 * 检索之间并不稳定 → 同一 query 重跑 top 列表大幅分叉。tie-breaker 方向恒定（不随
 * 主排序 asc/desc 翻转），保证并列段始终"高引 / 新 / 身份字典序"确定可复现。
 * recordKey 为终极全序键：任意两篇都能定序；匿名条目（recordKey=null）沉底。
 */
function compareTieBreak(a: MergedPaperItem, b: MergedPaperItem): number {
  const ca = getCitations(a) ?? -1
  const cb = getCitations(b) ?? -1
  if (ca !== cb) return cb - ca // 引用多者优先
  const ya = getYear(a) ?? -1
  const yb = getYear(b) ?? -1
  if (ya !== yb) return yb - ya // 新者优先
  const ka = recordKey(a.record)
  const kb = recordKey(b.record)
  if (ka === kb) return 0
  if (ka == null) return 1 // 匿名条目沉底
  if (kb == null) return -1
  return ka < kb ? -1 : 1
}

function sortByMode(
  items: MergedPaperItem[],
  mode: SessionPapersSortMode,
): MergedPaperItem[] {
  return [...items].sort((a, b) => {
    if (mode === 'relevance-desc' || mode === 'relevance-asc') {
      const ra = getRelevanceScore(a)
      const rb = getRelevanceScore(b)
      const dir = mode === 'relevance-desc' ? -1 : 1
      if (ra == null && rb == null) return compareTieBreak(a, b)
      if (ra == null) return 1
      if (rb == null) return -1
      if (ra !== rb) return (ra - rb) * dir
      return compareTieBreak(a, b)
    }
    if (mode === 'year-desc' || mode === 'year-asc') {
      const ya = getYear(a)
      const yb = getYear(b)
      const dir = mode === 'year-desc' ? -1 : 1
      if (ya == null && yb == null) return compareTieBreak(a, b)
      if (ya == null) return 1
      if (yb == null) return -1
      if (ya !== yb) return (ya - yb) * dir
      return compareTieBreak(a, b)
    }
    if (mode === 'impact-desc' || mode === 'impact-asc') {
      const ia = getImpactFactor(a)
      const ib = getImpactFactor(b)
      const dir = mode === 'impact-desc' ? -1 : 1
      if (ia == null && ib == null) return 0
      if (ia == null) return 1
      if (ib == null) return -1
      return (ia - ib) * dir
    }
    if (mode === 'source-desc' || mode === 'source-asc') {
      const dir = mode === 'source-desc' ? -1 : 1
      return getSource(a).localeCompare(getSource(b)) * dir
    }
    if (mode === 'jcr-desc' || mode === 'jcr-asc') {
      const ja = jcrQualityRank(a)
      const jb = jcrQualityRank(b)
      const dir = mode === 'jcr-desc' ? -1 : 1
      if (ja == null && jb == null) return 0
      if (ja == null) return 1
      if (jb == null) return -1
      return (ja - jb) * dir
    }
    if (mode === 'venue-tier-desc' || mode === 'venue-tier-asc') {
      const va = venueTierRank(a)
      const vb = venueTierRank(b)
      const dir = mode === 'venue-tier-desc' ? -1 : 1
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return (va - vb) * dir
    }
    // citations-desc / citations-asc
    const ca = getCitations(a)
    const cb = getCitations(b)
    const dir = mode === 'citations-desc' ? -1 : 1
    if (ca == null && cb == null) return compareTieBreak(a, b)
    if (ca == null) return 1
    if (cb == null) return -1
    if (ca !== cb) return (ca - cb) * dir
    return compareTieBreak(a, b)
  })
}

/**
 * 按 paper 身份去重：同一论文（同 entry.key 或同 recordKey）多次被检到只保留首条。
 *
 * 触发场景：searcher 跑了多次 query，同一篇 paper 在多个 tool_result 里出现；
 * paper-result-recorder 按行写 JSONL，session 面板没有跨条 dedupe，会导致 React
 * 渲染时同一篇 paper 出两张卡片、key 冲突告警，且 UI 噪音。
 *
 * 身份优先级：entry.key（workspace 已 canonical 化）> recordKey（doi/paperId/...
 * 全缺时退到 t:<title>|y:<year>）> 无身份则保留（视作匿名条目，不参与去重）。
 */
export function dedupeByIdentity(items: MergedPaperItem[]): MergedPaperItem[] {
  const seen = new Set<string>()
  const out: MergedPaperItem[] = []
  for (const item of items) {
    const id = item.entry?.key ?? recordKey(item.record)
    if (id == null) {
      out.push(item)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}

/**
 * session record × workspace entry 合并（SessionPapersPanel 与 DOI 点击解析共用）：
 * 保留 record 顺序；按 recordKey 关联 entry；过滤掉无 url 条目；同身份去重。
 *
 * 抽成共享函数的动机：对话流 DOI 点击命中「本次检索」时（useOpenDoiInRightPanel），
 * siblings 翻页列表必须与面板同一口径组装，否则 n/total 分母对不上。
 */
export function buildMergedPaperItems(
  records: PaperRecord[],
  workspacePapers: WorkspacePaperEntry[],
): MergedPaperItem[] {
  const byKey = new Map<string, WorkspacePaperEntry>()
  for (const e of workspacePapers) byKey.set(e.key, e)
  const joined = records
    .map((r) => {
      const k = recordKey(r)
      const rawEntry = k ? byKey.get(k) : undefined
      // #685 详情页摘要回退：workspace entry 缺摘要、但本次会话 record 补到了
      // （enrich 恢复的 abstract 先落 session JSONL）→ 展示层用 record 的摘要补上 entry，
      // 让详情面板（只读 entry.abstract）与列表卡片口径一致。仅内存合并，不改盘上
      // workspace 数据；真正的持久化回流由 workspace-paper-store 单独修。
      const entry =
        rawEntry && !(rawEntry.abstract || '').trim() && (r.abstract || '').trim()
          ? { ...rawEntry, abstract: r.abstract }
          : rawEntry
      return { record: r, entry }
    })
    // 有 url 才展示（entry.url 优先，其次看 record.url）；无 url 的条目一律隐藏
    .filter(({ record, entry }) => Boolean(entry?.url) || Boolean(record.url))
  return dedupeByIdentity(joined)
}

