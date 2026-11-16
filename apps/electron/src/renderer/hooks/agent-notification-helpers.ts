/** 由全局监听器复用的通知与会话导航；不持有额外全局状态。 */
import type { createStore } from 'jotai'
import type { NotificationSoundType } from '@/types/settings'
import { agentSessionsAtom, currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '../atoms/agent-atoms.ts'
import { tabsAtom, activeTabIdAtom, openTab } from '../atoms/tab-atoms.ts'
import { notificationsEnabledAtom, notificationSoundEnabledAtom, notificationSoundsAtom, sendDesktopNotification } from '../atoms/notifications.ts'
import { rightPanelTabsBySessionAtom, upsertTab, tabIdOfTarget, kindOfTarget, titleOfTarget } from '../atoms/right-panel-tabs.ts'
import { extOf } from '../lib/deliverable-path.ts'
import type { PreviewTarget } from '../atoms/side-panel-layout.ts'
import { agentSidePanelOpenMapAtom } from '../atoms/agent-atoms.ts'
import { i18n } from '../lib/i18n.ts'
export function createAgentNotificationHelpers(store: ReturnType<typeof createStore>) {
    /** 构建导航到指定会话的回调 */
    const makeNavigateToSession = (sessionId: string, sessionTitle: string) => () => {
      const tabs = store.get(tabsAtom)
      const sessions = store.get(agentSessionsAtom)
      const session = sessions.find((s) => s.id === sessionId)
      const result = openTab(tabs, {
        type: 'agent',
        sessionId,
        title: sessionTitle,
        workspaceId: session?.workspaceId,
      })
      store.set(tabsAtom, result.tabs)
      store.set(activeTabIdAtom, result.activeTabId)
      store.set(currentAgentSessionIdAtom, sessionId)
      if (session?.workspaceId) {
        store.set(currentAgentWorkspaceIdAtom, session.workspaceId)
      }
    }

    /** 获取会话标题 */
    const getSessionTitle = (sessionId: string): string => {
      const sessions = store.get(agentSessionsAtom)
      return sessions.find((s) => s.id === sessionId)?.title ?? i18n.t('conversation:session.defaultTitle')
    }

    /** 发送阻塞通知（带提示音 + 会话导航） */
    const sendBlockingNotification = (sessionId: string, title: string, body: string, soundType: NotificationSoundType) => {
      const enabled = store.get(notificationsEnabledAtom)
      const soundEnabled = store.get(notificationSoundEnabledAtom)
      const sounds = store.get(notificationSoundsAtom)
      const sessionTitle = getSessionTitle(sessionId)
      sendDesktopNotification(
        title,
        `[${sessionTitle}] ${body}`,
        enabled,
        {
          force: true,
          playSound: enabled && soundEnabled,
          soundType,
          sounds,
          onNavigate: makeNavigateToSession(sessionId, sessionTitle),
        }
      )
    }
    /** 在指定会话的右栏新建/聚焦一个文件预览 tab（与 useOpenInRightPanel 等价，store 版） */
    const openDeliverableInRightPanel = (sessionId: string, fullPath: string): void => {
      const target: PreviewTarget = {
        kind: 'file',
        path: fullPath,
        ext: extOf(fullPath.split('/').pop() ?? fullPath),
        size: 0, // 渲染器自行读文件；size 仅用于无 renderer 时的占位判断
      }
      store.set(rightPanelTabsBySessionAtom(sessionId), (prev) =>
        upsertTab(prev, tabIdOfTarget(target), kindOfTarget(target), titleOfTarget(target), target),
      )
      // 确保右栏可见，否则新建的产物 tab 用户看不到
      store.set(agentSidePanelOpenMapAtom, (prev) => {
        if (prev.get(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, true)
        return map
      })
    }

    return { makeNavigateToSession, getSessionTitle, sendBlockingNotification, openDeliverableInRightPanel }
}
