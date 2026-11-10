# 架构参考

Tinker 渲染进程 / 主进程 / Provider / 状态层的技术参考。仅记录"源码难以一眼看出"的横切关系与约定；
每个文件具体实现以源码头部中文注释为准。

2026-11-10 科研退役将科研运行接线与历史兼容区分开。本文保留旧模块位置以便读取历史数据，不能据此重新启动科研服务。批次与验证边界见[退役报告](./reports/2026-11-10-research-retirement.md)。

---

## IPC 通信模式（最重要的架构模式）

一条 IPC 通道需要在 **四处** 同步修改：

1. **类型 & 常量** —— `packages/shared/src/...` 定义通道名常量与请求/响应类型
2. **主进程处理** —— `apps/electron/src/main/ipc.ts` 通过 `ipcMain.handle()` 注册，调用 `main/lib/` 服务
3. **Preload 桥接** —— `apps/electron/src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld` 暴露类型安全 API
4. **渲染进程** —— 通过 `window.electronAPI.*` 调用，Jotai atoms 中封装

### 主要通道组

- `IPC_CHANNELS` —— 基础通道（运行时、Git、环境）
- `CHANNEL_IPC_CHANNELS` —— 渠道管理
- `AGENT_IPC_CHANNELS` —— Agent 功能
- `CAPABILITY_PACK_IPC_CHANNELS` —— 能力包只读列表（详见 [`agent-sdk-integration.md`](./agent-sdk-integration.md#agentmcp-和技能边界)）
- `ATTACHMENT_IPC_CHANNELS` —— 附件管理（保存/读取/另存/删除/文件对话框/文本提取）
- `ENVIRONMENT_IPC_CHANNELS` —— 环境检查
- `PROXY_IPC_CHANNELS` —— 代理设置
- `GITHUB_RELEASE_IPC_CHANNELS` —— GitHub 发布

---

## 共享常量（`packages/shared/src/constants/`）

跨文件 / 跨包重复的字面量统一收口到 shared，经 `packages/shared/src/index.ts` re-export，消费方一律 `import { X } from '@asci/shared'`。

### 位置决策树

| 类别 | 位置 |
|------|------|
| 安全 / 权限规则、跨域契约值（端口、模型 ID、URL、UI 策略值） | `packages/shared/src/constants/` |
| 应用级配置（APP_NAME 等） | `packages/shared/src/config/` |
| IPC 通道常量 | `packages/shared/src/types/`（**与请求/响应类型同文件**，不挪进 constants/） |
| Telemetry 事件 / 通道 | `packages/shared/src/telemetry/` |

### 提取判据

- ✅ 同语义、≥2 文件重复（如 Zotero 端口 23119 曾散落 7 处）
- ✅ 跨包 / 跨进程契约值（如默认 Claude 模型 ID：main + core provider profiles 共用）
- ❌ 偶然相等的数字（各处 300ms 防抖语义独立，不收）
- ❌ 具名单用本地常量（papers-rg limits、scrypt 参数、窗口尺寸等，原地即可）

### 文件清单

| 文件 | 内容 |
|------|------|
| `github-repo.ts` | GitHub 仓库标识、Releases URL |
| `permission-rules.ts` / `hard-permission-rules.ts` | 工具 / 命令安全分级与硬规则 |
| `zotero.ts` | Zotero connector 端口 23119、本地 API / connector 基址、ping 超时（含拼接守门测试） |
| `models.ts` | 默认 Claude 模型 ID（默认会话模型 + channel 探测模型共用） |
| `ui.ts` | 渲染层 UI 策略值：复制反馈时长、作者列表截断数 |

风格：SCREAMING_SNAKE_CASE 具名导出 + 中文头注释说明来源；含逻辑 / 模板拼接时配同目录 `*.test.ts`。

---

## 主进程服务层（`apps/electron/src/main/lib/`）

### Agent 核心

| 服务 | 职责 |
|------|------|
| `agent-orchestrator.ts` | Agent 核心编排：并发守卫、渠道查找、环境变量构建、SDK 路径解析、消息持久化、事件流处理、错误处理、首轮自动命名、子 Agent 装配（可用自建能力包与 Registry，经 `runOrchestratorQuery` 注入 SDK `options.agents`） |
| `agent-session-manager.ts` | 会话管理：SDK 消息持久化、会话元数据 CRUD、JSONL 存储 |
| `agent-prompt-builder.ts` | 通用系统提示词、工作区上下文与已注册 Agent 清单；内置科研小队不再提供，科研路由已退役；保留权限、文件、PDF 与输出语言策略 |
| `agent-permission-service.ts` | 工具权限检查、权限模式管理 |
| `agent-ask-user-service.ts` | AskUser 请求处理 |
| `agent-exit-plan-service.ts` | ExitPlan 服务 |
| `agent-workspace-manager.ts` | 工作区管理：MCP Server 配置、Skills 配置、工作区 CRUD |
| `agent-team-reader.ts` | 团队配置读取 |
| `channel-manager.ts` | 渠道 CRUD、API Key AES-256-GCM 加密（safeStorage）、连接测试、模型获取 |

### Agent SDK 子 Agent 装配（A0）

详见 [`agent-sdk-integration.md` — Orchestrator + 子 Agent](./agent-sdk-integration.md#agentmcp-和技能边界)。

| 服务 | 职责 |
|------|------|
| `subagent-registry.ts` | `SubagentRegistry` 接口 + in-memory 实现；三类来源（`builtin` / `user-config` / `capability-pack`）按优先级管理命名空间；`snapshot()` 产出 SDK `options.agents` 字典 |
| `subagent-registry-seed.ts` | 把 `buildBuiltinAgents` 展开为 builtin RegistryEntry —— builtin / pack 走同一 Registry 路径 |
| `run-orchestrator-query.ts` | **唯一** SDK query entrypoint（A0 ①）；`assembleQueryOptions()` 注入 `options.agents` + 通用 SubagentStart/Stop / pack.taskCompleted hooks，科研 hooks 不再装配 |
| `capability-pack-loader.ts` | 加载自建能力包、校验与展开模板并注册到 Registry；跳过三个退役内置 packId，不删除已安装目录 |
| `capability-pack-service.ts` | 只读 `listCapabilityPacks`，没有 toggle/import/uninstall；列表不展示三个退役内置 packId |
| `subagent-spans-hook.ts` | SubagentStart/Stop FIFO 配对成 `SubagentSpan` |
| `agent-orchestrator-spans-sink.ts` | 500ms debounce + 批量落 `AgentSessionMeta.subagentSpans`，cleanup 路径 `flush()` 兜底 |
| `emit-filesystem-agents.ts` / `emit-mcp-config.ts` / `mark-claude-project-trusted.ts` | 旧兼容实现保留，生产编排已停止调用；不自动覆盖用户 agents/MCP 文件或修改 trust |
| `runtime-skill-projection.ts` | 本次自有技能 plugin 投影及 SDK/后台任务租约，不修改用户源目录；未知/修改技能保留 |
| `pack-task-completed-hook.ts` | SubagentStop 命中 capability-pack 时 emit `pack.taskCompleted` |
| `paper-meta-cap-hook.ts` 等科研 hook | 保留的旧源码，不再接入当前 query |

### 工具与文件

| 服务 | 职责 |
|------|------|
| `workspace-watcher.ts` | 工作区文件监听：MCP 配置 / Skills / 附件目录的文件系统变化 |
| `attachment-service.ts` | 附件存储/读取/删除、文件对话框 |
| `document-parser.ts` | PDF / Office / 文本文件提取 |
| `file-preview-service.ts` | 文件预览服务 |

### 系统服务

| 服务 | 职责 |
|------|------|
| `runtime-init.ts` | 运行时初始化：Shell 环境、Bun、Git 检测（`bun-finder.ts`、`git-detector.ts`、`shell-env.ts`） |
| `config-paths.ts` | 配置路径管理：`~/.asci/` 目录结构 |
| `user-profile-service.ts` | 用户档案持久化 |
| `settings-service.ts` | 应用设置持久化（Agent 配置、通知、Tab 状态、快捷键覆盖等） |
| `updater/` | Electron Updater 集成 |
| `global-shortcut-service.ts` | 全局快捷键注册 |
| `quick-task-window.ts` | 快速任务窗口管理 |

### Zotero 历史兼容（九项主动科研命令已退役）

| 模块 | 职责 |
|------|------|
| `zotero-library.ts` | 旧数据读取兼容，不在启动时自动同步 |
| `zotero-integration.ts` | 旧集成源码保留，九项 Zotero 入队/配置/重建等主动命令已封堵 |
| `zotero-context-block.ts` | Zotero 上下文块构建 |
| `zotero-client/` | Zotero MCP 客户端 |

通用 OCR/ASR/PDF/Python 不随 Zotero 退役。OCR/ASR 使用既有独立设置字段，在 MCP 设置中管理，ASR 默认关闭且不在挂载时下载。历史状态/读取与缓存/权重管理保持，九项 Zotero 科研重建/入队/自动下载等入口明确不可用。其他论文/图谱写入与历史页面由后续只读兼容批次逐项收口，不将 Zotero 边界泛化为全仓写入已封堵。

---

## AI Provider 适配器（`packages/core/src/providers/`）

两层解耦：**Adapter（协议级）** + **Profile（配置级）**。新增 provider 只需扩 `ProviderType` 联合（`@asci/shared`）+ `adapterRegistry` / `profileRegistry` 各加一行，调用层（channel-manager、agent-orchestrator、ChannelForm）零代码改动。

### Adapter — 协议级

- **接口**（`types.ts`）—— `ProviderAdapter` 定义 `buildStreamRequest()` + `parseSSELine()`，承担 HTTP 请求构建 + SSE 解析
- **注册表**（`index.ts:adapterRegistry`）—— 按 `ProviderType` 查找；当前 6 个 provider 全部映射到同一个 `AnthropicAdapter`（都走 Anthropic Messages API / "Anthropic Skin"）
- **SSE 读取器**（`sse-reader.ts`）—— 通用 fetch + ReadableStream
- **URL 工具**（`url-utils.ts`）—— `normalizeAnthropicBaseUrl` 等

### Profile — 配置级

承担"6 个 provider 之间的端点级差异"，独立于协议：

- **契约**（`profile.ts`）—— `ProviderProfile` 接口：`defaultProbeModel` / `extraHeaders` / `validateEndpoint?` / `formatAuthError?` / `defaultCapabilities` / `fetchModels` + `FetchFn` 依赖注入类型
- **注册表**（`profile-registry.ts:profileRegistry`）—— 按 `ProviderType` 查找 profile；`getProfile(provider)` 单 entrypoint
- **6 个 profile**（`profiles/<provider>-profile.ts`）—— 每个 provider 一个数据驱动 profile：
  - **anthropic** / **openrouter**：远程拉模型清单（profile 内部用注入的 `fetchFn`）
  - **minimax** / **kimi** / **moonshot** / **deepseek**：静态清单
  - **moonshot**：`validateEndpoint` 拦截 OpenAI 端点（`/v1`）+ 返回 i18n key
  - **kimi**：`formatAuthError` 对 `/coding` 401 返回 `{baseMessageKey, detailSnippet?}`，由调用方走 `t()` 拼装
  - **openrouter**：`extraHeaders` 注入 ranking header（`HTTP-Referer` / `X-Title`），`defaultProbeModel` 返回 namespaced 模型
- **Capabilities**（`capabilities.ts`）—— `getDefaultCapabilities(provider)` / `getEffectiveCapabilities(channel)` 读 profile，取代了原 `@asci/shared/utils/channel-capabilities.ts` 的 switch

### 调用层入口（统一收口）

- **`apps/electron/src/main/lib/channel-manager.ts`** —— `fetchModels` / `testProviderConnection` / `testAnthropicCompat` 全部走 `getProfile()`，无任何 `switch (provider)` 分支
- **`apps/electron/src/main/lib/agent-orchestrator.ts`** —— `getEffectiveCapabilities(channel)` from `@asci/core`
- **`apps/electron/src/renderer/components/settings/ChannelForm.tsx`** —— `getDefaultCapabilities(provider)` from `@asci/core`

### Profile 与 i18n 解耦

Profile 在 `@asci/core`，不依赖 Electron 主进程 i18n。涉及文案的字段（`validateEndpoint.messageKey` / `formatAuthError.{baseMessageKey, detailSnippet?}`）返回 i18n key 与已截断的 detail snippet，由 channel-manager 走 `t()` 拼装最终文案。

### 多模态支持

- **图片** —— Anthropic 格式 `{ type: 'image', source: { type: 'base64', media_type, data } }`
- **文档** —— 提取文本后注入 `<file>` XML 标签

---

## Jotai 状态管理（`apps/electron/src/renderer/atoms/`）

| Atom 文件 | 管理的状态 |
|-----------|-----------|
| `agent-atoms.ts` | Agent 会话列表、当前会话、流式状态（`AgentStreamState`）、工作区选择、渠道选择、权限/AskUser 请求队列（按 sessionId Map） |
| `channels-atoms.ts` | 全局渠道列表缓存、渠道加载完成标志、思考块展开偏好 |
| `active-view.ts` | 主面板视图切换（'conversations' / 'library'） |
| `settings-tab.ts` | 设置面板当前标签页 |
| `tab-atoms.ts` | 多标签页状态：tabs、activeTabId、流式指示、小地图缓存（仅 Agent tab） |
| `user-profile.ts` | 用户档案（姓名 + 头像） |
| `updater.ts` | 自动更新状态（检查/下载/安装），优雅降级（updater 不可用时保持 idle） |
| `library-atoms.ts` | 旧文献库兼容状态 |
| `zotero-atoms.ts` | 旧 Zotero 状态兼容，不表示仍开放新工作流 |
| `side-panel-layout.ts` | 侧边栏布局 |
| `search-atoms.ts` | 搜索状态 |
| `draft-session-atoms.ts` | 草稿会话 |
| `shortcut-atoms.ts` / `notifications.ts` / `proxy-atoms.ts` / `environment.ts` | 快捷键覆盖 / 通知 / 代理 / 环境检查 |

---

## 渲染进程组件架构（`apps/electron/src/renderer/components/`）

- **`app-shell/`** —— 三面板布局（LeftSidebar | MainArea | RightSidePanel）；侧边栏含工作区选择器、Working/置顶区、日期分组会话列表、流式指示器
- **`agent/`** —— Agent 模式；`AgentView`（纯展示 + 交互，IPC 监听已提升到全局）、`AgentHeader`（渠道/模型选择）、`AgentMessages`（消息列表 + 工具活动）、`ToolActivityItem`、`ProjectSwitcher`、`PermissionBanner` / `AskUserBanner`
- **`tabs/`** —— 标签栏系统；`TabBar` / `TabBarItem` / `TabContent` / `TabPreviewPanel`（仅渲染 Agent tab）
- **`common/`** —— 跨模块复用组件；`UserAvatar`、`CopyButton`、`ModelSelector`、`AttachmentPreviewItem`、`format-message-time`
- **`settings/`** —— 设置面板；`GeneralSettings`、`ChannelSettings` / `ChannelForm`、`AgentSettings`、`McpServerForm`、`ProxySettings`、`ShortcutSettings`、`AboutSettings`；含 `primitives/` 可复用表单组件
- **`file-browser/`** —— 工作区文件树浏览
- **`preview/`** —— 文件预览面板（PDF / 图片 / 文本）
- **`library/`** —— 旧文献数据兼容视图
- **`ai-elements/`** —— Markdown / 代码块 / Mermaid / 推理折叠 / 富文本输入
- **`quick-task/`** —— 快速任务窗口（全局快捷键触发）
- **`onboarding/`** / **`welcome/`** —— 新手引导、欢迎页
- **`shortcuts/`** / **`environment/`** —— 快捷键设置、环境检查 UI
- **`ui/`** —— Radix UI 封装组件（现代化设计）

---

## 全局 Hooks（`apps/electron/src/renderer/hooks/`）

| Hook | 职责 |
|------|------|
| `useGlobalAgentListeners` | 全局 Agent IPC 监听器。在 `main.tsx` 顶层挂载，使用 `useStore()` 直接操作 atoms。处理流式事件、完成/错误、标题更新、权限请求、AskUser 请求。**永不随组件卸载销毁** ——确保页面切换（如设置页）时流式输出与权限请求不丢失 |

---

## 渲染进程初始化组件（`apps/electron/src/renderer/main.tsx`）

| 组件 | 职责 |
|------|------|
| `AgentSettingsInitializer` | 加载 Agent 渠道/模型/工作区设置、订阅 MCP / 文件变化事件 |
| `AgentListenersInitializer` | 挂载 `useGlobalAgentListeners`，全局 Agent IPC 监听 |
| `NotificationsInitializer` | 加载桌面通知开关 / 通知音设置 |
| `TabStatePersistenceInitializer` | 启动时恢复标签页，运行时防抖写入 `settings.json` |
| `UpdaterInitializer` | 订阅主进程推送的自动更新状态变化事件 |

---

## 相关资料

- [`build-and-packaging.md`](./build-and-packaging.md) —— 构建与打包细节、Agent SDK external 规则
- [`agent-sdk-integration.md`](./agent-sdk-integration.md) —— Agent SDK 核心流程、Orchestrator 深入
- [`CLAUDE.md`](../CLAUDE.md) —— 顶层硬约束与开发纪律
