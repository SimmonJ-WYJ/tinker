/**
 * GlobalShortcuts — 全局快捷键注册 + 初始化组件
 *
 * 在 main.tsx 顶层挂载（类似 AgentListenersInitializer），永不销毁。
 * 负责：
 * 1. 初始化快捷键注册表
 * 2. 从 settings 加载用户自定义配置
 * 3. 注册所有应用级快捷键的 handler
 * 4. 监听菜单 IPC 事件（Cmd+W 关闭标签）
 */

import { useEffect, useCallback } from 'react'
import { useAtomValue, useSetAtom, useAtom, useStore } from 'jotai'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { searchDialogOpenAtom } from '@/atoms/search-atoms'
import {
  tabsAtom,
  activeTabIdAtom,
  sidebarCollapsedAtom,
  closeTab,
  openTab,
} from '@/atoms/tab-atoms'
import { shortcutOverridesAtom, sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import {
  agentPendingPromptAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  agentChannelIdAtom,
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workingDoneSessionIdsAtom,
} from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useCreateSession } from '@/hooks/useCreateSession'
import { useShortcut } from '@/hooks/useShortcut'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'
import {
  initShortcutRegistry,
  updateShortcutOverrides,
} from '@/lib/shortcut-registry'

/**
 * 快捷键初始化 + 全局 Handler 注册
 *
 * 挂载后从 settings 加载自定义配置，并注册所有应用级快捷键。
 */
export function GlobalShortcuts(): null {
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSearchOpen = useSetAtom(searchDialogOpenAtom)
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  const setShortcutOverrides = useSetAtom(shortcutOverridesAtom)
  const shortcutOverrides = useAtomValue(shortcutOverridesAtom)
  const setSendWithCmdEnter = useSetAtom(sendWithCmdEnterAtom)
  const { createAgent } = useCreateSession()

  // Tab 管理（用于关闭标签页）
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const setWorkingDone = useSetAtom(workingDoneSessionIdsAtom)

  // 关闭活跃标签后同步副作用（与 TabBar.handleClose 共用）
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()

  // 初始化：挂载注册表 + 加载用户配置
  useEffect(() => {
    initShortcutRegistry()

    window.electronAPI.getSettings().then((settings) => {
      if (settings.shortcutOverrides) {
        setShortcutOverrides(settings.shortcutOverrides)
        updateShortcutOverrides(settings.shortcutOverrides)
      }
      setSendWithCmdEnter(settings.sendWithCmdEnter ?? false)
    }).catch(console.error)
  }, [setShortcutOverrides, setSendWithCmdEnter])

  // 配置变更时同步到注册表
  useEffect(() => {
    updateShortcutOverrides(shortcutOverrides)
  }, [shortcutOverrides])

  // ===== 关闭标签页逻辑 =====

  const handleCloseTab = useCallback(() => {
    if (!activeTabId) return
    const closedTabId = activeTabId
    const result = closeTab(tabs, activeTabId, activeTabId, currentWorkspaceId)
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)

    // 关闭的是当前活跃标签（必然），同步 appMode/currentXxxId 到新激活的标签
    const newActiveTab = result.activeTabId
      ? result.tabs.find((t) => t.id === result.activeTabId) ?? null
      : null
    syncActiveTabSideEffects(newActiveTab)

    // 从 Working Done 集合移除
    setWorkingDone((prev) => {
      if (!prev.has(closedTabId)) return prev
      const next = new Set(prev)
      next.delete(closedTabId)
      return next
    })
  }, [activeTabId, tabs, currentWorkspaceId, setTabs, setActiveTabId, setWorkingDone, syncActiveTabSideEffects])

  // 监听菜单 IPC 事件（Cmd+W 被 Electron 菜单拦截后通过 IPC 转发）
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuCloseTab(handleCloseTab)
    return cleanup
  }, [handleCloseTab])

  // 同时注册到快捷键系统（用于设置面板展示和自定义，实际触发走 IPC）
  useShortcut('close-tab', handleCloseTab)

  // ===== 快捷键 Handler =====

  // Cmd+, → 打开设置
  useShortcut(
    'open-settings',
    useCallback(() => setSettingsOpen(true), [setSettingsOpen]),
  )

  // Cmd+F → 全局搜索
  useShortcut(
    'global-search',
    useCallback(() => setSearchOpen(true), [setSearchOpen]),
  )

  // Cmd+N → 新建 Agent 会话
  useShortcut(
    'new-session',
    useCallback(() => {
      createAgent({ draft: true })
    }, [createAgent]),
  )

  // Cmd+B → 切换侧边栏
  useShortcut(
    'toggle-sidebar',
    useCallback(
      () => setSidebarCollapsed(!sidebarCollapsed),
      [sidebarCollapsed, setSidebarCollapsed],
    ),
  )

  // Cmd+K → 清除上下文（通过 CustomEvent 分发到 AgentView）
  useShortcut(
    'clear-context',
    useCallback(() => {
      window.dispatchEvent(new CustomEvent('asci:clear-context'))
    }, []),
  )

  // Cmd+L → 聚焦输入框（通过 CustomEvent 分发到 AgentView）
  useShortcut(
    'focus-input',
    useCallback(() => {
      window.dispatchEvent(new CustomEvent('asci:focus-input'))
    }, []),
  )

  // Cmd+. → 停止生成（通过 CustomEvent 分发到 AgentView）
  useShortcut(
    'stop-generation',
    useCallback(() => {
      window.dispatchEvent(new CustomEvent('asci:stop-generation'))
    }, []),
  )

  // ===== 快速任务窗口 → 创建 Agent 会话并自动发送 =====

  const store = useStore()

  useEffect(() => {
    const cleanup = window.electronAPI.onQuickTaskOpenSession(async (data) => {
      try {
        store.set(activeViewAtom, 'conversations')

        const channelId = store.get(agentChannelIdAtom) || undefined
        const workspaceId = store.get(currentAgentWorkspaceIdAtom) || undefined
        const meta = await window.electronAPI.createAgentSession(
          undefined,
          channelId,
          workspaceId,
        )
        store.set(agentSessionsAtom, (prev) => [meta, ...prev])
        store.set(currentAgentSessionIdAtom, meta.id)

        let fileReferences = ''
        if (data.files && data.files.length > 0 && workspaceId) {
          const workspaces = store.get(agentWorkspacesAtom)
          const workspace = workspaces.find((w) => w.id === workspaceId)
          if (workspace) {
            try {
              const filesToSave = data.files.map((f) => ({
                filename: f.filename,
                data: f.base64,
              }))
              const saved = await window.electronAPI.saveFilesToAgentSession({
                workspaceSlug: workspace.slug,
                sessionId: meta.id,
                files: filesToSave,
              })
              const refs = saved.map((f) => `- ${f.filename}: ${f.targetPath}`).join('\n')
              fileReferences = `<attached_files>\n${refs}\n</attached_files>\n\n`
            } catch (error) {
              console.error('[快速任务] 保存 Agent 附件失败:', error)
            }
          }
        }

        const currentTabs = store.get(tabsAtom)
        const result = openTab(currentTabs, {
          type: 'agent',
          sessionId: meta.id,
          title: data.text.slice(0, 30),
          workspaceId: meta.workspaceId ?? workspaceId,
        })
        store.set(tabsAtom, result.tabs)
        store.set(activeTabIdAtom, result.activeTabId)

        store.set(agentPendingPromptAtom, {
          sessionId: meta.id,
          message: fileReferences + data.text,
        })
      } catch (error) {
        console.error('[快速任务] 创建会话失败:', error)
      }
    })
    return cleanup
  }, [store])

  return null
}
