/** 复用正式 Jotai store；原初始化组件明确交付 hydrate 屏障。 */
import { getDefaultStore } from 'jotai'
import { toast } from 'sonner'
import { tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom } from '../renderer/atoms/tab-atoms.ts'
import { sidebarProjectFilesExpandedMapAtom } from '../renderer/atoms/agent-atoms.ts'
import type { FormalTransport } from './transport.ts'
import { createLifecycle } from './lifecycle.ts'
import { i18n } from '../renderer/lib/i18n.ts'

export interface FormalLifecycleMarker { hydrated(part: 'tabs' | 'settings', error?: unknown): void }
declare global { interface Window { __TAURI_FORMAL__?: FormalLifecycleMarker } }
export function installPersistence(transport: FormalTransport): FormalLifecycleMarker {
  const store = getDefaultStore()
  const ready = new Set<string>()
  let resolve = () => {}
  let reject: (error: unknown) => void = () => {}
  const hydrated = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  void hydrated.catch(() => {})
  let hydrateFailed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let frozen = false
  const capture = () => ({
    tabState: { tabs: store.get(tabsAtom), activeTabId: store.get(activeTabIdAtom), activeTabIdByWorkspace: store.get(activeTabIdByWorkspaceAtom) },
    sidebarProjectFilesExpandedByWorkspace: Object.fromEntries(store.get(sidebarProjectFilesExpandedMapAtom)),
  })
  const persist = async (value: ReturnType<typeof capture>) => {
    if (hydrateFailed || ready.size !== 2) throw new Error('hydrateFailed')
    if (!transport.readSync('settings:update-sync', value)) await transport.invoke('settings:update', value)
    return transport.revision
  }
  const schedule = () => {
    if (hydrateFailed || ready.size !== 2 || frozen) return
    clearTimeout(timer)
    timer = setTimeout(() => { void persist(capture()).catch(failure) }, 400)
  }
  const failure = (error: unknown) => { console.error('[原生预览] 保存失败', error); toast.error(i18n.t('desktopRuntime.transport', { ns: 'errors' })) }
  for (const target of [tabsAtom, activeTabIdAtom, activeTabIdByWorkspaceAtom, sidebarProjectFilesExpandedMapAtom]) store.sub(target, schedule)
  const block = (event: Event) => { if (frozen) { event.preventDefault(); event.stopImmediatePropagation() } }
  for (const name of ['click', 'pointerdown', 'keydown', 'beforeinput', 'drop']) window.addEventListener(name, block, true)
  const lifecycle = createLifecycle({
    hydrated,
    freeze(value) { frozen = value; transport.setClosing(value); clearTimeout(timer) },
    drain: () => transport.quiesce(), capture, persist,
    async begin() { return (await transport.command<{ closeToken: string }>('beginClose')).closeToken },
    async abort(closeToken) { await transport.command('abortClose', { closeToken }) },
    async finish(closeToken, committedRevision) {
      await transport.command('closeReady', { closeToken, committedRevision })
      // 只有当前未超时的调用获得 drain/join 确认，才给予 native 最后关闭权。
      await transport.command('closeWindow', { closeToken, committedRevision })
    },
    reload() { window.location.reload() }, failure,
  })
  transport.onAction((action) => { void lifecycle.run(action) })
  window.addEventListener('keydown', (event) => {
    if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') || event.key === 'F5') { event.preventDefault(); event.stopImmediatePropagation(); void lifecycle.run('reload') }
  }, true)
  return { hydrated(part, error) {
    // 一个 document 的任何初始化失败均为终态；StrictMode 迟到成功不能重新开放写入。
    if (error !== undefined) { hydrateFailed = true; clearTimeout(timer); reject(error); return }
    if (hydrateFailed) return
    ready.add(part)
    if (ready.size === 2) { resolve(); schedule() }
  } }
}
