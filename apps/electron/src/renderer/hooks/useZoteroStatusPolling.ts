/**
 * useZoteroStatusPolling — 全局 Zotero 连接状态轮询
 *
 * 在应用顶层挂载，永不销毁。后台周期 + 文档可见性/窗口焦点切换时
 * 刷新 zoteroPingStatusAtom，确保 Sidebar 文献库入口的"连接 Zotero"
 * Tag 不依赖 ZoteroSettings/LibraryView 挂载也能跟随实际连接状态更新。
 *
 * 与 ZoteroSettings.tsx 内 5s 间隔的 refresh() 共存：配置页的快节奏
 * 轮询用于用户主动配置时的即时反馈；此处的 60s 全局轮询负责后台同步。
 */

import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { zoteroPingStatusAtom } from '@/atoms/zotero-atoms'

const BACKGROUND_INTERVAL_MS = 60_000

export function useZoteroStatusPolling(): void {
  const setPingStatus = useSetAtom(zoteroPingStatusAtom)

  useEffect(() => {
    let cancelled = false
    // 自增请求号：响应回来时若已不是最新一笔，丢弃；防止 focus/visibility
    // 触发的快请求被定时器同期慢请求覆盖。
    let requestSeq = 0

    const refresh = async (): Promise<void> => {
      const myId = ++requestSeq
      try {
        const next = await window.electronAPI.zotero.ping()
        if (cancelled || myId !== requestSeq) return
        // 形状未变时返回同引用，避免 Jotai 触发整树订阅者 re-render
        setPingStatus((prev) =>
          prev.running === next.running && prev.remoteEnabled === next.remoteEnabled ? prev : next,
        )
      } catch (error) {
        console.warn('[Zotero] 后台 ping 失败:', error)
      }
    }

    void refresh()
    // 后台（visibility hidden）时不发起 ping，省电；回到前台由 visibilitychange 兜底
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, BACKGROUND_INTERVAL_MS)

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onFocus = (): void => { void refresh() }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [setPingStatus])
}
