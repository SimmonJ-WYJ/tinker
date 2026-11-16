<a id="账户删除do-3spec清服务端身份-&#45;行为遥测本地研究库保留"></a>

# Account Deletion (DO-3) Spec: Remove Server Identity + Behavioral Telemetry, Retain the Local Research Library

> **Status**: Design + implementation in progress (branch `claude/hopeful-chebyshev-87cfb0`)
> **Related issue**: [#428](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/428) (DO-3) · blocked-by [#420](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/420) (OPENSCI end-to-end sign-in)
> **Related PR**: Not yet opened
> **Domain language source of truth**: [`CONTEXT.md`](../../CONTEXT.md) §Data Ownership
> **PRD source**: [`docs/specs/0.3.0/0.3.0-prd.md`](./0.3.0/0.3.0-prd.md) Epic 4 slice 4.3 (DO-3)
> **Sibling spec**: [`data-export-do2-spec.md`](./data-export-do2-spec.md) (DO-2, same data-ownership Epic)

---

<a id="1-目标与验收"></a>

## 1. Goal and Acceptance

Users delete their account from the Settings **Account tab** (GDPR Art.17 right to erasure), clearing
**identity mapping + behavioral telemetry** from ASCI servers while **retaining** the device-level SQLite local research library. Require explicit **secondary confirmation**
and an **impact explanation** before deletion.

| # | Acceptance (from issue / PRD) |
|---|------|
| DO-3 | Trigger deletion → server user record + behavioral data cleared → local research library remains visible |
| Secondary confirmation | Clear second confirmation + impact explanation before deletion (prevent accidental actions) |

<a id="2-关键决策"></a>

## 2. Key Decisions

| # | Decision Point | Decision | Reason |
|---|--------|------|------|
| D1 | Server deletion endpoint | **ASCI-Server `DELETE /me`** (ASCI-Server#2 interface table): `Authorization: Bearer {access_token}`, removes local identity mapping + evolution telemetry events, **idempotent 204**; dev/stub uses local simulated success | Interface frozen in ASCI-Server#2; base URL = ASCI-Server (RS), **different origin from Hydra issuer** (OAuth only); configured through `asciServerBaseUrl` in `auth-config.json`, default dev `localhost:6060` |
| D2 | Behavioral telemetry deletion ownership | `DELETE /me` removes **ASCI-Server-side** identity mapping + evolution telemetry (`/events` channel); desktop additionally calls `telemetryService.clearUser()` to stop PostHog uid attribution | PostHog analytics and ASCI-Server evolution telemetry are physically separate (ADR-011); `DELETE /me` covers self-managed RS data; historical PostHog deletion is separate ops (desktop lacks admin key; stops attribution only) |
| D3 | UI entry | **Account tab (`ProfileSettings.tsx`)**, below sign-out | Follows PRD §200 intent; same page as signed-in identity |
| D4 | Secondary confirmation | **Dialog + impact bullets + explicit acknowledge checkbox before enabling deletion** | Irreversible GDPR action needs more than one click; checkbox is explicit second confirmation |
| D5 | Local data | **Leave unchanged** `~/.asci[-dev]/asci.db`, reviews bodies, owner-marker.json | Device-level retention is DO-3's core promise; owner-marker pointing to deleted uid is harmless device-ownership metadata |
| D6 | Client state after success | Clear tokens + cached User + dev-bypass; emit new `account-deleted` event → renderer returns to sign-in gate | Account no longer exists; sign out; distinguish from `logout` for a different toast |
| D7 | Browser global logout after deletion | **No**, clear locally only | Server deletes account and invalidates Hydra session; opening logout page again yields 404/confusion |
| D8 | Deletion failure | **Preserve local sign-in**, return error, show retry toast | Clearing local state before successful deletion removes access while server data remains, violating confirmed deletion |

<a id="3-代码事实设计依据"></a>

## 3. Code Facts (Design Basis)

- Authentication = desktop public client connects directly to Hydra OIDC (`auth-opensci-client.ts`); desktop holds tokens + cached `User`.
- Sign-out (`auth-service.ts:116`): RP-initiated logout URL + `tokenStore.clear()` + `clearCachedUser()` + `logout` event.
- Telemetry (`telemetry-service.ts`): Signed-in `distinct_id` = OPENSCI uid; sign-out/expiry falls back to anonymous deviceId; `identifyUser()` / `clearUser()` driven by `onAuthStateChanged` in `index.ts:417`.
- dev-bypass (`auth-dev-bypass.ts`): Stub path (`getCachedUser()` returns null).
- Four-way IPC: `auth-ipc.ts` constants → `registerAuthIpc` in `ipc.ts` → `preload/index.ts` → renderer.
- auth namespace i18n: `locales/{en,zh}/auth/profile.json`, aggregated through `locales/en/auth.ts`, guarded by `key-parity.test.ts`.

<a id="4-设计"></a>

## 4. Design

<a id="41-服务端删除契约asci-server2-接口表"></a>

### 4.1 Server Deletion Contract (ASCI-Server#2 Interface Table)

Add to `OpensciAuthClient`. The retained comment specifies idempotent deletion of identity/evolution telemetry; 401/403 → token-expired (sign in again), other 4xx/5xx → oauth-provider-error, network → network-error.

```ts
/** 删除账户：调 ASCI-Server DELETE /me 清身份映射 + 演化遥测事件，幂等 204。
 *  401/403 → token-expired（需重新登录）；其他 4xx/5xx → oauth-provider-error；网络 → network-error。 */
deleteAccount(accessToken: string): Promise<Result<void>>
```

- Endpoint: `DELETE {asciServerBaseUrl}me`, `Authorization: Bearer {accessToken}`, success 204.
- `asciServerBaseUrl` = ASCI-Server (RS) base, **different origin from Hydra issuer**; default dev `http://localhost:6060`, overridable in `auth-config.json` via `asciServerBaseUrl` (test/production domains; production URL pending platform allowlisting).
- Note: After ASCI-Server became a pure Resource Server, `/me`, `DELETE /me`, `/events` reside on RS; sign-in/refresh/sign-out moved to direct desktop→Hydra connections.

### 4.2 AuthService.deleteAccount()

The original pseudocode below preserves real OIDC and stub paths, leaves local state on failure, clears tokens/cache/dev-bypass on success, retains the local research library, and emits account-deleted.

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

Remove the uid's records from `users.json` / `credentials.json` / `oauth-links.json` and revoke all sessions
(reuse `revokeAllSessions` semantics). After deleting a dev fixture, the next `getCurrentUser` no longer signs in automatically (`disableBypassForRuntime` already applied).

<a id="44-新事件-account-deleted"></a>

### 4.4 New `account-deleted` Event

- Add `| { type: 'account-deleted' }` to the `AuthStateChangedEvent` union.
- `GlobalListeners.tsx`: Clear atoms and return to sign-in like `logout`, but show the `account-deleted` success toast.
- `onAuthStateChanged` in `index.ts`: Add `account-deleted` to `logout`/`session-expired` branch → `telemetryService.clearUser()` (stop uid attribution; server handles actual PostHog deletion).

<a id="45-ipc-四联"></a>

### 4.5 Four-Way IPC

| Layer | Location | Content |
|----|------|------|
| Constants + types | `packages/shared/src/types/auth-ipc.ts` + `auth.ts` | `AUTH_CHANNELS.DELETE_ACCOUNT='auth:delete-account'`; add `account-deleted` to `AuthStateChangedEvent` |
| main | `apps/electron/src/main/ipc.ts` (`registerAuthIpc`) | `ipcMain.handle(DELETE_ACCOUNT, () => svc.deleteAccount())` |
| preload | `apps/electron/src/preload/index.ts` | `deleteAccount: () => Promise<Result<void>>` |
| renderer | `ProfileSettings.tsx` + new `DeleteAccountDialog.tsx` | Button + secondary-confirmation dialog |

<a id="46-ui-与-i18n"></a>

### 4.6 UI and i18n

- `ProfileSettings.tsx`: Add Delete Account button (destructive text style) below sign-out, opening `DeleteAccountDialog`.
- New `components/auth/DeleteAccountDialog.tsx`:
  - Impact bullets: server identity+telemetry cleared irreversibly / local research library stays on this device / deletion signs out.
  - Acknowledge checkbox → enables destructive Delete Account button.
  - Success: atoms driven by `account-deleted` through `GlobalListeners`; failure: error toast.
- i18n: `auth` namespace `profile.deleteAccount` + `profile.deleteConfirm.*`, synchronized en + zh (key-parity guard).

<a id="47-测试"></a>

### 4.7 Tests

| Test | Verification |
|------|------|
| `auth-service` unit tests | Successful stub deletion → clear tokens/cache + emit `account-deleted`; failure → preserve local state, no event |
| `auth-stub` unit tests | After `deleteAccount(uid)`, `getUserByUid` is null and all sessions revoked |
| key-parity | en/zh `profile.deleteConfirm.*` aligned |

<a id="5-实现计划"></a>

## 5. Implementation Plan

1. **shared**: `DELETE_ACCOUNT` channel + `account-deleted` event type.
2. **main**: `OpensciAuthClient.deleteAccount` contract + `AuthStub.deleteAccount` + `AuthService.deleteAccount` + IPC registration + telemetry branch in `index.ts` + preload bridge.
3. **renderer**: `DeleteAccountDialog` + `ProfileSettings` entry + en/zh i18n.
4. **Tests**: auth-service / auth-stub unit tests.
5. **Finish**: `typecheck` / `bun test` / `simplify` review; increment `packages/shared`, `apps/electron` versions.

## 6. Out of Scope

- Actual server implementation of OPENSCI deletion (this spec defines contract + dev stub only).
- Local research-library deletion / secondary delete-local-too option (DO-3 explicitly preserves local data).
- Export guidance after deletion (users may run DO-2 first; no mandatory coupling).
- Account freezing / soft deletion / grace period for reversal (not in V1).

<a id="7-残留开放问题"></a>

## 7. Remaining Open Questions

- Test/production `asciServerBaseUrl` domains TBD (default dev `localhost:6060`; production URL added to `auth-config.json` or build-time injection after platform allowlisting).
- GDPR deletion of historical PostHog behavioral analytics is separate ops (unrelated to ASCI-Server `DELETE /me`; desktop only stops attribution via `clearUser()`); product/ops decide whether a server-side PostHog deletion path is needed.
