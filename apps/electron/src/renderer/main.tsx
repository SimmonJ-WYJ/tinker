/**
 * 渲染进程入口
 *
 * 挂载 React 应用。
 */

import React, { useEffect, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { useSetAtom, useAtomValue, useStore } from 'jotai'
import App from './App'
// 注册所有预览器（在应用启动时执行一次）
import './components/preview/registrations'
// renderer Sentry 尽早初始化（dev 门控 + 脱敏在模块内，#416 / ADR-011）
import { initSentryRenderer } from './lib/sentry'

initSentryRenderer()

// 全局未捕获异常 / Promise 拒绝兜底落 console（renderer Sentry 已自动捕获全局异常，
// 这里仅补终端线索，不重复手动上报，issue #459）
window.addEventListener('error', (e) => {
  console.error('[全局错误] uncaught error:', e.error ?? e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[全局错误] unhandledrejection:', e.reason)
})
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  currentAgentSessionIdAtom,
  workspaceCapabilitiesVersionAtom,
  workspaceFilesVersionAtom,
  agentDefaultPermissionModeAtom,
  agentSettingsReadyAtom,
  sidebarProjectFilesExpandedMapAtom,
} from './atoms/agent-atoms'
import { updateStatusAtom, initializeUpdater } from './atoms/updater'
import { asrWeightsStatusAtom } from './atoms/asr-weights'
import {
  notificationsEnabledAtom,
  notificationSoundEnabledAtom,
  notificationSoundsAtom,
  initializeNotifications,
} from './atoms/notifications'
import {
  initializeZoteroSettings,
  zoteroEnabledAtom,
  zoteroDataDirAtom,
  zoteroInstallStatusAtom,
  zoteroPingStatusAtom,
} from './atoms/zotero-atoms'
import { useGlobalAgentListeners } from './hooks/useGlobalAgentListeners'
import { useZoteroStatusPolling } from './hooks/useZoteroStatusPolling'
import { useQuoteChatTab } from './hooks/useQuoteChatTab'
import { tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom, filterVisibleTabs } from './atoms/tab-atoms'
import type { TabItem, PersistedTabState } from './atoms/tab-atoms'
import { channelsAtom, channelsLoadedAtom } from './atoms/channels-atoms'
import { Toaster } from './components/ui/sonner'
import { diffCapabilities, migratePermissionMode, reconcileActiveModel } from '@asci/shared'
import type { WorkspaceCapabilities } from '@asci/shared'
import { showCapabilityChangeToasts } from './lib/capabilities-toast'
import { isCapabilityToastSuppressed } from './lib/capability-toast-suppress'
import { UpdateDialog } from './components/settings/UpdateDialog'
import { GlobalShortcuts } from './components/shortcuts/GlobalShortcuts'
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary'
import './styles/globals.css'
import 'katex/dist/katex.min.css'
// i18n 初始化（同步执行 i18next.init，必须在 React 渲染前完成）
import './lib/i18n'
import { languageAtom, initializeLanguage } from './atoms/language-atoms'
import { themeAtom, isDarkAtom, initializeTheme, applyDarkClass } from './atoms/theme-atoms'

// ===== 窗口类型检测 =====
const windowParam = new URLSearchParams(window.location.search).get('window')
const isQuickTaskWindow = windowParam === 'quick-task'

/**
 * Agent 设置初始化组件
 *
 * 从主进程加载 Agent 渠道/模型设置并写入 atoms。
 */
function AgentSettingsInitializer(): null {
  const setAgentChannelId = useSetAtom(agentChannelIdAtom)
  const setAgentModelId = useSetAtom(agentModelIdAtom)
  const setAgentChannelIds = useSetAtom(agentChannelIdsAtom)
  const setAgentWorkspaces = useSetAtom(agentWorkspacesAtom)
  const setCurrentWorkspaceId = useSetAtom(currentAgentWorkspaceIdAtom)
  const bumpCapabilities = useSetAtom(workspaceCapabilitiesVersionAtom)
  const bumpFiles = useSetAtom(workspaceFilesVersionAtom)
  const setPermissionMode = useSetAtom(agentDefaultPermissionModeAtom)

  const setAgentSettingsReady = useSetAtom(agentSettingsReadyAtom)
  const setSidebarProjectFilesExpandedMap = useSetAtom(sidebarProjectFilesExpandedMapAtom)
  const setChannels = useSetAtom(channelsAtom)
  const setChannelsLoaded = useSetAtom(channelsLoadedAtom)
  const store = useStore()

  // 读取当前工作区信息（用于能力变化 diff）
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 缓存上一次工作区能力（用于 diff 检测变化）
  const prevCapabilitiesRef = useRef<WorkspaceCapabilities | null>(null)
  // 初次加载标记 — 应用启动或切换工作区时不显示 toast
  const suppressToastRef = useRef(true)

  useEffect(() => {
    // 并行加载渠道列表和设置，确保两者都就绪后再验证渠道有效性
    Promise.all([
      window.electronAPI.listChannels(),
      window.electronAPI.getSettings(),
    ]).then(([channels, settings]) => {
      // 缓存渠道列表
      setChannels(channels)
      setChannelsLoaded(true)

      const channelIds = new Set(channels.map((c) => c.id))

      // 验证并加载 Agent 渠道/模型
      // 1) 渠道：仍存在 → 加载；已删除 → 清空 agentChannelId + agentModelId
      // 2) 模型：在渠道的启用模型列表里 → 加载；否则 fallback 到第一个启用模型并回写 settings.json。
      //    issue #62 — 解决 "编辑渠道禁用激活模型后仍调旧 modelId" 问题。
      const activeChannel = settings.agentChannelId
        ? channels.find((c) => c.id === settings.agentChannelId)
        : null

      if (settings.agentChannelId && channelIds.has(settings.agentChannelId)) {
        setAgentChannelId(settings.agentChannelId)
      } else if (settings.agentChannelId && !channelIds.has(settings.agentChannelId)) {
        // 渠道已删除，清除无效设置
        console.warn('[AgentSettings] agentChannelId 指向已删除的渠道，清除')
        window.electronAPI.updateSettings({ agentChannelId: undefined, agentModelId: undefined }).catch(console.error)
      }

      if (activeChannel) {
        const result = reconcileActiveModel(activeChannel, settings.agentModelId ?? null)
        if (result.valid) {
          setAgentModelId(result.modelId)
          if (result.changed) {
            console.warn(
              `[AgentSettings] agentModelId="${settings.agentModelId}" 已不在渠道 "${activeChannel.name}" 的启用模型列表中，回退到 "${result.modelId}"`,
            )
            window.electronAPI
              .updateSettings({ agentModelId: result.modelId ?? undefined })
              .catch(console.error)
          }
        } else if (settings.agentModelId) {
          // 渠道存在但没有任何启用模型，清空 modelId 让用户重新选
          console.warn(
            `[AgentSettings] 渠道 "${activeChannel.name}" 无任何启用模型，清空 agentModelId`,
          )
          setAgentModelId(null)
          window.electronAPI.updateSettings({ agentModelId: undefined }).catch(console.error)
        }
      } else if (settings.agentModelId && !settings.agentChannelId) {
        // 没有 channelId 但有 modelId（异常但理论可能），保持原值不动以兼容旧行为
        setAgentModelId(settings.agentModelId)
      }

      // 加载 Agent 启用渠道列表，过滤已删除的渠道
      if (settings.agentChannelIds && settings.agentChannelIds.length > 0) {
        const validIds = settings.agentChannelIds.filter((id) => channelIds.has(id))
        setAgentChannelIds(validIds)
        // 如果有渠道被清理，持久化更新后的列表
        if (validIds.length !== settings.agentChannelIds.length) {
          console.warn('[AgentSettings] 清理了已删除的 agentChannelIds')
          window.electronAPI.updateSettings({ agentChannelIds: validIds }).catch(console.error)
        }
      } else if (settings.agentChannelId && channelIds.has(settings.agentChannelId)) {
        // 迁移：旧版本只有 agentChannelId，自动转为数组
        const migrated = [settings.agentChannelId]
        setAgentChannelIds(migrated)
        window.electronAPI.updateSettings({ agentChannelIds: migrated }).catch(console.error)
      }

      if (settings.agentPermissionMode) {
        // 迁移旧权限模式值（auto/smart/supervised → acceptEdits/bypassPermissions/plan）
        setPermissionMode(migratePermissionMode(settings.agentPermissionMode))
      }

      // 加载项目文件面板展开状态
      if (settings.sidebarProjectFilesExpandedByWorkspace) {
        const map = new Map<string, boolean>(
          Object.entries(settings.sidebarProjectFilesExpandedByWorkspace),
        )
        setSidebarProjectFilesExpandedMap(map)
      }

      // 加载工作区列表并恢复上次选中的工作区
      window.electronAPI.listAgentWorkspaces().then((workspaces) => {
        setAgentWorkspaces(workspaces)
        if (settings.agentWorkspaceId) {
          // 验证工作区仍然存在
          const exists = workspaces.some((w) => w.id === settings.agentWorkspaceId)
          setCurrentWorkspaceId(exists ? settings.agentWorkspaceId! : workspaces[0]?.id ?? null)
        } else if (workspaces.length > 0) {
          setCurrentWorkspaceId(workspaces[0]!.id)
        }
        setAgentSettingsReady(true)
        window.__TAURI_FORMAL__?.hydrated('settings')
      }).catch((err) => {
        console.error(err)
        window.__TAURI_FORMAL__?.hydrated('settings', err)
        setAgentSettingsReady(true) // 即使出错也标记就绪，避免永远阻塞
      })
    }).catch((err) => {
      console.error(err)
      window.__TAURI_FORMAL__?.hydrated('settings', err)
      setAgentSettingsReady(true) // 即使出错也标记就绪，避免永远阻塞
    })
  }, [setAgentChannelId, setAgentModelId, setAgentChannelIds, setAgentWorkspaces, setCurrentWorkspaceId, setPermissionMode, setChannels, setChannelsLoaded, setAgentSettingsReady, setSidebarProjectFilesExpandedMap])

  // 工作区切换时重置能力缓存，预加载基线
  useEffect(() => {
    suppressToastRef.current = true
    prevCapabilitiesRef.current = null

    if (!currentWorkspaceId) return
    const ws = workspaces.find((w) => w.id === currentWorkspaceId)
    if (!ws) return

    window.electronAPI
      .getWorkspaceCapabilities(ws.slug)
      .then((caps) => {
        prevCapabilitiesRef.current = caps
        suppressToastRef.current = false
      })
      .catch(console.error)
  }, [currentWorkspaceId, workspaces])

  // 订阅主进程文件监听推送
  useEffect(() => {
    const unsubCapabilities = window.electronAPI.onCapabilitiesChanged(() => {
      // 查找当前工作区 slug
      const ws = workspaces.find((w) => w.id === currentWorkspaceId)
      if (ws) {
        window.electronAPI
          .getWorkspaceCapabilities(ws.slug)
          .then((newCaps) => {
            const prevCaps = prevCapabilitiesRef.current
            if (prevCaps && !suppressToastRef.current && !isCapabilityToastSuppressed()) {
              const changes = diffCapabilities(prevCaps, newCaps)
              showCapabilityChangeToasts(changes)
            }
            prevCapabilitiesRef.current = newCaps
            suppressToastRef.current = false
          })
          .catch(console.error)
      }

      bumpCapabilities((v) => v + 1)
    })
    const unsubFiles = window.electronAPI.onWorkspaceFilesChanged(() => {
      bumpFiles((v) => v + 1)
    })

    return () => {
      unsubCapabilities()
      unsubFiles()
    }
  }, [bumpCapabilities, bumpFiles, currentWorkspaceId, workspaces])

  return null
}

/**
 * 自动更新初始化组件
 *
 * 订阅主进程推送的更新状态变化事件。
 */
function UpdaterInitializer(): null {
  const setUpdateStatus = useSetAtom(updateStatusAtom)

  useEffect(() => {
    const cleanup = initializeUpdater(setUpdateStatus)
    return cleanup
  }, [setUpdateStatus])

  return null
}

/**
 * ASR 权重状态订阅组件
 *
 * 首次加载当前状态；订阅主进程推送的 STATUS_CHANGED 事件，实时更新 atom。
 */
function AsrWeightsInitializer(): null {
  const setStatus = useSetAtom(asrWeightsStatusAtom)

  useEffect(() => {
    let mounted = true
    window.electronAPI.asrWeights.getStatus().then((s) => {
      if (mounted) setStatus(s)
    }).catch(console.error)
    const unsub = window.electronAPI.asrWeights.onStatusChanged((s) => {
      if (mounted) setStatus(s)
    })
    return () => {
      mounted = false
      unsub()
    }
  }, [setStatus])

  return null
}

/**
 * 语言初始化组件
 *
 * 从主进程加载语言偏好（默认 English），同步驱动 i18next 切换。
 */
function LanguageInitializer(): null {
  const setLanguage = useSetAtom(languageAtom)

  useEffect(() => {
    void initializeLanguage(setLanguage)
  }, [setLanguage])

  return null
}

/**
 * 主题初始化组件
 *
 * 启动期从 preload 同步读取已解析的 {mode, isDark} 并写入 atom + 应用 .dark class，
 * 订阅 theme:changed 推送（OS 系统偏好变更或用户切换设置时）保持同步。
 */
function ThemeInitializer(): null {
  const setTheme = useSetAtom(themeAtom)
  const setIsDark = useSetAtom(isDarkAtom)

  useEffect(() => {
    initializeTheme(setTheme, setIsDark)
    const unsub = window.electronAPI.onThemeChanged((state) => {
      setTheme(state.mode)
      setIsDark(state.isDark)
      applyDarkClass(state.isDark)
    })
    return () => { unsub() }
  }, [setTheme, setIsDark])

  return null
}

/**
 * 通知初始化组件
 *
 * 从主进程加载通知开关设置。
 */
function NotificationsInitializer(): null {
  const setEnabled = useSetAtom(notificationsEnabledAtom)
  const setSoundEnabled = useSetAtom(notificationSoundEnabledAtom)
  const setSounds = useSetAtom(notificationSoundsAtom)

  useEffect(() => {
    initializeNotifications(setEnabled, setSoundEnabled, setSounds)
  }, [setEnabled, setSoundEnabled, setSounds])

  return null
}

/**
 * Zotero 集成初始化组件
 *
 * 从主进程加载 zoteroEnabled / dataDir / install / ping 状态，
 * 避免重启后 UI 与 mcp.json 状态不一致。
 */
function ZoteroSettingsInitializer(): null {
  const setEnabled = useSetAtom(zoteroEnabledAtom)
  const setDataDir = useSetAtom(zoteroDataDirAtom)
  const setInstallStatus = useSetAtom(zoteroInstallStatusAtom)
  const setPingStatus = useSetAtom(zoteroPingStatusAtom)

  useEffect(() => {
    void initializeZoteroSettings(setEnabled, setDataDir, setInstallStatus, setPingStatus)
  }, [setEnabled, setDataDir, setInstallStatus, setPingStatus])

  return null
}

/**
 * Agent IPC 监听器初始化组件
 *
 * 全局挂载，永不销毁。确保 Agent 流式事件、权限请求
 * 在页面切换时不丢失。
 */
function AgentListenersInitializer(): null {
  useGlobalAgentListeners()
  useQuoteChatTab()
  return null
}

/**
 * Zotero 状态轮询组件
 *
 * 全局挂载，周期 + 可见性/焦点切换时刷新 zoteroPingStatusAtom，
 * 避免 Sidebar 文献库入口的"连接 Zotero"Tag 因 ping 状态过期而误显。
 */
function ZoteroStatusPollingInitializer(): null {
  useZoteroStatusPolling()
  return null
}

/**
 * 标签页持久化组件
 *
 * 启动时从 settings.tabState 恢复上次打开的标签页；
 * 运行时监听标签页变化，自动保存到 settings.json。
 */

/**
 * 旧版（分屏时代）持久化结构——仅用于向后兼容读取迁移。
 * 新版已扁平化为 { tabs, activeTabId }；旧版是 { tabs, splitLayout }。
 */
interface LegacyTabStateWithSplitLayout {
  splitLayout?: {
    focusedPanelIndex?: number
    panels?: Array<{ activeTabId?: string | null }>
  }
}

/** 从旧版 splitLayout 结构中提取原焦点面板的 activeTabId */
function extractLegacyActiveTabId(tabState: unknown): string | null {
  if (!tabState || typeof tabState !== 'object') return null
  const legacy = tabState as LegacyTabStateWithSplitLayout
  const panels = legacy.splitLayout?.panels
  if (!Array.isArray(panels) || panels.length === 0) return null
  const focusedIndex = legacy.splitLayout?.focusedPanelIndex ?? 0
  return panels[focusedIndex]?.activeTabId ?? panels[0]?.activeTabId ?? null
}

function TabStatePersistenceInitializer(): null {
  const store = useStore()
  const restoredRef = useRef(false)

  // 启动恢复：读取 settings.tabState + 校验会话有效性
  useEffect(() => {
    Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.listAgentSessions(),
      window.electronAPI.listAgentWorkspaces(),
    ]).then(([settings, agentSessions, workspaces]) => {
      const tabState = settings.tabState
      if (!tabState?.tabs?.length) {
        restoredRef.current = true
        return
      }

      // 解析当前工作区 ID（与 AgentSettingsInitializer 中保持同一规则：
      // 设置存在且仍有效 → 用之；否则回退到第一个工作区）。
      const effectiveWorkspaceId: string | null = settings.agentWorkspaceId
        && workspaces.some((w) => w.id === settings.agentWorkspaceId)
        ? settings.agentWorkspaceId
        : workspaces[0]?.id ?? null

      const sessionById = new Map(agentSessions.map((s) => [s.id, s]))
      const workspaceIds = new Set(workspaces.map((w) => w.id))

      // 恢复所有工作区的标签（#458：tab 栏运行期按工作区过滤，持久化保留全量）：
      // 1) 校验数据结构 + session 仍存在；2) workspaceId 以 session meta 回填为准；
      // 3) 归属工作区已被删除的 tab 丢弃（无归属的保留，各工作区可见）
      const validTabs = tabState.tabs
        .filter(
          (t): t is TabItem =>
            typeof t === 'object' &&
            t !== null &&
            'id' in t &&
            'sessionId' in t &&
            'type' in t &&
            'title' in t &&
            sessionById.has(t.sessionId),
        )
        .map((t) => {
          const wsId = sessionById.get(t.sessionId)?.workspaceId
          return wsId != null ? { ...t, workspaceId: wsId } : { ...t, workspaceId: undefined }
        })
        .filter((t) => t.workspaceId == null || workspaceIds.has(t.workspaceId))
      if (validTabs.length === 0) {
        restoredRef.current = true
        return
      }

      const validTabIds = new Set(validTabs.map((t) => t.id))

      // 恢复各工作区 active tab 记忆（剔除 tab 已不在 / 工作区已不存在的条目）
      const restoredMemory: Record<string, string> = {}
      for (const [wsId, tabId] of Object.entries(tabState.activeTabIdByWorkspace ?? {})) {
        if (workspaceIds.has(wsId) && validTabIds.has(tabId)) restoredMemory[wsId] = tabId
      }

      // 当前工作区可见的 tab 集合（active 必须落在可见集内）
      const visibleTabs = filterVisibleTabs(validTabs, effectiveWorkspaceId)
      const visibleTabIds = new Set(visibleTabs.map((t) => t.id))

      // 恢复 activeTabId：工作区记忆 → 持久化 activeTabId → 旧版 splitLayout → 首个可见 tab
      let restoredActiveTabId: string | null = null
      const remembered = effectiveWorkspaceId ? restoredMemory[effectiveWorkspaceId] : undefined
      const legacyId = extractLegacyActiveTabId(tabState)
      if (remembered && visibleTabIds.has(remembered)) {
        restoredActiveTabId = remembered
      } else if (tabState.activeTabId && visibleTabIds.has(tabState.activeTabId)) {
        restoredActiveTabId = tabState.activeTabId
      } else if (legacyId && visibleTabIds.has(legacyId)) {
        restoredActiveTabId = legacyId
      } else {
        restoredActiveTabId = visibleTabs[0]?.id ?? null
      }

      store.set(tabsAtom, validTabs)
      store.set(activeTabIdAtom, restoredActiveTabId)
      store.set(activeTabIdByWorkspaceAtom, restoredMemory)

      const activeTab = validTabs.find((t) => t.id === restoredActiveTabId)
      if (activeTab) {
        store.set(currentAgentSessionIdAtom, activeTab.sessionId)
      }

      console.log(`[TabRestore] 已恢复 ${validTabs.length} 个标签页（当前工作区可见 ${visibleTabs.length} 个）`)
    }).then(() => { window.__TAURI_FORMAL__?.hydrated('tabs') })
      .catch((err) => { console.error('[TabRestore] 恢复标签页失败:', err); window.__TAURI_FORMAL__?.hydrated('tabs', err) })
      .finally(() => { restoredRef.current = true })
  }, [store])

  // 各工作区 active tab 记忆：activeTabId 变化时按 tab 自身归属记录。
  // 多条激活路径先 set activeTabId 后 set workspaceId（TabBar.handleActivate 等），
  // 按"当前工作区"记会记错宿主；所有路径都先写 tabsAtom 再写 activeTabIdAtom，
  // 故以 tab.workspaceId 为 key 与触发顺序无关。无归属 tab 回退记到当前工作区。
  useEffect(() => {
    const unsub = store.sub(activeTabIdAtom, () => {
      const activeTabId = store.get(activeTabIdAtom)
      if (!activeTabId) return
      const tab = store.get(tabsAtom).find((t) => t.id === activeTabId)
      if (!tab) return
      const wsId = tab.workspaceId ?? store.get(currentAgentWorkspaceIdAtom)
      if (!wsId) return
      store.set(activeTabIdByWorkspaceAtom, (prev) =>
        prev[wsId] === activeTabId ? prev : { ...prev, [wsId]: activeTabId },
      )
    })
    return unsub
  }, [store])

  // 自动保存：监听 tabsAtom / activeTabIdAtom / 工作区记忆变化，防抖写入 settings.json
  useEffect(() => {
    if (window.__TAURI_FORMAL__) return
    let timer: ReturnType<typeof setTimeout> | null = null

    const buildTabState = (): PersistedTabState => ({
      tabs: store.get(tabsAtom),
      activeTabId: store.get(activeTabIdAtom),
      activeTabIdByWorkspace: store.get(activeTabIdByWorkspaceAtom),
    })

    const save = (): void => {
      window.electronAPI.updateSettings({
        tabState: buildTabState(),
      }).catch(console.error)
    }

    const debouncedSave = (): void => {
      if (!restoredRef.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 500)
    }

    const unsub1 = store.sub(tabsAtom, debouncedSave)
    const unsub2 = store.sub(activeTabIdAtom, debouncedSave)
    const unsub3 = store.sub(activeTabIdByWorkspaceAtom, debouncedSave)

    // 窗口关闭前立即刷新，避免最后 500ms 内的变更丢失
    const handleBeforeUnload = (): void => {
      if (timer) clearTimeout(timer)
      // 使用同步 IPC 确保关闭前数据写入磁盘
      const tabState = buildTabState()
      if (tabState.tabs.length > 0 && window.electronAPI.updateSettingsSync) {
        const ok = window.electronAPI.updateSettingsSync({ tabState })
        if (!ok) {
          console.warn('[TabPersist] sync IPC failed, falling back to async save')
          save()
        }
      } else {
        save()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      unsub1()
      unsub2()
      unsub3()
      if (timer) clearTimeout(timer)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [store])

  return null
}

/**
 * 项目文件面板展开状态持久化组件
 *
 * 监听 sidebarProjectFilesExpandedMapAtom 变化，
 * 防抖写回 settings.json 的 sidebarProjectFilesExpandedByWorkspace 字段。
 */
function ProjectFilesExpandedPersistenceInitializer(): null {
  const store = useStore()

  useEffect(() => {
    if (window.__TAURI_FORMAL__) return
    let timer: ReturnType<typeof setTimeout> | null = null

    const save = (): void => {
      const map = store.get(sidebarProjectFilesExpandedMapAtom)
      const plain: Record<string, boolean> = {}
      for (const [k, v] of map) plain[k] = v
      window.electronAPI
        .updateSettings({ sidebarProjectFilesExpandedByWorkspace: plain })
        .catch(console.error)
    }

    const debouncedSave = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 400)
    }

    const unsub = store.sub(sidebarProjectFilesExpandedMapAtom, debouncedSave)

    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [store])

  return null
}

// ===== 快速任务窗口：轻量渲染 =====
if (isQuickTaskWindow) {
  import('./components/quick-task/QuickTaskApp').then(({ QuickTaskApp }) => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <GlobalErrorBoundary>
          <QuickTaskApp />
        </GlobalErrorBoundary>
      </React.StrictMode>
    )
  })
} else {
  // ===== 主窗口：完整渲染 =====
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <GlobalErrorBoundary>
        <AgentSettingsInitializer />
        <LanguageInitializer />
        <ThemeInitializer />
        <NotificationsInitializer />
        {!window.__TAURI_FORMAL__ && <ZoteroSettingsInitializer />}
        {!window.__TAURI_FORMAL__ && <ZoteroStatusPollingInitializer />}
        <AgentListenersInitializer />
        {!window.__TAURI_FORMAL__ && <UpdaterInitializer />}
        {!window.__TAURI_FORMAL__ && <AsrWeightsInitializer />}
        <TabStatePersistenceInitializer />
        <ProjectFilesExpandedPersistenceInitializer />
        <GlobalShortcuts />
        <App />
        <UpdateDialog />
        <Toaster position="top-right" />
      </GlobalErrorBoundary>
    </React.StrictMode>
  )
}
