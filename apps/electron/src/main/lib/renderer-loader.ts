/**
 * 渲染进程加载策略
 *
 * 默认加载已构建的 dist/renderer，只有显式开发模式才连接 Vite dev server。
 */

import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { join } from 'path'

const DEFAULT_VITE_DEV_SERVER_URL = 'http://localhost:5173'

/** 是否使用 Vite dev server 加载渲染进程 */
export function shouldUseViteDevServer(): boolean {
  return !app.isPackaged && process.env.ASCI_RENDERER_MODE === 'dev'
}

/** 加载主窗口或快速任务窗口的渲染入口 */
export function loadRendererWindow(
  window: BrowserWindow,
  query?: Record<string, string>,
): void {
  if (shouldUseViteDevServer()) {
    const url = new URL(process.env.ASCI_VITE_DEV_SERVER_URL ?? DEFAULT_VITE_DEV_SERVER_URL)
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value)
    }
    console.log(`[渲染进程] 加载 Vite dev server: ${url.toString()}`)
    void window.loadURL(url.toString())
    return
  }

  console.log('[渲染进程] 加载本地构建产物')
  void window.loadFile(join(__dirname, 'renderer', 'index.html'), query ? { query } : undefined)
}
