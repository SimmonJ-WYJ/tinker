/**
 * Zotero 本地 HTTP API 客户端
 *
 * 基址 http://localhost:23119/api。无需 API Key（仅本机可访问）。
 */

import {
  ZOTERO_CONNECTOR_BASE,
  ZOTERO_CONNECTOR_PING_URL,
  ZOTERO_LOCAL_API_BASE,
  ZOTERO_LOCAL_HOST,
  ZOTERO_PING_TIMEOUT_MS,
} from '@asci/shared'
import { ZoteroError } from './errors.ts'

export { ZoteroError }

export async function fetchZotero<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = `${ZOTERO_LOCAL_API_BASE}${path.startsWith('/') ? path : `/${path}`}`

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'Zotero-API-Version': '3',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    // 典型 fetch 失败 (ECONNREFUSED / network): Zotero 没在跑
    throw new ZoteroError('zotero_not_running', `请启动 Zotero 桌面版（连接 ${ZOTERO_LOCAL_HOST} 失败）`)
  }

  if (response.status === 403) {
    throw new ZoteroError('remote_connection_disabled', '请在 Zotero 设置 → 高级中勾选 "Allow other applications on this computer to communicate with Zotero"')
  }

  if (response.status === 404) {
    throw new ZoteroError('not_found', `端点不存在: ${path}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ZoteroError('unexpected', `Zotero API 错误 ${response.status}: ${text.slice(0, 200)}`)
  }

  // Web API 写请求（PATCH /items 等）成功返回 204 No Content，没有 body 也没有
  // content-type；不应触发"非 JSON = 端口被占用"判定。
  if (response.status === 204) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    // localhost:23119 可能被别的服务占用（如 nginx 默认页）
    throw new ZoteroError('port_conflict', `${ZOTERO_LOCAL_HOST} 回包不是 JSON，可能被其他服务占用`)
  }

  return await response.json() as T
}

/**
 * Zotero connector API fetch wrapper（write 端使用，带 X-Zotero-Connector-API-Version 头绕过 browser 检测）
 */
export async function fetchZoteroConnector<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const url = `${ZOTERO_CONNECTOR_BASE}${path.startsWith('/') ? path : `/${path}`}`

  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        'X-Zotero-Connector-API-Version': '3',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (err) {
    throw new ZoteroError('zotero_not_running', `请启动 Zotero 桌面版（连接 ${ZOTERO_LOCAL_HOST} 失败）`)
  }

  if (response.status === 403) {
    throw new ZoteroError('remote_connection_disabled', '请在 Zotero 设置 → 高级中勾选 "Allow other applications on this computer to communicate with Zotero"')
  }

  if (response.status === 404) {
    throw new ZoteroError('not_found', `connector 端点不存在: ${path}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new ZoteroError('unexpected', `Zotero connector 错误 ${response.status}: ${text.slice(0, 200)}`)
  }

  // connector/import 成功返回 JSON 数组；空响应（如 updateSession）返回空字符串
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ZoteroError('unexpected', `Zotero connector 返回非 JSON：${text.slice(0, 200)}`)
  }
}

/** ping Zotero 是否可达，不抛错，返回 boolean */
export async function pingZotero(): Promise<boolean> {
  try {
    const response = await fetch(ZOTERO_CONNECTOR_PING_URL, { signal: AbortSignal.timeout(ZOTERO_PING_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}
