/**
 * Spotlight 引导 IPC 处理器
 *
 * 汇集 Onboarding Spotlight 首启引导与 Concept Spotlight（证据集 / 论文 notes tour）
 * 相关的 IPC 通道，并订阅 service 状态变更向所有渲染窗口广播。
 */

import { BrowserWindow, ipcMain } from 'electron'
import { ONBOARDING_SPOTLIGHT_IPC_CHANNELS } from '../../types/onboarding-spotlight'
import type { OnboardingSpotlightState, SpotlightStep } from '../../types/onboarding-spotlight'
import { onboardingSpotlightService } from '../lib/onboarding-spotlight-service'
import { CONCEPT_SPOTLIGHT_IPC_CHANNELS } from '../../types/concept-spotlight'
import type { ConceptTourKey, ConceptSpotlightState } from '../../types/concept-spotlight'
import { conceptSpotlightService } from '../lib/concept-spotlight-service'

/** 注册 Spotlight 引导 IPC 处理器 */
export function registerSpotlightIpc(): void {
  // ===== Onboarding Spotlight 引导 =====

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.GET,
    async (): Promise<OnboardingSpotlightState | null> => onboardingSpotlightService.getState(),
  )

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.BOOTSTRAP,
    async (): Promise<OnboardingSpotlightState | null> => onboardingSpotlightService.bootstrap(),
  )

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.START,
    async (): Promise<OnboardingSpotlightState> => onboardingSpotlightService.start(),
  )

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.ADVANCE,
    async (_, opts: { from: SpotlightStep; fromSubStage: number }): Promise<OnboardingSpotlightState> =>
      onboardingSpotlightService.advance(opts),
  )

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.SKIP_SUB_STAGE,
    async (): Promise<OnboardingSpotlightState> => onboardingSpotlightService.skipSubStage(),
  )

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.COMPLETE,
    async (): Promise<OnboardingSpotlightState> => onboardingSpotlightService.complete(),
  )

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.SKIP,
    async (): Promise<OnboardingSpotlightState> => onboardingSpotlightService.skip(),
  )

  ipcMain.handle(
    ONBOARDING_SPOTLIGHT_IPC_CHANNELS.RESTART,
    async (): Promise<OnboardingSpotlightState> => onboardingSpotlightService.restart(),
  )

  // 状态变更广播：service → 所有渲染进程窗口
  onboardingSpotlightService.subscribe((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.CHANGED, state)
    }
  })

  // ===== Concept Spotlight (证据集 / 论文 notes tour) =====
  ipcMain.handle(
    CONCEPT_SPOTLIGHT_IPC_CHANNELS.GET_STATE,
    async (): Promise<ConceptSpotlightState> => conceptSpotlightService.getState(),
  )

  ipcMain.handle(
    CONCEPT_SPOTLIGHT_IPC_CHANNELS.START,
    async (_, opts: { tour: ConceptTourKey }): Promise<ConceptSpotlightState> =>
      conceptSpotlightService.startTour(opts),
  )

  ipcMain.handle(
    CONCEPT_SPOTLIGHT_IPC_CHANNELS.ADVANCE,
    async (_, opts: { tour: ConceptTourKey; fromSubStage: number }): Promise<ConceptSpotlightState> =>
      conceptSpotlightService.advanceTour(opts),
  )

  ipcMain.handle(
    CONCEPT_SPOTLIGHT_IPC_CHANNELS.SKIP,
    async (_, opts: { tour: ConceptTourKey }): Promise<ConceptSpotlightState> =>
      conceptSpotlightService.skipTour(opts),
  )

  ipcMain.handle(
    CONCEPT_SPOTLIGHT_IPC_CHANNELS.COMPLETE,
    async (_, opts: { tour: ConceptTourKey }): Promise<ConceptSpotlightState> =>
      conceptSpotlightService.completeTour(opts),
  )

  ipcMain.handle(
    CONCEPT_SPOTLIGHT_IPC_CHANNELS.RESTART,
    async (_, opts: { tour: ConceptTourKey }): Promise<ConceptSpotlightState> =>
      conceptSpotlightService.restartTour(opts),
  )

  conceptSpotlightService.subscribe((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(CONCEPT_SPOTLIGHT_IPC_CHANNELS.CHANGED, state)
    }
  })
}
