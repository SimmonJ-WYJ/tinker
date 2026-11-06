/**
 * Concept Spotlight — 概念引导 tour（证据集 / 论文 notes）
 *
 * 与 SpotlightOverlay V2（configure-llm/connect-zotero/new-task）完全独立。
 * 每个 tour 独立持久化、独立触发、独立完成。
 */

export type ConceptTourKey = 'evidenceSet' | 'paperNotes'

export type ConceptTourStatus = 'in-progress' | 'completed' | 'skipped'

export interface ConceptTourState {
  status: ConceptTourStatus
  /** 当前 substage 索引（0 起），仅 status='in-progress' 时有效 */
  currentSubStage?: number
  /** 完成/跳过时间戳（毫秒） */
  finishedAt?: number
}

/** 全量状态：未启动的 tour 不出现在对象里 */
export type ConceptSpotlightState = {
  readonly [K in ConceptTourKey]?: ConceptTourState
}

/** 每个 tour 的 substage 数量 */
export const SUB_STAGES_PER_TOUR: Record<ConceptTourKey, number> = {
  evidenceSet: 3,
  paperNotes: 2,
}

/** IPC 通道常量 */
export const CONCEPT_SPOTLIGHT_IPC_CHANNELS = {
  GET_STATE: 'concept-spotlight:get-state',
  START:     'concept-spotlight:start',
  ADVANCE:   'concept-spotlight:advance',
  SKIP:      'concept-spotlight:skip',
  COMPLETE:  'concept-spotlight:complete',
  RESTART:   'concept-spotlight:restart',
  CHANGED:   'concept-spotlight:changed',
} as const
