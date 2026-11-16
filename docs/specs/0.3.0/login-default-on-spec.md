<a id="登录默认开启-speclogin-default-on"></a>

# Login enabled by default Spec (Login Default-On)

> **Status**: Implemented · Review pending
> **Related milestone**: 0.3.0
> **Domain-language source of truth**: `apps/electron/src/main/lib/auth-dev-bypass.ts`, `config-paths.ts#isLoginEnabled`, `renderer/lib/dev-mode.tsx#LOGIN_ENABLED`
> **Dependency input**: Existing login flow (`account-oauth-arch-spec.md`)

---

<a id="1-背景与目标"></a>

## 1. Background and goals

<a id="11-现状"></a>

### 1.1 Current state

Login uses a **global gate**, **off** by default:

| Entry | `LOGIN_ENABLED` | Login behavior |
|------|-----------------|----------|
| `bun run dev` | Unset → `false` | **No login**, render AppShell directly |
| `bun run dev:login` | `true` (+`ASCI_AUTH_NO_BYPASS=1`) | Real login page |
| Packaged artifacts (`dist:*`) | Unset → `false` | **No login** |

Two gates:
- **Renderer (compile time)**: `vite.config.ts` injects `__LOGIN_ENABLED__ = (process.env.LOGIN_ENABLED === 'true')`, stripped by tree-shaking.
- **Main process (runtime)**: `config-paths.ts#isLoginEnabled()` reads `process.env.LOGIN_ENABLED === 'true'` to decide whether to `registerAuthIpc` and construct `AuthService`.

<a id="12-目标需求反转"></a>

### 1.2 Goals (reverse requirement)

1. **Enable login by default in `bun run dev`**, **always showing the real login page** (no automatic bypass).
2. **Provide a skip argument**: `bun run dev:skip-login` disables login and opens AppShell directly (quick local startup).
3. **Packaged artifacts include login by default** (real login page; `app.isPackaged` already blocks bypass).
4. Packaging commands (`dist:*`) **require no new flags**; login is the default.

Core semantic reversal: **Login ON by default, OFF only through explicit opt-out**.

---

<a id="2-设计"></a>

## 2. Design

<a id="21-单一-opt-out-环境变量"></a>

### 2.1 Single opt-out environment variable

Introduce `ASCI_SKIP_LOGIN` (matches the request's “skip” wording; uses the `ASCI_` prefix alongside `ASCI_DEV` / `ASCI_AUTH_NO_BYPASS`) to replace `LOGIN_ENABLED`:

- **Unset** → login ON (dev and packaged defaults)
- **`=1`** → login OFF (only `dev:skip-login`)

Both gates read **the same** opt-out variable, keeping renderer/main decisions consistent:

**Renderer (compile time, `apps/electron/vite.config.ts`)**
```ts
// 默认开启登录；仅 ASCI_SKIP_LOGIN=1 时关闭。
// vite dev / vite build（打包）env 未设置 → true。
__LOGIN_ENABLED__: JSON.stringify(process.env.ASCI_SKIP_LOGIN !== '1'),
```

**Main process (runtime, `apps/electron/src/main/lib/config-paths.ts`)**
```ts
export function isLoginEnabled(): boolean {
  // 默认开启；仅 ASCI_SKIP_LOGIN=1（dev:skip-login）关闭。
  // 打包产物终端用户 env 无此变量 → 恒 true。
  return process.env.ASCI_SKIP_LOGIN !== '1'
}
```

> **Why runtime env suffices in main, without compile-time define**:
> - dev: Electron inherits the shell env of `bun run dev`; `ASCI_SKIP_LOGIN=1` injected by `dev:skip-login` is naturally visible.
> - Packaged: `ASCI_SKIP_LOGIN` belongs to the **build machine's** environment, not **end-user** runtime; absent on the user's env → `isLoginEnabled()` always `true`. Safe.
> - Consistent with existing `isLoginEnabled()` pattern, minimal change (reverse the check only).

<a id="22-dev-bypass-自动登录保持不变"></a>

### 2.2 dev-bypass automatic login remains unchanged

`auth-dev-bypass.ts#isDevBypassActive()` still strictly requires `process.env.ASCI_DEV === '1'`. Default `bun run dev` **does not set** `ASCI_DEV` → no bypass → **real login page** (goal 1).

Developers needing frictionless fixture automatic login explicitly use `dev:auto-login` (sets `ASCI_DEV=1`).

<a id="23-npm-scripts-重构根-packagejson"></a>

### 2.3 npm script refactor (root `package.json`)

Final choice (remove `dev:auto-login`; `dev` directly inherits old `dev:login` semantics):

| Script | env | Behavior |
|------|-----|------|
| `dev` (default, = old `dev:login`) | `ASCI_AUTH_NO_BYPASS=1` | Login ON + real login page (force real flow, even if `ASCI_DEV=1` accidentally inherited) |
| `dev:skip-login` (**new**, = old `dev`) | `ASCI_SKIP_LOGIN=1` | Login OFF, direct AppShell |

```jsonc
{
  "dev": "ASCI_AUTH_NO_BYPASS=1 bun run --filter='@asci/electron' dev",
  "dev:skip-login": "ASCI_SKIP_LOGIN=1 bun run --filter='@asci/electron' dev"
}
```

> Old `dev:login` (`LOGIN_ENABLED=true ASCI_AUTH_NO_BYPASS=1`) was replaced by `dev` and removed.
> No `dev:auto-login`: `dev` always sets `ASCI_AUTH_NO_BYPASS=1`, making dev-bypass automatic login unreachable through standard scripts (manually trigger only with `ASCI_DEV=1 bunx electronmon` if needed).
>
> **Implementation adjustment**: Retain renderer compile-time names `LOGIN_ENABLED` / `__LOGIN_ENABLED__` (referenced by multiple components); only switch their decision source to `process.env.ASCI_SKIP_LOGIN !== '1'`.

<a id="24-不需要改动的部分"></a>

### 2.4 Parts requiring no changes

- `App.tsx` already supports both `LOGIN_ENABLED` branches (`RouteGuard` vs direct rendering); reversing the constant takes effect immediately.
- `RouteGuard` / `GlobalListeners` / `useInitAuth` / auth atoms unchanged.
- `main/index.ts` retains `if (isLoginEnabled()) { registerAuthIpc(...) }` (reverse only inside the function).
- preload bridge always exists, unchanged.
- Login i18n copy already exists (used by old `dev:login`), **no new keys**.

---

<a id="3-行为矩阵改动后"></a>

## 3. Behavior matrix (after change)

| Entry | `ASCI_SKIP_LOGIN` | `ASCI_AUTH_NO_BYPASS` | renderer `__LOGIN_ENABLED__` | main `isLoginEnabled()` | bypass | Final behavior |
|------|:---:|:---:|:---:|:---:|:---:|------|
| `bun run dev` (default) | — | 1 | true | true | No | **Real login page** |
| `bun run dev:skip-login` | 1 | — | false | false | — | **No login**, direct entry |
| `dist:*` packaged artifacts | — | — | true | true | No (`app.isPackaged`) | **Real login page** |
| `electron:start` / `dist:fast` smoke | — | — | true | true | No | **Real login page** |

---

<a id="4-影响面与风险"></a>

## 4. Impact and risks

- **Smoke/packaging behavior change**: `electron:start`, `dist:fast` now stop at the real login page (previously direct entry). Backend / stub server must be reachable or login fails. Update smoke assertions expecting direct main-screen entry, or use `ASCI_SKIP_LOGIN=1` for no-login smoke tests.
- **`.asci-dev` isolation unaffected**: Default dev does not set `ASCI_DEV`; config directory still falls back to `.asci-dev` through `app.isPackaged`, as before.
- **`ASCI_SKIP_LOGIN` leakage risk**: Only an explicit `ASCI_SKIP_LOGIN=1` in end-user machine env disables login, an intentional, acceptable opt-out.
- **CI**: Find workflows/scripts referencing old `LOGIN_ENABLED` / `dev:login` and migrate together.

---

<a id="5-改动清单实现时"></a>

## 5. Change inventory (during implementation)

1. `apps/electron/vite.config.ts`: Change `__LOGIN_ENABLED__` check to `ASCI_SKIP_LOGIN !== '1'`.
2. `apps/electron/src/main/lib/config-paths.ts`: Change `isLoginEnabled()` to `ASCI_SKIP_LOGIN !== '1'`; update header comment.
3. `apps/electron/src/renderer/lib/dev-mode.tsx`: Update `LOGIN_ENABLED` comment (default-on semantics).
4. Root `package.json`: Add `dev:skip-login` / `dev:auto-login`; handle old `dev:login`.
5. Search repository-wide for remaining `LOGIN_ENABLED` / `dev:login` references (CI, docs, scripts) and migrate.
6. Versions: Increment `apps/electron/package.json` patch (once when opening PR).
7. Documentation sync (requires user permission): `README.md` / `CLAUDE.md` dev-only gate sections, `docs/i18n.md` if referenced.

---

<a id="6-验证"></a>

## 6. Validation

- `bun run dev` → stop at real login page.
- `bun run dev:skip-login` → direct AppShell.
- `bun run dev:auto-login` → automatic login as `dev@asci.local`.
- `CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --dir` smoke → real login page.
- `bun run typecheck` / `bun test` (including `key-parity`) pass.
