# ASCI

**Agent-based Scientific Collaboration Interface** — A deep Agent desktop application for researchers.

Built on Claude Agent SDK, supporting multi-Agent collaboration (Agent Teams), the MCP ecosystem, Skills, and research workflows.

- Repository: https://github.com/OPENSCI-Labs/ASCI-Alpha
- Contribution guide: Read [`CLAUDE.md`](./CLAUDE.md) first

---

<a id="快速开始"></a>

## Quick start

> Contributing / running this repository's agent collaboration workflow requires **Claude Code CLI v2.1.152+** (check `claude --version`; upgrade with `claude update` / reinstall if older).

```bash
bun install
bun run dev                      # Vite + Electron + 热重载（默认含登录，停在真实登录页）
bun run dev:skip-login           # 同上但跳过登录，直接进主界面（快速本地开发）
```

> Login is enabled by default: `bun run dev` and all packaged artifacts (`dist:*`) include login and stop at the real login page;
> only `bun run dev:skip-login` (injecting `ASCI_SKIP_LOGIN=1`) skips login locally.

<a id="构建与打包"></a>

## Build and packaging

```bash
bun run electron:build           # 渲染 + 主进程打包
bun run electron:start           # 构建并启动（冒烟测试）

cd apps/electron
bun run dist:mac                 # macOS 安装包
bun run dist:win                 # Windows 安装包
bun run dist:linux               # Linux 安装包
bun run dist:fast                # 当前架构快速打包（调试用）
```

<a id="electron-子脚本appselectron"></a>

### Electron sub-scripts (`apps/electron/`)

```bash
bun run build:main               # esbuild → dist/main.cjs
bun run build:preload            # esbuild → dist/preload.cjs
bun run build:renderer           # Vite → dist/renderer/
bun run build:resources          # 复制 resources/ 到 dist/
bun run generate:icons           # 生成应用图标
```

<a id="开发工具命令"></a>

## Development tool commands

```bash
bun run typecheck                # 所有包类型检查
cd packages/core && bun run typecheck   # 单包类型检查
bun test                         # Bun 原生测试运行器
```

---

<a id="技术栈"></a>

## Technology stack

| Layer | Technology |
|------|------|
| Runtime | Bun 1.2.5+ |
| Language | TypeScript 5+ (strict mode, ESNext) |
| Desktop framework | Electron 39 |
| Frontend | React 18 + Vite 6 + Tailwind CSS + Radix UI |
| State management | Jotai |
| Date/time | dayjs (unified entry, see [`docs/date-time.md`](./docs/date-time.md)) |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` |
| Build | esbuild + Vite |
| Distribution | electron-builder |

Exact versions follow the respective `package.json` files.

---

<a id="monorepo-结构"></a>

## Monorepo structure

Bun workspaces, `@asci/*` scope, internal references use `workspace:*`.

```
ASCI-Alpha/
├── packages/
│   ├── shared/   # Shared types, IPC constants, utils (zero runtime dependencies)
│   ├── core/     # Provider adapters, Shiki highlighting, Zotero client
│   └── ui/       # Shared React components (CodeBlock, MermaidBlock...)
└── apps/
    └── electron/ # Main desktop app (main / preload / renderer)
```

<a id="各包职责"></a>

### Package responsibilities

- **`@asci/shared`** — Exports `./types` / `./config` / `./utils`; core types include `AgentMessage`, `Channel`, `PermissionRequest`, `FileAttachment`, `LLMMessage`, `ModelOption`.
- **`@asci/core`** — Exports `./providers` / `./highlight` / `./types` / `./utils` / `./zotero`; implements Provider adapter registry and code highlighting; depends on `@asci/shared`, `shiki`.
- **`@asci/ui`** — Shared React UI components (CodeBlock, MermaidBlock...); depends on `@asci/core`, `beautiful-mermaid`, Radix UI; React 18 peer dependency.
- **`@asci/electron`** — Main application integrating all packages above; key dependencies `@anthropic-ai/claude-agent-sdk`, TipTap, Tailwind, file parsing (`pdf-parse` / `officeparser` / `word-extractor`).

---

<a id="核心特性"></a>

## Core features

<a id="已实现功能"></a>

### Implemented features

- ✅ **Anthropic protocol-compatible endpoints** — Native Anthropic, MiniMax, and Anthropic-compatible custom URL endpoints
- ✅ **Agent SDK integration** — Full Agent mode based on Claude Agent SDK
- ✅ **Agent Teams** — Multi-Agent collaboration and team configuration reading
- ✅ **Workspace management** — Workspace isolation, MCP Server configuration, Skills management, Snapshot/Fork
- ✅ **Permission system** — Tool permission checks, user confirmation, ExitPlanMode, AskUser
- ✅ **Automatic updates** — Electron Updater integration
- ✅ **Proxy support** — System proxy detection and configuration
- ✅ **Document parsing** — PDF, Office, and text extraction
- ✅ **Multimodal support** — Images and document attachments
- ✅ **Quick task window** — Global shortcut for quickly creating Agent sessions
- ✅ **Tab system** — Parallel sessions, drag reordering, preview panels
- ✅ **Left Sidebar project files panel** — Recent files when collapsed; full file tree + drag upload when expanded
- ✅ **Zotero integration** — Library reading, citation injection, PDF reading

<a id="架构亮点"></a>

### Architecture highlights

- **Concurrency guard** — Prevents conflicting parallel requests within a session
- **Global listeners** — Agent IPC listeners never unmount, preserving background sessions
- **Permission queue** — Requests isolated by sessionId, supporting parallel sessions
- **File watching** — Live workspace file, MCP configuration, and Skills monitoring
- **Event-stream processing** — Streaming conversion and accumulation of SDK messages
- **Error mapping** — Consistent conversion of SDK errors into application errors

---

<a id="本地文件存储asci"></a>

## Local file storage (`~/.asci/`)

All data lives in the user directory: **JSON for configuration, JSONL for append-only logs, SQLite (`asci.db`) for the object-model layer (Paper / Note / EvidenceRef, etc.)**, with portable files. See [ADR-001](./docs/adr/ADR-001-local-storage.md) for object-layer selection.

> Development mode (unpackaged / `ASCI_DEV=1`) uses `~/.asci-dev/`, isolated from production `~/.asci/`. Source of truth: `apps/electron/src/main/lib/config-paths.ts`.

```
~/.asci/
├── channels.json                # Channels (API keys encrypted with safeStorage AES-256-GCM)
├── settings.json                # Settings (Agent, notifications, tabs, shortcut overrides, telemetry consent)
├── user-profile.json            # User profile
├── proxy-settings.json          # Proxy configuration
├── memory.json                  # Memory configuration
├── chat-tools.json              # Chat tool configuration
├── mcp.json                     # Global MCP Server configuration
├── wechat.json / wechat-sync.json          # WeChat integration + long-poll cursor
├── dingtalk.json                # DingTalk integration
├── feishu.json / feishu-bindings.json      # Feishu integration + chat bindings (per-bot feishu-bindings-{botId}.json)
├── zotero-article.json          # Zotero paragraph-summary enhancement
├── zotero-embedding.json        # Zotero semantic search (vector index)
│
├── agent-sessions.json          # Agent session index
├── agent-sessions/{uuid}.jsonl  # One JSONL per session (messages)
├── agent-workspaces.json        # Agent workspace index
├── conversations.json           # Conversation index (legacy)
├── conversations/{id}.jsonl     # Conversation messages (legacy)
│
├── agent-sessions-papers/{sessionId}.jsonl        # Paper search records (per session)
├── agent-sessions-diagnostics/{sessionId}.jsonl   # Session diagnostics (+ {sessionId}.stderr.log SDK subprocess stderr)
├── feedback/{sessionId}.jsonl   # Assistant 👍/👎 feedback
├── crash-logs/crash.jsonl       # Process/renderer crash logs
├── attachments/{conversationId}/{uuid}.ext   # Message attachments
│
├── agent-workspaces/            # Agent workspaces (slug-isolated)
│   ├── {slug}/
│   │   ├── {sessionId}/         # Session cwd (includes ASCI identity CLAUDE.md)
│   │   ├── workspace-files/     # Shared files (papers/ downloaded PDFs, paper-notes/ long notes)
│   │   ├── mcp.json             # MCP Server configuration
│   │   ├── skills/              # Enabled Skills
│   │   ├── skills-inactive/     # Disabled Skills (not scanned by SDK)
│   │   └── papers.jsonl         # Workspace paper index
│   └── _no-workspace/{sessionId}/   # Fallback sandbox without a workspace
│
├── default-skills/              # Built-in Skill templates (copied for new workspaces)
├── capability-packs/{packId}/manifest.json   # User-installed packs
│
├── asci.db                      # Research-object SQLite (WAL; back up .db-wal/.db-shm too; formerly objects.db, migrated on startup)
├── reviews/{id}.html            # Review body (DB metadata only; legacy .md compatible)
│
├── zotero/                      # Zotero integration runtime data
│   ├── zotero-pdf-snapshot.json # Passive PDF diff snapshot
│   ├── wiki/{attachmentKey}.md  # Parsed PDF markdown (+ enhanced .article.md, structured .txt)
│   ├── wiki/index.json          # Literature index
│   └── vector-index.db          # Vector index (sqlite-vec + FTS5, rebuildable cache)
│
├── cache/                       # Rebuildable caches
│   ├── pycache/                 # paper-search MCP Python bytecode
│   ├── asr-weights/ / asr/      # ASR model weights + recognition cache
│   └── ocr/                     # OCR recognition cache
├── citation-graph-cache/        # Citation graph cache
├── models/                      # Local inference model weights (embedding, etc.; downloaded at runtime)
│
├── telemetry/                   # Telemetry (ADR-011): anonymous device-id.json + events/signals JSONL buffers
└── sdk-config/projects/         # Isolated Agent SDK project configuration (CLAUDE_CONFIG_DIR)
```

Key design: Workspaces isolated by slug, separate directory per session; workspace-managed MCP and Skills. `cache/` and `zotero/vector-index.db` are rebuildable caches; delete and rebuild if corrupt.

---

<a id="深入阅读"></a>

## Further reading

- [CLAUDE.md](./CLAUDE.md) — Agent development instructions and hard constraints
- [docs/architecture.md](./docs/architecture.md) — IPC communication, service layer, Providers, state, components
- [docs/build-and-packaging.md](./docs/build-and-packaging.md) — Build, packaging, SDK external rules
- [docs/agent-sdk-integration.md](./docs/agent-sdk-integration.md) — Agent SDK integration architecture and flows
- [docs/history/sdk-upgrade-notes.md](./docs/history/sdk-upgrade-notes.md) — SDK version upgrade history
- [docs/specs/](./docs/specs) — Design specs + implementation plans (tracked in git with PRs)
- [docs/adr/](./docs/adr) — Architecture decision records (from ADR-000)

<a id="设计参照"></a>

## Design references

- Claude Agent SDK：[TypeScript v1](https://platform.claude.com/docs/en/agent-sdk/typescript) / [v2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [craft-agents-oss](https://github.com/craftship/craft-agents-oss) — Session management / permission modes / MCP integration / `~/.craft-agent/` configuration-location pattern

---

> Last updated: 2026-06-30 11:30
