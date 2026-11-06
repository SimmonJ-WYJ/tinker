/**
 * Concept Spotlight 主进程单例
 *
 * 每个 tour 独立 start/advance/skip/complete/restart；
 * 内部读写 settings.conceptSpotlight 子树；subscribe 给 ipc 广播。
 */

import { nowMs } from '@asci/shared'
import type {
  ConceptTourKey,
  ConceptSpotlightState,
  ConceptTourState,
} from '../../types/concept-spotlight'
import { SUB_STAGES_PER_TOUR } from '../../types/concept-spotlight'
import { getSettings, updateSettings } from './settings-service'

type Listener = (state: ConceptSpotlightState) => void
const listeners = new Set<Listener>()

function readState(): ConceptSpotlightState {
  const settings = getSettings()
  return settings.conceptSpotlight ?? {}
}

function writeState(next: ConceptSpotlightState): ConceptSpotlightState {
  updateSettings({ conceptSpotlight: next })
  for (const listener of listeners) {
    try {
      listener(next)
    } catch (error) {
      console.error('[Concept Spotlight] listener 异常:', error)
    }
  }
  return next
}

function setTour(state: ConceptSpotlightState, key: ConceptTourKey, tour: ConceptTourState): ConceptSpotlightState {
  return { ...state, [key]: tour }
}

export const conceptSpotlightService = {
  getState(): ConceptSpotlightState {
    return readState()
  },

  /** 启动 tour（若已 in-progress 保留当前位置，幂等） */
  startTour(opts: { tour: ConceptTourKey }): ConceptSpotlightState {
    const current = readState()
    const existing = current[opts.tour]
    if (existing && existing.status === 'in-progress') return current
    return writeState(setTour(current, opts.tour, { status: 'in-progress', currentSubStage: 0 }))
  },

  /**
   * 显式推进 substage。守卫：仅当 (currentSubStage === fromSubStage) 时推进。
   * 末 substage 之后转 completed 并写 finishedAt。
   */
  advanceTour(opts: { tour: ConceptTourKey; fromSubStage: number }): ConceptSpotlightState {
    const current = readState()
    const existing = current[opts.tour]
    if (!existing || existing.status !== 'in-progress' || existing.currentSubStage !== opts.fromSubStage) {
      return current  // 守卫不通过，原样返回
    }
    const total = SUB_STAGES_PER_TOUR[opts.tour]
    const nextSubStage = opts.fromSubStage + 1
    if (nextSubStage >= total) {
      return writeState(setTour(current, opts.tour, { status: 'completed', finishedAt: nowMs() }))
    }
    return writeState(setTour(current, opts.tour, { status: 'in-progress', currentSubStage: nextSubStage }))
  },

  /** 用户主动跳过整个 tour */
  skipTour(opts: { tour: ConceptTourKey }): ConceptSpotlightState {
    const current = readState()
    return writeState(setTour(current, opts.tour, { status: 'skipped', finishedAt: nowMs() }))
  },

  /** 直接完成（主按钮"完成"） */
  completeTour(opts: { tour: ConceptTourKey }): ConceptSpotlightState {
    const current = readState()
    return writeState(setTour(current, opts.tour, { status: 'completed', finishedAt: nowMs() }))
  },

  /** "重看演示"：从任意状态回到 substage 0 */
  restartTour(opts: { tour: ConceptTourKey }): ConceptSpotlightState {
    const current = readState()
    return writeState(setTour(current, opts.tour, { status: 'in-progress', currentSubStage: 0 }))
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  /** 仅供测试 */
  __resetForTests(): void {
    listeners.clear()
  },
}
