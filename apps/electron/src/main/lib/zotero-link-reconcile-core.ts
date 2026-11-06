/**
 * Zotero link 对账纯逻辑（#461）—— 无 electron / fs 依赖，便于单测
 *
 * 选择逻辑：给定各工作区的 linkedZoteroKey 与「已确认在 Zotero 被删除」的 key 集合，
 * 算出每个工作区需要清空的 entry key 列表。读写盘 / 反查 Zotero / 广播事件等副作用
 * 留在 zotero-link-reconcile.ts。
 */

/** 单个工作区的 linkedZoteroKey 视图（纯函数入参） */
export interface WorkspaceLinks {
  /** 工作区 id（用于广播 changed 事件，事件按 id 而非 slug） */
  id: string
  /** 工作区 slug（用于读写 papers.jsonl） */
  slug: string
  entries: Array<{ key: string; linkedZoteroKey: string | null }>
}

/** 每个工作区需清空 linkedZoteroKey 的 entry key 列表 */
export interface ClearPlan {
  id: string
  slug: string
  keys: string[]
}

/** 反查每批 itemKey 数量（与 zotero-pdf-diff 的 PARENT_BATCH 同口径，URL 长度安全） */
export const ITEM_KEY_BATCH = 50

/**
 * 批量反查 Zotero 存在性，返回「成功查询且确认已被删除」的 key 集合。
 *
 * fetchExistingKeys(batch)：传入一批 itemKey，返回其中 Zotero 仍存在的 key 子集。
 * 保守原则：某批查询抛错（网络异常 / Zotero 离线）时，该批 key 一律按「仍存在」处理，
 *   跳过不计入 stale——绝不在查询失败时误清。
 */
export async function findDeletedZoteroKeys(
  keys: string[],
  fetchExistingKeys: (batch: string[]) => Promise<string[]>,
  batchSize: number = ITEM_KEY_BATCH,
): Promise<Set<string>> {
  // 切批后所有批次并发反查（Zotero local API 在 localhost，可并发）
  const batches: string[][] = []
  for (let i = 0; i < keys.length; i += batchSize) {
    batches.push(keys.slice(i, i + batchSize))
  }

  const stale = new Set<string>()
  const results = await Promise.all(
    batches.map((batch) =>
      fetchExistingKeys(batch).then(
        (existing) => ({ batch, existing: new Set(existing) }),
        (err) => {
          // 保守：本批查询失败 → 全部按仍存在处理，跳过（不计入 stale）
          console.warn('[Zotero Link 对账] 反查批次失败，跳过该批不清理:', err)
          return null
        },
      ),
    ),
  )

  for (const r of results) {
    if (!r) continue
    for (const k of r.batch) {
      if (!r.existing.has(k)) stale.add(k)
    }
  }
  return stale
}

/**
 * 纯函数：给定各工作区的 linkedZoteroKey 与「已确认在 Zotero 被删除」的 key 集合，
 * 算出每个工作区需要清空的 entry key 列表。只返回有命中条目的工作区。
 */
export function selectEntriesToClear(
  workspaces: WorkspaceLinks[],
  staleKeys: ReadonlySet<string>,
): ClearPlan[] {
  if (staleKeys.size === 0) return []
  const plans: ClearPlan[] = []
  for (const ws of workspaces) {
    const keys = ws.entries
      .filter((e) => e.linkedZoteroKey != null && staleKeys.has(e.linkedZoteroKey))
      .map((e) => e.key)
    if (keys.length > 0) plans.push({ id: ws.id, slug: ws.slug, keys })
  }
  return plans
}
