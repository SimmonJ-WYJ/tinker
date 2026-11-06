/**
 * Onboarding Spotlight atoms
 *
 * - onboardingSpotlightAtom: 主进程同步的 state（启动时 hydrate + onChanged 订阅）
 * - spotlightActiveAtom: 派生当前 spotlight 是否在展示
 *
 * 注：目标 DOM 解析逻辑（step + subStage → data-spotlight-target attr）已迁移到 SpotlightOverlay 内部 TARGET_TABLE。
 */

import { atom } from 'jotai'
import type { OnboardingSpotlightState } from '../../types/onboarding-spotlight'

export const onboardingSpotlightAtom = atom<OnboardingSpotlightState | null>(null)

export const spotlightActiveAtom = atom<boolean>((get) => {
  const state = get(onboardingSpotlightAtom)
  return state?.status === 'in-progress' && !!state.currentStep
})
