/**
 * Preload 共享辅助工具
 *
 * 收口 preload 各 domain 片段共用的 IPC 事件订阅逻辑，
 * 避免在每个 on* 方法里重复 listener 注册 / 移除样板。
 */
import { ipcRenderer } from 'electron'

/** 订阅主进程事件通道，返回取消订阅函数 */
export function subscribe<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_: unknown, data: T): void => cb(data)
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}
