/**
 * zotero_ping: 探测 Zotero 运行状态与远程连接是否启用
 */

import { pingZotero, fetchZotero, ZoteroError } from '../../../src/main/lib/zotero-client/api-client.ts'

export interface PingResult {
  running: boolean
  remoteEnabled: boolean
}

export async function handlePing(): Promise<PingResult> {
  const running = await pingZotero()
  if (!running) {
    return { running: false, remoteEnabled: false }
  }

  // Zotero 在跑。再试一次 /api 判定远程是否启用
  try {
    await fetchZotero('/users/0/items?limit=1')
    return { running: true, remoteEnabled: true }
  } catch (err) {
    if (err instanceof ZoteroError) {
      if (err.type === 'remote_connection_disabled') {
        return { running: true, remoteEnabled: false }
      }
      if (err.type === 'zotero_not_running') {
        // /connector/ping 成功和 /api 调用之间 Zotero 退出了，保守报告未在跑
        return { running: false, remoteEnabled: false }
      }
    }
    // 其他错误（port_conflict / not_found / unexpected 等）归为"已启动但远程未启用"
    return { running: true, remoteEnabled: false }
  }
}

export const pingToolDefinition = {
  name: 'zotero_ping',
  description: '检查 Zotero 桌面版是否在运行，以及是否启用了远程连接。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
} as const
