/** Electron 专用入口：适配 IPC、文件路径和上下文桥，纯 API 不依赖平台模块。 */
import '@sentry/electron/preload'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { DESKTOP_PREVIEW_STATUS_CHANNEL } from '@asci/shared'
import { THEME_IPC_CHANNELS } from '../types/index.ts'
import type { ResolvedTheme } from '../types/index.ts'
import { createDesktopApi } from './api.ts'
import type { ElectronAPI } from './api.ts'
import type { PlatformTransport } from './transport.ts'

export type { ElectronAPI } from './api.ts'

const transport: PlatformTransport = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  readSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
  subscribe<T>(channel: string, callback: (data: T) => void) {
    const listener = (_event: unknown, data: T): void => callback(data)
    ipcRenderer.on(channel, listener)
    return () => { ipcRenderer.removeListener(channel, listener) }
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('electronAPI', createDesktopApi(transport))

// 同步暴露启动主题，避免 React mount 前的首帧白闪。
const initialTheme = transport.readSync<ResolvedTheme>(THEME_IPC_CHANNELS.RESOLVE)
contextBridge.exposeInMainWorld('__INITIAL_THEME__', initialTheme)
contextBridge.exposeInMainWorld('__DESKTOP_RUNTIME_PREVIEW__', transport.readSync(DESKTOP_PREVIEW_STATUS_CHANNEL) === true)

declare global {
  interface Window {
    electronAPI: ElectronAPI
    __INITIAL_THEME__: ResolvedTheme
  }
}
