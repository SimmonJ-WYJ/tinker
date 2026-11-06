/**
 * Onboarding Spotlight 引导 — 主进程单例（V2 多阶段）
 *
 * - 状态机：3 step × 7 substage（详见 SUB_STAGES_PER_STEP）
 * - 单向推进：advance({ from, fromSubStage }) 双重守卫
 * - skipSubStage：仅推进当前 substage（用于 2b 没装 Zotero）
 * - 老用户兼容：onboardingSpotlight 字段缺失 → null；V1 字段 introduce-input → new-task 迁移
 * - V2 不再依赖业务事件钩子（删除 maybeAdvanceFromBusiness）
 */

import type { OnboardingSpotlightState, SpotlightStep } from '../../types/onboarding-spotlight'
import {
  SUB_STAGES_PER_STEP,
  stepAfter,
  createInitialSpotlightState,
} from '../../types/onboarding-spotlight'
import { nowMs } from '@asci/shared'
import { getSettings, updateSettings, isFreshInstall } from './settings-service'

type Listener = (state: OnboardingSpotlightState) => void
const listeners = new Set<Listener>()

function readState(): OnboardingSpotlightState | null {
  const settings = getSettings()
  const raw = settings.onboardingSpotlight
  if (!raw) return null

  // V1 → V2 字段迁移：introduce-input → new-task
  // 用 unknown 中转再 cast，避免交叉类型收窄导致 TS2367 比较报错
  const rawObj = raw as unknown as OnboardingSpotlightState & { currentStep?: string }
  let currentStep: string | undefined = rawObj.currentStep
  if (currentStep === 'introduce-input') currentStep = 'new-task'

  return {
    status: rawObj.status,
    currentStep: currentStep as SpotlightStep | undefined,
    currentSubStage: rawObj.currentSubStage ?? (rawObj.currentStep ? 0 : undefined),
    finishedAt: rawObj.finishedAt,
  }
}

function writeState(next: OnboardingSpotlightState): OnboardingSpotlightState {
  updateSettings({ onboardingSpotlight: next })
  for (const listener of listeners) {
    try {
      listener(next)
    } catch (error) {
      console.error('[Onboarding Spotlight] listener 异常:', error)
    }
  }
  return next
}

/** 内部辅助：当前 (step, subStage) 推进到下一个 — 跨 step 时回到 substage 0 */
function nextLocation(
  currentStep: SpotlightStep,
  currentSubStage: number,
): { status: 'in-progress'; step: SpotlightStep; subStage: number } | { status: 'completed' } {
  const total = SUB_STAGES_PER_STEP[currentStep]
  if (currentSubStage + 1 < total) {
    return { status: 'in-progress', step: currentStep, subStage: currentSubStage + 1 }
  }
  const next = stepAfter(currentStep)
  if (next === null) return { status: 'completed' }
  return { status: 'in-progress', step: next, subStage: 0 }
}

export const onboardingSpotlightService = {
  getState(): OnboardingSpotlightState | null {
    return readState()
  },

  /**
   * 应用启动时的 spotlight 引导入口（renderer 在 App mount 时调一次）
   *
   * - 真·首次安装（settings.json 不存在）→ 自动 start()，唤起 onboarding 引导
   * - 老用户升级（settings.json 已存在但无 onboardingSpotlight 字段）→ 保持 null，
   *   不强制重走（参考 [[onboarding-first-launch-rule]]）
   * - 已有持久化状态（in-progress / completed / skipped）→ 原样返回
   */
  bootstrap(): OnboardingSpotlightState | null {
    const existing = readState()
    if (existing) return existing
    if (isFreshInstall()) return this.start()
    return null
  },

  /** 启动 spotlight；已 in-progress 则保留当前位置 */
  start(): OnboardingSpotlightState {
    const existing = readState()
    if (existing && existing.status === 'in-progress') return existing
    return writeState(createInitialSpotlightState())
  },

  /** 显式推进：仅当 (from, fromSubStage) 与当前匹配时推进 */
  advance(opts: { from: SpotlightStep; fromSubStage: number }): OnboardingSpotlightState {
    const current = readState()
    if (!current || current.status !== 'in-progress') {
      return current ?? createInitialSpotlightState()
    }
    if (current.currentStep !== opts.from || current.currentSubStage !== opts.fromSubStage) {
      return current  // 守卫：不匹配不动
    }

    const target = nextLocation(opts.from, opts.fromSubStage)
    if (target.status === 'completed') {
      return writeState({ status: 'completed', finishedAt: nowMs() })
    }
    return writeState({
      status: 'in-progress',
      currentStep: target.step,
      currentSubStage: target.subStage,
    })
  },

  /** 仅推进当前 substage（不终止 spotlight）— 用于 2b 没装 Zotero */
  skipSubStage(): OnboardingSpotlightState {
    const current = readState()
    if (!current || current.status !== 'in-progress' || !current.currentStep) {
      return current ?? createInitialSpotlightState()
    }
    const target = nextLocation(current.currentStep, current.currentSubStage ?? 0)
    if (target.status === 'completed') {
      return writeState({ status: 'completed', finishedAt: nowMs() })
    }
    return writeState({
      status: 'in-progress',
      currentStep: target.step,
      currentSubStage: target.subStage,
    })
  },

  /** 直接标记完成（3b 主按钮 / 监听 chip click） */
  complete(): OnboardingSpotlightState {
    return writeState({ status: 'completed', finishedAt: nowMs() })
  },

  /** 用户点"跳过引导"终止整个 spotlight */
  skip(): OnboardingSpotlightState {
    return writeState({ status: 'skipped', finishedAt: nowMs() })
  },

  /** 头像菜单"重看引导"：从任意状态回到 (configure-llm, 0) */
  restart(): OnboardingSpotlightState {
    return writeState(createInitialSpotlightState())
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** 仅供测试：重置所有模块级状态（当前：listeners） */
  __resetForTests(): void {
    listeners.clear()
  },
}
