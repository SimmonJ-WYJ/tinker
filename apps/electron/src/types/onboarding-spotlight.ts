/**
 * Onboarding Spotlight 引导类型 + IPC 通道常量（V2 多阶段）
 *
 * 状态机：3 主步 × 7 substage（点击实际控件触发 advance）
 *  - configure-llm: 3 substage（sidebar / add-channel / settings-close）
 *  - connect-zotero: 2 substage（library sidebar / start-zotero in library view）
 *  - new-task: 2 substage（new-task sidebar / starter-chips area）
 */

export type SpotlightStep =
  | 'configure-llm'
  | 'connect-zotero'
  | 'new-task'

export type SpotlightStatus = 'idle' | 'in-progress' | 'completed' | 'skipped'

export interface OnboardingSpotlightState {
  status: SpotlightStatus
  /** 当前主步；status='in-progress' 时有效 */
  currentStep?: SpotlightStep
  /** 当前 step 内的子阶段索引（0 起）；同上 */
  currentSubStage?: number
  /** 完成或跳过的时间戳 */
  finishedAt?: number
}

/** 主步顺序 */
export const SPOTLIGHT_STEPS_ORDER: ReadonlyArray<SpotlightStep> = [
  'configure-llm',
  'connect-zotero',
  'new-task',
]

/** 各 step 的 substage 数量 */
export const SUB_STAGES_PER_STEP: Record<SpotlightStep, number> = {
  'configure-llm': 3,    // sidebar / add-channel / settings-close
  'connect-zotero': 2,   // library sidebar / start-zotero
  'new-task': 2,         // new-task sidebar / starter-chips
}

/** 状态机辅助：返回下一主步；末步返回 null */
export function stepAfter(current: SpotlightStep): SpotlightStep | null {
  const idx = SPOTLIGHT_STEPS_ORDER.indexOf(current)
  if (idx < 0 || idx >= SPOTLIGHT_STEPS_ORDER.length - 1) return null
  return SPOTLIGHT_STEPS_ORDER[idx + 1] ?? null
}

/** Onboarding Spotlight IPC 通道常量 */
export const ONBOARDING_SPOTLIGHT_IPC_CHANNELS = {
  GET: 'onboarding-spotlight:get',
  /** 应用启动时调用：首次安装自动开始引导，老用户保持 null（详见 service.bootstrap()） */
  BOOTSTRAP: 'onboarding-spotlight:bootstrap',
  START: 'onboarding-spotlight:start',
  ADVANCE: 'onboarding-spotlight:advance',
  SKIP_SUB_STAGE: 'onboarding-spotlight:skip-sub-stage',
  COMPLETE: 'onboarding-spotlight:complete',
  SKIP: 'onboarding-spotlight:skip',
  RESTART: 'onboarding-spotlight:restart',
  CHANGED: 'onboarding-spotlight:changed',
} as const

/** 默认 state 工厂（首次完成 OnboardingView 时调用） */
export function createInitialSpotlightState(): OnboardingSpotlightState {
  return {
    status: 'in-progress',
    currentStep: 'configure-llm',
    currentSubStage: 0,
  }
}
