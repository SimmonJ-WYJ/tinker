# CLAUDE.md

> **Agent Harness configuration entry point**. This is a map, not an encyclopedia. It contains only permanent core rules and hard constraints.
> Follow Architecture Navigation into the source or `docs/` for details. Obtain the user's permission before editing CLAUDE.md / README.md.

---

<a id="1-项目速览"></a>

## 1. Project Overview

**Tinker** is a general Agent desktop application for chat, writing, coding, image, and file tasks,
built with `@anthropic-ai/claude-agent-sdk` + Electron and evolved from the ASCI project.

The current development repository and default issue / PR target is [`SimmonJ-WYJ/tinker`](https://github.com/SimmonJ-WYJ/tinker).
Preserve attribution to ASCI / OPENSCI Labs and contributors. See [LICENSE](./LICENSE), [NOTICE](./NOTICE), and
the [historical README](./docs/history/ASCI-README.md). Research terminology and older roadmaps are in
the [historical CONTEXT](./docs/history/ASCI-CONTEXT.md) and are not current product goals.
Internal `@asci/*`, `ASCI_*`, MCP protocol names, `.asci` data paths, app identifiers / OAuth / deeplinks
are compatibility contracts and must not be bulk-renamed for branding. The existing Electron / SDK backend still provides production functionality and must not be retired merely because a Rust experimental frontend exists.

- Runtime: Bun 1.2.5+ (replacing npm / pnpm / node)
- Language: TypeScript 5+ (strict mode, ESNext)
- UI: Electron 39 + React 18 + Vite 6 + Tailwind + Radix UI
- State: Jotai
- Agent Harness: this repository's agent collaboration workflow requires **Claude Code CLI v2.1.152+** (check `claude --version`. If older, run `claude update` / reinstall to upgrade first)
- Versions are defined in each `package.json`. See the root `README.md` for the full tech-stack inventory.

<a id="monorepo-结构bun-workspacesasci-作用域"></a>

### Monorepo Structure (Bun Workspaces, `@asci/*` Scope)

```
packages/
  shared/   # Types, IPC channel constants, utils        ← zero runtime dependencies
  core/     # Provider adapters, Shiki, legacy integration compatibility modules
  ui/       # Shared React components (CodeBlock, Mermaid...)
apps/
  electron/ # Desktop application (main / preload / renderer)
```

Use `workspace:*` for all internal references.

---

<a id="2-核心规则永远生效"></a>

## 2. Core Rules (Always Apply)

| Category | Rule |
|------|------|
| **Interaction** | Communicate with the user in Chinese. Keep code comments and logs in Chinese, retaining necessary technical terms. Repository documentation, PR titles/descriptions, and PR review reports are written in English, including translations of archived documents and historical PR descriptions requested by the user. This does not change the application's bilingual UI or Agent output-language routing. |
| **i18n** | Any bugfix / feature involving user-facing UI text **must** resolve it through i18n using `useT(ns)` / `t(key)`. No inline hardcoded strings in either language. Add or remove keys in both en + zh, enforced by `key-parity` tests. See [`docs/i18n.md`](./docs/i18n.md). |
| **Built-in prompts** | Built-in Agent prompts (system prompts / SubAgent definitions / workspace injection / service-to-Agent notifications) are in English. The Output Language directive at the end of the system prompt routes Agent output using both UI language and user-message language. Users choose the language of their own Agent / Skill prompts. |
| **Types** | Never use `any`. Prefer `interface` for object types and `import type` for type-only imports. |
| **Constants** | Extract repeated values with the same meaning across files, or cross-package/process contract values (ports, model IDs, URLs, UI policy values), into `packages/shared/src/constants/` (SCREAMING_SNAKE_CASE + Chinese header comment, re-exported through `index.ts`). **Do not extract coincidentally equal numbers or named, single-use local constants**. IPC channel constants remain beside their types in `types/` by design. See the shared-constants section of [`docs/architecture.md`](./docs/architecture.md). |
| **State** | Use Jotai consistently. Do not introduce another global-state library. |
| **Storage** | Local first: JSON for configuration, JSONL for append-only logs. Use SQLite only for **relational / large structured data** (better-sqlite3, synchronous main-process access, files under `~/.asci/`). Avoid defaulting to localStorage. |
| **File size** | Each `.ts` / `.tsx` source file has a **soft limit of ~500 lines and a hard limit of ~800 lines**. Split by domain/stage as it approaches the limit. Three established patterns: register IPC by domain in `apps/electron/src/main/ipc/<domain>.ts` (one `register<Domain>Ipc()` per domain, with `ipc.ts` only calling them sequentially). Split preload APIs into `apps/electron/src/preload/domains/<domain>.ts` (fragment object + interface, aggregated by `index.ts` with `satisfies ElectronAPI`). For large classes such as the orchestrator, first extract self-contained pure helpers into sibling `*-helpers.ts` / `*-<concern>.ts` files. **Put new IPC handlers in the relevant `ipc/<domain>.ts` and new preload APIs in the relevant `domains/<domain>.ts`. Never grow the already-thinned orchestrator/aggregator again**. See [ADR-000 §3.4](./docs/adr/ADR-000-common-convention.md). |
| **Dates and time** | Use **dayjs** consistently. Construction / arithmetic / ISO conversion use `nowIso` / `nowMs` / `toIso` / `toMs` / `dayjs` from `@asci/shared`. Display uses `formatDate` / `formatDateTime` / `formatMessageTime` from `@/utils/dayjs`, localized to the UI language. Relative time uses `useFormatRelativeTime`. **No raw `new Date(...)` formatting / `.toLocale*` / manually concatenated time strings** (guarded by `asci/no-raw-date-format` warnings). See [`docs/date-time.md`](./docs/date-time.md). |
| **UI** | Use ShadcnUI style, cards + shadows instead of borders, light/dark themes, rich colors, and backgrounds on settings pages. **Use semantic color tokens, never hardcoded Tailwind palettes** such as `bg-red-500/text-blue-600`. Brand colors require a `// eslint-disable-next-line asci/no-tailwind-palette -- <理由>` exemption with a reason. See [`docs/design.md`](./docs/design.md). |
| **Dev-only gates (renderer)** | Gate development-only features / logic / UI (debug buttons, test probes) with `useIsDevMode()` (reactive React), `getIsDevMode()` (one-time non-React), or `<DevOnly>` from `@/lib/dev-mode`. **Effective dev mode** = `import.meta.env.DEV` (true only in `vite dev`) **or** `debugModeAtom` (the runtime Debug switch unlocked by repeatedly clicking the version in About, persisted in localStorage, and also true in production when enabled). ⚠️ Because it reads a runtime atom, gated code **is no longer removed by `vite build` tree-shaking**. It is bundled and runtime-gated, but visible only in effective dev mode. Dev-only text **does not require** i18n (see [`docs/i18n.md`](./docs/i18n.md) §3.1). ⚠️ **Reverse rule**: removing a gate (`<DevOnly>` / `useIsDevMode()` / `getIsDevMode()` condition) promotes the feature to production UI and **immediately ends** both exemptions. Add i18n ([`docs/i18n.md`](./docs/i18n.md) §3.8), semantic tokens, and light/dark support ([`docs/design.md`](./docs/design.md) §9). |
| **Dev-only gates (main process)** | In `apps/electron/src/main/**`, distinguish dev/prod with `process.env.ASCI_DEV === '1'` (explicit override) or `app.isPackaged` (unpackaged = dev). **Do not use ASCI_DEV in the renderer**: contextIsolation prevents access to `process.env`, and this runtime check cannot remove code. These differ: `ASCI_DEV`/`app.isPackaged` means unpackaged (`electron:start` smoke is dev), while `import.meta.env.DEV` means Vite dev server (false in `electron:start`). Do not confuse them. For child-process / MCP dev environment injection, follow `getConfigEnvForChildren()` in `config-paths.ts` (injects `{ ASCI_DEV: '1' }` in dev, isolating `~/.asci-dev` from `~/.asci`). |
| **Development** | BDD: describe behavior before implementing it. |
| **Dependencies** | Search and compare versions before adding dependencies. Do not default to the latest or an arbitrary version. |
| **Versioning** | **No manual bump is needed**. The pre-commit hook (`scripts/bump-version-on-commit.mjs`) pins each changed workspace `package.json` to **patch + 1** of its corresponding `origin/main` version (plain numeric `{N}.{N}.{N}`, no `-rc`), then auto-stages it in the commit. It is idempotent (skips when already > remote), and handles each changed package separately. Pre-push no longer changes versions. Offline / no `origin/main` silently skips this step. |
| **Path alias** | `@/` → `apps/electron/src/renderer/` |
| **Imports** | **No re-export aliases**: do not use `export const foo = bar` / `export { bar as foo }` to give an existing function / constant / variable a second name. Consumers import the original symbol directly (for example `sanitizeText`, rather than the historical alias `export const stripHtmlTags = sanitizeText`). Aliases create dead forwarding and two names for one thing, making renames easy to miss. Exception: same-name barrel re-exports bridging packages, such as `@asci/shared`'s `index.ts`, only consolidate import paths and are permitted. |
| **Collaboration** | See [ADR-000](./docs/adr/ADR-000-common-convention.md) for branch / commit / PR conventions. Commits must use Conventional Commits. Developers manually squash-merge PRs by default. Agents do not merge. State explicitly in the PR description if commits should be retained. |
| **Documentation sync** | Feature changes require README / CLAUDE.md synchronization, but **obtain user permission before editing them**. |

---

<a id="3-反馈回路每次改动必跑"></a>

## 3. Feedback Loops (Required for Every Change)

Stable feedback loops are central to harness engineering. Follow this order:

<a id="feedforward-&#45;改动前"></a>

### Feedforward — Before Editing
- Understand the entry points (`main/ipc.ts`, relevant atoms, affected IPC channels).
- For IPC changes, synchronize all four: **shared constants → main handling → preload bridge → renderer call**.
- For user-facing UI text, find/add keys under `apps/electron/src/renderer/locales/<lang>/<ns>/...`, update both en and zh, and use `useT(ns)` in components.
- List affected packages (pre-commit automatically bumps versions, so do not increment manually).

<a id="computational-&#45;机器自动校验必跑"></a>

### Computational — Automated Checks (Required)
```bash
bun run typecheck          # Typecheck the full monorepo
bun test                   # Unit / integration tests (native Bun)
bun run electron:build     # Verify buildability after refactoring or dependency changes
```

<a id="inferential-&#45;agent-自修正"></a>

### Inferential — Agent Self-Correction
- **Before opening a PR or updating/pushing an existing one**, run `simplify` / `@code-simplifier` to review reuse, simplification, and readability (see [ADR-000 §3.3](./docs/adr/ADR-000-common-convention.md)).
- **Before opening a PR**, run `git fetch origin && git merge origin/main` (or `origin/UI-main`), resolve conflicts, then open the PR (see [ADR-000 §3.3](./docs/adr/ADR-000-common-convention.md)).
- **After opening a PR**, run `/review` on it and post the result with `gh pr comment`. **The comment ends the agent workflow. Never run `gh pr merge` or enable auto-merge. Leave merging to the developer** (see [docs/agents/pr-flow.md](./docs/agents/pr-flow.md)).
- For UI changes, run `bun run dev` and exercise the golden path + edge cases in the browser. For text changes, switch zh↔en in settings and test both languages for raw keys or missing translations.
- Explicitly tell the user when UI verification cannot be performed. Do not claim completion instead.

---

<a id="4-常用命令"></a>

## 4. Common Commands

```bash
# Development
bun run dev                      # Vite + Electron + hot reload (sign-in enabled by default, stops at the real sign-in page)
bun run dev:skip-login           # Same, but ASCI_SKIP_LOGIN=1 skips sign-in and opens the main interface
bun run electron:start           # Build and launch (smoke test, sign-in enabled)

# Checks
bun run typecheck
bun test

# Packaging
cd apps/electron
bun run dist:mac | dist:win | dist:linux
bun run dist:fast                # Quick verification for the current architecture
```

> For manual staged development in complex cases, single-package type checking, and Electron subscripts (`build:main` / `build:renderer` / `generate:icons`, etc.), see `apps/electron/package.json` and `README.md`.

---

<a id="5-架构导航真相源-&#45;源码-&#45;docs"></a>

## 5. Architecture Navigation (Source of Truth = Source / Docs)

This map explains where to find information. **Follow the links into the relevant files for details**.

<a id="ipc-通信必须牢记的横切约定"></a>

### IPC Communication (Essential Cross-Cutting Convention)
Synchronize each IPC channel in **four places**:
1. `packages/shared/src/...` — channel-name constants + request/response types.
2. `apps/electron/src/main/ipc.ts` — `ipcMain.handle` registration, calling services in `main/lib/`.
3. `apps/electron/src/preload/index.ts` — exposure through `contextBridge.exposeInMainWorld`.
4. `apps/electron/src/renderer/atoms/` or components — calls through `window.electronAPI.*`.

<a id="i18n横切约定"></a>

### i18n (Cross-Cutting Convention)
See [`docs/i18n.md`](./docs/i18n.md) for framework entry points, namespaces, large-namespace split locations, main-process entry points, language sources of truth, type completion, and guard tests.

<a id="详细参考"></a>

### Detailed References

| Topic | Location |
|------|------|
| IPC channel groups, main-process services, Providers, Jotai atoms, component domains, global hooks, initialization components | [`docs/architecture.md`](./docs/architecture.md) |
| Agent SDK core flow / Orchestrator / event conversion / permission queueing | [`docs/agent-sdk-integration.md`](./docs/agent-sdk-integration.md) |
| Build tools, packaging strategy, SDK external rules | [`docs/build-and-packaging.md`](./docs/build-and-packaging.md) |
| Local file storage under `~/.asci/` | [`README.md`](./README.md) |
| Core features, Monorepo package responsibilities | [`README.md`](./README.md) |

Each service's responsibility is recorded in its Chinese file-header comment. Common entry points:
- `apps/electron/src/main/lib/agent-orchestrator.ts` — core Agent SDK orchestration.
- `apps/electron/src/renderer/hooks/useGlobalAgentListeners` — global Agent IPC listeners (never destroyed).
- `apps/electron/src/main/lib/channel-manager.ts` — API-key safeStorage AES-256-GCM encryption.

---

<a id="6-specs设计方案tracked"></a>

## 6. Specs (Designs, Tracked)

Write a design before implementing nontrivial changes:

- `docs/specs/<feature>-spec.md` — design specification + implementation plan, **tracked with the PR in Git**. Include a status header (status / related issue / related PR / domain-language source of truth), following `docs/specs/capability-package-spec.md`.
- Current domain language (glossary) belongs in root `CONTEXT.md` (tracked). Historical research definitions are archived in `docs/history/ASCI-CONTEXT.md` and do not automatically restore old features or roadmaps.

**Convention**: all designs go in tracked `docs/specs/`, **not** `docs/superpowers/` (scratch space ignored by `.gitignore`, for the current session only). This makes specs linkable from issues/PRs, reusable across sessions, and durable. Read an existing spec for the same feature before editing code.

---

<a id="7-硬约束breaking-警告"></a>

## 7. Hard Constraints (Breaking Warnings)

Violating these four areas can cause **unusable packages**, **production credential leaks**, or **missing / partial translations / unstable Agent selection**. Follow them strictly. See [`docs/build-and-packaging.md`](./docs/build-and-packaging.md), [`docs/agent-sdk-integration.md`](./docs/agent-sdk-integration.md), and [`docs/i18n.md`](./docs/i18n.md) for full context.

<a id="71-agent-sdk-打包anthropic-aiclaude-agent-sdk"></a>

### 7.1 Agent SDK Packaging (`@anthropic-ai/claude-agent-sdk`)
- esbuild must use `--external:@anthropic-ai/claude-agent-sdk`.
- `files` in `apps/electron/electron-builder.yml` must include the SDK package and native-binary packages:
  `node_modules/@anthropic-ai/claude-agent-sdk/**/*` and `node_modules/@anthropic-ai/claude-agent-sdk-*/**/*`.
- SDK 0.2.113+ distributes `claude` / `claude.exe` through per-platform optional dependencies. Windows smoke tests must verify that `claude-agent-sdk-win32-x64/claude.exe` is packaged.
- The shared external list is in `apps/electron/scripts/build-main.ts` (used by `build:main`/`watch:main`, including build-time key injection): `electron`, `@anthropic-ai/claude-agent-sdk`, native modules such as `better-sqlite3`, and **`@sentry/electron`** (ADR-011: OTel dynamic instrumentation cannot be bundled, and its transitive dependency closure must be in `electron-builder.yml` `files`). esbuild bundles other dependencies into `main.cjs`.
- Smoke commands: locally, `CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --dir`. On Windows, manually trigger `.github/workflows/smoke-windows.yml` with `--win --dir`.

<a id="72-sdk-env-语义0211102113"></a>

### 7.2 SDK Environment Semantics (0.2.111/0.2.113+)
The SDK changed `options.env` merge/replacement semantics in 0.2.111 and 0.2.113. This project does not rely on the SDK default: `buildSdkEnv()` in `agent-orchestrator.ts` explicitly builds the full environment, then explicitly overwrites every `ANTHROPIC_*` key not managed by `sdkEnv` with an empty string.

When modifying `buildSdkEnv()`:
1. ✅ Keep the `ANTHROPIC_` prefix filter in `cleanEnv`.
2. ✅ Keep the final `ANTHROPIC_*` empty-string override loop.
3. ✅ Explicitly add every new SDK-recognized environment variable to `sdkEnv`, or the empty-string loop will erase it.

<a id="73-typescript-配置"></a>

### 7.3 TypeScript Configuration
- `"module": "Preserve"` + `"moduleResolution": "bundler"`.
- `"jsx": "react-jsx"`, strict mode, Target ESNext.
- Every package uses `"type": "module"`. **Include `.ts` extensions in imports**.

### 7.4 i18n
See [`docs/i18n.md`](./docs/i18n.md) for complete rules. Violations cause missing/partial translations or translated text to interfere with Agent selection. These rules cover the inline-hardcoding ban (JSX text / attributes / props / branches), synchronized en + zh, namespace boundaries, large-namespace splitting, UI-only Skill `nameI18n`, no i18n coupling in `packages/`, disabling i18n in tests, and more.

---

<a id="8-done-when每次交付前自检"></a>

## 8. Done When (Check Before Every Delivery)

1. [ ] `bun run typecheck` passes.
2. [ ] `bun test` passes when logic changes, including bilingual key alignment in `key-parity.test.ts`.
3. [ ] No manual version bump (pre-commit automatically bumps to `origin/main` patch+1).
4. [ ] Ran `simplify` / `@code-simplifier` before opening / updating a PR.
5. [ ] Before opening the PR, ran `git fetch origin && git merge origin/main` (or `origin/UI-main`), merged the latest mainline, and resolved conflicts.
6. [ ] Reviewed the pushed PR with `/review` and posted results through `gh pr comment`. Stopped after commenting, with **no** `gh pr merge` or auto-merge (developer merges manually).
7. [ ] For UI changes, exercised the golden path + edge cases in `bun run dev`, or explicitly reported that verification was unavailable.
8. [ ] For user-facing text, used `useT(ns)`, synchronized en + zh, and tested both languages through settings without raw keys.
9. [ ] For functional changes, asked the user whether to synchronize CLAUDE.md / README.md.
10. [ ] For IPC changes, synchronized all four places.
11. [ ] For SDK packaging changes, passed a local `dist:fast` smoke test.

---

<a id="附录文档导航"></a>

## Appendix: Documentation Navigation

| Document | Contents |
|------|------|
| [`README.md`](./README.md) | Quick start, full commands, Monorepo package responsibilities, core features, `~/.asci/` storage structure |
| [`docs/architecture.md`](./docs/architecture.md) | IPC channel groups, main-process services, Provider adapters, Jotai atoms, component domains, global hooks, initialization components |
| [`docs/agent-sdk-integration.md`](./docs/agent-sdk-integration.md) | Agent SDK core flow, Orchestrator/PromptBuilder/PermissionService, event conversion, permission queues, SDK upgrade notes |
| [`docs/build-and-packaging.md`](./docs/build-and-packaging.md) | esbuild / Vite / electron-builder configuration, Agent SDK packaging rules, common errors |
| [`docs/i18n.md`](./docs/i18n.md) | Cross-cutting i18n conventions (locale layout, namespaces, main-process i18n, key-parity guards) + 7 hard constraints (no inline strings, en/zh parity, namespace boundaries, large-namespace splitting, Skill nameI18n, decoupled packages, disabled i18n in tests) |
| [`docs/date-time.md`](./docs/date-time.md) | Date/time conventions (dayjs entry points in `@asci/shared` and display helpers in `@/utils/dayjs`, UI-synchronized locale, relative-time i18n hook, `asci/no-raw-date-format` guard, exceptions retaining native Date) |
| [`docs/history/sdk-upgrade-notes.md`](./docs/history/sdk-upgrade-notes.md) | SDK version-upgrade history |
| [`docs/specs/`](./docs/specs) | Tracked design specifications + implementation plans, committed with PRs. See §6. |

External references:
- Agent SDK (TypeScript v1): https://platform.claude.com/docs/en/agent-sdk/typescript
- Agent SDK (TypeScript v2 preview): https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview
- craft-agents-oss (design reference): https://github.com/craftship/craft-agents-oss

---

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues on `SimmonJ-WYJ/tinker` via the `gh` CLI. Upstream issue references retain their original repository context. See `docs/agents/issue-tracker.md`.

### PR flow

See `docs/agents/pr-flow.md` for merging the latest mainline before opening a PR, creating the PR, and running `/review` and commenting afterward. The source of truth is [ADR-000 §3.3](./docs/adr/ADR-000-common-convention.md).

### Triage labels

Five canonical triage roles map 1:1 to their default label names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
