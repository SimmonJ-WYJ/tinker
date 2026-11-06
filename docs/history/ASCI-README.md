# ASCI

**Agent-based Scientific Collaboration Interface** —— 面向科研用户的深度 Agent 桌面应用。

基于 Claude Agent SDK 构建，支持多 Agent 协同（Agent Teams）、MCP 生态、Skill 体系与科研工作流。

- 仓库：https://github.com/OPENSCI-Labs/ASCI-Alpha
- 贡献指南：请先阅读 [`CLAUDE.md`](./CLAUDE.md)

---

## 快速开始

> 贡献 / 运行本仓库 agent 协作流程需 **Claude Code CLI v2.1.152+**（`claude --version` 查看；低于此版本先 `claude update` / 重装升级）。

```bash
bun install
bun run dev                      # Vite + Electron + 热重载（默认含登录，停在真实登录页）
bun run dev:skip-login           # 同上但跳过登录，直接进主界面（快速本地开发）
```

> 登录默认开启：`bun run dev` 与所有打包产物（`dist:*`）都包含登录、停在真实登录页；
> 仅 `bun run dev:skip-login`（注入 `ASCI_SKIP_LOGIN=1`）本地跳过登录。

## 构建与打包

```bash
bun run electron:build           # 渲染 + 主进程打包
bun run electron:start           # 构建并启动（冒烟测试）

cd apps/electron
bun run dist:mac                 # macOS 安装包
bun run dist:win                 # Windows 安装包
bun run dist:linux               # Linux 安装包
bun run dist:fast                # 当前架构快速打包（调试用）
```

### Electron 子脚本（`apps/electron/`）

```bash
bun run build:main               # esbuild → dist/main.cjs
bun run build:preload            # esbuild → dist/preload.cjs
bun run build:renderer           # Vite → dist/renderer/
bun run build:resources          # 复制 resources/ 到 dist/
bun run generate:icons           # 生成应用图标
```

## 开发工具命令

```bash
bun run typecheck                # 所有包类型检查
cd packages/core && bun run typecheck   # 单包类型检查
bun test                         # Bun 原生测试运行器
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun 1.2.5+ |
| 语言 | TypeScript 5+（严格模式，ESNext） |
| 桌面框架 | Electron 39 |
| 前端 | React 18 + Vite 6 + Tailwind CSS + Radix UI |
| 状态管理 | Jotai |
| 日期时间 | dayjs（统一入口，详见 [`docs/date-time.md`](./docs/date-time.md)） |
| Agent SDK | `@anthropic-ai/claude-agent-sdk` |
| 构建 | esbuild + Vite |
| 分发 | electron-builder |

具体版本以各 `package.json` 为准。

---

## Monorepo 结构

Bun workspaces，`@asci/*` 作用域，内部引用用 `workspace:*`。

```
ASCI-Alpha/
├── packages/
│   ├── shared/   # 共享类型、IPC 通道常量、utils（零运行时依赖）
│   ├── core/     # Provider 适配器、Shiki 高亮、Zotero 客户端
│   └── ui/       # 共享 React 组件（CodeBlock、MermaidBlock...）
└── apps/
    └── electron/ # 桌面应用主体（main / preload / renderer）
```

### 各包职责

- **`@asci/shared`** — 导出 `./types` / `./config` / `./utils`；核心类型包含 `AgentMessage`、`Channel`、`PermissionRequest`、`FileAttachment`、`LLMMessage`、`ModelOption`。
- **`@asci/core`** — 导出 `./providers` / `./highlight` / `./types` / `./utils` / `./zotero`；实现 Provider 适配器注册表与代码高亮；依赖 `@asci/shared`、`shiki`。
- **`@asci/ui`** — 共享 React UI 组件库（CodeBlock、MermaidBlock...）；依赖 `@asci/core`、`beautiful-mermaid`、Radix UI；peer 依赖 React 18。
- **`@asci/electron`** — 应用主体，集成以上所有包；关键依赖 `@anthropic-ai/claude-agent-sdk`、TipTap、Tailwind、文件解析（`pdf-parse` / `officeparser` / `word-extractor`）。

---

## 核心特性

### 已实现功能

- ✅ **Anthropic 协议兼容端点** —— 原生 Anthropic、MiniMax 及 Anthropic 兼容的自定义 URL 端点
- ✅ **Agent SDK 集成** —— 基于 Claude Agent SDK 的完整 Agent 模式
- ✅ **Agent Teams** —— 多 Agent 协同、团队配置读取
- ✅ **工作区管理** —— 多工作区隔离、MCP Server 配置、Skills 管理、Snapshot/Fork
- ✅ **权限系统** —— 工具权限检查、用户确认流程、ExitPlanMode、AskUser
- ✅ **自动更新** —— Electron Updater 集成
- ✅ **代理支持** —— 系统代理检测与配置
- ✅ **文档解析** —— PDF、Office、文本文件提取
- ✅ **多模态支持** —— 图片、文档附件
- ✅ **快速任务窗口** —— 全局快捷键触发，快速创建 Agent 会话
- ✅ **标签页系统** —— 多会话并行、拖拽重排、预览面板
- ✅ **左侧 Sidebar 项目文件面板** —— 收起态显示最近文件，展开态完整文件树 + 拖拽上传
- ✅ **Zotero 集成** —— 文献库读取、引用注入、PDF 阅读

### 架构亮点

- **并发守卫** —— 同一会话防止并行请求冲突
- **全局监听** —— Agent IPC 监听器永不销毁，确保后台会话不丢失
- **权限排队** —— 按 sessionId 隔离权限请求，支持多会话并行
- **文件监听** —— 工作区文件、MCP 配置、Skills 实时监控
- **事件流处理** —— SDK 消息流式转换与累积
- **错误映射** —— SDK 错误统一转换为应用错误

---

## 本地文件存储（`~/.asci/`）

所有数据保存在用户目录，**配置走 JSON、追加型日志走 JSONL、对象模型层（Paper / Note / EvidenceRef 等）走 SQLite (`asci.db`)**，文件可移植。对象层选型见 [ADR-001](./docs/adr/ADR-001-local-storage.md)。

> 开发模式（未打包 / `ASCI_DEV=1`）落 `~/.asci-dev/`，与正式版 `~/.asci/` 隔离。真相源为 `apps/electron/src/main/lib/config-paths.ts`。

```
~/.asci/
├── channels.json                # 渠道配置（API Key 经 safeStorage AES-256-GCM 加密）
├── settings.json                # 应用设置（Agent 配置、通知、Tab 状态、快捷键覆盖、遥测 consent）
├── user-profile.json            # 用户档案
├── proxy-settings.json          # 代理配置
├── memory.json                  # 记忆配置
├── chat-tools.json              # Chat 工具配置
├── mcp.json                     # 全局 MCP Server 配置
├── wechat.json / wechat-sync.json          # 微信集成配置 + 长轮询游标
├── dingtalk.json                # 钉钉集成配置
├── feishu.json / feishu-bindings.json      # 飞书集成配置 + 聊天绑定（按 bot 落 feishu-bindings-{botId}.json）
├── zotero-article.json          # Zotero 段落总结增强配置
├── zotero-embedding.json        # Zotero 语义检索（向量索引）配置
│
├── agent-sessions.json          # Agent 会话索引
├── agent-sessions/{uuid}.jsonl  # 每会话一个 JSONL（消息）
├── agent-workspaces.json        # Agent 工作区索引
├── conversations.json           # 对话索引（legacy）
├── conversations/{id}.jsonl     # 对话消息（legacy）
│
├── agent-sessions-papers/{sessionId}.jsonl        # 论文检索记录（按会话）
├── agent-sessions-diagnostics/{sessionId}.jsonl   # 会话诊断事件（+ {sessionId}.stderr.log SDK 子进程 stderr）
├── feedback/{sessionId}.jsonl   # 助手输出 👍/👎 反馈采集
├── crash-logs/crash.jsonl       # 进程/渲染崩溃日志
├── attachments/{conversationId}/{uuid}.ext   # 消息附件
│
├── agent-workspaces/            # Agent 工作区（按 slug 隔离）
│   ├── {slug}/
│   │   ├── {sessionId}/         # 会话工作目录（cwd；含 ASCI 身份 CLAUDE.md）
│   │   ├── workspace-files/     # 工作区共享文件（含 papers/ 下载 PDF、paper-notes/ 长笔记）
│   │   ├── mcp.json             # MCP Server 配置
│   │   ├── skills/              # 启用的 Skills
│   │   ├── skills-inactive/     # 禁用的 Skills（SDK 不扫描）
│   │   └── papers.jsonl         # 工作区论文索引
│   └── _no-workspace/{sessionId}/   # 未绑定工作区时的兜底沙箱
│
├── default-skills/              # 内置默认 Skills 模板（新建工作区时复制）
├── capability-packs/{packId}/manifest.json   # 用户安装的能力包
│
├── asci.db                      # 科研对象 SQLite（WAL；备份需同时带 .db-wal/.db-shm；历史名 objects.db，启动自动迁移）
├── reviews/{id}.html            # Review 正文（DB 行只存元数据；旧数据兼容 .md）
│
├── zotero/                      # Zotero 集成运行时数据
│   ├── zotero-pdf-snapshot.json # PDF 被动 diff 快照
│   ├── wiki/{attachmentKey}.md  # PDF 解析 markdown（+ .article.md 增强、.txt 结构化）
│   ├── wiki/index.json          # 文献索引
│   └── vector-index.db          # 向量索引（sqlite-vec + FTS5，可重建缓存）
│
├── cache/                       # 可重建缓存
│   ├── pycache/                 # paper-search MCP Python 字节码缓存
│   ├── asr-weights/ / asr/      # ASR 模型权重 + 识别结果缓存
│   └── ocr/                     # OCR 识别结果缓存
├── citation-graph-cache/        # 引用图谱缓存
├── models/                      # 本地推理模型权重（嵌入模型等，运行时下载）
│
├── telemetry/                   # 遥测（ADR-011）：匿名 device-id.json + events/signals JSONL 缓冲
└── sdk-config/projects/         # Agent SDK 隔离项目配置（CLAUDE_CONFIG_DIR）
```

关键设计：工作区按 slug 隔离，每会话独立目录；MCP 和 Skills 按工作区管理。`cache/` 与 `zotero/vector-index.db` 为可重建缓存，损坏可直接删除重建。

---

## 深入阅读

- [CLAUDE.md](./CLAUDE.md) —— Agent 开发指令与硬约束
- [docs/architecture.md](./docs/architecture.md) —— IPC 通信、服务层、Provider、状态、组件
- [docs/build-and-packaging.md](./docs/build-and-packaging.md) —— 构建、打包、SDK external 规则
- [docs/agent-sdk-integration.md](./docs/agent-sdk-integration.md) —— Agent SDK 集成架构与流程
- [docs/history/sdk-upgrade-notes.md](./docs/history/sdk-upgrade-notes.md) —— SDK 版本升级历史
- [docs/specs/](./docs/specs) —— 设计规格 + 实现计划（tracked，随 PR 进 git）
- [docs/adr/](./docs/adr) —— 架构决策记录（ADR-000 起）

## 设计参照

- Claude Agent SDK：[TypeScript v1](https://platform.claude.com/docs/en/agent-sdk/typescript) / [v2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [craft-agents-oss](https://github.com/craftship/craft-agents-oss) —— 会话管理 / 权限模式 / MCP 集成 / `~/.craft-agent/` 配置位置模式

---

> 最后更新：2026-06-30 11:30
