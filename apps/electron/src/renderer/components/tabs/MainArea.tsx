/**
 * MainArea — 主内容区域
 *
 * 组合 TabBar + TabContent。设置以浮窗形式叠加显示。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { activeTabIdAtom, visibleTabsAtom } from '@/atoms/tab-atoms'
import { Panel } from '@/components/app-shell/Panel'
import { SettingsDialog } from '@/components/settings'
import { WelcomeView } from '@/components/welcome/WelcomeView'
import { TabContent } from './TabContent'
import { activeViewAtom } from '@/atoms/active-view'
import { LibraryView } from '@/components/library/LibraryView'
import { NotesView } from '@/components/library/NotesView'
import { HomeHeader, HomePanelToggle } from '@/components/welcome/HomeHeader'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { tabsAtom } from '@/atoms/tab-atoms'
import { ProjectOverview } from '@/components/agent/ProjectOverview'
import { ConfigView } from '@/components/config/ConfigView'

export function MainArea(): React.ReactElement {
  const visibleTabs = useAtomValue(visibleTabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setActiveTabId = useSetAtom(activeTabIdAtom)
  const activeView = useAtomValue(activeViewAtom)
  const allTabs = useAtomValue(tabsAtom)
  const drafts = useAtomValue(draftSessionIdsAtom)
  const active = allTabs.find((item) => item.id === activeTabId)
  const emptyDraft = !active || drafts.has(active.sessionId)

  // 兜底：当前工作区有可见 tab 但 activeTabId 为空时，自动激活第一个可见标签。
  // 正常路径（openTab/closeTab/持久化恢复）都会维护 activeTabId，此分支只为防御
  // 异常状态（如外部原子被误清空），避免渲染 WelcomeView 触发重复 openTab 循环。
  React.useEffect(() => {
    if (visibleTabs.length > 0 && !activeTabId) {
      setActiveTabId(visibleTabs[0]!.id)
    }
  }, [visibleTabs, activeTabId, setActiveTabId])

  if (activeView === 'project') {
    return <><Panel variant="grow" className="workspace-main-panel bg-content-area rounded-2xl"><ProjectOverview /></Panel><SettingsDialog /></>
  }

  // activeView === 'library' 时整块主区显示文献库占位视图，覆盖 TabBar
  // 注意：LibraryView 自身的根元素带 titlebar-no-drag，避免顶部 50px 的窗口拖动区
  // 吞掉 CollectionTree 首行"所有条目"的点击
  if (activeView === 'library') {
    return (
      <>
        <Panel
          variant="grow"
          className="workspace-main-panel bg-content-area rounded-2xl"
        >
          <LibraryView />
        </Panel>
        <SettingsDialog />
      </>
    )
  }

  // activeView === 'notes' 时整块主区显示全局笔记视图（ADR-004 方案 A 原型 #2）
  if (activeView === 'notes') {
    return (
      <>
        <Panel
          variant="grow"
          className="workspace-main-panel bg-content-area rounded-2xl"
        >
          <NotesView />
        </Panel>
        <SettingsDialog />
      </>
    )
  }

  // activeView === 'config' 时整块主区显示配置页（spec §6.4 — Skill / 能力包板块）
  if (activeView === 'config') {
    return (
      <>
        <Panel
          variant="grow"
          className="workspace-main-panel bg-content-area rounded-2xl"
        >
          <ConfigView />
        </Panel>
        <SettingsDialog />
      </>
    )
  }

  return (
    <>
      <Panel
        variant="grow"
        className="workspace-main-panel bg-content-area rounded-2xl"
      >
        {emptyDraft ? <HomeHeader /> : <div className="workspace-panel-controls"><HomePanelToggle /></div>}
        {/* 切工作区瞬间 activeTabId 仍指旧 tab（F46 订阅异步路由中），此时继续渲染旧
            TabContent 而非闪 WelcomeView；可见集与 active 同时为空才显示欢迎屏 */}
        {visibleTabs.length === 0 && !activeTabId ? (
          <WelcomeView />
        ) : activeTabId ? (
          <div className="flex-1 min-h-0">
            <TabContent tabId={activeTabId} />
          </div>
        ) : null}
      </Panel>
      <SettingsDialog />
    </>
  )
}
