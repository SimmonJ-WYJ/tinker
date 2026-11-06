// packages/shared/src/types/auth-ipc.ts
/**
 * 账户体系 IPC 通道（spec §五）。每条通道在 main/ipc.ts + preload + renderer 四联同步。
 * 命名约定：模块名:动词-kebab-case
 */

export const AUTH_CHANNELS = {
  LOGIN:                    'auth:login',
  REGISTER:                 'auth:register',
  LOGOUT:                   'auth:logout',
  GET_CURRENT_USER:         'auth:get-current-user',
  REFRESH:                  'auth:refresh',
  REQUEST_EMAIL_VERIFY:     'auth:request-email-verify',
  CONFIRM_EMAIL_VERIFY:     'auth:confirm-email-verify',
  REQUEST_PASSWORD_RESET:   'auth:request-password-reset',
  CONFIRM_PASSWORD_RESET:   'auth:confirm-password-reset',
  UPDATE_PROFILE:           'auth:update-profile',
  DELETE_ACCOUNT:           'auth:delete-account',
  /** dev-only 连通自检：只读 GET /me 探针，验证 ASCI-Server base URL + token 受众，零副作用 */
  VERIFY_CONNECTION:        'auth:verify-connection',
  /** dev-only：取当前 access token 原文（供手动调试接口/复制）；主进程 app.isPackaged 门控，生产恒拒 */
  GET_ACCESS_TOKEN_DEV:     'auth:get-access-token-dev',
  GET_SESSION_META:         'auth:get-session-meta',
  MARK_RENDERER_READY:      'auth:mark-renderer-ready',
  SCAN_LOCAL_DATA:          'auth:scan-local-data',
  // events (main → renderer)
  STATE_CHANGED:            'auth:state-changed',
  DEEPLINK_ROUTE:           'auth:deeplink-route',
} as const

export const OAUTH_CHANNELS = {
  START:  'oauth:start',
  CANCEL: 'oauth:cancel',
} as const

export type AuthChannel = (typeof AUTH_CHANNELS)[keyof typeof AUTH_CHANNELS]
export type OAuthChannel = (typeof OAUTH_CHANNELS)[keyof typeof OAUTH_CHANNELS]

/**
 * dev-only ASCI-Server 连通自检结果（只读 GET /me 探针）。
 * - `reached`/`httpStatus`：收到任意 HTTP 响应即 base URL 可达（DNS/TLS/路由/代理通）
 * - `authorized`：HTTP 2xx，即 RS 接受了当前 access token（JWKS + 受众校验通过）
 * 网络层失败不返回本结构，走 Result 的 network-error。
 */
export interface AuthServerConnectionCheck {
  /** 实际探测的 ASCI-Server base URL（含末尾 /），便于核对配置是否生效 */
  serverBaseUrl: string
  /** GET /me 的 HTTP 状态码（401/403 = 可达但 token 被拒，正是要提前抓的受众问题） */
  httpStatus: number
  /** httpStatus 为 2xx */
  authorized: boolean
}
