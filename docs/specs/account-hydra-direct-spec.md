<a id="账号中心直连-hydra-specdesktop-public-client-&#45;pkce"></a>

# Account Center Direct Hydra Connection Spec (Desktop Public Client + PKCE)

> **Status**: implementation in progress
> **Related issue**: [ASCI-Server#2](https://github.com/OPENSCI-Labs/ASCI-Server/issues/2) (server becomes a pure Resource Server)
> **Domain language source of truth**: `CONTEXT.md`
> **Input dependency**: “OPENSCI Account Center: Project Integration Specification (Phase One)”; `docs/specs/0.3.0/account-oauth-arch-spec.md` (this spec supersedes its sign-in flow)
> **External dependencies (awaiting Account Center confirmation)**: ① desktop public client registration (tentative client_id `asci-desktop`) ② loopback port matching policy ③ exemption from mandatory `backchannel_logout_uri`

---

<a id="1-背景与角色转变"></a>

## 1. Background and Role Change

Account Center switches from Keycloak to **Ory Hydra** (standard OIDC Provider; test issuer
`https://opensci-id-test.opensci.io/`). The original ASCI-Server intermediary OIDC broker
(`/auth/start` + `/auth/handoff`) is retired entirely, becoming a pure Resource Server (only verifies access token signatures).

| Responsibility | Old (broker passthrough) | New (direct) |
|------|------------------|-----------|
| PKCE / state / discovery / token exchange | ASCI-Server | **Desktop main process** |
| refresh | Not implemented | Desktop connects directly to `{issuer}oauth2/token` (rotating) |
| Logout | Clear local state only | Clear local state only (silent client logout, without Account Center global logout) |
| Business API authentication | — | ASCI-Server local JWKS signature verification + `client_id` audience validation |

<a id="2-登录时序authorization-code-&#45;pkcerfc-8252"></a>

## 2. Sign-In Sequence (Authorization Code + PKCE, RFC 8252)

1. Main process generates `code_verifier` / `code_challenge(S256)` / `state`;
2. Start a 127.0.0.1 loopback listener (**fixed port list** 53682/53683/53684, tried in order, matching registered
   `redirect_uris`; if Account Center confirms it ignores loopback ports under RFC 8252 §7.3, random ports may be a fallback);
3. System browser opens `{issuer}oauth2/auth?...&code_challenge=...&state=...`
   (endpoint discovered through `{issuer}.well-known/openid-configuration`, cached in process);
4. Validate callback `state` → send `code` + `code_verifier` directly to `{issuer}oauth2/token` to exchange for
   access (15min) / refresh (rotating) / id_token;
5. Decode id_token **claims v1** into `User` (decoded only from the token response at sign-in, never persisted); access / refresh tokens are encrypted by safeStorage on disk.

claims v1 contract: `sub` / `auth_method` / `claims_ver` always exist; determine `name` / `picture` **by presence**
(usually absent in the first token on first global sign-in); **do not read `ext.*`**. v1 has no email / institution / field →
set `User.email` to an empty string and `institution` / `field` to null; Product will decide later how UI display converges.

The desktop does not verify id_token signatures (tokens come directly from the issuer's token endpoint over TLS, not via the browser;
ASCI-Server access-token signature verification backs the security decision), consistent with the old handoff path.

<a id="3-refresh旋转式"></a>

## 3. Refresh (Rotating)

- Access token 15min TTL → checked by `isTokenExpired` (60s early margin);
- If expired with refresh available: `POST {issuer}oauth2/token` `grant_type=refresh_token`, **overwrite the entire token set on success**
  (rotation: old refresh is invalidated immediately and cannot be replayed);
- Distinguish failures: **network error → offline grace** (retain login state, retry next time); **4xx (invalid_grant) =
  revoked / frozen / globally logged out → clear tokens + User cache + `session-expired`**;
- Triggers: on-demand refresh in `getCurrentUser()` (startup recovery) + explicit IPC `refresh()`; access tokens have
  no business consumers this phase, so no background timer.

<a id="4-登出客户端本地登出"></a>

## 4. Logout (Local Client Logout)

- Desktop “Sign out” = **silent client logout**: clear only local tokens / User cache + reset in-memory state + broadcast `logout`;
  **do not** open the browser or call `{issuer}oauth2/sessions/logout`, so the Account Center Hydra SSO session remains alive;
- Meaning: logout affects only the ASCI client; OPENSCI Account Center remains signed in. On subsequent sign-in, the system browser reuses Hydra's
  existing session, and the authorization-code flow usually issues new tokens without requiring credentials again;
- Tradeoff: local tokens are deleted (the client cannot reuse old credentials), but Account Center refresh tokens / SSO sessions retain their natural
  lifecycle. Logout means “forget credentials locally,” not “revoke on the server.” Targeted server revocation for this client's session
  requires Account Center `/oauth2/revoke` support (outside this phase);
- The desktop has no public endpoint for back-channel logout; **not implemented this phase**.

<a id="5-配置auth-configjsonasci-dev"></a>

## 5. Configuration (auth-config.json, `~/.asci[-dev]/`)

```json
{ "issuer": "https://opensci-id-test.opensci.io/", "clientId": "asci-desktop", "loopbackPorts": [53682, 53683, 53684] }
```

All three keys are optional (defaults shown above). The old `asciServerUrl` key is deprecated and ignored. If client_id changes after registration confirmation, change only the default constant.

<a id="6-实现落点"></a>

## 6. Implementation Locations

| File | Change |
|------|------|
| `auth-oidc.ts` | PKCE pure functions, discovery / standard token response parsing (replacing handoff parsing), claims v1 profile, callback state validation |
| `auth-opensci-client.ts` | Direct Hydra connection: discovery cache, fixed-port loopback, authorization URL, code exchange, `refreshTokens()` |
| `auth-token-store.ts` | `StoredTokens`: accessToken / refreshToken / obtainedAt / expiresAt (id_token not persisted) |
| `auth-service.ts` | Wire on-demand refresh into getCurrentUser, route refresh() through opensci, logout clears only local sessions |
| Unchanged | stub / dev-bypass / deeplink (verify/reset) compatibility paths, shared `User` type, renderer / IPC surface |

<a id="7-分期"></a>

## 7. Phases

- **This phase**: everything in the table + unit tests (PKCE / parsing / mapping / state validation).
- **Later**: Bearer for business calls such as `/events` (consider a background refresh timer then), account API profile fallback
  (once server-side out-of-scope restrictions lift), retirement of stub registration; if Product requires “logout revokes on the server,” introduce
  `/oauth2/revoke` for targeted revocation (only the ASCI client, leaving SSO sessions alone).

---

**Spec version**: v1 · 2026-06-12
