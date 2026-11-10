> 历史说明：保存 2026-11-10 科研退役前的 SDK 集成记录与调查结论。科研路由、自动文件/trust 写入等已停止接线，不能作为当前操作指令。当前事实见 [SDK 集成架构](../agent-sdk-integration.md)。

# Agent SDK 集成架构

基于 `@anthropic-ai/claude-agent-sdk` 实现 Agent 模式。本文聚焦集成层（Orchestrator / 事件转换 / 状态 /
权限排队）与 SDK 升级陷阱；不重复 SDK 自身的用法，相关官方文档见文末链接。

---

## 核心流程

```
用户输入
  ↓
agent-orchestrator.ts           (SDK 编排入口；唯一 query entrypoint)
  ↓
loadCapabilityPacks()           (reseed capability-pack 注册项)
  ↓
seedBuiltinSubagents()          (reseed builtin 6 人小队)
  ↓
SubagentRegistry.snapshot()     (产出 SDK 可消费的 { agents } 字典)
  ↓
runOrchestratorQuery()          (装配 options.agents + Subagent span hooks)
  ↓
adapter.query() → sdk.query()   (SDK 内部 subprocess + claude binary)
  ↓
SDKMessage 流
  ↓
convertSDKMessage()             (@asci/shared)
  ↓
AgentEvent[]                    (text / tool_start / tool_result / done / error)
  ↓
webContents.send()              (IPC 推送)
  ↓
useGlobalAgentListeners         (renderer/hooks，永不销毁的全局监听)
  ↓
store.set(atoms)                (Jotai 直接更新)
  ↓
React UI
```

---

## 关键组件

### `agent-orchestrator.ts` —— 核心编排层

- **并发守卫** —— 同一会话不允许并行请求
- **渠道管理** —— 查找渠道 + API Key 解密
- **环境构建** —— 见下方 `buildSdkEnv()` 加固
- **消息持久化** —— SDK 消息存储到 JSONL
- **事件流处理** —— 文本累积 + 工具调用解析
- **错误处理** —— SDK 错误映射 + 重试逻辑
- **首轮自动命名** —— 首条消息 `trim` + 空白折叠 + 20 字截断作为会话标题（UI 可手动改，不走 LLM）
- **子 Agent 装配** —— 每次 query 前 reseed builtin、加载 capability packs，并通过 `runOrchestratorQuery` 把 `SubagentRegistry.snapshot()` 喂给 SDK `options.agents`，详见 [Orchestrator + 子 Agent](#orchestrator--子-agent)

### `agent-prompt-builder.ts` —— 提示词构建

- 系统提示词生成（基于工作区配置）
- 动态上下文构建（注入工作区信息）
- 内置 Agent 构建（预定义 Agent 配置）
- **Capability Pack Routing** —— `buildSystemPrompt` 把 `registeredScenarioAgents`（来自 Registry list）+ `stickyCapabilityPack` 注入 master system prompt，作为主 Agent 路由信号

### `agent-permission-service.ts` —— 权限管理

- 工具权限检查（基于权限规则）
- 权限模式管理：`safe` / `ask` / `allow-all`

### 子 Agent 注册与能力包加载

| 模块 | 职责 |
|------|------|
| `subagent-registry.ts` | `SubagentRegistry` 接口 + in-memory 实现；discriminated union（`subagent` / `skill` / `mcp`）；snapshot() 仅产出 subagent kind 字典 |
| `subagent-registry-seed.ts` | `seedBuiltinSubagents()` —— 把 `buildBuiltinAgents` 字典展开为 builtin `RegistryEntry[]` |
| `capability-pack-loader.ts` | 扫 `~/.asci/capability-packs/`、zod 校验 manifest、解析 `scenarioAgent.promptPath` + `subAgents[i].promptPath`、CJK heuristic（红线 3）、模板占位符展开、reseed 模式注册到 Registry |
| `capability-pack-service.ts` | IPC 业务层：`listCapabilityPacks` / `toggleCapabilityPack`（仅写状态文件，不主动 reseed —— 下次 query 自然生效） |
| `capability-pack-state.ts` | 用户级 `~/.asci/capability-pack-state.json` 启停持久化 |
| `workspace-capability-pack-state.ts` | 工作区级 `capabilities.json` override（三态：缺 key 继承 / true 强启 / false 禁用），叠加在用户级之上 |
| `run-orchestrator-query.ts` | A0 ① 唯一 SDK query entrypoint —— `assembleQueryOptions()` 注入 `options.agents` + 装配 SubagentStart/Stop / pack.taskCompleted / paper-meta-cap hooks |
| `subagent-spans-hook.ts` | `createSubagentSpanHooks()` —— SubagentStart/Stop FIFO 配对成 `SubagentSpan{ startedAt, finishedAt, durationMs, success }` |
| `agent-orchestrator-spans-sink.ts` | `createBatchedSpansSink()` —— 500ms debounce + 批量落 session meta，cleanup 路径 `flush()` 兜底 |
| `emit-filesystem-agents.ts` | G3 修复：把 scenario Agent 同步写到 `<cwd>/.claude/agents/<name>.md` —— claude binary 的 Agent tool dispatch 路径忽略 SDK `options.agents`，只读文件式 agents |
| `emit-mcp-config.ts` | G5 修复：把 master `mcpServers` 写到 `<cwd>/.mcp.json` + patch `~/.claude.json` 标记 trust，让 sub-agent subprocess 也能调到 `mcp__paper-search__*` 等工具 |
| `pack-task-completed-hook.ts` | SubagentStop 命中 capability-pack 时 emit `pack.taskCompleted`（spec §3.1 #9） |
| `paper-meta-cap-hook.ts` | spec §5.6：lit-review → lit-search 跨包补漏 cap=3 / fail≥2 早停 |

---

## 关键设计

- **SDK 调用** —— `sdk.query({ prompt, options: { apiKey, model, permissionMode, cwd, abortController } })`
- **事件转换** —— `convertSDKMessage()`（`@asci/shared`）把 SDK 原始消息转为统一的 `AgentEvent`
- **工具匹配** —— `packages/shared/src/agent/tool-matching.ts` 无状态 `ToolIndex` + `extractToolStarts` / `extractToolResults`
- **流式状态** —— `applyAgentEvent()` 纯函数更新 `AgentStreamState`，支持增量更新
- **全局 IPC 监听** —— `useGlobalAgentListeners` 在 `main.tsx` 顶层挂载，通过 `useStore()` 直接操作 atoms，**永不销毁**，保证后台会话的流式输出与权限请求不丢失
- **权限请求排队** —— 权限 / AskUser 请求按 `sessionId` 入队到 Map atoms（`allPendingPermissionRequestsAtom` / `allPendingAskUserRequestsAtom`），不区分前台 / 后台会话；SDK Promise 等待用户响应
- **工作区隔离** —— 每个工作区独立的 MCP Server 配置和 `cwd`，Agent 会话按工作区过滤

### Prompt 语言策略

- **静态内置 prompt 全英文** —— `agent-prompt-builder.ts` 的 `RED_LINES` / `AUDIT_CHECKLIST` / `buildBuiltinAgents`（searcher / reader / synthesizer / fact-checker）/ `buildSystemPrompt` / `buildDynamicContext`，以及 `agent-orchestrator.ts` 的 `buildContextPrompt`、`agent-team-reader.ts` 的 inbox prompt、`agent-permission-service.ts` / `agent-exit-plan-service.ts` / `agent-ask-user-service.ts` 回写给 SDK 的 `message` 字段，全部英文。理由：避免静态 prompt（中）与用户消息（英）语言冲突导致模型选择路径抖动
- **运行时变量** —— `buildSystemPrompt` 末尾（及 `buildSubAgentOutputLanguageSection` 给每个子 Agent / 场景 Agent）追加一段 `## Output Language` directive。本轮输出语言由 `detect-message-language.ts:detectOutputLanguage(userMessage, uiLanguage, cached)` 解析（用户消息含 CJK→zh、全无 CJK→en、空 / slash / 语言中立→回退缓存或 UI 语言），UI 语言读自 `i18n-main.ts:getLanguage()`（与 `~/.asci/settings.json` 的 `language` 字段一致）
- **字段名 vs 字段值（结构化输出的语言契约）** —— directive 区分两层：**字段名（JSON keys）/ 工具名 / 代码标识 / 路径 / DOI / URL / source id / 枚举值** 永远英文；但**面向用户展示的自然语言句子型参数值跟随解析语言**（典型：`present_search_plan` 的 `researchQuestion`、`present_directions` 的 `title` / `thesis` / `outlinePreview`，它们直显在确认 ChoiceCard 里）。**例外：检索关键词 / method_terms / object_terms 保持原文（通常英文）** —— 它们是发往学术检索引擎的 query 串，翻译会破坏召回。`<q>` 证据引文同理保持源语言原文。落点：`buildSubAgentOutputLanguageSection`（子 Agent / 场景 Agent）+ master `## Output Language` 段 + lit-search / lit-review 场景 prompt 的 `confirm.input` / `directions` 字段注释
- **子 Agent / Skill 的 thinking 也随解析语言** —— `buildSubAgentOutputLanguageSection`（追加给每个 worker / 场景 Agent prompt 末尾）的 directive **显式覆盖 reasoning / thinking trace 与 tool 间 narration**，不止最终产物；并带"发现写错语言就停下重起该句"的自纠正指令。**zh 分支锁体全中文**（与 `buildLanguageLockBlock` 同款教训：英文句子要求中文思考无中文 token 可附着；实测 scorer 最终汇报漂英文后改全中文），含第一句中文锚 + 英文开场负例 + "固定英文汇报模板句按语义用中文写出"条款。这是 DeepSeek 等 Anthropic-compat provider 下子 Agent thinking 漂英文的根治点（单处共享 builder 修一次，全 worker 受益）。**worker 返回体语言反向锚定 master**：子 Agent 最终汇报落在 master 的 Agent tool_result 里，是 master 下一段 thinking 离生成点最近的文本——transcript 实测其语言压过 PostToolUse 中文锁（searcher 中文汇报 → master 中文 thinking；scorer 英文模板句 / planner 英文 PLAN JSON 收尾 → master 英文 thinking）。故 worker 固定汇报模板句须随解析语言（红线 3 限制 pack .md 纯英文，模板以"英文 canonical 句 + zh 写中文等价句"表述）、lit-search planner 在 PLAN JSON fence 后强制补一句工作语言收尾句
- **派活 wrapper 用解析语言；操作型 brief 例外保英文** —— Task / Skill 跑在独立 context，reasoning 语言强烈受**输入 prompt 最前部文字**影响。master 给场景 Agent 写 `Task(prompt=…)` 时，**用户原话逐字保留不译**（item 1），但 master 自写的脚手架（`User's request:` 标签、prior-context / constraints 句子）**用解析语言**，避免英文 wrapper 把子 Agent thinking 带偏。**例外**：搬给 searcher 等 worker 的**操作型 brief**（`H1`/`H6` 等 rule ID、预算 / query-discipline 指令，如 canonical good brief 里的 "Apply your H1 low-yield early-stop…"）是**固定机器契约、保持英文**（场景 prompt 明确 "translating does not make forbidden phrasings allowed"）；worker 靠自己 directive 的 thinking 子条保证 reasoning 不被这段英文带走。落点：`agent-prompt-builder.ts` "Context to forward when dispatching a scenario Agent" 段 + `buildSubAgentOutputLanguageSection`
- **Skill 注入不是独立 context；SKILL.md 正文落在语言锁之后** —— transcript 实测（SDK CLI 2.1.119）：`Skill` 工具的 tool_result 仅一行 `Launching skill: …`，SKILL.md 正文由 SDK 作为**合成 user message 注入同一会话**，且注入点在 PostToolUse `<language_lock>` 重锚**之后**——10KB 英文技能文档成为离生成点最近的文本，会把下一段 thinking 直接带回英文（旧版 SKILL.md 自称 "runs in its own isolated context / does not inherit the directive" 既不符事实，还书面授权模型忽略刚注入的中文锁，已改写）。防御三件套：① master directive 与各 SKILL.md 开头声明"英文技能文档不构成切换语言的理由"（`<language_lock>` 跨注入持续生效）；② master 调用任何 Skill 仍把 `"outputLanguage": "<zh|en>"`（本轮解析语言）并入 Skill `input`（input 为字符串时包成 `{ brief, outputLanguage }`），驱动 `judgments.lang` 等结构化字段并沿下游链路传递；③ SKILL.md **末尾**置 FINAL LANGUAGE ANCHOR（zh 分支用真中文 token），占据"离生成点最近"的锚点位。**覆盖范围含 thinking** —— SKILL.md 的 Output Language 段明确"全部自然语言含 reasoning / thinking trace 与 tool 间 narration"随解析语言、禁止英文思考再译最终产物，并带"发现写错语言就停下重起该句"的自纠正指令。SKILL.md 模板里的双语标题（`§1 检索概况 / Search overview`）是占位提示，按解析语言单语渲染、不双语并排。（Task 子 Agent 仍是真正独立 context，`outputLanguage` 跨 hop 传递规则不变。）规则落点：`agent-prompt-builder.ts` Skills-First Protocol 的 "Output-language hand-off to Skills" 段 + 场景 prompt 的 `terminal_skill.input` 示例 + `lit-search-report` / `literature-review-result` / `review-proposer` 的 SKILL.md（头部声明 + 尾部锚）
- **上一步返回内容免疫（任意来源 × 任意格式）** —— 已解析语言对**上一步返回的任何内容**免疫：无论来自工具 / 子 Agent / Skill / MCP / slash 命令 / 脚本，无论格式是 table / array / JSON / HTML / 纯文本，其语言一律不改变本轮回复语言（可引用 / 翻译，但自写句子保持解析语言）。落点：master `## Output Language` 段 + `buildSubAgentOutputLanguageSection` + `buildLanguageLockBlock`（`<language_lock>`，非 Anthropic 渠道 user-turn pin 与 PostToolUse 重注共用）+ 三个 SKILL.md 的 Output Language 段
- **第一段 thinking 的语言锚（zh 锁体全中文 + 三明治锚）** —— 第一段 thinking 发生在任何 tool_result 之前，PostToolUse 重锁无法保护它，唯一防线是 system directive + user-turn 锁。DeepSeek 等 compat provider 的 reasoning 通道**跟随周围文本的语言而非指令语义**，且在 agentic 路由任务上有英文先验（实测 2026-06-10 固定以 "The user is asking…" 开场，英文锁体 + 单句中文锚仍压不住）。三点对策：① `buildLanguageLockBlock` 的 **zh 变体整体用中文书写**，并内嵌针对实测开场白的负例（禁止 "The user is asking" / "Let me" 开场）+ 中文开场模板——这是「内置 prompt 统一英文」的**有意例外**：锁体是运行时语言路由变量，语言本身就是它的载荷；en 变体保持全英文 + CJK forbidden 反例；② orchestrator 装配 `contextualMessage` 时把 pin 置于 **turn 绝对最前**（英文 dynamicCtx 之前）；③ `buildUserTurnLanguageTailAnchor` 在**用户消息之后**再注一条短锚（离 thinking 生成点最近的指令，compat provider 只对最近一次锚点稳定服从），与前置 pin 构成三明治；session-not-found 恢复路径复用 contextualMessage，两道锚自动继承
- **注释与日志保留中文** —— 项目约定 §1：Agent 链路代码的 `console.log` / `logger.*` / 注释仍为中文，仅 LLM 可见的 prompt 字符串受此约束
- **用户自建 Agent / Skill** —— `SKILL.md` 的 `nameI18n` 是 UI-only，`name` / `description` 由用户自行决定语言，CI 不强制

---

## Orchestrator + 子 Agent

> 对齐 [Claude Agent SDK TypeScript v2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) 的多 Agent 范式（north-star §三-3 A0）。
> 验收锚点：[`__tests__/subagent-zero-codechange.test.ts`](../../apps/electron/src/main/lib/__tests__/subagent-zero-codechange.test.ts)
> —— 新增 mock 子 Agent 只调 `registry.register()`，全程不改 Orchestrator / `runOrchestratorQuery` / `buildBuiltinAgents` 一行。

### 范式

主 Agent（master）由 `agent-orchestrator.ts` 持有一次 `sdk.query()` 调用，路由意图、做澄清、派活给子 Agent；
子 Agent（subagent）通过 `SubagentRegistry` 注册，由 `runOrchestratorQuery.assembleQueryOptions()` 一次性喂给 SDK `options.agents`。
**所有** SDK query 调用必须走 `runOrchestratorQuery`（A0 ①），禁止旁路。

### 三类注册来源（按优先级）

| source | 优先级（数字越小越高） | 注册时机 | 卸载策略 |
|---|---|---|---|
| `builtin` | 0 | 每次 query 前 reseed | `unregister(e => e.source === 'builtin')` |
| `user-config` | 1 | （Phase 2 预留 —— 用户自建子 Agent） | — |
| `capability-pack` | 2 | 每次 query 前 reseed（loader 内部先 unregister） | `unregister(e => e.source === 'capability-pack')` |

冲突策略：同 `kind` 内同 `name` 时按优先级覆盖；两个 capability-pack 同 `name` 直接抛错（让后激活的 pack 失败而非静默覆盖）。
跨 `kind` 同 `name` 不冲突。

### 注册红线

- C1：子 Agent `def.tools` **禁止**含 `'Task'` / `'Agent'`（子 Agent 不能再生子 Agent）
- 名禁与 SDK 内置 `'general-purpose'` 同名
- `source === 'capability-pack'` 时 `packId` 必填
- 红线 3（loader）：能力包 SubAgent prompt `.md` 文件**禁止**出现 CJK 字符 —— 内置 prompt 统一英文（CLAUDE.md §1 / §7.4）

### 双轨注册（G3 / G5 修复）

claude binary（闭源 CLI）的 Agent tool dispatch 路径**忽略** SDK `options.agents` 字段，只读文件式 `.claude/agents/*.md`；
sub-agent dispatch 时是另一个 claude subprocess，**不继承**父级 master 的 `mcpServers`。
因此每次 query 前 orchestrator 会在 session `cwd` 下：

1. `emit-filesystem-agents.ts` 把 Registry 里所有 `kind === 'subagent'` 的 entry 写成 `<cwd>/.claude/agents/<name>.md`（含 frontmatter + body）
2. `emit-mcp-config.ts` 把 master 的 `mcpServers` 字典写到 `<cwd>/.mcp.json`，并由 `mark-claude-project-trusted.ts` patch trust 标记模拟用户已 trust，让 sub-agent subprocess 启动时 load 同一批 MCP server。trust 标记**双写** `~/.claude.json`（向后兼容）与 `$CLAUDE_CONFIG_DIR/.claude.json`（即 `~/.asci(-dev)/sdk-config/.claude.json`，binary 实际消费的那份）—— issue #587 根因：此前只写 homedir，而 ASCI 给所有 claude 子进程设了 `CLAUDE_CONFIG_DIR`，binary 读的是 sdk-config 那份，trust 从未生效，子代理偶发解析不到 `mcp__paper-search__*`

programatic 注册（SDK `options.agents`）+ 文件式注册（`.claude/agents/`）双轨，缺一不可。

### 工作区级 override

`capability-pack-loader` 在用户级 `~/.asci/capability-pack-state.json` 之上叠加
`~/.asci/agent-workspaces/{slug}/capabilities.json` —— 三态：缺 key 继承用户级 / `true` 强启 / `false` 禁用。
当 `workspaceSlug` 不传（homedir 会话或测试）时退化为只读用户级。

### Subagent Span 遥测

`subagent-spans-hook.ts` 的 `SubagentStart/Stop` hook 按 `subagent_type` 名 FIFO 配对 startedAt / finishedAt，
经 `agent-orchestrator-spans-sink.ts` 的 500ms debounce 批量落 `AgentSessionMeta.subagentSpans`；
orchestrator cleanup 路径调 `flush()` 兜底 debounce 窗口内未落盘的 spans。
0.3 §三-A telemetry consumer 直接订阅 sink 输出即可。

### 集成清单（修改 Orchestrator 子 Agent 链路时必读）

1. 新增 builtin 子 Agent → 改 `buildBuiltinAgents`（`agent-prompt-builder.ts`），不动 Orchestrator
2. 新增 capability-pack 子 Agent → 用户把 pack 放到 `~/.asci/capability-packs/<packId>/`，不动任何代码
3. 新增 user-config 子 Agent（Phase 2）→ 在 seed 路径调 `registry.register({ source: 'user-config', ... })`，不动 Orchestrator
4. 新增 SubagentStart/Stop hook 用途 → 在 `run-orchestrator-query.ts` 的 `assembleQueryOptions` 内合并到对应 hooks 数组，不破坏 span hooks
5. 修改 `runOrchestratorQuery` —— **必读** `subagent-zero-codechange.test.ts`；该测试是 A0 ④ 验收锚点

---

## SDK 版本升级注意事项

### `options.env` 语义变更

- SDK 0.2.111 将 `options.env` 从"替换 `process.env`"改为"叠加到 `process.env`"
- SDK 0.2.113 又恢复为"替换 `process.env`"
- Shell 中可能存在的 `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_CUSTOM_HEADERS` / `ANTHROPIC_MODEL` 等变量，不能依赖 SDK 默认 env 语义来隔离

### 加固方案

`agent-orchestrator.ts` 的 `buildSdkEnv()` 显式构造完整 env：先继承非 `ANTHROPIC_*` 系统变量，再写入项目管理的 SDK env，末尾遍历 `process.env`，对所有**未被 sdkEnv 显式管理**的 `ANTHROPIC_*` 键显式置空字符串。

这样项目侧不依赖 SDK 的"叠加/替换"默认行为，升级前后都由 ASCI 控制最终传给 Claude Code 子进程的 env。

### 修改 `buildSdkEnv()` 检查清单

1. ✅ 保留 `cleanEnv` 的 `ANTHROPIC_` 前缀过滤
2. ✅ 保留末尾的 `ANTHROPIC_*` 空字符串覆盖循环
3. ✅ 新增的 SDK 识别的环境变量必须显式加入 `sdkEnv`（否则会被空字符串循环误覆盖）

若未来升级到后续大版本导致 `undefined` / 空字符串处理规则变化，需重新评估本加固逻辑。

### 关键 Breaking Changes

- `0.2.111` —— `options.env` 从"替换"变为"叠加"，见上文加固方案
- `0.2.113` —— `options.env` 恢复为"替换"，并改为通过 per-platform optional dependency 分发 native Claude Code binary

更早的版本历史见 [`history/sdk-upgrade-notes.md`](./sdk-upgrade-notes.md)。

---

## 共享类型（`@asci/shared`）

| 类型 | 说明 |
|------|------|
| `AgentEvent` | Agent 事件（`text` / `tool_start` / `tool_result` / `done` / `error`） |
| `AgentSessionMeta` | 会话元数据（`id` / `title` / `channelId` / `workspaceId`） |
| `AgentMessage` | 持久化消息（`role` + content blocks） |
| `AgentSendInput` | 发送请求输入 |
| `AGENT_IPC_CHANNELS` | Agent 相关 IPC 通道常量 |
| `WorkspaceCapabilities` | 工作区能力（MCP Server 列表 + Skills 列表） |
| `SubagentSpan` | 子 Agent 派发 span（`scenarioAgentName` / `startedAt` / `finishedAt` / `durationMs` / `success`），写入 `AgentSessionMeta.subagentSpans` |
| `CapabilityPackManifest` | 能力包 manifest zod schema —— `packId` / `scenarioAgent` / `subAgents` / `skillRefs` / `mcpRefs` |
| `CAPABILITY_PACK_IPC_CHANNELS` | 能力包列表 / 启停 IPC 通道常量 |

---

## 设计参照

遵循 [craft-agents-oss](https://github.com/craftship/craft-agents-oss) 的模式：

- 会话管理 —— 收件箱 / 归档工作流
- 权限模式 —— `safe` / `ask` / `allow-all`
- MCP 集成 —— Model Context Protocol 用于外部数据源
- 凭证存储 —— AES-256-GCM 加密
- 配置位置 —— `~/.asci/`（类似 `~/.craft-agent/`）

## 外部文档

- [Agent SDK TypeScript v1](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK TypeScript v2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)

## 相关资料

- [`architecture.md`](../architecture.md) —— IPC 通信、状态层、组件层
- [`build-and-packaging.md`](../build-and-packaging.md) —— SDK external 打包规则
- [`../CLAUDE.md`](../../CLAUDE.md) —— 顶层硬约束与开发纪律
