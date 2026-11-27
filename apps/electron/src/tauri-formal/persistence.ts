/** 复用正式 Jotai store；原初始化组件明确交付 hydrate 屏障。 */
import type { AgentEffort, AgentSessionMeta } from '@asci/shared'
import { getDefaultStore } from 'jotai'
import { toast } from 'sonner'
import { tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom } from '../renderer/atoms/tab-atoms.ts'
import { sidebarProjectFilesExpandedMapAtom, agentSessionDraftsAtom, currentAgentWorkspaceIdAtom } from '../renderer/atoms/agent-atoms.ts'
import type { FormalTransport } from './transport.ts'
import { createLifecycle } from './lifecycle.ts'
import { i18n } from '../renderer/lib/i18n.ts'

export interface FormalLifecycleMarker {
  prepareRevision?(input: { sessionId: string; upToMessageUuid: string }): Promise<{
    session: AgentSessionMeta & Required<Pick<AgentSessionMeta, 'nativeRevisionRoute'>>
    prompt: string
    effort?: AgentEffort
  }>
  projectBackups?: import('./project-backups').NativeProjectBackups
  projectDocuments?: import('./project-documents').NativeProjectDocuments
  imageAssets?: import('./image-assets').NativeImageAssets
  nativeImageTaskLifecycle?: boolean
  nativeTaskLifecycle?: {
    retry(input: { sessionId: string; requestId: string; startedAt: number; retryOfRequestId: string }): Promise<void>
    stop(sessionId: string, expectedRequestId: string): Promise<void>
  }
  projectTaskStatuses?(workspaceId: string): Promise<import('./project-tasks').ProjectTaskStatus[]>
  bindProjectDirectory?(workspaceId: string): Promise<boolean>
  importSessions?: import('./session-import').SessionImporter
  imageFiles?: import('./image-files').NativeImageFiles
  nativeImages?: boolean
  selectedImageUse?(text: string, imageId: string, imageModel?: boolean): 'edit' | 'text' | 'inspect' | 'switchToText'
  hydrated(part: 'tabs' | 'settings', error?: unknown): void
}
declare global {
  interface Window {
    __TAURI_FORMAL__?: FormalLifecycleMarker
  }
}

export function installPersistence(transport: FormalTransport): FormalLifecycleMarker & {
  dispose(): void
} {
  const store = getDefaultStore()
  // 草稿只在正式Tauri入口hydrate；不修改Electron默认初始化或存储。
  store.set(agentSessionDraftsAtom, new Map(Object.entries(transport.bootstrap.platformSnapshot.settings.sessionDrafts ?? {})))
  const ready = new Set<string>()
  let resolve = () => {}
  let reject: (error: unknown) => void = () => {}
  const hydrated = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  void hydrated.catch(() => {})
  let hydrateFailed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let frozen = false
  const capture = () => {
    const tabs = store.get(tabsAtom)
    const activeTabId = store.get(activeTabIdAtom)
    const workspace = store.get(currentAgentWorkspaceIdAtom) ?? transport.bootstrap.platformSnapshot.settings.agentWorkspaceId
    const active = tabs.find(tab => tab.id === activeTabId)
    const activeTabIdByWorkspace = {
      ...store.get(activeTabIdByWorkspaceAtom)
    }
    if (workspace && active && (active.workspaceId ?? workspace) === workspace) activeTabIdByWorkspace[workspace] = active.id
    return {
      tabState: {
        tabs,
        activeTabId,
        activeTabIdByWorkspace
      },
      sidebarProjectFilesExpandedByWorkspace: Object.fromEntries(store.get(sidebarProjectFilesExpandedMapAtom)),
      sessionDrafts: Object.fromEntries(store.get(agentSessionDraftsAtom)),
    }
  }
  const persist = async (value: ReturnType<typeof capture>, lifecycle = false) => {
    if (hydrateFailed || ready.size !== 2) throw new Error('hydrateFailed')
    if (lifecycle) return transport.persistCapture(value)
    if (!transport.readSync('settings:update-sync', value)) await transport.invoke('settings:update', value)
    return transport.revision
  }
  const schedule = () => {
    if (hydrateFailed || ready.size !== 2 || frozen) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      void persist(capture()).catch(failure)
    }, 400)
  }
  const failure = (error: unknown) => {
    console.error('[原生预览] 保存失败', error)
    toast.error(i18n.t('desktopRuntime.transport', {
      ns: 'errors'
    }))
  }
  const subscriptions = [tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom, sidebarProjectFilesExpandedMapAtom, agentSessionDraftsAtom].map(target => store.sub(target, schedule))
  const block = (event: Event) => {
    if (frozen) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  for (const name of ['click', 'pointerdown', 'keydown', 'beforeinput', 'drop']) window.addEventListener(name, block, true)
  const lifecycle = createLifecycle({
    hydrated,
    freeze(value) {
      frozen = value
      transport.setClosing(value)
      clearTimeout(timer)
    },
    drain: () => transport.quiesce(),
    capture,
    persist: value => persist(value, true),
    async begin() {
      return (await transport.command<{
        closeToken: string
      }>('beginClose')).closeToken
    },
    async abort(closeToken) {
      await transport.command('abortClose', {
        closeToken
      })
    },
    async finish(closeToken, committedRevision) {
      await transport.command('closeReady', {
        closeToken,
        committedRevision
      })
      // 只有当前未超时的调用获得 drain/join 确认，才给予 native 最后关闭权。
      await transport.command('closeWindow', {
        closeToken,
        committedRevision
      })
    },
    reload() {
      window.location.reload()
    },
    failure,
  })
  transport.onAction((action) => {
    void lifecycle.run(action)
  })
  const reloadKey = (event: KeyboardEvent) => {
    if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') || event.key === 'F5') {
      event.preventDefault()
      event.stopImmediatePropagation()
      void lifecycle.run('reload')
    }
  }
  window.addEventListener('keydown', reloadKey, true)
  return {
    dispose() {
      frozen = true
      clearTimeout(timer)
      for (const unsubscribe of subscriptions) unsubscribe()
      for (const name of ['click', 'pointerdown', 'keydown', 'beforeinput', 'drop']) window.removeEventListener(name, block, true)
      window.removeEventListener('keydown', reloadKey, true)
      transport.onAction(() => {})
    },
    hydrated(part, error) {
      // 一个 document 的任何初始化失败均为终态；StrictMode 迟到成功不能重新开放写入。
      if (error !== undefined) {
        hydrateFailed = true
        clearTimeout(timer)
        reject(error)
        return
      }
      if (hydrateFailed) return
      ready.add(part)
      if (ready.size === 2) {
        resolve()
        schedule()
      }
    }
  }
}
