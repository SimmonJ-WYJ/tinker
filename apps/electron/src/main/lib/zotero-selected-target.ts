/**
 * 获取 Zotero UI 当前选中的 target（collection 或 library 根）
 *
 * 调用 /connector/getSelectedCollection：
 * - 过滤 recent=true，按 level 降序取最大那条（level 0 是 library 根，level 1+ 是 collection）
 * - 若没有 recent target 或请求失败（Zotero 未运行 / 网络错），返回 null
 */

import { fetchZoteroConnector } from './zotero-client/api-client.ts'
import type { ZoteroSelectedTarget, ZoteroCollectionTarget } from '@asci/shared'

interface GetSelectedCollectionResponse {
  targets?: Array<{
    id: string
    name: string
    level?: number
    recent?: boolean
  }>
}

export async function getSelectedTarget(): Promise<ZoteroSelectedTarget | null> {
  try {
    // 必须 POST：/getSelectedCollection 不支持 GET（返 400 Endpoint does not support method）
    const resp = await fetchZoteroConnector<GetSelectedCollectionResponse>('/getSelectedCollection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const targets = resp?.targets ?? []
    const recentTargets = targets.filter((t) => t.recent)
    if (recentTargets.length === 0) return null
    recentTargets.sort((a, b) => (b.level ?? 0) - (a.level ?? 0))
    const best = recentTargets[0]!
    return {
      id: best.id,
      name: best.name,
      level: best.level ?? 0,
    }
  } catch (err) {
    console.warn('[Zotero] 获取当前选中 target 失败:', err)
    return null
  }
}

/**
 * 列出全部可写入 target（library 根 + 所有 collection），供「加入 Zotero」选择器用。
 *
 * 复用 /connector/getSelectedCollection 的 targets 树：每条 id 即 treeViewID
 * （'L1' = 我的文献库根，'C<整数>' = collection），可直接传给 /updateSession 的 target。
 * 与 listCollections（Web API /collections，返回 8 字符 key）不同 —— 写入走 connector，
 * 必须用 treeViewID 而非 Web API key。Zotero 未运行 / 失败时返回空数组。
 */
export async function listCollectionTargets(): Promise<ZoteroCollectionTarget[]> {
  try {
    // 必须 POST：/getSelectedCollection 不支持 GET（返 400 Endpoint does not support method）
    const resp = await fetchZoteroConnector<GetSelectedCollectionResponse>('/getSelectedCollection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const targets = resp?.targets ?? []
    return targets.map((t) => ({
      treeViewID: t.id,
      name: t.name,
      level: t.level ?? 0,
    }))
  } catch (err) {
    console.warn('[Zotero] 列出可写入 target 失败:', err)
    return []
  }
}
