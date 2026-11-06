/**
 * SpotlightOverlay — 多阶段蒙版引导（V2）
 *
 * 状态机：3 step × 7 substage（详见 TARGET_TABLE）。
 * 每个 substage 高亮一个 data-spotlight-target；用户点击高亮区 → spotlight 转发 click 到底层目标 → advance 到下一 substage。
 * 3b（starter-chips）特殊：hit-area pointer-events:none，让 chip 自身被点中；监听 pendingStarterPromptAtom 变化自动 complete。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { onboardingSpotlightAtom } from '@/atoms/onboarding-spotlight-atoms'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'
import { activeViewAtom } from '@/atoms/active-view'
import { pendingStarterPromptAtom } from '@/atoms/starter-prompt-atoms'
import { zoteroPingStatusAtom, zoteroConnectedAtom } from '@/atoms/zotero-atoms'
import type { SpotlightStep } from '../../../types/onboarding-spotlight'
import { SpotlightTooltip } from './SpotlightTooltip'

const RECT_PADDING = 4
const RECT_RADIUS = 8

/** (step, subStage) → data-spotlight-target 属性值 */
const TARGET_TABLE: Record<SpotlightStep, ReadonlyArray<string>> = {
  'configure-llm':   ['configure-sidebar', 'add-channel', 'settings-close'],
  'connect-zotero':  ['library', 'start-zotero'],
  'new-task':        ['new-task', 'starter-chips'],
}

function targetAttrFor(step: SpotlightStep, subStage: number): string {
  return TARGET_TABLE[step][subStage] ?? ''
}

/** 决定当前 (step, subStage) 在当前视图下是否应显示 spotlight */
function shouldShowInCurrentView(
  step: SpotlightStep,
  subStage: number,
  settingsOpen: boolean,
  activeView: string,
): boolean {
  if (step === 'configure-llm') {
    if (subStage === 0) return !settingsOpen && activeView !== 'library'
    return settingsOpen  // 1, 2 必须设置打开
  }
  if (step === 'connect-zotero') {
    if (subStage === 0) return !settingsOpen && activeView !== 'library'
    return activeView === 'library' && !settingsOpen  // 1：文献库内
  }
  // new-task：主视图（设置关闭 + 非文献库）
  return !settingsOpen && activeView !== 'library'
}

export function SpotlightOverlay(): React.ReactElement | null {
  const state = useAtomValue(onboardingSpotlightAtom)
  const settingsOpen = useAtomValue(settingsOpenAtom)
  const activeView = useAtomValue(activeViewAtom)
  const pendingStarterPrompt = useAtomValue(pendingStarterPromptAtom)
  const zoteroPingStatus = useAtomValue(zoteroPingStatusAtom)
  const zoteroConnected = useAtomValue(zoteroConnectedAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setActiveView = useSetAtom(activeViewAtom)

  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const [tick, setTick] = React.useState(0)
  // 防鼠标误触：每次 step/subStage 切换后给 600ms 让用户先看清气泡
  const [armed, setArmed] = React.useState(false)

  const step = state?.status === 'in-progress' ? state.currentStep : undefined
  const subStage = state?.status === 'in-progress' ? state.currentSubStage ?? 0 : 0

  React.useEffect(() => {
    setArmed(false)
    const t = window.setTimeout(() => setArmed(true), 400)
    return () => window.clearTimeout(t)
  }, [step, subStage])

  // 自动同步主视图：当前 step/subStage 要求非文献库视图（且未打开设置）时，
  // 若用户停留在文献库，自动切回 conversations 让引导可见。
  // 覆盖：configure-llm/0、connect-zotero/0、new-task 全部 substage
  // —— 这些位置只有在主视图下才能看到对应控件。
  React.useEffect(() => {
    if (!step) return
    const needNonLibrary =
      step === 'new-task' ||
      (step === 'configure-llm' && subStage === 0) ||
      (step === 'connect-zotero' && subStage === 0)
    if (needNonLibrary && activeView === 'library' && !settingsOpen) {
      setActiveView('conversations')
    }
  }, [step, subStage, activeView, settingsOpen, setActiveView])

  // 兼容已配置 Zotero 的用户：进入 connect-zotero/1 时，若 Zotero 已在运行，
  // LibraryView 会直接渲染三栏，「启动 Zotero」按钮不存在 → spotlight 会卡死。
  // 此时视为本 substage 已完成，自动跳到下一步。
  React.useEffect(() => {
    if (step === 'connect-zotero' && subStage === 1 && zoteroPingStatus.running) {
      window.electronAPI.skipOnboardingSpotlightSubStage().catch(console.error)
    }
  }, [step, subStage, zoteroPingStatus.running])

  const visible = step !== undefined && shouldShowInCurrentView(step, subStage, settingsOpen, activeView)
  const isStarterChipsStage = step === 'new-task' && subStage === 1

  // 计算 rect — 监听 step / subStage / settingsOpen / activeView / window resize
  // 同时用 ResizeObserver 跟踪 target 自身大小变化（避免 mount 期间按钮 width 未稳定导致亮区偏小）
  React.useEffect(() => {
    if (!step || !visible) {
      setRect(null)
      return
    }
    const targetAttr = targetAttrFor(step, subStage)
    const findEl = (): Element | null => document.querySelector(`[data-spotlight-target="${targetAttr}"]`)
    const update = (): void => {
      const el = findEl()
      setRect(el ? el.getBoundingClientRect() : null)
    }
    update()

    let timer: number | null = null
    const onResize = (): void => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(update, 60) as unknown as number
    }
    window.addEventListener('resize', onResize)

    // 观察 target 自身尺寸/位置变化
    const targetEl = findEl()
    let observer: ResizeObserver | null = null
    if (targetEl) {
      observer = new ResizeObserver(() => update())
      observer.observe(targetEl)
    }

    // 兜底：mount 后 600ms 内每 80ms 重测一次（应对 target 节点被 React rerender 替换、ResizeObserver 失效场景）
    const ticks: number[] = []
    for (let i = 1; i <= 7; i++) {
      ticks.push(window.setTimeout(update, i * 80) as unknown as number)
    }

    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) window.clearTimeout(timer)
      if (observer) observer.disconnect()
      for (const t of ticks) window.clearTimeout(t)
    }
  }, [step, subStage, visible, settingsOpen, activeView, tick])

  // 目标 DOM 还没挂载时 retry 一次
  React.useEffect(() => {
    if (step && visible && !rect) {
      const t = window.setTimeout(() => setTick((v) => v + 1), 100)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [step, visible, rect])

  // 3b 特殊：监听 pendingStarterPromptAtom，chip 被点（atom 非空）→ 自动 complete
  React.useEffect(() => {
    if (isStarterChipsStage && pendingStarterPrompt !== null) {
      window.electronAPI.completeOnboardingSpotlight().catch(console.error)
    }
  }, [isStarterChipsStage, pendingStarterPrompt])

  if (!step || !visible || !rect) return null

  const handlePrimary = async (): Promise<void> => {
    if (!armed) return
    // 3b 主按钮"完成 ✓"：直接 complete（不点 chip 也能结束）
    if (isStarterChipsStage) {
      await window.electronAPI.completeOnboardingSpotlight().catch(console.error)
      return
    }

    // 先 advance（让 spotlight 状态提前切到下一阶段），再 dispatch click 触发底层动作。
    // 否则 click 可能让目标 DOM 立刻消失（如 add-channel 被 ChannelForm 替换），导致 spotlight rect=null 隐藏。
    const advancePromise = window.electronAPI.advanceOnboardingSpotlight({
      from: step,
      fromSubStage: subStage,
    }).catch(console.error)

    const targetAttr = targetAttrFor(step, subStage)
    const target = document.querySelector(`[data-spotlight-target="${targetAttr}"]`)
    if (target instanceof HTMLElement) {
      target.click()
      // spec §6.4 之后：「配置」按钮只切 ConfigView，不再副作用打开 Settings。
      // onboarding 第一步仍需把用户引导到 Settings → 渠道，由本处显式补打开。
      if (step === 'configure-llm' && subStage === 0) {
        setSettingsOpen(true)
        setSettingsTab('channels')
      }
    } else if (step === 'configure-llm' && subStage === 0) {
      setSettingsOpen(true)
      setSettingsTab('channels')
    }

    await advancePromise
  }

  const handleSkipSubStage = async (): Promise<void> => {
    await window.electronAPI.skipOnboardingSpotlightSubStage().catch(console.error)
  }

  const handleSkipAll = async (): Promise<void> => {
    await window.electronAPI.skipOnboardingSpotlight().catch(console.error)
  }

  // 镂空区
  const x = rect.x - RECT_PADDING
  const y = rect.y - RECT_PADDING
  const w = rect.width + RECT_PADDING * 2
  const h = rect.height + RECT_PADDING * 2

  // 3b 阶段 hit-area 透传 click 到底层 chip
  const cutoutPointerEvents = isStarterChipsStage ? 'none' : 'auto'

  return (
    <>
      {/* SVG 蒙版镂空 — z-110 高于 Radix Dialog 的 z-100，确保覆盖设置/对话框 */}
      <svg className="fixed inset-0 z-[110] w-full h-full pointer-events-none">
        <defs>
          <mask id="spotlight-hole">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={RECT_RADIUS} ry={RECT_RADIUS} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.65)" mask="url(#spotlight-hole)" />
      </svg>

      {/* 暗区 hit-area：拦截非镂空区点击 */}
      <div
        className="fixed inset-0 z-[110] pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      />
      {/* 镂空区 hit-area：3b 特殊为 pointer-events:none 让 chip 直接接收点击 */}
      <div
        className="fixed z-[110] cursor-pointer"
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          pointerEvents: cutoutPointerEvents,
        }}
        onClick={handlePrimary}
      />

      <SpotlightTooltip
        step={step}
        subStage={subStage}
        rect={rect}
        onPrimary={handlePrimary}
        onSkipSubStage={handleSkipSubStage}
        onSkipAll={handleSkipAll}
        zoteroConnected={zoteroConnected}
      />
    </>
  )
}
