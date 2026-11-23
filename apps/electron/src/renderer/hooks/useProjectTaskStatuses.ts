import * as React from 'react'
import type { TaskStatus } from '../../tauri-formal/project-tasks'

interface ProjectTasks {
  workspaceId?: string
  statuses?: Map<string, TaskStatus>
  unavailable?: boolean
}

/** 在项目打开、任务变化或回到窗口时读取 Rust 的状态。流式文本片段不逐个触发查询。 */
export function useProjectTaskStatuses(workspaceId: string | null | undefined, sessionIds: string[]): ProjectTasks {
  const [snapshot, setSnapshot] = React.useState<ProjectTasks>({})
  const read = window.__TAURI_FORMAL__?.projectTaskStatuses
  // Electron 无此能力；项目内搜索也无需重新订阅相同的会话。
  const sessionKey = read && workspaceId ? JSON.stringify(sessionIds) : '[]'
  React.useEffect(() => {
    if (!workspaceId || !read) return
    const members = new Set<string>(JSON.parse(sessionKey))
    if (!members.size) return
    const observed = new Map<string, string>()
    let mounted = true
    let busy = false
    let dirty = false
    const refresh = async () => {
      dirty = true
      if (busy) return
      busy = true
      try {
        while (dirty && mounted) {
          dirty = false
          try {
            const rows = await read(workspaceId)
            if (!mounted || dirty) continue
            setSnapshot({ workspaceId, statuses: new Map(rows.map(row => [row.sessionId, row.status])) })
          } catch {
            if (mounted && !dirty) setSnapshot({ workspaceId, unavailable: true })
          }
        }
      } finally {
        busy = false
      }
    }
    const event = window.electronAPI.onAgentStreamEvent(({ sessionId, requestId }) => {
      if (requestId && members.has(sessionId) && observed.get(sessionId) !== requestId) {
        observed.set(sessionId, requestId)
        void refresh()
      }
    })
    const complete = window.electronAPI.onAgentStreamComplete(({ sessionId }) => {
      if (members.has(sessionId)) void refresh()
    })
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    void refresh()
    return () => {
      mounted = false
      event()
      complete()
      window.removeEventListener('focus', onFocus)
    }
  }, [workspaceId, read, sessionKey])
  return read && workspaceId === snapshot.workspaceId && sessionIds.length ? snapshot : {}
}
