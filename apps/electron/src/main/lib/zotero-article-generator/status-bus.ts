/**
 * article 状态变更事件总线（避免 worker ↔ index 之间循环依赖）
 *
 * index.ts 在初始化时把 emit 函数注入；worker.ts 在中途节点（每片完成等）调用 ping。
 */

import type { ZoteroPdfArticleStatusSummary } from '@asci/shared'

type Emitter = () => ZoteroPdfArticleStatusSummary | null

let listener: ((summary: ZoteroPdfArticleStatusSummary) => void) | null = null
let summarySource: Emitter | null = null

/** index.ts 调用：注册渲染端推送回调 + 状态摘要计算函数 */
export function configureStatusBus(
  cb: ((summary: ZoteroPdfArticleStatusSummary) => void) | null,
  source: Emitter,
): void {
  listener = cb
  summarySource = source
}

/** worker / index 内部调用：触发一次状态推送（无监听则静默） */
export function pingStatusChanged(): void {
  if (!listener || !summarySource) return
  try {
    const summary = summarySource()
    if (summary) listener(summary)
  } catch (err) {
    console.warn('[Zotero Article] status bus ping 异常:', err)
  }
}
