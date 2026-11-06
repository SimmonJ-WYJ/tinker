/**
 * session 论文 → workspace 论文库回流
 *
 * 触发时机：session-papers-watcher 监测到 {sessionId}.jsonl（canonical）落盘后调用。
 *
 * 作用域（见 #702）：**仅刷新已加入文献库的条目**。retrieve 落盘后把本会话 records
 * 合并进 workspace，但只升级已存在的 entry（abstract/venue/citations 缺→有、lastSeenAt
 * 刷新），绝不为「未加入」论文凭检索结果新建条目——规避历史自动回流抠 DOI 片段产生
 * 大量占位条目的问题（commit 32cc7f0f 下线老回流的动因）。
 *
 * 用户标注层（status/starred/tags/note/linkedZoteroKey）由 appendOrMerge 保证永不被覆盖。
 *
 * 失败只 warn、不抛——监听主流程不受回流影响。
 */

import { getAgentSessionMeta } from './agent-session-manager'
import { getAgentWorkspace } from './agent-workspace-manager'
import { listSessionPapers } from './paper-result-recorder'
import { appendOrMerge } from './workspace-paper-store'
import { emitPapersChanged } from './workspace-paper-events'

/** 把指定会话的检索结果回流刷新到所属 workspace 已存在的论文条目 */
export function reflowSessionToWorkspace(sessionId: string): void {
  try {
    const workspaceId = getAgentSessionMeta(sessionId)?.workspaceId
    if (!workspaceId) return
    const ws = getAgentWorkspace(workspaceId)
    if (!ws) return

    const { records } = listSessionPapers(sessionId)
    if (records.length === 0) return

    const touched = appendOrMerge(ws.slug, records, sessionId, { onlyExisting: true })
    if (touched.length > 0) {
      emitPapersChanged(workspaceId, touched.map((e) => e.key), 'append')
    }
  } catch (err) {
    console.warn(`[论文回流] session ${sessionId} → workspace 刷新失败:`, err)
  }
}
