import * as React from 'react'
import { useSetAtom } from 'jotai'
import { AppShell } from './components/app-shell/AppShell'
import { TooltipProvider } from './components/ui/tooltip'
import { GraphModal } from './components/citation-graph/GraphModal'
import { onboardingSpotlightAtom } from './atoms/onboarding-spotlight-atoms'
import { conceptSpotlightAtom } from './atoms/concept-spotlight-atoms'
import { LOGIN_ENABLED } from '@/lib/dev-mode'
import { RouteGuard } from './components/auth/RouteGuard'
import { GlobalListeners } from './components/auth/GlobalListeners'
import type { AppShellContextType } from './contexts/AppShellContext'

export default function App(): React.ReactElement {
  const setOnboardingSpotlight = useSetAtom(onboardingSpotlightAtom)
  const setConceptSpotlight = useSetAtom(conceptSpotlightAtom)

  // 初始化 onboarding spotlight 状态 + 订阅主进程广播
  // 使用 bootstrap：首次安装自动唤起引导，老用户升级保持 null（不强制重走）
  React.useEffect(() => {
    const initialize = async (): Promise<void> => {
      try {
        const spotlight = await window.electronAPI.bootstrapOnboardingSpotlight()
        setOnboardingSpotlight(spotlight)
      } catch (error) {
        console.error('[App] 初始化 spotlight 失败:', error)
      }
    }
    void initialize()

    const unsubscribe = window.electronAPI.onOnboardingSpotlightChanged((state) => {
      setOnboardingSpotlight(state)
    })
    return unsubscribe
  }, [setOnboardingSpotlight])

  // 初始化 concept spotlight（证据集 / 论文 notes tour）+ 订阅广播
  React.useEffect(() => {
    const initialize = async (): Promise<void> => {
      try {
        const state = await window.electronAPI.getConceptSpotlightState()
        setConceptSpotlight(state)
      } catch (error) {
        console.error('[App] 初始化 concept spotlight 失败:', error)
      }
    }
    void initialize()

    const unsubscribe = window.electronAPI.onConceptSpotlightChanged((state) => {
      setConceptSpotlight(state)
    })
    return unsubscribe
  }, [setConceptSpotlight])

  // Placeholder context value
  const contextValue: AppShellContextType = {}

  return (
    <TooltipProvider delayDuration={200}>
      {/* 登录门控：默认 LOGIN_ENABLED 走 RouteGuard 守卫；dev:skip-login 关时直渲 AppShell */}
      {LOGIN_ENABLED ? (
        <RouteGuard>
          <AppShell contextValue={contextValue} />
          <GraphModal />
        </RouteGuard>
      ) : (
        <>
          <AppShell contextValue={contextValue} />
          <GraphModal />
        </>
      )}
      {LOGIN_ENABLED && <GlobalListeners />}
    </TooltipProvider>
  )
}
