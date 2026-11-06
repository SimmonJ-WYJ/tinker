/**
 * Zotero link 对账：清理 papers.jsonl 里指向「已删 Zotero 条目」的 stale linkedZoteroKey（#461）
 *
 * 背景：用户在会话「加入文献」面板把 paper「加入 Zotero」后会写回 linkedZoteroKey
 * （Zotero 父条目的 8 字符 Web API key）；之后若在 Zotero 删除该条目，没有任何路径
 * 清掉这个 key，导致面板永远显示「已加入 Zotero」且隐藏勾选框，无法重新加入。
 *
 * 策略（思路 B：Web API 反查）：
 *   1. 枚举所有工作区，收集 papers.jsonl 里所有非空 linkedZoteroKey
 *   2. 批量反查 Zotero Web API（?itemKey=K1,K2,...）确认存在性
 *   3. 清掉「成功查询但 Zotero 已不返回」的 key（= 已被删除），并广播 changed 刷新面板
 *
 * 保守原则：批次查询失败（网络异常 / Zotero 离线）时，该批 key 一律按「仍存在」处理，
 *   绝不在查询失败时误清——避免把好好的链接当成被删。
 *
 * 由 runZoteroPdfDiff 在每次 diff 末尾调用（此时已 ping 过 Zotero、确认在线）。
 *
 * 纯选择逻辑见 zotero-link-reconcile-core.ts（无 electron / fs 依赖，单测覆盖）。
 */

import { fetchZotero } from './zotero-client/api-client.ts'
import { listAgentWorkspaces } from './agent-workspace-manager'
import * as workspacePaperStore from './workspace-paper-store'
import { emitPapersChanged } from './workspace-paper-events'
import {
  findDeletedZoteroKeys,
  selectEntriesToClear,
  type WorkspaceLinks,
} from './zotero-link-reconcile-core'

/** Zotero Web API item 响应片段（只取 key） */
interface ZoteroApiItemKey {
  key: string
}

/** 一批 itemKey → Zotero 仍存在的 key 子集（?itemKey= 只返回存在的条目） */
async function fetchExistingZoteroKeys(batch: string[]): Promise<string[]> {
  const items = await fetchZotero<ZoteroApiItemKey[]>(
    `/users/0/items?itemKey=${batch.join(',')}&format=json`,
  )
  return items.map((it) => it.key)
}

/**
 * 读取所有工作区的 linkedZoteroKey 视图（仅取 key + linkedZoteroKey 两字段）。
 */
function loadWorkspaceLinks(): WorkspaceLinks[] {
  return listAgentWorkspaces().map((ws) => ({
    id: ws.id,
    slug: ws.slug,
    entries: workspacePaperStore
      .list(ws.slug, {})
      .map((e) => ({ key: e.key, linkedZoteroKey: e.linkedZoteroKey })),
  }))
}

/**
 * 主入口：对账所有工作区的 linkedZoteroKey，清掉指向已删 Zotero 条目的 key。
 *
 * 返回清理的 entry 条数；不抛错（调用方在 diff 主路径上，失败仅 warn 不阻塞）。
 */
export async function reconcileWorkspaceZoteroLinks(): Promise<{ cleared: number }> {
  const workspaces = loadWorkspaceLinks()

  // 收集各工作区所有非空 linkedZoteroKey（去重）
  const allKeys = new Set<string>()
  for (const ws of workspaces) {
    for (const e of ws.entries) {
      if (e.linkedZoteroKey) allKeys.add(e.linkedZoteroKey)
    }
  }
  if (allKeys.size === 0) return { cleared: 0 }

  const staleKeys = await findDeletedZoteroKeys([...allKeys], fetchExistingZoteroKeys)
  const plans = selectEntriesToClear(workspaces, staleKeys)

  let cleared = 0
  for (const plan of plans) {
    workspacePaperStore.batchUpdate(plan.slug, plan.keys, { linkedZoteroKey: null })
    emitPapersChanged(plan.id, plan.keys, 'external')
    cleared += plan.keys.length
    console.log(
      `[Zotero Link 对账] 工作区 ${plan.slug} 清理 ${plan.keys.length} 条 stale linkedZoteroKey（Zotero 已删除）`,
    )
  }
  return { cleared }
}
