/**
 * 项目文件面板纯工具函数
 */

/**
 * 把总数 + capped 格式化成标题条展示的计数字串。
 * - `null` 表示尚未加载 → "(—)"
 * - capped=true 表示扫到了 MAX_SCAN_FILES 上限 → "(N+)"
 * - 其他 → "(N)"
 */
export function formatProjectFilesCount(totalCount: number | null, capped: boolean): string {
  if (totalCount === null) return '(—)'
  if (capped) return `(${totalCount}+)`
  return `(${totalCount})`
}

/**
 * 版本号竞态守护：
 *
 * 每次发起 IPC 请求前 `issue(workspaceId)` 得到 ticket；
 * 响应回来时 `check(ticket, currentWorkspaceId)` 判断是否应接受结果。
 * 若中途 workspace 切换或同 workspace 再次 issue，旧 ticket 失效。
 */
export interface VersionGuardTicket {
  readonly id: number
  readonly workspaceId: string
}

export interface VersionGuard {
  issue(workspaceId: string): VersionGuardTicket
  check(ticket: VersionGuardTicket, currentWorkspaceId: string | null): boolean
}

export function createVersionGuard(): VersionGuard {
  let nextId = 0
  const latestByWorkspace = new Map<string, number>()

  return {
    issue(workspaceId: string): VersionGuardTicket {
      const id = ++nextId
      latestByWorkspace.set(workspaceId, id)
      return { id, workspaceId }
    },
    check(ticket, currentWorkspaceId): boolean {
      if (ticket.workspaceId !== currentWorkspaceId) return false
      return latestByWorkspace.get(ticket.workspaceId) === ticket.id
    },
  }
}
