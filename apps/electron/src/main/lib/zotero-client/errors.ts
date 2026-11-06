/**
 * Zotero MCP 结构化错误
 *
 * 所有工具统一抛 ZoteroError，main 函数转成 MCP 错误响应。
 */

export type ZoteroErrorType =
  | 'zotero_not_running'
  | 'remote_connection_disabled'
  | 'port_conflict'
  | 'not_found'
  | 'unexpected'

export class ZoteroError extends Error {
  readonly type: ZoteroErrorType

  constructor(type: ZoteroErrorType, message: string) {
    super(message)
    this.type = type
    this.name = 'ZoteroError'
  }
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
