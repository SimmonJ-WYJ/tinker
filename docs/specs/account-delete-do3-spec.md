# 账户删除（DO-3）Spec：清服务端身份 + 行为遥测，本地研究库保留

> **状态**：设计 + 实现中（分支 `claude/hopeful-chebyshev-87cfb0`）
> **关联 issue**：[#428](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/428)（DO-3）· blocked-by [#420](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/420)（OPENSCI 登录端到端）
> **关联 PR**：待开
> **领域语言事实源**：[`CONTEXT.md`](../../CONTEXT.md) §数据所有权（Data Ownership）
> **PRD 来源**：[`docs/specs/0.3.0/0.3.0-prd.md`](./0.3.0/0.3.0-prd.md) Epic 4 切片 4.3（DO-3）
> **姊妹 spec**：[`data-export-do2-spec.md`](./data-export-do2-spec.md)（DO-2，同 Epic 数据所有权）

---

## 1. 目标与验收

用户在 Settings **账户 tab** 一键删除账户（GDPR Art.17 被遗忘权）：清空 ASCI 服务端的
**身份映射 + 行为遥测数据**；本地研究库（设备级 SQLite）**保留不删**。删除前有明确**二次确认**
与**影响说明**。

| # | 验收（来自 issue / PRD） |
|---|------|
| DO-3 | 触发删除 → 服务端用户记录 + 行为数据清空 → 本地研究库保留可见 |
| 二次确认 | 删除前有明确二次确认 + 影响说明（不误操作） |

## 2. 关键决策

| # | 决策点 | 裁决 | 理由 |
|---|--------|------|------|
| D1 | 服务端删除端点 | **ASCI-Server `DELETE /me`**（ASCI-Server#2 接口表）：`Authorization: Bearer {access_token}`，删本地身份映射 + 演化遥测事件，**幂等 204**；dev/stub 模式走本地 stub 模拟成功 | 接口已在 ASCI-Server#2 冻结；base URL = ASCI-Server（RS），**与 Hydra issuer 不同源**（issuer 仅 OAuth），经 `auth-config.json` 的 `asciServerBaseUrl` 配置，默认 dev `localhost:6060` |
| D2 | 行为遥测删除归属 | `DELETE /me` 清 **ASCI-Server 侧**身份映射 + 演化遥测事件（`/events` 通道）；桌面端额外 `telemetryService.clearUser()` 停止 PostHog uid 归属 | PostHog 行为分析与 ASCI-Server 演化遥测物理隔离（ADR-011）；`DELETE /me` 覆盖项目自管的 RS 数据，PostHog 历史数据删除是独立 ops（桌面端无 admin key，仅停归属） |
| D3 | UI 入口位置 | **账户 tab（`ProfileSettings.tsx`）**，登出按钮下方 | 按 PRD §200 原意；与登录态身份信息同页 |
| D4 | 二次确认形态 | **对话框 + 影响说明 bullet + 显式勾选 acknowledge 才放开删除按钮** | GDPR 不可逆操作，单点确认不足；勾选 = 明确二次确认 |
| D5 | 本地数据处置 | **完全不动** `~/.asci[-dev]/asci.db`、reviews 正文、owner-marker.json | 「本地研究库设备级保留」是 DO-3 核心承诺；owner-marker 指向已删 uid 无害（设备级归属元数据） |
| D6 | 删除成功后客户端态 | 清 token + 清 User 缓存 + 解除 dev-bypass + 发新事件 `account-deleted` → renderer 退回登录门 | 账户已不存在，必须登出；与 `logout` 区分以便 UI 给不同 toast |
| D7 | 删除后是否开浏览器全局登出 | **不开**。仅清本地 | 账户已被服务端删除，Hydra 会话由服务端一并失效；再开浏览器登出页会 404/困惑 |
| D8 | 删除失败行为 | **保留本地登录态**，返回错误，UI toast 报错让用户重试 | 服务端未删成功就清本地 = 用户失去入口却数据仍在服务端，违反「确认即删除」 |

## 3. 代码事实（设计依据）

- 鉴权 = 桌面 public client 直连 Hydra OIDC（`auth-opensci-client.ts`）；桌面持 token + 缓存 `User`
- 登出（`auth-service.ts:116`）：RP-initiated logout URL + `tokenStore.clear()` + `clearCachedUser()` + 发 `logout` 事件
- 遥测（`telemetry-service.ts`）：`distinct_id` 登录态 = OPENSCI uid，登出/失效回落匿名 deviceId；`identifyUser()` / `clearUser()` 由 `index.ts:417` 的 `onAuthStateChanged` 驱动
- dev-bypass（`auth-dev-bypass.ts`）：走 stub 路径（`getCachedUser()` 返回 null）
- IPC 四联约定：`auth-ipc.ts` 常量 → `ipc.ts` 的 `registerAuthIpc` → `preload/index.ts` → renderer
- auth ns i18n：`locales/{en,zh}/auth/profile.json`，经 `locales/en/auth.ts` 聚合，`key-parity.test.ts` 守门

## 4. 设计

### 4.1 服务端删除契约（ASCI-Server#2 接口表）

`OpensciAuthClient` 新增：

```ts
/** 删除账户：调 ASCI-Server DELETE /me 清身份映射 + 演化遥测事件，幂等 204。
 *  401/403 → token-expired（需重新登录）；其他 4xx/5xx → oauth-provider-error；网络 → network-error。 */
deleteAccount(accessToken: string): Promise<Result<void>>
```

- 端点：`DELETE {asciServerBaseUrl}me`，`Authorization: Bearer {accessToken}`，成功 204
- `asciServerBaseUrl` = ASCI-Server（RS）base，**与 Hydra issuer 不同源**；默认 dev `http://localhost:6060`，经 `auth-config.json` 的 `asciServerBaseUrl` 覆盖（测试/生产域名；生产 URL 待平台报备加白）
- 注：ASCI-Server 转纯 Resource Server 后，`/me`、`DELETE /me`、`/events` 在 RS；登录/刷新/登出已移至桌面端直连 Hydra

### 4.2 AuthService.deleteAccount()

```
deleteAccount():
  if !currentUid → errUnauth
  if opensciClient.getCachedUser():            # OIDC 真实路径
    accessToken = tokenStore.getAccessToken(); if !accessToken → errUnauth
    r = opensciClient.deleteAccount(accessToken); if !r.ok → return r   # 失败不清本地（D8）
  elif stub:                                   # stub / dev-bypass 路径
    r = stub.deleteAccount(currentUid); if !r.ok → return r
  else → errUnsupported
  # 成功：清本地会话（不动本地研究库），发 account-deleted
  tokenStore.clear(); opensciClient.clearCachedUser()
  if shouldBypass(): disableBypassForRuntime()
  currentUid = null; loginAt = null
  sendStateChanged({ type: 'account-deleted' })
  return ok
```

### 4.3 AuthStub.deleteAccount(uid)

删 `users.json` / `credentials.json` / `oauth-links.json` 中该 uid 的记录 + revoke 其全部 session
（复用 `revokeAllSessions` 语义）。dev fixture 删后下次 `getCurrentUser` 不再自动登录（已 `disableBypassForRuntime`）。

### 4.4 新事件 `account-deleted`

- `AuthStateChangedEvent` union 加 `| { type: 'account-deleted' }`
- `GlobalListeners.tsx`：与 `logout` 同样清 atom 回登录页，但 toast 用 `account-deleted` 成功文案
- `index.ts` 的 `onAuthStateChanged`：`account-deleted` 并入 `logout`/`session-expired` 分支 → `telemetryService.clearUser()`（停止 uid 归属；服务端负责真正删 PostHog 数据）

### 4.5 IPC 四联

| 层 | 位置 | 内容 |
|----|------|------|
| 常量+类型 | `packages/shared/src/types/auth-ipc.ts` + `auth.ts` | `AUTH_CHANNELS.DELETE_ACCOUNT='auth:delete-account'`；`AuthStateChangedEvent` 加 `account-deleted` |
| main | `apps/electron/src/main/ipc.ts`（`registerAuthIpc`） | `ipcMain.handle(DELETE_ACCOUNT, () => svc.deleteAccount())` |
| preload | `apps/electron/src/preload/index.ts` | `deleteAccount: () => Promise<Result<void>>` |
| renderer | `ProfileSettings.tsx` + 新 `DeleteAccountDialog.tsx` | 按钮 + 二次确认对话框 |

### 4.6 UI 与 i18n

- `ProfileSettings.tsx`：登出按钮下方加「删除账户」按钮（destructive 文字样式），点开 `DeleteAccountDialog`
- 新组件 `components/auth/DeleteAccountDialog.tsx`：
  - 影响说明 bullet：服务端身份+遥测清空（不可恢复）/ 本地研究库保留在本设备 / 删除后退出登录
  - 勾选框 acknowledge → 放开 destructive「删除账户」按钮
  - 成功：atom 由 `GlobalListeners` 的 `account-deleted` 驱动；失败：toast 报错
- i18n：`auth` ns `profile.deleteAccount` + `profile.deleteConfirm.*`，en + zh 同步（key-parity 守门）

### 4.7 测试

| 测试 | 验证 |
|------|------|
| `auth-service` 单测 | stub 路径删除成功 → 清 token/缓存 + 发 `account-deleted`；删除失败 → 保留本地态、不发事件 |
| `auth-stub` 单测 | `deleteAccount(uid)` 后 `getUserByUid` 为 null、session 全 revoke |
| key-parity | en/zh `profile.deleteConfirm.*` 对齐 |

## 5. 实现计划

1. **shared**：`DELETE_ACCOUNT` 通道 + `account-deleted` 事件类型
2. **main**：`OpensciAuthClient.deleteAccount` 契约 + `AuthStub.deleteAccount` + `AuthService.deleteAccount` + IPC 注册 + `index.ts` 遥测分支 + preload 桥接
3. **renderer**：`DeleteAccountDialog` + `ProfileSettings` 入口 + i18n en/zh
4. **测试**：auth-service / auth-stub 单测
5. **收尾**：`typecheck` / `bun test` / `simplify` 复盘；版本递增 `packages/shared`、`apps/electron`

## 6. Out of Scope

- 真实 OPENSCI 删除端点的服务端实现（本 spec 只定契约 + dev stub）
- 本地研究库删除 / 二次「连本地一起删」选项（DO-3 明确保留本地）
- 删除后导出引导（用户可先走 DO-2 再删，不做强绑定）
- 账户冻结 / 软删 / 撤销删除宽限期（V1 不做）

## 7. 残留开放问题

- `asciServerBaseUrl` 测试/生产域名待定（默认 dev `localhost:6060`；生产 URL 待平台报备加白名单后填入 `auth-config.json` 或构建期注入）
- PostHog 行为分析历史数据的 GDPR 删除是独立 ops（与 ASCI-Server `DELETE /me` 无关，桌面端仅 `clearUser()` 停归属）；是否需要服务端侧再补一条 PostHog 删除链路由产品/ops 决定
