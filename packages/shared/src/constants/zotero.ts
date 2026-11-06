/**
 * Zotero 本地连接常量 · 单一真源
 *
 * 端口 23119 与 1500ms ping 超时此前散落在 ipc.ts / zotero-write.ts /
 * zotero-client/api-client.ts 等多处，各写各的容易漂移，统一收口到这里。
 *
 * 注意：23119 是 Zotero 桌面版固定监听端口（connector 协议约定），
 * 不可配置；仅当 Zotero 官方变更协议时才需要改动。
 */

/** Zotero 桌面版本地 HTTP 服务端口（connector 协议固定值） */
export const ZOTERO_CONNECTOR_PORT = 23119

/** 本机 host:port，错误提示文案与日志中引用 */
export const ZOTERO_LOCAL_HOST = `localhost:${ZOTERO_CONNECTOR_PORT}`

/** 本地 API 基址（无需 API Key，仅本机可访问） */
export const ZOTERO_LOCAL_API_BASE = `http://${ZOTERO_LOCAL_HOST}/api`

/** connector 写端基址（saveItems / saveAttachment / ping） */
export const ZOTERO_CONNECTOR_BASE = `http://${ZOTERO_LOCAL_HOST}/connector`

/** 探活 URL */
export const ZOTERO_CONNECTOR_PING_URL = `${ZOTERO_CONNECTOR_BASE}/ping`

/** 探活超时：本机回环，1.5s 足够区分"没在跑"与"在跑" */
export const ZOTERO_PING_TIMEOUT_MS = 1500
