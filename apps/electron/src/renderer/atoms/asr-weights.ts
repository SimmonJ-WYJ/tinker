/**
 * ASR 权重状态的 Jotai atom
 *
 * 主进程推送 STATUS_CHANGED 事件进来；订阅挂在 AsrWeightsInitializer。
 */
import { atom } from 'jotai'
import type { AsrWeightStatus } from '@asci/shared'

export const asrWeightsStatusAtom = atom<AsrWeightStatus | null>(null)

/** 触发下载（不阻塞；进度通过订阅事件更新） */
export const asrWeightsDownloadAtom = atom(null, async (_get, set) => {
  const s = await window.electronAPI.asrWeights.download()
  set(asrWeightsStatusAtom, s)
})

export const asrWeightsCancelAtom = atom(null, async (_get, set) => {
  const s = await window.electronAPI.asrWeights.cancel()
  set(asrWeightsStatusAtom, s)
})

export const asrWeightsDeleteAtom = atom(null, async (_get, set) => {
  const s = await window.electronAPI.asrWeights.delete()
  set(asrWeightsStatusAtom, s)
})

export const asrWeightsRefreshAtom = atom(null, async (_get, set) => {
  const s = await window.electronAPI.asrWeights.getStatus()
  set(asrWeightsStatusAtom, s)
})
