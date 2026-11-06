# CLAUDE.md

> **Agent Harness 配置入口**。本文件是"地图"而非"百科全书"，只收录永远生效的核心规则和硬约束；
> 细节请按"架构导航"下钻到源码或 `docs/`。修改 CLAUDE.md / README.md 前需征得用户允许。

---

## 1. 项目速览

**ASCI（Agent-based Scientific Collaboration Interface）** — 面向科研用户的深度 Agent 桌面应用，
基于 `@anthropic-ai/claude-agent-sdk` + Electron。

- 运行时：Bun 1.2.5+（替代 npm / pnpm / node）
- 语言：TypeScript 5+（严格模式，ESNext）
- UI：Electron 39 + React 18 + Vite 6 + Tailwind + Radix UI
- 状态：Jotai
- Agent Harness：本仓库 agent 协作流程依赖 **Claude Code CLI v2.1.152+**（`claude --version` 查看；低于此版本先 `claude update` / 重装升级）
- 版本号见各 `package.json`；Tech Stack 完整清单见根 `README.md`

### Monorepo 结构（Bun workspaces，`@asci/*` 作用域）

```
packages/
  shared/   # 类型、IPC 通道常量、utils        ← 零运行时依赖
  core/     # Provider 适配器、Shiki、Zotero 客户端
  ui/       # 共享 React 组件（CodeBlock、Mermaid...）
apps/
  electron/ # 桌面应用主体（main / preload / renderer）
```

内部引用统一用 `workspace:*`。

---

## 2. 核心规则（永远生效）

| 类别 | 规则 |
|------|------|
| **交互** | 使用中文与用户交流；注释和日志也用中文，保留必要的专业术语 |
| **i18n** | 任何 bugfix / 新功能涉及面向用户的 UI 文案，**必须**通过 i18n 走 `useT(ns)` / `t(key)` 解析，禁止 inline 硬编码字符串（中或英）；en + zh 两侧同步增减 key，由 `key-parity` 测试守门 — 详见 [`docs/i18n.md`](./docs/i18n.md) |
| **内置 prompt** | 内置 Agent prompt（system prompt / SubAgent 定义 / 工作区注入 / 服务回写 Agent 的通知文案）统一英文；Agent 输出语言由 system prompt 末尾的 Output Language directive 路由（UI 语言 + 用户消息语言双重判断）；用户自建 Agent / Skill 的 prompt 由用户自行决定语言 |
| **类型** | 永远不用 `any`；对象类型优先 `interface`；仅类型导入用 `import type` |
| **常量** | 同语义跨文件重复值、跨包/跨进程契约值（端口、模型 ID、URL、UI 策略值）提取到 `packages/shared/src/constants/`（SCREAMING_SNAKE_CASE + 中文头注释，经 `index.ts` re-export）；**偶然相等的数字与具名单用本地常量不提取**；IPC 通道常量按设计留在 `types/` 与类型同文件 — 详见 [`docs/architecture.md`](./docs/architecture.md) 共享常量节 |
| **状态** | 统一用 Jotai，禁止引入新的全局状态库 |
| **存储** | 本地优先：配置走 JSON、追加型日志走 JSONL；**关系型 / 大量结构化数据** 才用 SQLite（better-sqlite3，主进程同步访问，文件落 `~/.asci/`）；避免默认用 localStorage |
| **文件体积** | 单个 `.ts` / `.tsx` 源文件**软上限 ~500 行、硬上限 ~800 行**；接近即按域/阶段拆分。三类既定范式：IPC 注册按域拆到 `apps/electron/src/main/ipc/<domain>.ts`（每域一个 `register<Domain>Ipc()`，编排器 `ipc.ts` 只顺序调用）；preload API 按域拆到 `apps/electron/src/preload/domains/<domain>.ts`（片段对象 + 接口，`index.ts` 聚合并 `satisfies ElectronAPI`）；巨型 class（如 orchestrator）优先抽自包含纯 helper 到同级 `*-helpers.ts` / `*-<concern>.ts`。**新增 IPC handler 放对应 `ipc/<domain>.ts`、新增 preload API 放对应 `domains/<domain>.ts`，禁止回填已拆薄的编排/聚合文件**；详见 [ADR-000 §3.4](./docs/adr/ADR-000-common-convention.md) |
| **时间日期** | 统一用 **dayjs**：构造 / 算术 / ISO 互转走 `@asci/shared` 的 `nowIso` / `nowMs` / `toIso` / `toMs` / `dayjs`；展示用 `@/utils/dayjs` 的 `formatDate` / `formatDateTime` / `formatMessageTime`（随界面语言本地化），相对时间走 `useFormatRelativeTime`。**禁止裸 `new Date(...)` 格式化 / `.toLocale*` / 手搓拼时间串**（`asci/no-raw-date-format` warn 守门）；详见 [`docs/date-time.md`](./docs/date-time.md) |
| **UI** | ShadcnUI 风格，卡片+阴影替代边框，亮/暗双主题、饱满色彩，设置页设背景。**颜色必须用语义 token，禁止 Tailwind 调色板硬编码**（`bg-red-500/text-blue-600` 等）；brand 色用 `// eslint-disable-next-line asci/no-tailwind-palette -- <理由>` 豁免；详见 [`docs/design.md`](./docs/design.md) |
| **dev-only 门控（渲染侧）** | 仅开发期可见的功能 / 逻辑 / UI（debug 按钮、测试探针等）一律用 `@/lib/dev-mode` 的 `useIsDevMode()`（React 反应式）/ `getIsDevMode()`（非 React 一次性）/ `<DevOnly>` 组件门控。**有效 dev 模式** = `import.meta.env.DEV`（仅 `vite dev` 为 true）**或** `debugModeAtom`（用户在「关于」页连点版本号解锁的运行期 Debug 开关，持久化 localStorage，开启后 prod 亦为 true）。⚠️ 因含运行期 atom 读取，被门控代码**不再被 `vite build` tree-shaking 剥离**（改打进产物、运行期门控），但仍只在有效 dev 模式下显示。dev-only 文案**无需** i18n（详见 [`docs/i18n.md`](./docs/i18n.md) §3.1）。⚠️ **反向规则**：一旦移除门控（删 `<DevOnly>` / `useIsDevMode()` / `getIsDevMode()` 条件）把功能提升为生产 UI，i18n 与调色板硬编码两项豁免**当场失效**，须回填 i18n（[`docs/i18n.md`](./docs/i18n.md) §3.8）与语义 token / 亮暗双主题（[`docs/design.md`](./docs/design.md) §九） |
| **dev-only 门控（主进程）** | `apps/electron/src/main/**` 区分 dev/prod 用 `process.env.ASCI_DEV === '1'`（显式覆盖）或 `app.isPackaged`（未打包 = dev）；**渲染进程禁用 ASCI_DEV** —— contextIsolation 下 renderer 读不到 `process.env`，且它是运行期判断无法剥离代码。两者语义不同：`ASCI_DEV`/`app.isPackaged` 表"未打包"（`electron:start` 冒烟为 dev），`import.meta.env.DEV` 表"Vite dev server"（`electron:start` 为 false），勿混用。给子进程 / MCP 注入 dev env 参照 `config-paths.ts` 的 `getConfigEnvForChildren()`（dev 时注入 `{ ASCI_DEV: '1' }`，隔离 `~/.asci-dev` vs `~/.asci`） |
| **开发流程** | BDD（行为驱动），先描述行为再落代码 |
| **依赖** | 新增依赖前先搜索比较版本，不要默认最新/某个版本 |
| **版本号** | **无需手动 bump**：pre-commit 钩子（`scripts/bump-version-on-commit.mjs`）自动把本分支改过的 workspace `package.json` 钉到 `origin/main` 对应版本的 **patch + 1**（纯数字 `{N}.{N}.{N}`，无 `-rc`），改写后 auto-stage 进本次 commit；幂等（已 > remote 即跳过），多包同改各自钉。pre-push 不再碰版本号。离线 / 无 `origin/main` 时静默跳过 |
| **路径别名** | `@/` → `apps/electron/src/renderer/` |
| **导入** | **禁止 re-export 别名**：不写 `export const foo = bar` / `export { bar as foo }` 给已有函数 / 常量 / 变量起第二个名字；消费方直接 import 源符号（如直接用 `sanitizeText`，而非历史别名 `export const stripHtmlTags = sanitizeText`）。别名制造死转发与"一物两名"，改名时易漏改。例外：跨包桥接的 barrel re-export（`@asci/shared` 的 `index.ts` 同名 re-export，仅收口路径不改名）不在此限 |
| **协作流程** | 分支 / commit / PR 规范见 [ADR-000](./docs/adr/ADR-000-common-convention.md)；commit 必须 Conventional Commits 格式；PR 默认由开发者手动 squash merge（Agent 不代劳，保留 commits 需在 PR 描述显式说明） |
| **文档同步** | 功能变更需同步 README / CLAUDE.md，但**修改前先征求用户许可** |

---

## 3. 反馈回路（每次改动必跑）

Harness engineering 的核心是稳定的 feedback loops。按顺序执行：

### Feedforward — 改动前
- 读懂入口（`main/ipc.ts`、相关 atoms、受影响的 IPC 通道）
- 若改 IPC，记得四联同步：**shared 常量 → main 处理 → preload 桥接 → renderer 调用**
- 若改面向用户的 UI 文案：先在 `apps/electron/src/renderer/locales/<lang>/<ns>/...` 下找/加 key，en 与 zh 同步落键；组件里走 `useT(ns)` 引用
- 列出受影响的包（版本号由 pre-commit 钩子自动 bump，无需手动递增）

### Computational — 机器自动校验（必跑）
```bash
bun run typecheck          # 全 monorepo 类型检查
bun test                   # 单元 / 集成测试（Bun 原生）
bun run electron:build     # 重构或改依赖后验证可构建
```

### Inferential — Agent 自修正
- **开 PR 或更新/推送已有 PR 前**运行 `simplify` / `@code-simplifier`，复盘 reuse / 简化 / 可读性（见 [ADR-000 §3.3](./docs/adr/ADR-000-common-convention.md)）
- **开 PR 前**先 `git fetch origin && git merge origin/main`（或 `origin/UI-main`）合并最新主干，消化冲突再开 PR（见 [ADR-000 §3.3](./docs/adr/ADR-000-common-convention.md)）
- **开 PR 后**跑 `/review` skill 审该 PR，结果用 `gh pr comment` 回帖；**回帖即收尾，Agent 绝不 `gh pr merge` / 开 auto-merge，合并留给开发者手动完成**（流程见 [docs/agents/pr-flow.md](./docs/agents/pr-flow.md)）
- UI 改动：`bun run dev` 启动后在浏览器里走一遍 golden path + 边界情况；涉及文案改动需在设置页切 zh↔en 各走一遍，确认无 raw key 与漏翻
- 无法自验的 UI 必须明确告知用户，而不是宣称完成

---

## 4. 常用命令

```bash
# 开发
bun run dev                      # Vite + Electron + 热重载（默认含登录，停真实登录页）
bun run dev:skip-login           # 同上但 ASCI_SKIP_LOGIN=1 跳过登录，直进主界面
bun run electron:start           # 构建并启动（冒烟测试，含登录）

# 校验
bun run typecheck
bun test

# 打包
cd apps/electron
bun run dist:mac | dist:win | dist:linux
bun run dist:fast                # 当前架构快速验证
```

> 复杂情况的手动分步开发、单包 typecheck、Electron 子脚本（`build:main` / `build:renderer` / `generate:icons` 等）详见 `apps/electron/package.json` 与 `README.md`。

---

## 5. 架构导航（真相源 = 源码 / docs）

下面是"在哪里找什么"的地图。**具体细节请下钻到对应文件**。

### IPC 通信（必须牢记的横切约定）
一条 IPC 通道需要在 **四处** 同步：
1. `packages/shared/src/...` — 通道名常量 + 请求/响应类型
2. `apps/electron/src/main/ipc.ts` — `ipcMain.handle` 注册，调用 `main/lib/` 服务
3. `apps/electron/src/preload/index.ts` — `contextBridge.exposeInMainWorld` 暴露
4. `apps/electron/src/renderer/atoms/` 或组件 — 通过 `window.electronAPI.*` 调用

### i18n（横切约定）
详见 [`docs/i18n.md`](./docs/i18n.md) —— 框架入口、命名空间清单、大型 ns 拆段位置、主进程入口、语言事实源、类型补全入口、守门测试入口。

### 详细参考

| 主题 | 位置 |
|------|------|
| IPC 通道组、主进程服务层、Provider、Jotai atoms、组件域、全局 Hooks、初始化组件 | [`docs/architecture.md`](./docs/architecture.md) |
| Agent SDK 核心流程 / Orchestrator / 事件转换 / 权限排队 | [`docs/agent-sdk-integration.md`](./docs/agent-sdk-integration.md) |
| 构建工具、打包策略、SDK external 规则 | [`docs/build-and-packaging.md`](./docs/build-and-packaging.md) |
| 本地文件存储 `~/.asci/` 结构 | [`README.md`](./README.md) |
| 核心特性清单、Monorepo 包职责 | [`README.md`](./README.md) |

服务职责写在每个文件顶部的中文头注释中；最常用入口：
- `apps/electron/src/main/lib/agent-orchestrator.ts` — Agent SDK 核心编排
- `apps/electron/src/renderer/hooks/useGlobalAgentListeners` — 全局 Agent IPC 监听（永不销毁）
- `apps/electron/src/main/lib/channel-manager.ts` — API Key safeStorage AES-256-GCM 加密

---

## 6. Specs（设计方案，tracked）

非平凡改动先写设计方案，再实现：

- `docs/specs/<feature>-spec.md` — 设计规格 + 实现计划，**tracked（随 PR 进 git）**；带状态头（状态 / 关联 issue / 关联 PR / 领域语言事实源），格式参照 `docs/specs/capability-package-spec.md`
- 领域语言（术语表）落仓库根 `CONTEXT.md`（tracked）

**约定**：设计方案一律放 `docs/specs/`（tracked），**不放** `docs/superpowers/`（该目录在 `.gitignore` 内，仅当前会话临时 scratch）。这样 spec 可被 issue/PR 引用、可跨会话、可长期保留；优先读同 feature 的 spec 再动代码。

---

## 7. 硬约束（Breaking 警告）

以下四项做错会**打包不可用**、**线上泄漏密钥**或**漏翻 / 半翻 / Agent 选择抖动**，务必遵守。完整背景见 [`docs/build-and-packaging.md`](./docs/build-and-packaging.md)、[`docs/agent-sdk-integration.md`](./docs/agent-sdk-integration.md) 与 [`docs/i18n.md`](./docs/i18n.md)。

### 7.1 Agent SDK 打包（`@anthropic-ai/claude-agent-sdk`）
- esbuild 必须 `--external:@anthropic-ai/claude-agent-sdk`
- `apps/electron/electron-builder.yml` 的 `files` 必须包含 SDK 主包和 native binary 包：
  `node_modules/@anthropic-ai/claude-agent-sdk/**/*` 与 `node_modules/@anthropic-ai/claude-agent-sdk-*/**/*`
- SDK 0.2.113+ 通过 per-platform optional dependency 分发 `claude` / `claude.exe`，Windows 冒烟必须检查 `claude-agent-sdk-win32-x64/claude.exe` 已进包
- external 清单收敛在 `apps/electron/scripts/build-main.ts`（`build:main`/`watch:main` 共用，含构建期 key 注入）：`electron`、`@anthropic-ai/claude-agent-sdk`、native 模块（`better-sqlite3` 等）与 **`@sentry/electron`**（ADR-011：OTel 动态 instrumentation 不可 bundle，传递依赖闭包须进 `electron-builder.yml` `files`）；其他依赖交给 esbuild 打进 `main.cjs`
- 冒烟命令：本地 `CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --dir`；Windows 用 `.github/workflows/smoke-windows.yml` 手动触发 `--win --dir`

### 7.2 SDK env 语义（0.2.111/0.2.113+）
SDK 曾在 0.2.111 与 0.2.113 调整 `options.env` 的叠加/替换语义。项目侧不依赖 SDK 默认行为：`agent-orchestrator.ts` 的 `buildSdkEnv()` 显式构造完整 env，并在末尾"显式置空所有未被 sdkEnv 管理的 `ANTHROPIC_*` 键"。

修改 `buildSdkEnv()` 时：
1. ✅ 保留 `cleanEnv` 的 `ANTHROPIC_` 前缀过滤
2. ✅ 保留末尾的 `ANTHROPIC_*` 空字符串覆盖循环
3. ✅ 任何新增的 SDK 可识别环境变量必须显式进 `sdkEnv`，否则会被空字符串循环误伤

### 7.3 TypeScript 配置
- `"module": "Preserve"` + `"moduleResolution": "bundler"`
- `"jsx": "react-jsx"`、严格模式、Target ESNext
- 所有包 `"type": "module"`；**导入时带 `.ts` 扩展名**

### 7.4 i18n
完整规则详见 [`docs/i18n.md`](./docs/i18n.md)。违反任一条会导致漏翻 / 半翻 / Agent 选择路径被翻译干扰，必须严格遵守 —— 涵盖：inline 硬编码禁令（含 JSX 文本 / 属性 / props / 条件分支）、en + zh 同步、命名空间边界、大型 ns 拆分、Skill `nameI18n` UI-only、`packages/` 禁止耦合 i18n、测试禁用 i18n 等。

---

## 8. Done When（每次交付前自检）

1. [ ] `bun run typecheck` 通过
2. [ ] `bun test` 通过（涉及逻辑改动时；含 `key-parity.test.ts` 双语 key 对齐校验）
3. [ ] 版本号无需手动改（pre-commit 钩子自动 bump 到 `origin/main` patch+1）
4. [ ] 开 PR / 更新已有 PR 前跑过一次 `simplify` / `@code-simplifier` 复盘
5. [ ] 开 PR 前已 `git fetch origin && git merge origin/main`（或 `origin/UI-main`）合并最新主干并消化冲突
6. [ ] PR 推远端后已跑 `/review` 并用 `gh pr comment` 回帖审查结果；回帖后停手，**未** `gh pr merge` / 开 auto-merge（合并留给开发者）
7. [ ] UI 改动在 `bun run dev` 中实际点过 golden path + 边界情况（或显式告知无法自验）
8. [ ] 若涉及面向用户文案：`useT(ns)` 接入、en + zh 同步、设置页切 zh↔en 各走一遍无 raw key
9. [ ] 若为功能变化：向用户确认是否需要同步 CLAUDE.md / README.md
10. [ ] 若涉及 IPC：四处同步已完成
11. [ ] 若涉及 SDK 打包配置：本地 `dist:fast` 冒烟通过

---

## 附录：文档导航

| 文档 | 内容 |
|------|------|
| [`README.md`](./README.md) | 快速开始、完整命令、Monorepo 包职责、核心特性清单、`~/.asci/` 存储结构 |
| [`docs/architecture.md`](./docs/architecture.md) | IPC 通道组、主进程服务层、Provider 适配器、Jotai atoms、组件域、全局 Hooks、初始化组件 |
| [`docs/agent-sdk-integration.md`](./docs/agent-sdk-integration.md) | Agent SDK 核心流程、Orchestrator/PromptBuilder/PermissionService、事件转换、权限排队、SDK 升级注意事项 |
| [`docs/build-and-packaging.md`](./docs/build-and-packaging.md) | esbuild / Vite / electron-builder 配置、Agent SDK 打包规则、常见错误 |
| [`docs/i18n.md`](./docs/i18n.md) | i18n 横切约定（locales 布局、ns 清单、主进程 i18n、key-parity 守门）+ 7 条硬约束（inline 硬编码禁令、en/zh 同步、ns 边界、大型 ns 拆分、Skill nameI18n、packages 解耦、测试禁用 i18n）|
| [`docs/date-time.md`](./docs/date-time.md) | 日期时间约定（dayjs 双层入口：`@asci/shared` 基础 helper + `@/utils/dayjs` 展示 helper、locale 随界面语言同步、相对时间走 i18n hook、`asci/no-raw-date-format` 守门、保留原生 Date 的例外）|
| [`docs/history/sdk-upgrade-notes.md`](./docs/history/sdk-upgrade-notes.md) | SDK 版本升级历史 |
| [`docs/specs/`](./docs/specs) | 设计规格 + 实现计划（tracked，随 PR 进 git；详见 §6） |

外部：
- Agent SDK（TypeScript v1）：https://platform.claude.com/docs/en/agent-sdk/typescript
- Agent SDK（TypeScript v2 preview）：https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview
- craft-agents-oss（设计参照）：https://github.com/craftship/craft-agents-oss

---

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues on `OPENSCI-Labs/ASCI-Alpha` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### PR flow

开 PR 前合并最新主干、开 PR、PR 后跑 `/review` 回帖的完整流程见 `docs/agents/pr-flow.md`（真相源为 [ADR-000 §3.3](./docs/adr/ADR-000-common-convention.md)）。

### Triage labels

Five canonical triage roles map 1:1 to their default label names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
