# 账号中心直连 Hydra Spec（Desktop Public Client + PKCE）

> **状态**：实现中
> **关联 issue**：[ASCI-Server#2](https://github.com/OPENSCI-Labs/ASCI-Server/issues/2)（服务端转纯 Resource Server）
> **领域语言事实源**：`CONTEXT.md`
> **依赖输入**：《OPENSCI 账号中心·项目接入规范（第一期）》；`docs/specs/0.3.0/account-oauth-arch-spec.md`（被本 spec 取代登录链路部分）
> **外部依赖（待账号中心确认）**：①桌面 public client 注册（client_id 暂定 `asci-desktop`）②loopback 端口匹配策略 ③`backchannel_logout_uri` 必填豁免

---

## 1. 背景与角色转变

账号中心由 Keycloak 切换为 **Ory Hydra**（标准 OIDC Provider，测试环境 issuer
`https://opensci-id-test.opensci.io/`）。原中间层 ASCI-Server 的 OIDC broker
（`/auth/start` + `/auth/handoff`）整体下线，转纯 Resource Server（只验签 access token）。

| 职责 | 旧（broker 透传） | 新（直连） |
|------|------------------|-----------|
| PKCE / state / discovery / token 交换 | ASCI-Server | **桌面主进程** |
| refresh | 未实现 | 桌面直连 `{issuer}oauth2/token`（旋转式） |
| 登出 | 仅清本地 | 仅清本地（客户端静默登出，不触发账号中心全局登出） |
| 业务接口鉴权 | — | ASCI-Server JWKS 本地验签 + `client_id` 受众校验 |

## 2. 登录时序（Authorization Code + PKCE，RFC 8252）

1. 主进程生成 `code_verifier` / `code_challenge(S256)` / `state`；
2. 起 127.0.0.1 loopback（**固定端口表** 53682/53683/53684 依次尝试，需与注册的
   `redirect_uris` 一致；若账号中心确认按 RFC 8252 §7.3 忽略 loopback 端口则可回退随机端口）；
3. 系统浏览器打开 `{issuer}oauth2/auth?...&code_challenge=...&state=...`
   （端点经 `{issuer}.well-known/openid-configuration` discovery，进程内缓存）；
4. 回调校验 `state` → `code` + `code_verifier` 直连 `{issuer}oauth2/token` 换
   access（15min）/ refresh（旋转）/ id_token；
5. 解码 id_token **claims v1** 映射 `User`（仅登录时从 token 响应解码，不入库），access / refresh token 经 safeStorage 加密落盘。

claims v1 契约：`sub` / `auth_method` / `claims_ver` 恒在；`name` / `picture` **按 presence 判断**
（全局首登的首个 token 通常缺失）；**勿读 `ext.*`**。v1 无 email / 机构 / 学科 →
`User.email` 置空串、`institution` / `field` 置 null，UI 展示收敛由产品侧后续拍板。

id_token 不在桌面端验签（token 经 TLS 直连 issuer 的 token endpoint 获得，非浏览器面传递；
安全决策由 ASCI-Server 对 access token 验签兜底）——与旧 handoff 路径同口径。

## 3. refresh（旋转式）

- access token 15min TTL → `isTokenExpired`（60s 提前量）判定；
- 过期且有 refresh：`POST {issuer}oauth2/token` `grant_type=refresh_token`，**成功后整组覆盖写**
  （旋转：旧 refresh 立即作废，不可重放）；
- 失败语义分流：**网络错误 → 离线宽限**（保持登录态，下次再试）；**4xx（invalid_grant）=
  被吊销 / 冻结 / 全局登出 → 清 token + 清 User 缓存 + `session-expired`**；
- 触发点：`getCurrentUser()`（启动恢复）按需刷新 + IPC `refresh()` 显式刷新；本期 access token
  尚无业务消费方，不做后台定时器。

## 4. 登出（客户端本地登出）

- 桌面「退出登录」= **客户端静默登出**：仅清本机 token / User 缓存 + 复位内存态 + 广播 `logout`，
  **不**打开浏览器、**不**调 `{issuer}oauth2/sessions/logout`，因此账号中心 Hydra 的 SSO 会话保持存活；
- 语义：登出只作用于 ASCI 客户端，OPENSCI 账号中心仍登录；二次登录时系统浏览器复用 Hydra
  现存会话，授权码流程通常无需用户重新输凭据即可换发新 token；
- 取舍：本机 token 已删（客户端无法再用旧凭据），但账号中心侧 refresh token / SSO 会话仍随其自然
  生命周期存活——登出是「本机忘记凭据」而非「服务端吊销」。如需服务端定向吊销该 client 的会话，
  需账号中心提供 `/oauth2/revoke`（本期不做）；
- back-channel logout 桌面无公网端点，**本期不实现**。

## 5. 配置（auth-config.json，`~/.asci[-dev]/`）

```json
{ "issuer": "https://opensci-id-test.opensci.io/", "clientId": "asci-desktop", "loopbackPorts": [53682, 53683, 53684] }
```

三键均可缺省（默认即上值）。旧 `asciServerUrl` 键废弃忽略。client_id 注册确认后若有变更只改默认常量。

## 6. 实现落点

| 文件 | 改动 |
|------|------|
| `auth-oidc.ts` | PKCE 纯函数、discovery / 标准 token 响应解析（替代 handoff 解析）、claims v1 profile、callback state 校验 |
| `auth-opensci-client.ts` | 直连 Hydra：discovery 缓存、固定端口 loopback、授权 URL、code 交换、`refreshTokens()` |
| `auth-token-store.ts` | `StoredTokens`：accessToken / refreshToken / obtainedAt / expiresAt（id_token 不入库） |
| `auth-service.ts` | getCurrentUser 按需刷新接线、refresh() 走 opensci 路径、logout 仅清本机会话 |
| 不动 | stub / dev-bypass / deeplink（verify/reset）兼容路径、shared `User` 类型、renderer / IPC 面 |

## 7. 分期

- **本期**：上表全部 + 单测（PKCE / 解析 / 映射 / state 校验）。
- **后续**：`/events` 等业务调用带 Bearer（届时考虑后台刷新定时器）、账户 API 画像兜底
  （服务端 out of scope 解除后）、stub 注册链路退役；如产品需「登出即服务端吊销」，再引入
  `/oauth2/revoke` 定向吊销（仅吊销 ASCI client 这一路，不动 SSO 会话）。

---

**Spec 版本**：v1 · 2026-06-12
