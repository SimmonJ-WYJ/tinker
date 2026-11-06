# Agent + 能力包架构

> **本文定位**：把"主 Agent ↔ SubAgent ↔ 能力包 ↔ 工作区事件总线"四层结构画一张完整地图，并给出代码位点。
> **真相源**：源码 + [`docs/milestones/0.2/agent-and-capability-pack-spec.md`](../milestones/0.2/agent-and-capability-pack-spec.md)（spec），本文与代码不一致时以代码为准并提单修订。
>
> 配套文档：[`docs/agent-sdk-integration.md`](../agent-sdk-integration.md) 聚焦 SDK 集成层（消息流、状态、权限排队）；[`docs/architecture.md`](../architecture.md) 是工程总索引。

---

## 目录

- [§1 全景拓扑](#1-全景拓扑)
- [§2 主 Orchestrator（Master Agent）](#2-主-orchestratormaster-agent)
- [§3 SubAgent Registry](#3-subagent-registry)
- [§4 七个 Builtin SubAgent](#4-七个-builtin-subagent)
- [§5 能力包子系统](#5-能力包子系统)
- [§6 SDK options 装配](#6-sdk-options-装配)
- [§7 Hooks 链](#7-hooks-链)
- [§8 工作区事件总线](#8-工作区事件总线)
- [§9 会话粘滞 + 意图切换](#9-会话粘滞--意图切换)
- [§10 Task ↔ Agent 双名兼容（C5）](#10-task--agent-双名兼容c5)
- [§11 关键文件索引](#11-关键文件索引)

---

<a id="1-全景拓扑"></a>

## §1 全景拓扑

```
用户消息
   ↓
┌────────────────────────────────────────────────────────────────┐
│  apps/electron/src/main/lib/agent-orchestrator.ts              │
│                                                                 │
│  • 收 IPC 请求                                                  │
│  • buildSdkEnv（清洗 ANTHROPIC_*）                              │
│  • buildSystemPrompt（sandwich 9 段，§2.2）                     │
│  • loadCapabilityPacks（按工作区状态 reseed Registry，§5.2）    │
│  • assembleQueryOptions（agents + hooks 装配，§6）              │
│  • runOrchestratorQuery（唯一 SDK query 间接入口，§2.1）         │
└────────────────────────────────────────────────────────────────┘
   ↓
┌────────────────────────────────────────────────────────────────┐
│  Claude Agent SDK query()                                       │
│                                                                 │
│  options.agents = registry.snapshot()  ←   7 builtin + N pack   │
│  options.allowedTools = resolveMasterAllowedTools()             │
│  options.hooks = { PreToolUse, PostToolUse,                     │
│                    SubagentStart, SubagentStop }                │
└────────────────────────────────────────────────────────────────┘
   ↓                       ↓                       ↓
 Master 自我响应       Task 派发 SubAgent       hooks 副作用
                          ↓                       ↓
                    ┌───────────────┐      ┌────────────────────┐
                    │  SubAgent     │      │ 1. 权限硬规则      │
                    │  subprocess   │      │ 2. paper-meta cap  │
                    │  (独立子上下文)│      │ 3. spans 记录      │
                    └───────────────┘      │ 4. pack 收口 emit  │
                          ↓                │ 5. 语言锁          │
                  tool_result 回主流        └────────────────────┘
                          ↓                       ↓
                    SDKMessage 流          WorkspaceEventBus
                          ↓                       ↓
                    SDK→AgentEvent              9 事件订阅链
                    (UI 透传)                  （0.3 ProposalDispatcher）
```

**四层职责一句话**：
- **Master Agent** —— 意图识别 + Task 派发 + system prompt sandwich，不亲自动手
- **SubAgent Registry** —— builtin / user-config / capability-pack 三源统一注册中心，snapshot 直接喂 SDK
- **能力包** —— 容器：场景 Agent + skillRefs + mcpRefs + uiFramework + （0.3）proposals
- **WorkspaceEventBus** —— 5 大对象 CRUD + 场景收口 → 9 事件 → 0.3 订阅者驱动 Proposal 链路

---

<a id="2-主-orchestratormaster-agent"></a>

## §2 主 Orchestrator（Master Agent）

### 2.1 唯一 SDK query 入口（A0 ①）

**强约束**：main 进程内 `import { query }` 只在 [`run-orchestrator-query.ts`](../../apps/electron/src/main/lib/run-orchestrator-query.ts) 出现一次；其余路径都走 `runOrchestratorQuery(opts)` 间接调用。

```ts
// run-orchestrator-query.ts:73-78
export function runOrchestratorQuery(input: RunOrchestratorQueryInput): AsyncIterable<SDKMessage> {
  const options = assembleQueryOptions(input)
  return input.adapter.query(options)
}
```

调用位点（仅两处）：
- [`agent-orchestrator.ts:1788`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1788) — 初次 query
- [`agent-orchestrator.ts:2178`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L2178) — resume

### 2.2 System Prompt sandwich 九段

[`agent-prompt-builder.ts buildSystemPrompt()`](../../apps/electron/src/main/lib/agent-prompt-builder.ts) 按以下顺序拼接：

| # | 段名 | 大致行号 | 内容要点 |
|---|---|---|---|
| 1 | 身份（Identity） | L598-608 | "I am ASCI Agent" + Alpha-stage 自我定位 |
| 2 | §0 Operating Philosophy | L615-623 | "Route over execute" — Agent 主导 + 用户决策 |
| 3 | Mission | L626-630 | "search comprehensively / synthesize accurately / never hallucinate" |
| 4 | Three Principles | L633-637 | 综合性 / 准确性 / 反幻觉 |
| 5 | Capabilities & Boundaries | L640-663 | 能力清单 + 接单规则 + 边界 + Zotero 导入 |
| 6 | My Team（SubAgent 定义） | L667-750 | 4 个核心 builtin（searcher/reader/synthesizer/fact-checker）+ 模型选择策略 |
| 7 | Capability Pack Routing | L756-834 | PLAN 派活协议 + 已注册 scenario Agent 清单（含 sticky pack，§9） |
| 8 | Workspace | L839-903 | cwd / .context/ / 论文索引 / CLAUDE.md |
| 9 | Anti-hallucination Red Lines | L906-911 | 9 条 `RED_LINES`（定义在 L60-92） |
| 10 | Handling Uncertainty | L914-923 | AskUserQuestion 用法 |
| 11 | Tool Usage | L926-939 | 工具规范 + 路径规则 + 大文件写入 |
| 12 | Output Language directive | 末尾 | 由 UI 语言 + 用户消息语言双重路由 |

> 注：段 6 列出的 4 个 SubAgent 是给 Master Agent 在没有粘滞包时的默认路由提示；完整 7 个 builtin 通过 `options.agents` 喂给 SDK，Master 始终可以派发到任何注册的 subagent_type。

### 2.3 allowedTools 决议矩阵

[`agent-orchestrator.master-tools.ts:26-48 resolveMasterAllowedTools()`](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts#L26-L48)

| permissionMode | options.allowedTools |
|---|---|
| `default` | `undefined`（SDK 默认全开） |
| `bypassPermissions` | `undefined`（同上） |
| `plan` | `PLAN_MODE_ALLOWED_TOOLS` 全集（15 项，含 `Task` + `Agent`） |
| `acceptEdits` | `['Task', ...SAFE_TOOLS]` 去重 = `['Task', Read, Glob, Grep, WebSearch, WebFetch, TodoRead, TodoWrite, TaskOutput]` |

**A0b 红线**：顶层 `options.allowedTools` **只接受 `'Task'`**，不接受 `'Agent'`（[`subagent-tool-name.ts:22`](../../packages/shared/src/utils/subagent-tool-name.ts#L22) `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT='Task'`）。`'Agent'` 仅在 `PLAN_MODE_ALLOWED_TOOLS`（PreToolUse 过滤的 matcher 集合）里出现，目的是兼容 SDK 在 `tool_use.name` 上的 `Task`/`Agent` 双名切换（详见 §10）。

### 2.4 buildSdkEnv 红线（继承 CLAUDE.md §7.2）

[`agent-orchestrator.ts buildSdkEnv()`](../../apps/electron/src/main/lib/agent-orchestrator.ts) 必须保留：
1. `cleanEnv` 过滤 `ANTHROPIC_` 前缀
2. 末尾对所有"未被 sdkEnv 管理的 `ANTHROPIC_*` 键"显式置空
3. 任何新增 SDK 可识别 env 必须显式进 `sdkEnv`，否则被空字符串循环误伤

---

<a id="3-subagent-registry"></a>

## §3 SubAgent Registry

### 3.1 类型架构

[`subagent-registry.ts`](../../apps/electron/src/main/lib/subagent-registry.ts)

```ts
// RegistryEntrySource — 三档来源
type RegistryEntrySource = 'builtin' | 'capability-pack' | 'user-config'

// RegistryEntryKind — 三档种类
type RegistryEntryKind = 'subagent' | 'skill' | 'mcp'
```

存储 key 形如 `${kind}:${name}` —— 跨 kind 同名不冲突（[L104](../../apps/electron/src/main/lib/subagent-registry.ts#L104)）。

### 3.2 命名空间冲突策略（SOURCE_PRIORITY）

[L107-111](../../apps/electron/src/main/lib/subagent-registry.ts#L107-L111)：

| Source | Priority（数字小=优先级高） |
|---|---|
| `builtin` | 0 |
| `user-config` | 1 |
| `capability-pack` | 2 |

冲突 4 种处理（[L151-171](../../apps/electron/src/main/lib/subagent-registry.ts#L151-L171)）：

| 情形 | 行为 |
|---|---|
| `capability-pack` × `capability-pack` 同名 | **直接抛错**（后激活包加载失败） |
| 新来 priority 更高（如 `builtin` 覆盖现有 `user-config`） | 覆盖 + log warn |
| 现有 priority 更高（如 `builtin` 已占位，新来 `capability-pack`） | 保留 + log warn |
| 优先级相同 | 保留现有 |

### 3.3 注册项校验红线（[L117-140](../../apps/electron/src/main/lib/subagent-registry.ts#L117-L140)）

`validateEntry()` 在 `register()` 入口检验：
1. `source === 'capability-pack'` 时 `packId` 必填
2. `kind === 'subagent'` 时：
   - 名称不得为 `'general-purpose'`（SDK 内置占名）
   - **C1 红线**：`def.tools` 不得含 `'Task'` / `'Agent'` —— 子 Agent 不能再生子 Agent

### 3.4 snapshot() 形状

```ts
// L200-206
snapshot(): { agents: Record<string, AgentDefinition> }
```

只产出 `kind === 'subagent'` 的注册项；Skill / MCP 各走各自管道（Skill → system prompt 内联；MCP → `options.mcpServers` via `composeMcpServers`）。

### 3.5 list() API

```ts
list(filter?: { kind?, source?, packId? }): readonly RegistryEntry[]
```

**A2 闭环**：`snapshot().agents` 的 key 集 必定等于 `list({ kind: 'subagent' }).map(e => e.name)`。

---

<a id="4-七个-builtin-subagent"></a>

## §4 七个 Builtin SubAgent

[`subagent-registry-seed.ts`](../../apps/electron/src/main/lib/subagent-registry-seed.ts) 调用 [`buildBuiltinAgents()`](../../apps/electron/src/main/lib/agent-prompt-builder.ts) 在 registry 启动时种入 7 个 builtin entry：

| SubAgent | Prompt 位置 | Model | tools | 一句话职责 |
|---|---|---|---|---|
| **searcher** | [agent-prompt-builder.ts:161-196](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L161-L196) | haiku | Read/Glob/Grep/Bash/WebSearch/WebFetch | 多源关键词迭代检索 + 投递 Evidence Table |
| **reader** | [L197-247](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L197-L247) | haiku | Read/Glob/Grep/Bash/WebFetch | 单 PDF 精确提取；失败降级 abstract（spec §5.7 第 4 条） |
| **synthesizer** | [L249-305](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L249-L305) | sonnet | Read/Glob/Grep/Bash/Write/Edit | lit-review 核心 — Agent loop 流式写综述 HTML fragment（spec §5.4 / PR-H） |
| **fact-checker** | [L307-370](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L307-L370) | haiku | Read/Glob/Grep/Bash | 逐句校验可溯源性；标 `verified / unsupported / contradicted / unchecked` |
| **relevance-scorer** | [L370-401](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L370-L401) | haiku | Read/Glob/Grep/Bash | F22 排序 + LLM rerank batch |
| **citation-explorer** | [L402-430](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L402-L430) | haiku | Read/Glob/Grep/Bash/WebSearch/WebFetch | Snowball forward/backward 引文展开 + 图谱 |
| **review-proposer** | [L431-510](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L431-L510) | sonnet | Read/Glob/Grep | lit-review Turn 1 — 输出 3 方向 + outline 提案 |

### 4.1 共享 schema（跨 SubAgent 协议）

`agent-prompt-builder.ts` 内集中定义、多个 SubAgent prompt 复用：

- **`RED_LINES`**（L60-92）—— 9 条反幻觉红线，Section 7 与各 SubAgent prompt 共用
- **`renderEvidenceSchema()`**（L95-108）—— Evidence Table JSON 结构（searcher/reader/synthesizer/fact-checker 共同协议）
- **`buildSubAgentOutputLanguageSection()`**（L123-130）—— 复读父级语言决议，避免 SubAgent 用错语言

### 4.2 模型选择策略

- **haiku**（searcher / reader / fact-checker / relevance-scorer / citation-explorer）—— 高频/点状任务，成本敏感
- **sonnet**（synthesizer / review-proposer）—— 长链路推理任务

详见 [agent-prompt-builder.ts:703-712](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L703-L712)。

---

<a id="5-能力包子系统"></a>

## §5 能力包子系统

### 5.1 Manifest schema 四红线

[`packages/shared/src/schemas/capability-pack.ts`](../../packages/shared/src/schemas/capability-pack.ts) 用 Zod `.strict()` 校验：

| # | 红线 | 抛错形态 |
|---|---|---|
| 1 | `strict()` 拒绝未知字段 | 阻止 `masterPrompt` 等覆盖主 Agent 的越权字段 |
| 2 | `packId` kebab-case；scenarioAgent.name 禁与 `'general-purpose'` 同名 | 命名约束 |
| 3 | scenarioAgent.prompt 必须英文（CJK heuristic 拒绝） | 内置 prompt 统一英文（CLAUDE.md §2） |
| 4 | scenarioAgent.tools 不得含 `'Task'` / `'Agent'`（C1） | 场景 Agent 也是 SubAgent，不能再生子 Agent |

### 5.2 加载链路

[`capability-pack-loader.ts loadCapabilityPacks()`](../../apps/electron/src/main/lib/capability-pack-loader.ts)：

```
loadCapabilityPacks(registry, opts)
   │
   ├─ 1. reseed：registry.unregister(e => e.source === 'capability-pack')
   │
   ├─ 2. discover：扫 packsDir 子目录（默认 default-capability-packs + ~/.asci/capabilities）
   │
   ├─ 3. 逐个 pack 处理：
   │      ├─ 读 manifest.json → CapabilityPackSchema.safeParse
   │      ├─ 用户级 isPackEnabled(packId)
   │      ├─ 工作区级 getWorkspacePackOverride(packId)
   │      ├─ resolveEffectiveEnabled(user, override)：三态合成
   │      └─ effective=true → registerPack(registry, manifest)
   │
   └─ 4. registerPack：
          ├─ registry.register({ kind: 'subagent', source: 'capability-pack',
          │                       packId, name: scenarioAgent.name, def })
          ├─ 对每个 skillRefs → registry.register({ kind: 'skill', ... })
          └─ 对每个 mcpRefs → registry.register({ kind: 'mcp', ... })
```

### 5.3 用户级 × 工作区级三态语义

[`workspace-capability-pack-state.ts`](../../apps/electron/src/main/lib/workspace-capability-pack-state.ts) `resolveEffectiveEnabled`：

| 工作区级 override | 用户级 isPackEnabled | effective |
|---|---|---|
| 缺 key（继承） | true | ✅ enabled |
| 缺 key（继承） | false | ❌ disabled |
| 显式 `true` | 任意 | ✅ enabled（工作区强启） |
| 显式 `false` | 任意 | ❌ disabled（工作区禁用） |

- **用户级状态**：`~/.asci/capability-pack-state.json`（[`config-paths.ts:518-520`](../../apps/electron/src/main/lib/config-paths.ts#L518-L520) `getCapabilityPackStatePath()`）
- **工作区级状态**：`~/.asci/agent-workspaces/<slug>/capabilities.json`（[`config-paths.ts:533-535`](../../apps/electron/src/main/lib/config-paths.ts#L533-L535) `getWorkspaceCapabilitiesPath()`）

### 5.4 toggle 行为

[`capability-pack-service.ts:149`](../../apps/electron/src/main/lib/capability-pack-service.ts#L149) `toggleCapabilityPack(packId, enabled)`：
- 仅写状态 JSON
- **不主动 reseed Registry**：Registry 在下一次 `runAgent` → `loadCapabilityPacks` 时自然按新状态 reseed
- 这是 spec §6.3"启用后注册中心立即可枚举"的兜底实现 —— 立即性由"下一次 query 必 reseed"保证

### 5.5 0.2 首发三包

| Pack | 路径 | scenarioAgent | mcpRefs | subAgentRefs | uiFramework |
|---|---|---|---|---|---|
| **lit-search** | [apps/electron/default-capability-packs/lit-search/manifest.json](../../apps/electron/default-capability-packs/lit-search/manifest.json) | name=`lit-search`, model=sonnet, tools=[] | `paper-search` | `searcher` / `relevance-scorer` / `citation-explorer` | `conversation-and-artifact` |
| **lit-review** | [apps/electron/default-capability-packs/lit-review/manifest.json](../../apps/electron/default-capability-packs/lit-review/manifest.json) | name=`lit-review`, model=sonnet, tools=[] | `paper-search` | `review-proposer` / `synthesizer` / `reader` / `fact-checker` | `conversation-and-artifact` |
| **mock-pack-1** | [apps/electron/test-fixtures/capability-packs/mock-pack-1/](../../apps/electron/test-fixtures/capability-packs/mock-pack-1/) | 测试 fixture | — | — | — |

> lit-search / lit-review 的 scenarioAgent 是 PLAN-only 极简 dispatcher（spec §5.1 原则 01：每 turn 仅 2 次 LLM 调用 — 开口 + 收口；中间 SubAgent 执行期不打断）。  
> tools 留空意味着场景 Agent **本身不直接调任何 MCP**，全部 work 派给 subAgentRefs 列出的 builtin SubAgent。  
> mcpRefs 仅作为路由信号告诉 Master "本包需要 paper-search MCP"，实际 MCP 注入由 `composeMcpServers` 在 query 装配时合并。

### 5.6 配置页

[`apps/electron/src/renderer/components/config/ConfigView.tsx`](../../apps/electron/src/renderer/components/config/ConfigView.tsx) 是左侧 sidebar 的"配置"独立路由（与"文献库"平级）。两个板块：

- **能力包板块** —— [`CapabilityPackPanel.tsx`](../../apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx)：列表 + toggle + manifest 校验报错展示
- **Skill 板块** —— 占位中（`t('skillsPanel.comingSoon')`），spec §6.4 内容待落

---

<a id="6-sdk-options-装配"></a>

## §6 SDK options 装配

### 6.1 assembleQueryOptions 全景

[`run-orchestrator-query.ts:38-79`](../../apps/electron/src/main/lib/run-orchestrator-query.ts#L38-L79)：

```ts
export function assembleQueryOptions(input): ClaudeAgentQueryOptions {
  const snapshot = input.registry.snapshot()
  const spanHooks  = createSubagentSpanHooks(sessionId, sink)            // A0a — telemetry
  const packHooks  = createPackTaskCompletedHook(sessionId, lookup)      // spec §3.1 #9
  const paperMetaCapHooks = createPaperMetaCapHook(sessionId)            // spec §5.6 cap=3

  return {
    ...input.baseOptions,
    agents: snapshot.agents,                                              // 完全替换语义
    hooks: {
      ...baseHooks,
      PreToolUse:    [...baseHooks.PreToolUse,    ...paperMetaCapHooks.PreToolUse],
      PostToolUse:   [...baseHooks.PostToolUse,   ...paperMetaCapHooks.PostToolUse],
      SubagentStart: [...baseHooks.SubagentStart, ...spanHooks.SubagentStart],
      SubagentStop:  [...baseHooks.SubagentStop,  ...spanHooks.SubagentStop, ...packHooks.SubagentStop],
    },
  }
}
```

### 6.2 关键约束

- **agents 完全替换语义**：`snapshot.agents` 整体替换 `baseOptions.agents`（编译期由 `Omit<..., 'agents'>` 阻止误传）—— 子 Agent 必须通过 Registry 注册，调用方不应自行构造
- **hooks 合并语义**：四种 hook 都用 `concat` 而非 `overwrite`；baseOptions 已有的 entry 保留，新 entry 拼在后面
- **PreToolUse / PostToolUse 链顺序**：先 baseOptions（如权限服务 hard rule）→ 后 paper-meta-cap

### 6.3 baseOptions 的提供方

[`agent-orchestrator.ts:1576-1604`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1576-L1604) 已经预填了：

- **PreToolUse**: `permissionService.createPreToolUseHardRuleHookForSession(sessionId, ...)`
- **PostToolUse**: 语言锁 additionalContext 注入（H1）

`assembleQueryOptions` 在这两条之后追加 paper-meta-cap 的 entry。

---

<a id="7-hooks-链"></a>

## §7 Hooks 链

### 7.1 PreToolUse 链

| 顺序 | Entry matcher | 源文件 | 作用 |
|---|---|---|---|
| 1 | `'*'` | [`agent-permission-service.ts:138-163`](../../apps/electron/src/main/lib/agent-permission-service.ts#L138-L163) | Hard rule 拦截（Bash 黑名单 / 危险路径 / 文件系统硬约束） |
| 2 | `'mcp__paper-search__get_paper_meta'` | [`paper-meta-cap-hook.ts`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) | spec §5.6 — cap=3 / fail≥2 早停；触限返回 `permissionDecision: 'deny'` |

### 7.2 PostToolUse 链

| 顺序 | Entry matcher | 源文件 | 作用 |
|---|---|---|---|
| 1 | `'*'` | [`agent-orchestrator.ts:1590-1604`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1590-L1604) | H1 语言锁 — 每个 tool_result 后追加 additionalContext 重发布 Output Language directive |
| 2 | `'mcp__paper-search__get_paper_meta'` | [`paper-meta-cap-hook.ts`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) | 累计 attempts / failures；MCP `tool_response.isError === true` 视为失败 |

### 7.3 SubagentStart 链

| 顺序 | matcher | 源文件 | 作用 |
|---|---|---|---|
| 1 | `'*'` | [`subagent-spans-hook.ts:38-44`](../../apps/electron/src/main/lib/subagent-spans-hook.ts#L38-L44) | A0a — append span（scenarioAgentName + startedAt）到 SpanSink；session meta 落盘 |

### 7.4 SubagentStop 链

| 顺序 | matcher | 源文件 | 作用 |
|---|---|---|---|
| 1 | `'*'` | [`subagent-spans-hook.ts:46-64`](../../apps/electron/src/main/lib/subagent-spans-hook.ts#L46-L64) | A0a — 按 FIFO 配对最早 start，回填 finishedAt / success / durationMs |
| 2 | `'*'` | [`pack-task-completed-hook.ts:43-49`](../../apps/electron/src/main/lib/pack-task-completed-hook.ts#L43-L49) | spec §3.1 #9 — 命中 capability-pack 注册项时 emit `pack.taskCompleted` 到 WorkspaceEventBus |

### 7.5 paper-meta-cap 工作流细节

```
get_paper_meta 调用 N 次：
  N=1: PreToolUse(attempts=0) → allow → tool runs → PostToolUse → attempts=1
  N=2: PreToolUse(attempts=1) → allow → tool runs → PostToolUse → attempts=2
  N=3: PreToolUse(attempts=2) → allow → tool runs → PostToolUse → attempts=3
  N=4: PreToolUse(attempts=3) → DENY ❌ → 返回中文 reason "[paper-meta-cap] 本轮综述已调用 3 次（上限 3）..."

或 fail 早停：
  N=1: PreToolUse → allow → tool runs（isError=true）→ PostToolUse → attempts=1, failures=1
  N=2: PreToolUse → allow → tool runs（isError=true）→ PostToolUse → attempts=2, failures=2
  N=3: PreToolUse(failures=2 ≥ 2)→ DENY ❌ "连续失败 2 次（早停阈值 2）"
```

常量定义（[`paper-meta-cap-hook.ts:24-28`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts#L24-L28)）：
- `GET_PAPER_META_TOOL = 'mcp__paper-search__get_paper_meta'`
- `GET_PAPER_META_CAP = 3`
- `GET_PAPER_META_FAIL_EARLY_STOP = 2`

---

<a id="8-工作区事件总线"></a>

## §8 工作区事件总线

### 8.1 总线 API

[`workspace-event-bus.ts`](../../apps/electron/src/main/lib/workspace-event-bus.ts)：模块级单例 `workspaceEventBus`。

```ts
class WorkspaceEventBus {
  emit(event: WorkspaceEvent): void                              // 同步 emit；handler 错误 swallow + console.error
  on(handler): () => void                                        // 全量监听
  on<K>(kind: K, handler: Handler<Extract<E, {kind: K}>>): () => void  // 按 kind 过滤
  dispose(): void                                                // 测试隔离
}
```

设计取舍：
- **同步 emit** —— spec §3.3 禁止异步
- **handler 错误 swallow** —— Repository CRUD 不被订阅者拖垮
- **无中间件** —— 0.2 无 speaker / scoped 等需求，加上反而模糊语义

### 8.2 四个事件（spec §3.1）

[`packages/shared/src/types/workspace-events.ts`](../../packages/shared/src/types/workspace-events.ts) 定义类型。
历史裁剪：`evidenceSet.created` / `evidenceSet.paperAdded` / `note.created` / `note.updated`
已随 0.2 数据模型重构（c1fda468）移除；`citationRelation.created` 已随 0.4 CitationRelation
功能废弃移除（#718）。

| # | 事件 kind | emit 位点 | 触发条件 |
|---|---|---|---|
| 1 | `paper.created` | [paper-repository.ts:89](../../apps/electron/src/main/lib/objects/repositories/paper-repository.ts#L89) | createPaper |
| 2 | `paper.deleted` | [paper-repository.ts:227](../../apps/electron/src/main/lib/objects/repositories/paper-repository.ts#L227) | softDeletePaper |
| 3 | `evidenceRef.created` | [evidence-ref-repository.ts:67](../../apps/electron/src/main/lib/objects/repositories/evidence-ref-repository.ts#L67) | createEvidenceRef（综述 pipeline inline 产出） |
| 4 | `pack.taskCompleted` | [pack-task-completed-hook.ts](../../apps/electron/src/main/lib/pack-task-completed-hook.ts) → SubagentStop hook | 命中 `source='capability-pack'` 的 scenario Agent 收口 |

### 8.3 emit owner 划分（spec §3.2）

| 事件 | Owner | 实现路径 |
|---|---|---|
| #1-#2 | **fanlizhi** | Repository CRUD 内联 emit |
| #3 | **liningftp** | 综述 pipeline 走 createEvidenceRef → Repository 内联 emit |
| #4 | **liningftp** | SDK SubagentStop hook → 查 registry → 仅 capability-pack 触发 |

> 0.2 阶段 §3.2 把 Repository 内联 emit 归在 fanlizhi 范围，本会话由 liningftp 代写以确保事件总线闭环；如后续需要 fanlizhi review/接管，repo 内联 emit 是单点改动，迁移成本低。

### 8.4 订阅者

- **0.2 阶段**：测试代码（5 处 `workspaceEventBus.on` 调用，全部在 `*.test.ts` 内）；**生产路径无运行时订阅者**
- **0.3 阶段**：`ProposalDispatcher.subscribe('paper.created', ...)` 等 → 后台异步子进程触发 Proposal 自动产出

---

<a id="9-会话粘滞--意图切换"></a>

## §9 会话粘滞 + 意图切换

### 9.1 stickyCapabilityPackId 数据流

```
                         ┌─────────────────────────┐
        sessionMeta:     │ stickyCapabilityPackId? │
                         └─────────────────────────┘
                                  ↑           ↓
       由 IPC 层在意图切换           读取（agent-orchestrator.ts:1536）
       检测命中时清空                              ↓
   (detect-intent-switch.ts)         查 registry 解析为
                                  stickyCapabilityPack: {
                                    packId, scenarioAgentName,
                                    scenarioAgentDescription
                                  }
                                              ↓
                          注入到 buildSystemPrompt(ctx.stickyCapabilityPack)
                                              ↓
                    agent-prompt-builder.ts:821-831 在 "Capability Pack
                    Routing" 段后追加 "Active sticky pack" 小节
```

[`agent-orchestrator.ts:1534-1551`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1534-L1551)：

```ts
const stickyPackId = sessionMeta?.stickyCapabilityPackId
if (stickyPackId) {
  const packEntries = this.subagentRegistry.list({ kind: 'subagent', packId: stickyPackId })
  const scenarioEntry = packEntries[0]
  if (scenarioEntry && scenarioEntry.kind === 'subagent') {
    stickyCapabilityPack = {
      packId: stickyPackId,
      scenarioAgentName: scenarioEntry.name,
      scenarioAgentDescription: scenarioEntry.def.description ?? '',
    }
  }
}
```

### 9.2 意图切换检测

[`detect-intent-switch.ts`](../../apps/electron/src/main/lib/detect-intent-switch.ts)（spec §4.3）：
- 用户消息意图明显偏离当前 sticky pack 时清空 `stickyCapabilityPackId`
- 用户主动 `@主` 也强制重新路由

### 9.3 默认透传（D-C）

场景 Agent 的事件（tool_use / tool_result / 流式文本）**绕过主 Agent 直接给 UI** —— 通过 `convertSDKMessage` 把 SDK 消息转 `AgentEvent` 后由 `webContents.send` 推到 renderer，附 speaker 标识（[`resolve-message-speaker.ts`](../../apps/electron/src/renderer/components/agent/resolve-message-speaker.ts)）。

---

<a id="10-task--agent-双名兼容c5"></a>

## §10 Task ↔ Agent 双名兼容（C5）

SDK 在 v2.1.63 前后切换 `tool_use.name` 在 `'Task'` / `'Agent'` 之间；项目所有"判断子 Agent 派发"的位点必须 **OR 双名**，而 `system:init` / `permission_denials` / `options.allowedTools` 输入侧位点 **只接受 `'Task'`**。

### 10.1 派发语义位点（双名 OR）

通过 [`subagent-tool-name.ts isSubagentToolUse()`](../../packages/shared/src/utils/subagent-tool-name.ts) 统一判定：

```ts
export const SUBAGENT_TOOL_NAMES = ['Task', 'Agent'] as const
export const isSubagentToolUse = (tool: { name: string }): boolean =>
  SUBAGENT_TOOL_NAMES.includes(tool.name as never)
```

调用点：

| 文件:行号 | 用途 |
|---|---|
| [message-stream-converter.ts:29](../../packages/shared/src/utils/message-stream-converter.ts#L29) | SDK 消息 → AgentEvent 转换：识别子 Agent 派发 |
| [agent-permission-service.ts:392](../../apps/electron/src/main/lib/agent-permission-service.ts#L392) | 权限 UI banner description |
| [agent-permission-service.ts:428](../../apps/electron/src/main/lib/agent-permission-service.ts#L428) | i18n key 路由 |
| [agent-permission-service.ts:452](../../apps/electron/src/main/lib/agent-permission-service.ts#L452) | 危险度等级判定 |
| [subagent-registry.ts:133](../../apps/electron/src/main/lib/subagent-registry.ts#L133) | C1 红线：子 Agent tools 禁含 Task/Agent |
| [capability-pack.ts:41](../../packages/shared/src/schemas/capability-pack.ts#L41) | manifest 校验 scenarioAgent.tools 同上 |

### 10.2 输入侧 only `'Task'` 位点

| 文件:行号 | 用途 |
|---|---|
| [subagent-tool-name.ts:22](../../packages/shared/src/utils/subagent-tool-name.ts#L22) | `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT = 'Task'` 常量定义 |
| [agent-allowed-tools.ts:14](../../apps/electron/src/main/lib/agent-allowed-tools.ts#L14) | `PLAN_MODE_ALLOWED_TOOLS` 包含 `'Task'` 字面量（同集合也含 `'Agent'`，但走的是 PreToolUse 过滤而非顶层 allowedTools） |
| [agent-orchestrator.master-tools.ts:42](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts#L42) | acceptEdits 模式注入 `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT` |

### 10.3 C5 验收锚点

grep 全仓 `block.name === '` / `.tool_name === '` / `tool_use.name ===` 调用点 → 处于派发语义全部双名 OR；处于 `system:init` / `permission_denials` 语义全部 only `"Task"`；零错配。

---

<a id="11-关键文件索引"></a>

## §11 关键文件索引

### 主进程 lib/

| 文件 | 职责 |
|---|---|
| [agent-orchestrator.ts](../../apps/electron/src/main/lib/agent-orchestrator.ts) | 编排主体；runAgent / persistSDKMessages / canUseTool 排队 / watchdog / retry |
| [agent-orchestrator.master-tools.ts](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts) | `resolveMasterAllowedTools` allowedTools 决议 |
| [agent-allowed-tools.ts](../../apps/electron/src/main/lib/agent-allowed-tools.ts) | `PLAN_MODE_ALLOWED_TOOLS` 集合 |
| [run-orchestrator-query.ts](../../apps/electron/src/main/lib/run-orchestrator-query.ts) | **唯一** SDK `query` 间接入口 + `assembleQueryOptions` |
| [agent-prompt-builder.ts](../../apps/electron/src/main/lib/agent-prompt-builder.ts) | `buildSystemPrompt` + 7 个 builtin SubAgent 的 prompt + RED_LINES |
| [agent-permission-service.ts](../../apps/electron/src/main/lib/agent-permission-service.ts) | 权限服务 + PreToolUse hard rule + canUseTool |
| [agent-event-bus.ts](../../apps/electron/src/main/lib/agent-event-bus.ts) | **SDK 流式事件总线**（与工作区事件总线区分） |
| [agent-session-manager.ts](../../apps/electron/src/main/lib/agent-session-manager.ts) | 会话状态持久化；stickyCapabilityPackId 字段 |
| [subagent-registry.ts](../../apps/electron/src/main/lib/subagent-registry.ts) | 三源 × 三 kind 注册中心 |
| [subagent-registry-seed.ts](../../apps/electron/src/main/lib/subagent-registry-seed.ts) | `seedBuiltinSubagents` 启动期注册 7 个 builtin |
| [subagent-spans-hook.ts](../../apps/electron/src/main/lib/subagent-spans-hook.ts) | SubagentStart/Stop telemetry hook |
| [pack-task-completed-hook.ts](../../apps/electron/src/main/lib/pack-task-completed-hook.ts) | SubagentStop → `pack.taskCompleted` 事件转换 |
| [paper-meta-cap-hook.ts](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) | spec §5.6 跨包补漏 cap=3 / fail≥2 早停 |
| [capability-pack-loader.ts](../../apps/electron/src/main/lib/capability-pack-loader.ts) | `loadCapabilityPacks` 扫描 + reseed + register |
| [capability-pack-service.ts](../../apps/electron/src/main/lib/capability-pack-service.ts) | `toggleCapabilityPack` 写状态 |
| [workspace-capability-pack-state.ts](../../apps/electron/src/main/lib/workspace-capability-pack-state.ts) | 工作区级 override 三态语义 |
| [workspace-event-bus.ts](../../apps/electron/src/main/lib/workspace-event-bus.ts) | **工作区对象事件总线**（9 事件） |
| [detect-intent-switch.ts](../../apps/electron/src/main/lib/detect-intent-switch.ts) | sticky pack 意图切换检测 |
| [litreview-sdk-mcp.ts](../../apps/electron/src/main/lib/litreview-sdk-mcp.ts) | lit-review 包内 SDK MCP server（present_directions tool） |

### Shared types

| 文件 | 职责 |
|---|---|
| [packages/shared/src/types/workspace-events.ts](../../packages/shared/src/types/workspace-events.ts) | 9 个 `WorkspaceEvent` 类型 |
| [packages/shared/src/schemas/capability-pack.ts](../../packages/shared/src/schemas/capability-pack.ts) | Zod manifest schema + 四红线 |
| [packages/shared/src/utils/subagent-tool-name.ts](../../packages/shared/src/utils/subagent-tool-name.ts) | `SUBAGENT_TOOL_NAMES` / `isSubagentToolUse` / `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT` |
| [packages/shared/src/constants/permission-rules.ts](../../packages/shared/src/constants/permission-rules.ts) | `SAFE_TOOLS` |

### Renderer

| 文件 | 职责 |
|---|---|
| [config/ConfigView.tsx](../../apps/electron/src/renderer/components/config/ConfigView.tsx) | 左侧"配置"页（能力包板块 + Skill 板块占位） |
| [config/CapabilityPackPanel.tsx](../../apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx) | 能力包列表 + toggle UI |
| [settings/SettingsPanel.tsx](../../apps/electron/src/renderer/components/settings/SettingsPanel.tsx) | Settings 弹窗 11 tab（含 mcp + datacollection）|
| [agent/resolve-message-speaker.ts](../../apps/electron/src/renderer/components/agent/resolve-message-speaker.ts) | speaker 徽标解析（主 Agent / 场景 Agent / 包名）|

### 内置能力包

| 路径 | 说明 |
|---|---|
| [apps/electron/default-capability-packs/lit-search/](../../apps/electron/default-capability-packs/lit-search/) | 检索包 manifest |
| [apps/electron/default-capability-packs/lit-review/](../../apps/electron/default-capability-packs/lit-review/) | 综述包 manifest |
| [apps/electron/test-fixtures/capability-packs/](../../apps/electron/test-fixtures/capability-packs/) | 测试 fixture（mock-pack-1 / mock-pack-broken-redline） |

---

## 附录 A：硬约束清单速查

| 编号 | 约束 | 验收锚点 |
|---|---|---|
| A0 ① | `import { query }` 仅 `run-orchestrator-query.ts` 唯一一处 | grep 全仓应该只有该文件 1 处 |
| A0 ② | Master allowedTools 不含 Bash/Edit/Write（acceptEdits 模式除外，acceptEdits 才包含 SAFE_TOOLS 但仍不含 Bash/Edit/Write） | [`agent-orchestrator.master-tools.ts:26-48`](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts#L26-L48) |
| A0a | SubagentStart/Stop hook 接通 | [`run-orchestrator-query.ts:69-77`](../../apps/electron/src/main/lib/run-orchestrator-query.ts#L69-L77) |
| A0b / C5 | Task↔Agent 双名兼容 | §10 |
| A2 | snapshot.agents key 集 = list({kind:'subagent'}).map(name) | [`subagent-registry.ts:200-206`](../../apps/electron/src/main/lib/subagent-registry.ts#L200-L206) |
| A3 | mock pack 通过契约注册 + 路由 + UI 渲染 + emit `pack.taskCompleted` | §7.4 + §8.2 #9 |
| C1 | 子 Agent tools 禁含 Task/Agent | [`subagent-registry.ts:131-138`](../../apps/electron/src/main/lib/subagent-registry.ts#L131-L138) + [`capability-pack.ts:41`](../../packages/shared/src/schemas/capability-pack.ts#L41) |
| H1 | PostToolUse 重发布语言锁（除 anthropic native） | [`agent-orchestrator.ts:1590-1604`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1590-L1604) |
| §3.3 | 9 事件 emit 同步 | [`workspace-event-bus.ts`](../../apps/electron/src/main/lib/workspace-event-bus.ts) emit 内无 async |
| §5.6 | get_paper_meta cap=3 / fail≥2 早停 | [`paper-meta-cap-hook.ts`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) |

---

## 附录 B：版本注记

- **本文版本**：2026-05-25 首版
- **对齐源**：[`agent-and-capability-pack-spec.md`](../milestones/0.2/agent-and-capability-pack-spec.md) 2026-05-23
- **后续修订**：行号会随代码漂移；建议把本文当作"路线图"，具体实现以源码注释 + git blame 为准
