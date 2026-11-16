<a id="架构参考"></a>

# Architecture Reference

Technical reference for Tinker's renderer / main process / Provider / state layers. Records only cross-cutting relationships and conventions
that are not obvious from source at a glance; individual implementations are defined by their Chinese file-header comments.

The 2026-11-10 research retirement separates research runtime wiring from historical compatibility. Old module locations remain here for reading historical data; they are not instructions to restart research services. Batch and validation boundaries are in the [retirement report](./reports/2026-11-10-research-retirement.md).

---

<a id="ipc-通信模式最重要的架构模式"></a>

## IPC Communication Pattern (Most Important Architecture Pattern)

Each IPC channel requires synchronized changes in **four places**:

1. **Types & constants** — Define channel constants and request/response types in `packages/shared/src/...`.
2. **Main-process handling** — Register through `ipcMain.handle()` in `apps/electron/src/main/ipc.ts`, calling `main/lib/` services.
3. **Preload bridge** — Expose type-safe APIs through `contextBridge.exposeInMainWorld` in `apps/electron/src/preload/index.ts`.
4. **Renderer** — Call through `window.electronAPI.*`, wrapped in Jotai atoms.

<a id="主要通道组"></a>

### Main Channel Groups

- `IPC_CHANNELS` — Basic channels (runtime, Git, environment)
- `CHANNEL_IPC_CHANNELS` — Channel management
- `AGENT_IPC_CHANNELS` — Agent features
- `CAPABILITY_PACK_IPC_CHANNELS` — Read-only capability pack listing (see [`agent-sdk-integration.md`](./agent-sdk-integration.md#agentmcp-和技能边界))
- `ATTACHMENT_IPC_CHANNELS` — Attachment management (save/read/save as/delete/file dialogs/text extraction)
- `ENVIRONMENT_IPC_CHANNELS` — Environment checks
- `PROXY_IPC_CHANNELS` — Proxy settings
- `GITHUB_RELEASE_IPC_CHANNELS` — GitHub releases

---

<a id="共享常量packagessharedsrcconstants"></a>

## Shared Constants (`packages/shared/src/constants/`)

Centralize literals repeated across files/packages in shared, re-export through `packages/shared/src/index.ts`, and always consume via `import { X } from '@asci/shared'`.

<a id="位置决策树"></a>

### Location Decision Table

| Category | Location |
|------|------|
| Security / permission rules, cross-domain contract values (ports, model IDs, URLs, UI policy values) | `packages/shared/src/constants/` |
| Application configuration (APP_NAME, etc.) | `packages/shared/src/config/` |
| IPC channel constants | `packages/shared/src/types/` (**same file as request/response types**, not constants/) |
| Telemetry events / channels | `packages/shared/src/telemetry/` |

<a id="提取判据"></a>

### Extraction Criteria

- ✅ Same semantics, repeated in ≥2 files (e.g. Zotero port 23119 once appeared in 7 places).
- ✅ Cross-package / cross-process contract values (e.g. default Claude model ID shared by main + core provider profiles).
- ❌ Coincidentally equal numbers (300ms debounce values with independent semantics remain separate).
- ❌ Named local constants used once (papers-rg limits, scrypt parameters, window dimensions, etc. stay local).

<a id="文件清单"></a>

### Files

| File | Content |
|------|------|
| `github-repo.ts` | GitHub repository identifiers, Releases URL |
| `permission-rules.ts` / `hard-permission-rules.ts` | Tool / command safety classification and hard rules |
| `zotero.ts` | Zotero connector port 23119, local API / connector base URLs, ping timeout (with composition guard tests) |
| `models.ts` | Default Claude model ID (shared by default conversation model + channel probe model) |
| `ui.ts` | Renderer UI policy values: copy feedback duration, author-list truncation count |

Style: Named SCREAMING_SNAKE_CASE exports + Chinese header comments explaining sources; logic / template composition requires colocated `*.test.ts`.

---

<a id="主进程服务层appselectronsrcmainlib"></a>

## Main-Process Service Layer (`apps/electron/src/main/lib/`)

<a id="agent-核心"></a>

### Agent Core

| Service | Responsibility |
|------|------|
| `agent-orchestrator.ts` | Core Agent orchestration: concurrency guards, channel lookup, environment construction, SDK path resolution, message persistence, event streaming, error handling, first-turn automatic naming, subagent assembly (user-created capability packs and Registry, injected into SDK `options.agents` through `runOrchestratorQuery`) |
| `agent-session-manager.ts` | Conversation management: SDK message persistence, session metadata CRUD, JSONL storage |
| `agent-prompt-builder.ts` | General system prompts, workspace context, registered Agent list; built-in research teams are no longer supplied and research routing is retired; permission, file, PDF, and output-language policies remain |
| `agent-permission-service.ts` | Tool permission checks, permission-mode management |
| `agent-ask-user-service.ts` | AskUser request handling |
| `agent-exit-plan-service.ts` | ExitPlan service |
| `agent-workspace-manager.ts` | Workspace management: MCP Server configuration, Skills configuration, workspace CRUD |
| `agent-team-reader.ts` | Team configuration reading |
| `channel-manager.ts` | Channel CRUD, API Key AES-256-GCM encryption (safeStorage), connection tests, model fetching |

<a id="agent-sdk-子-agent-装配a0"></a>

### Agent SDK Subagent Assembly (A0)

See [`agent-sdk-integration.md` — Orchestrator + Subagents](./agent-sdk-integration.md#agentmcp-和技能边界).

| Service | Responsibility |
|------|------|
| `subagent-registry.ts` | `SubagentRegistry` interface + in-memory implementation; priority-based namespaces from three sources (`builtin` / `user-config` / `capability-pack`); `snapshot()` produces the SDK `options.agents` dictionary |
| `subagent-registry-seed.ts` | Expands `buildBuiltinAgents` into builtin RegistryEntry objects; builtin / pack use the same Registry path |
| `run-orchestrator-query.ts` | **Sole** SDK query entrypoint (A0 ①); `assembleQueryOptions()` injects `options.agents` + general SubagentStart/Stop / pack.taskCompleted hooks; research hooks are no longer assembled |
| `capability-pack-loader.ts` | Loads user-created capability packs, validates/expands templates, registers in Registry; skips three retired built-in packIds without deleting installed directories |
| `capability-pack-service.ts` | Read-only `listCapabilityPacks`, without toggle/import/uninstall; list omits three retired built-in packIds |
| `subagent-spans-hook.ts` | FIFO-pairs SubagentStart/Stop into `SubagentSpan` |
| `agent-orchestrator-spans-sink.ts` | 500ms debounce + batch writes to `AgentSessionMeta.subagentSpans`, with cleanup-path `flush()` fallback |
| `emit-filesystem-agents.ts` / `emit-mcp-config.ts` / `mark-claude-project-trusted.ts` | Old compatibility implementations remain; production orchestration no longer calls them; no automatic overwriting of user agents/MCP files or trust changes |
| `runtime-skill-projection.ts` | Per-run owned skill plugin projection and SDK/background-task leases; does not modify user source directories; unknown/modified skills remain |
| `pack-task-completed-hook.ts` | Emits `pack.taskCompleted` when SubagentStop matches a capability pack |
| Research hooks such as `paper-meta-cap-hook.ts` | Retained old source, no longer connected to current queries |

<a id="工具与文件"></a>

### Tools and Files

| Service | Responsibility |
|------|------|
| `workspace-watcher.ts` | Workspace file watching: MCP configuration / Skills / attachment-directory filesystem changes |
| `attachment-service.ts` | Attachment storage/reading/deletion, file dialogs |
| `document-parser.ts` | PDF / Office / text extraction |
| `file-preview-service.ts` | File preview service |

<a id="系统服务"></a>

### System Services

| Service | Responsibility |
|------|------|
| `runtime-init.ts` | Runtime initialization: Shell environment, Bun, Git detection (`bun-finder.ts`, `git-detector.ts`, `shell-env.ts`) |
| `config-paths.ts` | Configuration path management: `~/.asci/` directory structure |
| `user-profile-service.ts` | User profile persistence |
| `settings-service.ts` | App settings persistence (Agent settings, notifications, Tab state, shortcut overrides, etc.) |
| `updater/` | Electron Updater integration |
| `global-shortcut-service.ts` | Global shortcut registration |
| `quick-task-window.ts` | Quick task window management |

<a id="zotero-历史兼容九项主动科研命令已退役"></a>

### Zotero Historical Compatibility (Nine Active Research Commands Retired)

| Module | Responsibility |
|------|------|
| `zotero-library.ts` | Old-data read compatibility, without automatic startup synchronization |
| `zotero-integration.ts` | Old integration source retained; nine active Zotero queue/configuration/rebuild commands blocked |
| `zotero-context-block.ts` | Zotero context block construction |
| `zotero-client/` | Zotero MCP client |

General OCR/ASR/PDF/Python remain despite Zotero retirement. OCR/ASR use existing independent settings managed in MCP settings; ASR defaults off and does not download on mount. Historical status/reading and cache/weight management remain; nine Zotero research rebuild/queue/automatic-download entries are explicitly unavailable. Paper/graph active-write boundaries and historical-page guards are recorded in retirement batch three; ordinary notes, reading/export, and existing material management remain. Do not generalize research-only write guards into a ban on editing all user data.

---

<a id="ai-provider-适配器packagescoresrcproviders"></a>

## AI Provider Adapters (`packages/core/src/providers/`)

Two decoupled layers: **Adapter (protocol)** + **Profile (configuration)**. Adding a provider only extends the `ProviderType` union (`@asci/shared`) and adds a row each to `adapterRegistry` / `profileRegistry`; callers (channel-manager, agent-orchestrator, ChannelForm) need zero code changes.

<a id="adapter-&#45;协议级"></a>

### Adapter — Protocol Level

- **Interface** (`types.ts`) — `ProviderAdapter` defines `buildStreamRequest()` + `parseSSELine()` for HTTP request construction + SSE parsing.
- **Registry** (`index.ts:adapterRegistry`) — Lookup by `ProviderType`; all current 6 providers map to the same `AnthropicAdapter` (Anthropic Messages API / "Anthropic Skin").
- **SSE reader** (`sse-reader.ts`) — General fetch + ReadableStream.
- **URL utilities** (`url-utils.ts`) — `normalizeAnthropicBaseUrl`, etc.

<a id="profile-&#45;配置级"></a>

### Profile — Configuration Level

Handles endpoint-level differences among 6 providers independently of protocol:

- **Contract** (`profile.ts`) — `ProviderProfile` interface: `defaultProbeModel` / `extraHeaders` / `validateEndpoint?` / `formatAuthError?` / `defaultCapabilities` / `fetchModels` + `FetchFn` dependency injection type.
- **Registry** (`profile-registry.ts:profileRegistry`) — Profile lookup by `ProviderType`; `getProfile(provider)` as sole entrypoint.
- **6 profiles** (`profiles/<provider>-profile.ts`) — One data-driven profile per provider:
  - **anthropic** / **openrouter**: Fetch remote model lists (using injected `fetchFn` inside the profile).
  - **minimax** / **kimi** / **moonshot** / **deepseek**: Static lists.
  - **moonshot**: `validateEndpoint` intercepts OpenAI endpoints (`/v1`) + returns i18n keys.
  - **kimi**: `formatAuthError` returns `{baseMessageKey, detailSnippet?}` for `/coding` 401; callers compose through `t()`.
  - **openrouter**: `extraHeaders` injects ranking headers (`HTTP-Referer` / `X-Title`); `defaultProbeModel` returns a namespaced model.
- **Capabilities** (`capabilities.ts`) — `getDefaultCapabilities(provider)` / `getEffectiveCapabilities(channel)` read profiles, replacing the switch in former `@asci/shared/utils/channel-capabilities.ts`.

<a id="调用层入口统一收口"></a>

### Caller Entry Points (Centralized)

- **`apps/electron/src/main/lib/channel-manager.ts`** — `fetchModels` / `testProviderConnection` / `testAnthropicCompat` all use `getProfile()`; no `switch (provider)` branches.
- **`apps/electron/src/main/lib/agent-orchestrator.ts`** — `getEffectiveCapabilities(channel)` from `@asci/core`.
- **`apps/electron/src/renderer/components/settings/ChannelForm.tsx`** — `getDefaultCapabilities(provider)` from `@asci/core`.

<a id="profile-与-i18n-解耦"></a>

### Profile and i18n Decoupling

Profiles live in `@asci/core` without Electron main-process i18n dependencies. Text-related fields (`validateEndpoint.messageKey` / `formatAuthError.{baseMessageKey, detailSnippet?}`) return i18n keys and truncated detail snippets; channel-manager composes final text using `t()`.

<a id="多模态支持"></a>

### Multimodal Support

- **Images** — Anthropic format `{ type: 'image', source: { type: 'base64', media_type, data } }`.
- **Documents** — Extract text and inject it into `<file>` XML tags.

---

<a id="jotai-状态管理appselectronsrcrendereratoms"></a>

## Jotai State Management (`apps/electron/src/renderer/atoms/`)

| Atom file | Managed state |
|-----------|-----------|
| `agent-atoms.ts` | Agent session list, current session, streaming state (`AgentStreamState`), workspace/channel selection, permission/AskUser queues (Map by sessionId) |
| `channels-atoms.ts` | Global channel-list cache, channel-loaded flag, thinking-block expansion preference |
| `active-view.ts` | Main-panel view switching ('conversations' / 'library') |
| `settings-tab.ts` | Current settings tab |
| `tab-atoms.ts` | Multiple-tab state: tabs, activeTabId, streaming indicators, minimap cache (Agent tabs only) |
| `user-profile.ts` | User profile (name + avatar) |
| `updater.ts` | Auto-update state (check/download/install), graceful degradation (idle when updater unavailable) |
| `library-atoms.ts` | Legacy literature-library compatibility state |
| `zotero-atoms.ts` | Legacy Zotero state compatibility; does not mean new workflows remain available |
| `side-panel-layout.ts` | Sidebar layout |
| `search-atoms.ts` | Search state |
| `draft-session-atoms.ts` | Draft sessions |
| `shortcut-atoms.ts` / `notifications.ts` / `proxy-atoms.ts` / `environment.ts` | Shortcut overrides / notifications / proxy / environment checks |

---

<a id="渲染进程组件架构appselectronsrcrenderercomponents"></a>

## Renderer Component Architecture (`apps/electron/src/renderer/components/`)

- **`app-shell/`** — Three-panel layout (LeftSidebar | MainArea | RightSidePanel); sidebar includes workspace selector, Working/pinned area, date-grouped session list, and streaming indicators.
- **`agent/`** — Agent mode; `AgentView` (presentation + interaction; IPC listeners lifted globally), `AgentHeader` (channel/model selection), `AgentMessages` (message list + tool activity), `ToolActivityItem`, `ProjectSwitcher`, `PermissionBanner` / `AskUserBanner`.
- **`tabs/`** — Tab system; `TabBar` / `TabBarItem` / `TabContent` / `TabPreviewPanel` (Agent tabs only).
- **`common/`** — Shared components; `UserAvatar`, `CopyButton`, `ModelSelector`, `AttachmentPreviewItem`, `format-message-time`.
- **`settings/`** — Settings panel; `GeneralSettings`, `ChannelSettings` / `ChannelForm`, `AgentSettings`, `McpServerForm`, `ProxySettings`, `ShortcutSettings`, `AboutSettings`; includes reusable `primitives/` forms.
- **`file-browser/`** — Workspace file-tree browsing.
- **`preview/`** — File preview panel (PDF / image / text).
- **`library/`** — Legacy literature data compatibility views.
- **`ai-elements/`** — Markdown / code blocks / Mermaid / reasoning collapse / rich text input.
- **`quick-task/`** — Quick task window (global shortcut trigger).
- **`onboarding/`** / **`welcome/`** — Onboarding and welcome page.
- **`shortcuts/`** / **`environment/`** — Shortcut settings and environment-check UI.
- **`ui/`** — Radix UI wrapper components (modern design).

---

<a id="全局-hooksappselectronsrcrendererhooks"></a>

## Global Hooks (`apps/electron/src/renderer/hooks/`)

| Hook | Responsibility |
|------|------|
| `useGlobalAgentListeners` | Global Agent IPC listener mounted at the top of `main.tsx`, manipulating atoms directly through `useStore()`. Handles streaming events, completion/errors, title updates, permission requests, and AskUser requests. **Never destroyed on component unmount** — preserves streaming output and permission requests during page switches (e.g. to settings). |

---

<a id="渲染进程初始化组件appselectronsrcrenderermaintsx"></a>

## Renderer Initialization Components (`apps/electron/src/renderer/main.tsx`)

| Component | Responsibility |
|------|------|
| `AgentSettingsInitializer` | Loads Agent channel/model/workspace settings; subscribes to MCP / file change events |
| `AgentListenersInitializer` | Mounts `useGlobalAgentListeners` for global Agent IPC listening |
| `NotificationsInitializer` | Loads desktop notification toggles / sound settings |
| `TabStatePersistenceInitializer` | Restores tabs at startup; debounced writes to `settings.json` during runtime |
| `UpdaterInitializer` | Subscribes to auto-update status changes pushed by main |

---

<a id="相关资料"></a>

## Related Resources

- [`build-and-packaging.md`](./build-and-packaging.md) — Build and packaging details, Agent SDK external rules.
- [`agent-sdk-integration.md`](./agent-sdk-integration.md) — Agent SDK core flow, Orchestrator details.
- [`CLAUDE.md`](../CLAUDE.md) — Top-level hard constraints and development discipline.
