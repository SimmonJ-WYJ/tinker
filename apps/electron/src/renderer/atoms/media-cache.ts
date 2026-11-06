/**
 * Zotero 媒体缓存状态的 Jotai atom
 *
 * stats 通过 IPC 从主进程拉取。
 * 没有自动刷新：面板 mount / 清空后主动 refresh。
 */
import { atom } from 'jotai'
import type { MediaCacheStats } from '@asci/shared'

export const mediaCacheStatsAtom = atom<MediaCacheStats | null>(null)
export const mediaCacheLoadingAtom = atom(false)

export const refreshMediaCacheStatsAtom = atom(null, async (_get, set) => {
  set(mediaCacheLoadingAtom, true)
  try {
    const stats = await window.electronAPI.mediaCache.stats()
    set(mediaCacheStatsAtom, stats)
  } finally {
    set(mediaCacheLoadingAtom, false)
  }
})

export const clearMediaCacheAtom = atom(null, async (_get, set) => {
  set(mediaCacheLoadingAtom, true)
  try {
    await window.electronAPI.mediaCache.clear()
    const stats = await window.electronAPI.mediaCache.stats()
    set(mediaCacheStatsAtom, stats)
  } finally {
    set(mediaCacheLoadingAtom, false)
  }
})
