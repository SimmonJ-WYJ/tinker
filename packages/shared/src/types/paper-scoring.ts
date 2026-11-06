/**
 * 证据驱动文献评分 v2 的前端类型契约（与服务端 paper_scoring.score_record 输出对齐）。
 *
 * 写入 session 论文 record 的 `extra.score`，与 v1（relevance / finalRelevance）并行。
 * 设计母本见 docs/specs/lit-scoring-agent-spec.md。
 */

/** venue 强度档 */
export type VenueTier = 'top' | 'strong' | 'normal' | 'weak' | 'unknown'

/** venue 类型 */
export type VenueType = 'journal' | 'conference' | 'workshop' | 'repository' | 'preprint' | 'unknown'

/** 出版状态 */
export type PublicationStatus =
  | 'preprint_only'
  | 'preprint_with_doi'
  | 'accepted_pending_publication'
  | 'published_workshop'
  | 'published_conference'
  | 'published_journal'
  | 'published_repository'
  | 'unknown'

/** 推荐等级（final_score → level） */
export type ScoreLevel = 'S' | 'A' | 'B' | 'C' | 'D'

/** 七维分数（null = 缺数据，触发权重重分配；不是 0/差） */
export interface ScoreDimensions {
  semantic_relevance: number | null
  method_match: number | null
  venue_quality: number | null
  publication_status: number | null
  recency: number | null
  paper_influence: number | null
  reproducibility: number | null
}

/** record.extra.score 的完整结构 */
export interface PaperScore {
  version: number
  scores: ScoreDimensions
  /** 相关性分 0-100（semantic + method）—— 主导排序 */
  relevanceScore: number
  /** 质量分 0-100（venue/出版/时效/影响力/可复现）—— 二级标注；全缺为 null */
  qualityScore: number | null
  /** 缺数据、被重分配权重的维度名 */
  nullFields: string[]
  /** 综合分 0-100 = 0.8×relevanceScore + 0.2×qualityScore（相关性主导，质量二级） */
  finalScore: number
  /** 内部等级（前端不展示 S/A/B/C/D） */
  level?: ScoreLevel
  /** 关键字段证据置信度加权（0-1），不乘进 finalScore，仅展示 + 同分次级排序 */
  dataConfidence: number
  venueTier: VenueTier
  venueMatchConfidence: number
  publicationStatus: PublicationStatus
  publicationStatusConfidence: number
  venueType: VenueType
  /** 人类可读排序理由 */
  reason: string
}
