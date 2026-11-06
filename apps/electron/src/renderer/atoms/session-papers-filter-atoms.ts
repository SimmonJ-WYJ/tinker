/**
 * Session 检索结果筛选 / 排序 atoms（F23）
 *
 * 设计要点：
 * - 按 sessionId 分槽（atomFamily），切会话天然得到独立实例 → 切会话清空筛选状态
 * - 同一会话切面板 / 关闭展开 Dialog 不丢状态 → 满足 issue AC "同会话内保留"
 * - 不写磁盘，重启清空（符合 issue 语义"同会话内"）
 *
 * 范围仅本 issue（F23），不与 workspace-papers Library 共享。
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { NormalizedPaperSource, VenueTier } from '@asci/shared'

export interface SessionPapersFilter {
  /** 年份下限；null = 不限 */
  yearMin: number | null
  /** 年份上限；null = 不限 */
  yearMax: number | null
  /** 来源白名单；空数组 = 不限 */
  sources: NormalizedPaperSource[]
  /** 引用量最小值；null = 不限。档位：10 / 50 / 100 */
  minCitations: number | null
  /** 相关度最小值（0-100）；null = 不限。Filter 弹窗 Score 档位与 Overview 滑块共写此字段 */
  minRelevance: number | null
  /** JCR 分区白名单（'Q1'…'Q4'）；空数组 = 不限。缺分区数据的论文在筛选激活时隐藏 */
  jcrPartitions: string[]
  /** 影响因子最小值；null = 不限。档位：2 / 5 / 10 */
  minImpactFactor: number | null
  /** Venue 等级白名单（不含 'unknown'）；空数组 = 不限。unknown/缺失视为不满足 */
  venueTiers: VenueTier[]
  /** 仅显示有摘要 */
  abstractOnly: boolean
}

export const EMPTY_SESSION_PAPERS_FILTER: SessionPapersFilter = {
  yearMin: null,
  yearMax: null,
  sources: [],
  minCitations: null,
  minRelevance: null,
  jcrPartitions: [],
  minImpactFactor: null,
  venueTiers: [],
  abstractOnly: false,
}

/**
 * 排序模式：相关度 / 引用量 / 年份 / 影响因子 / 来源 / JCR 分区 / Venue 等级，
 * 各支持升降序。null 一律沉底。
 *
 * F22（issue #93）落地后扩展为 6 种排序，默认按相关度降序；
 * Filter 弹窗分组标题的排序箭头补充后 4 种维度。
 * 质量序维度（jcr / venue-tier）desc = 优先（Q1 / top 在前）。
 */
export type SessionPapersSortMode =
  | 'relevance-desc'
  | 'relevance-asc'
  | 'citations-desc'
  | 'citations-asc'
  | 'year-desc'
  | 'year-asc'
  | 'impact-desc'
  | 'impact-asc'
  | 'source-desc'
  | 'source-asc'
  | 'jcr-desc'
  | 'jcr-asc'
  | 'venue-tier-desc'
  | 'venue-tier-asc'

export const DEFAULT_SESSION_PAPERS_SORT: SessionPapersSortMode = 'relevance-desc'

export const sessionPapersFilterFamilyAtom = atomFamily((_sessionId: string) =>
  atom<SessionPapersFilter>({ ...EMPTY_SESSION_PAPERS_FILTER }),
)

export const sessionPapersSortFamilyAtom = atomFamily((_sessionId: string) =>
  atom<SessionPapersSortMode>(DEFAULT_SESSION_PAPERS_SORT),
)

/** 计算当前筛选有几个维度处于激活状态（顶栏徽标用） */
export function countActiveFilters(f: SessionPapersFilter): number {
  let n = 0
  if (f.yearMin != null || f.yearMax != null) n++
  if (f.sources.length > 0) n++
  if (f.minCitations != null) n++
  if (f.minRelevance != null) n++
  if (f.jcrPartitions.length > 0) n++
  if (f.minImpactFactor != null) n++
  if (f.venueTiers.length > 0) n++
  if (f.abstractOnly) n++
  return n
}
