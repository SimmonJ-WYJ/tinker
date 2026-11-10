# Agent SDK 集成架构

当前 Tinker 生产应用继续使用 Electron + React/TypeScript 与 `@anthropic-ai/claude-agent-sdk`。Rust/Tauri 位于隔离实验路径，没有替换当前生产入口、会话数据或模型执行器。本文记录科研退役后的运行边界；旧调查与科研设计归档在[历史 SDK 记录](./history/ASCI-agent-sdk-integration.md)，不再作为恢复旧功能的要求。

## 核心调用链

```text
用户输入 → agent-orchestrator.ts
  → selectRuntimePolicy（conversation / general / coding）
  → 通用动态上下文、可用工具与自建能力包
  → SubagentRegistry.snapshot
  → runOrchestratorQuery → ClaudeAgentAdapter → SDK query
  → convertSDKMessage → AgentEvent → IPC
  → useGlobalAgentListeners → Jotai → React UI
```

`runOrchestratorQuery` 是 SDK query 装配入口。主编排保留并发守卫、渠道选择、消息持久化、图片请求授权、权限与 AskUser、流式转换、取消、错误和恢复逻辑。科研关键词、旧 research profile 与 sticky 科研状态不再把任务切入专属科研执行链。

| 位置 | 当前职责 |
|---|---|
| `agent-orchestrator.ts` | 构造本轮 options 与生命周期，保留通用模型、图像、文件和项目能力 |
| `agent-prompt-builder.ts` | 通用角色、工具/文件规则、工作区、可用 Agent、语言与权限指令；`buildBuiltinAgents` 目前返回空字典 |
| `capability-pack-loader.ts` / `capability-pack-service.ts` | 自建能力包的加载、模型/prompt/MCP 引用与只读列表；没有 toggle/import/uninstall；跳过保留的三个退役内置 packId |
| `subagent-registry.ts` / `subagent-registry-seed.ts` | Registry 来源与优先级；不能把空 builtin seed 描述为仍有科研小队 |
| `run-orchestrator-query.ts` | Registry 快照覆盖 options.agents，追加通用 spans 与自建 pack 完成 hooks，保留既有其他 hooks |
| `agent-orchestrator-mcp.ts` / `mcp/builtin-mcp-resolver.ts` | 可用 Python、PDF、独立 OCR/ASR 与用户自建 MCP；图片/网页/项目工具另按运行 profile 装配 |
| `agent-permission-service.ts` / `agent-ask-user-service.ts` | 权限与用户输入等待，不能因科研清理而放开其他敏感工具 |
| `agent-session-manager.ts` | 既有元数据与 SDK JSONL 读写兼容 |

内置 `lit-search`、`lit-review`、`research-gap` 的分发、自动 seed 和注册已退役。专属论文检索/Zotero/综述/研究空白/searchplan MCP、科研 hook、session papers watcher 和科研后台启动已断开。保留旧源码、schema 与 renderer 是为历史读取/导出，不表示它们仍接入生产新任务。可迁移与遗留清单见[本轮报告](./reports/2026-11-10-research-retirement.md)。

## Agent、MCP 和技能边界

自建 Agent 经 Registry 及 SDK `options.agents` 注入，MCP 经显式 `mcpServers` 传入。原始命名、模型与通用 hook 保留，显式 tools 列表不会清空已选择的 Agent。既有 `pack.taskCompleted` / span 写入仍用于通用扩展。

生产编排已停止调用 `emitFilesystemAgents`、`emitMcpConfigFile` 和 `markClaudeProjectTrusted`。不得为兼容旧派活而自动清空 `.claude/agents`、覆盖 `.mcp.json`、复制密钥或修改 Claude trust。SDK 类型声明支持 programmatic agents；本轮模拟宿主测试能证明 wrapper/adapter 转发，**未验证原生 CLI 派活**，不能把旧历史调查或类型声明当原生验收结果。

普通任务保留 `settingSources: ['project']`，简单 conversation 使用空 sources。这样保留项目 CLAUDE/settings 与用户现有配置；没有新增 user/global sources。无法安全判定归属的旧 `.claude/agents`、`.mcp.json` 和用户指令不改动，仍可能被 SDK 自行发现。`strictMcpConfig` 不是本轮使用的发现隔离开关。

技能 seed/copy/upgrade 跳过退役内置资源，不自动删除已安装副本。运行时仅以精确发布布局和指纹排除已知退役副本，未知/修改内容按用户资源保留。识别先有界检查元数据，只有精确已知布局才有限读取正文，不扫描用户附件。每轮创建本次自有临时 plugin，使用与显式 Skill 提及相同的 `asci-workspace-${workspaceSlug}` 命名空间。

临时目录同时由主编排、SDK 迭代器和已开始后台任务持有租约。正常主输出结束不抢删子任务资源；支持的 SDK `close()` 终止查询后才释放它所属的任务 pin。最多 64 个活跃投影，不能靠淘汰活跃目录来释放容量。异常/停止/重复停止均需回归测试，原生进程树实际生命周期仍待专项验收。

## 输出语言与上下文

内置静态 prompt 使用英文。`detectOutputLanguage` 根据当前用户消息、缓存及 UI 语言解析本轮输出语言，主 prompt 与子 Agent 的语言 directive 延续现有策略。用户可见自然语言值跟随解析语言，工具名/代码/JSON keys/路径/源引文保留其协议或原文。工具/Skill/子 Agent 返回的语言不能自行切换本轮回复语言。

工作区上下文保留文件、待办、计划与项目指令规则，移除强制论文语料索引和科研路由。用户自建 prompt/Skill 语言由用户决定，UI 的 `nameI18n` 不改变技能协议名。语言 directive 是源码策略，本轮未运行真实模型服从度测试。

## 流式状态与权限

- `convertSDKMessage` / tool matching 将 SDK 消息转为统一 `AgentEvent`。
- `applyAgentEvent` 更新增量状态，`useGlobalAgentListeners` 顶层监听不随页面切换销毁。
- 权限、AskUser 按 sessionId 入队，已有取消、等待、图片续作范围与敏感操作边界保持。
- `SubagentStart/Stop` spans 由 sink 防抖持久化，cleanup flush；不是科研采集器。
- 历史 JSONL、对象 schema、图片版本和导出保持兼容，不破坏性迁移用户数据。

## SDK 环境和打包红线

`buildSdkEnv()` 显式构造完整环境，不依赖 SDK 不同版本对 options.env 的叠加/替换默认语义：

1. 继承前过滤 ambient `ANTHROPIC_*`。
2. 写入本应用管理的 SDK env。
3. 对剩余未管理的 `ANTHROPIC_*` 显式置空。

新增 SDK 可识别变量必须显式管理，不能误继承或被末尾循环抹掉。SDK external/native binary 与打包规则见[构建文档](./build-and-packaging.md)，旧版本环境语义见[升级记录](./history/sdk-upgrade-notes.md)。科研资源退役不改变 SDK external、OAuth、app identifier 或 `.asci` 数据路径。

## 验证边界与参考

自动化使用合成目录、伪 Electron、真实 IPC/query wrapper/adapter 和模拟 SDK。不读取真实会话/凭据或调用付费模型。准确计数与逐批回滚见[执行记录](./reports/2026-11-10-research-retirement.md)。原生 SDK 子 Agent/技能发现、GUI、实际 OCR/ASR/Python 及线上模型未据此验收。

- [架构参考](./architecture.md)
- [项目规则](../CLAUDE.md)
- [Agent SDK TypeScript 官方入口](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [历史 SDK 调查](./history/ASCI-agent-sdk-integration.md)
