/** Tauri 注入门面；仅调用 formal 命令，不暴露旧 Lab 通用 IPC。 */
import type { NativeBridge, NativeEvent } from './protocol.ts'
interface TauriGlobal {
  core: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> }
  event: { listen<T>(name: string, callback: (event: { payload: T }) => void): Promise<() => void> }
}
export function nativeBridge(): NativeBridge {
  const tauri = (window as unknown as { __TAURI__: TauriGlobal }).__TAURI__
  return {
    request: <T>(request: Record<string, unknown>) => tauri.core.invoke<T>('formal_request', { request }),
    listen: (callback) => tauri.event.listen<NativeEvent>('formal:event', (event) => callback(event.payload)),
  }
}
/** 原 utilities.css 的同一 drag/no-drag 语义，WebKit 无须识别 Chromium 属性。 */
export function isWindowDragTarget(target: Element): boolean {
  let element: Element | null = target
  while (element) {
    if (element.matches('.titlebar-no-drag,button,input,textarea,a,select,[contenteditable="true"],[role="button"],[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper],[data-sonner-toaster],[data-sonner-toast]')) return false
    if (element.classList.contains('titlebar-drag-region')) return true
    element = element.parentElement
  }
  return false
}
export function installWindowDrag(generation: string): void {
  const tauri = (window as unknown as { __TAURI__: TauriGlobal }).__TAURI__
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !isWindowDragTarget(event.target)) return
    void tauri.core.invoke('formal_window', { generation, action: 'drag' }).catch(console.error)
  })
}
