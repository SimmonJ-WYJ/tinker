/**
 * Reviews IPC 通道与类型
 *
 * 主进程 reviews 实体的 UI 侧反查辅助 IPC。当前只有"按 body_path 反查 reviewId"
 * 一项，给综述 HTML 预览（ReviewHtmlPreviewRenderer）→ Add note here 流程使用。
 *
 * 见 docs/superpowers/specs/2026-05-24-review-side-note-design.md
 */

import type { ObjectId } from './objects/index.ts'

export const REVIEWS_IPC_CHANNELS = {
  /** 按 body_path 反查 reviewId（综述 HTML 预览组件 → 启用 Add note here 入口用） */
  RESOLVE_BY_BODY_PATH: 'reviews:resolveByBodyPath',
  /** 列出所有非 deleted 综述（精简：id + title）—— 证据集「补证据 · 综述」选择器候选源（#709） */
  LIST: 'reviews:list',
} as const

export interface ReviewsResolveByBodyPathInput {
  bodyPath: string
}

/** 综述精简项：补证据选择器列表用 */
export interface ReviewSummary {
  id: ObjectId
  title: string
}

export type ReviewsListResult = ReviewSummary[]

/**
 * 找到对应非 deleted 综述 → 返回 { id }；找不到 → null。
 * 仅返回 id 是因为 UI 当前唯一用途是反查 reviewId；要更多字段后续扩展。
 */
export type ReviewsResolveByBodyPathResult = { id: ObjectId } | null
