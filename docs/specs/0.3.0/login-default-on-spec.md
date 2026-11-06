# 登录默认开启 Spec（Login Default-On）

> **状态**：已实现 · 待 review
> **关联里程碑**：0.3.0
> **领域语言事实源**：`apps/electron/src/main/lib/auth-dev-bypass.ts`、`config-paths.ts#isLoginEnabled`、`renderer/lib/dev-mode.tsx#LOGIN_ENABLED`
> **依赖输入**：现有登录链路（`account-oauth-arch-spec.md`）

---

## 1. 背景与目标

### 1.1 现状

登录功能采用**全局门控开关**，默认**关闭**：

| 入口 | `LOGIN_ENABLED` | 登录行为 |
|------|-----------------|----------|
| `bun run dev` | 未设置 → `false` | **无登录**，直渲 AppShell |
| `bun run dev:login` | `true`（+`ASCI_AUTH_NO_BYPASS=1`） | 真实登录页 |
| 打包产物（`dist:*`） | 未设置 → `false` | **无登录** |

门控有两道：
- **渲染侧（编译期）**：`vite.config.ts` 注入 `__LOGIN_ENABLED__ = (process.env.LOGIN_ENABLED === 'true')`，被 tree-shaking 剥离。
- **主进程（运行期）**：`config-paths.ts#isLoginEnabled()` 读 `process.env.LOGIN_ENABLED === 'true'`，决定是否 `registerAuthIpc` 与构造 `AuthService`。

### 1.2 目标（需求反转）

1. **`bun run dev` 默认开启登录**，且**每次显示真实登录页**（不自动 bypass）。
2. **提供跳过参数**：`bun run dev:skip-login` 关闭登录，直接进 AppShell（快速本地启动）。
3. **打包产物默认包含登录**（真实登录页；`app.isPackaged` 本就阻断 bypass）。
4. 打包命令（`dist:*`）**无需新增任何 flag** —— 默认即登录。

核心语义反转：**登录默认 ON，仅显式 opt-out 时 OFF**。

---

## 2. 设计

### 2.1 单一 opt-out 环境变量

引入 `ASCI_SKIP_LOGIN`（命名与请求中"跳过"一致，沿用 `ASCI_` 前缀，与 `ASCI_DEV` / `ASCI_AUTH_NO_BYPASS` 同族），取代原 `LOGIN_ENABLED`：

- **未设置** → 登录 ON（dev 默认 + 打包产物默认）
- **`=1`** → 登录 OFF（仅 `dev:skip-login`）

两道门控读**同一个** opt-out 变量，保证 renderer/main 判断一致：

**渲染侧（编译期，`apps/electron/vite.config.ts`）**
```ts
// 默认开启登录；仅 ASCI_SKIP_LOGIN=1 时关闭。
// vite dev / vite build（打包）env 未设置 → true。
__LOGIN_ENABLED__: JSON.stringify(process.env.ASCI_SKIP_LOGIN !== '1'),
```

**主进程（运行期，`apps/electron/src/main/lib/config-paths.ts`）**
```ts
export function isLoginEnabled(): boolean {
  // 默认开启；仅 ASCI_SKIP_LOGIN=1（dev:skip-login）关闭。
  // 打包产物终端用户 env 无此变量 → 恒 true。
  return process.env.ASCI_SKIP_LOGIN !== '1'
}
```

> **为何主进程用运行期 env 即可、不必编译期 define**：
> - dev：electron 进程继承 `bun run dev` 的 shell env，`dev:skip-login` 注入的 `ASCI_SKIP_LOGIN=1` 自然可见。
> - 打包：`ASCI_SKIP_LOGIN` 是**打包构建机**的环境，不会进入**终端用户**运行环境；终端用户 env 无此变量 → `isLoginEnabled()` 恒 `true`。安全。
> - 与现有 `isLoginEnabled()` 模式一致，改动最小（仅反转判断）。

### 2.2 dev-bypass 自动登录保持不变

`auth-dev-bypass.ts#isDevBypassActive()` 仍严格要求 `process.env.ASCI_DEV === '1'`。默认 `bun run dev` **不设** `ASCI_DEV` → 不 bypass → **真实登录页**（满足目标 1）。

需要"自动登录 fixture 免摩擦"的开发者，显式走 `dev:auto-login`（设 `ASCI_DEV=1`）。

### 2.3 npm scripts 重构（根 `package.json`）

最终采用（去掉 `dev:auto-login`，`dev` 直接继承旧 `dev:login` 语义）：

| 脚本 | env | 行为 |
|------|-----|------|
| `dev`（默认，= 旧 `dev:login`） | `ASCI_AUTH_NO_BYPASS=1` | 登录 ON + 真实登录页（强制真实流程，即使误带 `ASCI_DEV=1` 也不 bypass） |
| `dev:skip-login`（**新增**，= 旧 `dev`） | `ASCI_SKIP_LOGIN=1` | 登录 OFF，直进 AppShell |

```jsonc
{
  "dev": "ASCI_AUTH_NO_BYPASS=1 bun run --filter='@asci/electron' dev",
  "dev:skip-login": "ASCI_SKIP_LOGIN=1 bun run --filter='@asci/electron' dev"
}
```

> 旧 `dev:login`（`LOGIN_ENABLED=true ASCI_AUTH_NO_BYPASS=1`）已被 `dev` 取代并移除。
> 不提供 `dev:auto-login`：`dev` 恒带 `ASCI_AUTH_NO_BYPASS=1`，dev-bypass 自动登录在标准脚本下不可达（如需仅手动 `ASCI_DEV=1 bunx electronmon` 触发）。
>
> **实现微调**：渲染侧编译期常量保留原名 `LOGIN_ENABLED` / `__LOGIN_ENABLED__`（多组件引用），仅翻转其判断源为 `process.env.ASCI_SKIP_LOGIN !== '1'`。

### 2.4 不需要改动的部分

- `App.tsx` 已对 `LOGIN_ENABLED` 两分支齐备（`RouteGuard` vs 直渲），常量翻转即生效。
- `RouteGuard` / `GlobalListeners` / `useInitAuth` / auth atoms 不变。
- `main/index.ts` 的 `if (isLoginEnabled()) { registerAuthIpc(...) }` 不变（判断函数内部反转即可）。
- preload bridge 始终存在，不变。
- 登录相关 i18n 文案已存在（旧 `dev:login` 已用过），**无新增 key**。

---

## 3. 行为矩阵（改动后）

| 入口 | `ASCI_SKIP_LOGIN` | `ASCI_AUTH_NO_BYPASS` | renderer `__LOGIN_ENABLED__` | main `isLoginEnabled()` | bypass | 最终行为 |
|------|:---:|:---:|:---:|:---:|:---:|------|
| `bun run dev`（默认） | — | 1 | true | true | 否 | **真实登录页** |
| `bun run dev:skip-login` | 1 | — | false | false | — | **无登录**，直进 |
| `dist:*` 打包产物 | — | — | true | true | 否（`app.isPackaged`） | **真实登录页** |
| `electron:start` / `dist:fast` 冒烟 | — | — | true | true | 否 | **真实登录页** |

---

## 4. 影响面与风险

- **冒烟/打包行为变化**：`electron:start`、`dist:fast` 现在会停在真实登录页（此前直进）。需要后端 / stub server 可达，否则登录失败。冒烟脚本若有"直接进主界面"的断言需同步调整，或用 `ASCI_SKIP_LOGIN=1` 跑无登录冒烟。
- **`.asci-dev` 隔离不受影响**：默认 dev 未设 `ASCI_DEV`，config 目录仍靠 `app.isPackaged` 回落 `.asci-dev`，与现状一致。
- **`ASCI_SKIP_LOGIN` 泄漏风险**：仅当终端用户机器 env 显式带 `ASCI_SKIP_LOGIN=1` 才会关登录——属有意 opt-out，可接受。
- **CI**：搜索引用旧 `LOGIN_ENABLED` / `dev:login` 的工作流与脚本，同步迁移。

---

## 5. 改动清单（实现时）

1. `apps/electron/vite.config.ts`：`__LOGIN_ENABLED__` 判断改为 `ASCI_SKIP_LOGIN !== '1'`。
2. `apps/electron/src/main/lib/config-paths.ts`：`isLoginEnabled()` 改为 `ASCI_SKIP_LOGIN !== '1'`，更新头注释。
3. `apps/electron/src/renderer/lib/dev-mode.tsx`：更新 `LOGIN_ENABLED` 注释（语义改为默认 on）。
4. 根 `package.json`：新增 `dev:skip-login` / `dev:auto-login`，处理旧 `dev:login`。
5. 全仓搜索 `LOGIN_ENABLED` / `dev:login` 残留引用（CI、文档、脚本）并迁移。
6. 版本号：`apps/electron/package.json` patch 递增（开 PR 时一次）。
7. 文档同步（需用户许可）：`README.md` / `CLAUDE.md` dev-only 门控节、`docs/i18n.md` 若引用。

---

## 6. 验证

- `bun run dev` → 停真实登录页。
- `bun run dev:skip-login` → 直进 AppShell。
- `bun run dev:auto-login` → 自动登录 `dev@asci.local`。
- `CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --dir` 冒烟 → 真实登录页。
- `bun run typecheck` / `bun test`（含 `key-parity`）通过。
