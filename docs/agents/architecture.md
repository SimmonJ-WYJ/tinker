<a id="agent-&#45;能力包架构"></a>

# Agent + Capability-Pack Architecture

> **Purpose**: map all four layers, “main Agent ↔ SubAgent ↔ capability pack ↔ workspace event bus,” with code locations.
> **Sources of truth**: source code + [`docs/milestones/0.2/agent-and-capability-pack-spec.md`](../milestones/0.2/agent-and-capability-pack-spec.md) (spec). Where this document differs from code, code wins; file an issue to revise it.
>
> Companion documents: [`docs/agent-sdk-integration.md`](../agent-sdk-integration.md) covers SDK integration (streams, state, permission queues); [`docs/architecture.md`](../architecture.md) is the engineering index.

---

<a id="目录"></a>

## Contents

- [§1 Overall Topology](#1-全景拓扑)
- [§2 Main Orchestrator (Master Agent)](#2-主-orchestratormaster-agent)
- [§3 SubAgent Registry](#3-subagent-registry)
- [§4 Seven Builtin SubAgents](#4-七个-builtin-subagent)
- [§5 Capability-Pack Subsystem](#5-能力包子系统)
- [§6 SDK Options Assembly](#6-sdk-options-装配)
- [§7 Hook Chains](#7-hooks-链)
- [§8 Workspace Event Bus](#8-工作区事件总线)
- [§9 Session Stickiness + Intent Switching](#9-会话粘滞--意图切换)
- [§10 Task ↔ Agent Dual-Name Compatibility (C5)](#10-task--agent-双名兼容c5)
- [§11 Key File Index](#11-关键文件索引)

---

<a id="1-全景拓扑"></a>

## §1 Overall Topology

```
User message
   ↓
┌────────────────────────────────────────────────────────────────┐
│  apps/electron/src/main/lib/agent-orchestrator.ts              │
│                                                                 │
│  • Receive IPC requests                                          │
│  • buildSdkEnv (filter ANTHROPIC_*)                               │
│  • buildSystemPrompt (9-part sandwich, §2.2)                      │
│  • loadCapabilityPacks (reseed Registry by workspace state, §5.2)  │
│  • assembleQueryOptions (agents + hooks assembly, §6)             │
│  • runOrchestratorQuery (sole indirect SDK query entry, §2.1)      │
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
  Master responds       Task dispatches SubAgent       Hook side effects
                          ↓                       ↓
                    ┌───────────────┐      ┌────────────────────┐
                     │  SubAgent      │      │ 1. Permission hard rules │
                    │  subprocess   │      │ 2. paper-meta cap  │
                     │ (child context)│      │ 3. Span recording        │
                     └────────────────┘      │ 4. Pack completion emit  │
                           ↓                 │ 5. Language lock         │
                   tool_result to main stream └─────────────────────────┘
                          ↓                       ↓
                     SDKMessage stream          WorkspaceEventBus
                          ↓                       ↓
                     SDK→AgentEvent             9-event subscription chain
                     (UI passthrough)           (0.3 ProposalDispatcher)
```

**Four-layer responsibilities**:
- **Master Agent**: intent recognition + Task dispatch + system-prompt sandwich, without executing directly
- **SubAgent Registry**: unified builtin / user-config / capability-pack sources, snapshots fed directly to SDK
- **Capability pack**: container for scenario Agent + skillRefs + mcpRefs + uiFramework + (0.3) proposals
- **WorkspaceEventBus**: CRUD for 5 object types + scenario completion → 9 events → 0.3 subscribers drive Proposals

---

<a id="2-主-orchestratormaster-agent"></a>

## §2 Main Orchestrator (Master Agent)

<a id="21-唯一-sdk-query-入口a0-"></a>

### 2.1 Sole SDK Query Entry (A0 ①)

**Hard constraint**: main-process `import { query }` appears only once in [`run-orchestrator-query.ts`](../../apps/electron/src/main/lib/run-orchestrator-query.ts); every other path calls indirectly through `runOrchestratorQuery(opts)`.

```ts
// run-orchestrator-query.ts:73-78
export function runOrchestratorQuery(input: RunOrchestratorQueryInput): AsyncIterable<SDKMessage> {
  const options = assembleQueryOptions(input)
  return input.adapter.query(options)
}
```

Call sites (only two):
- [`agent-orchestrator.ts:1788`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1788) — initial query
- [`agent-orchestrator.ts:2178`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L2178) — resume

<a id="22-system-prompt-sandwich-九段"></a>

### 2.2 Nine-Part System-Prompt Sandwich

[`agent-prompt-builder.ts buildSystemPrompt()`](../../apps/electron/src/main/lib/agent-prompt-builder.ts) concatenates in this order:

| # | Section | Approximate lines | Content |
|---|---|---|---|
| 1 | Identity | L598-608 | “I am ASCI Agent” + Alpha-stage positioning |
| 2 | §0 Operating Philosophy | L615-623 | “Route over execute” — Agent-led + user decisions |
| 3 | Mission | L626-630 | "search comprehensively / synthesize accurately / never hallucinate" |
| 4 | Three Principles | L633-637 | Comprehensiveness / accuracy / anti-hallucination |
| 5 | Capabilities & Boundaries | L640-663 | Capabilities + task acceptance rules + boundaries + Zotero import |
| 6 | My Team (SubAgent definitions) | L667-750 | 4 core builtins (searcher/reader/synthesizer/fact-checker) + model-selection policy |
| 7 | Capability Pack Routing | L756-834 | PLAN dispatch protocol + registered scenario Agents (including sticky pack, §9) |
| 8 | Workspace | L839-903 | cwd / .context/ / paper index / CLAUDE.md |
| 9 | Anti-hallucination Red Lines | L906-911 | 9 `RED_LINES` (defined L60-92) |
| 10 | Handling Uncertainty | L914-923 | AskUserQuestion usage |
| 11 | Tool Usage | L926-939 | Tool conventions + path rules + large-file writes |
| 12 | Output Language directive | End | Routed by both UI language + user-message language |

> The 4 SubAgents in section 6 guide default Master routing without sticky packs; all 7 builtins enter SDK through `options.agents`, and Master may always dispatch any registered subagent_type.

<a id="23-allowedtools-决议矩阵"></a>

### 2.3 allowedTools Decision Matrix

[`agent-orchestrator.master-tools.ts:26-48 resolveMasterAllowedTools()`](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts#L26-L48)

| permissionMode | options.allowedTools |
|---|---|
| `default` | `undefined` (SDK default enables all) |
| `bypassPermissions` | `undefined` (same) |
| `plan` | Full `PLAN_MODE_ALLOWED_TOOLS` (15 entries, including `Task` + `Agent`) |
| `acceptEdits` | Deduplicated `['Task', ...SAFE_TOOLS]` = `['Task', Read, Glob, Grep, WebSearch, WebFetch, TodoRead, TodoWrite, TaskOutput]` |

**A0b constraint**: top-level `options.allowedTools` **accepts only `'Task'`**, not `'Agent'` ([`subagent-tool-name.ts:22`](../../packages/shared/src/utils/subagent-tool-name.ts#L22) `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT='Task'`). `'Agent'` appears only in `PLAN_MODE_ALLOWED_TOOLS` (PreToolUse matcher set) to support SDK `tool_use.name` switching between `Task`/`Agent` (§10).

<a id="24-buildsdkenv-红线继承-claudemd-72"></a>

### 2.4 buildSdkEnv Constraints (CLAUDE.md §7.2)

[`agent-orchestrator.ts buildSdkEnv()`](../../apps/electron/src/main/lib/agent-orchestrator.ts) must preserve:
1. `cleanEnv` filters `ANTHROPIC_` prefixes
2. Finally clear every `ANTHROPIC_*` key not managed by sdkEnv
3. Explicitly add any new SDK-recognized env to `sdkEnv`, or the empty-string loop erases it

---

<a id="3-subagent-registry"></a>

## §3 SubAgent Registry

<a id="31-类型架构"></a>

### 3.1 Type Architecture

[`subagent-registry.ts`](../../apps/electron/src/main/lib/subagent-registry.ts)

```ts
// RegistryEntrySource — 三档来源
type RegistryEntrySource = 'builtin' | 'capability-pack' | 'user-config'

// RegistryEntryKind — 三档种类
type RegistryEntryKind = 'subagent' | 'skill' | 'mcp'
```

Storage keys use `${kind}:${name}`, so identical names across kinds do not conflict ([L104](../../apps/electron/src/main/lib/subagent-registry.ts#L104)).

<a id="32-命名空间冲突策略source_priority"></a>

### 3.2 Namespace Conflict Policy (SOURCE_PRIORITY)

[L107-111](../../apps/electron/src/main/lib/subagent-registry.ts#L107-L111)：

| Source | Priority (smaller=higher) |
|---|---|
| `builtin` | 0 |
| `user-config` | 1 |
| `capability-pack` | 2 |

Four conflict cases ([L151-171](../../apps/electron/src/main/lib/subagent-registry.ts#L151-L171)):

| Case | Behavior |
|---|---|
| Same-name `capability-pack` × `capability-pack` | **Throw immediately** (later activated pack fails loading) |
| New priority higher (`builtin` replaces `user-config`) | Replace + log warn |
| Existing priority higher (`builtin` occupied, new `capability-pack`) | Retain + log warn |
| Equal priority | Retain existing |

<a id="33-注册项校验红线l117-140"></a>

### 3.3 Entry Validation Constraints ([L117-140](../../apps/electron/src/main/lib/subagent-registry.ts#L117-L140))

`validateEntry()` checks at `register()`:
1. `source === 'capability-pack'` requires `packId`
2. For `kind === 'subagent'`:
   - Name cannot be `'general-purpose'` (SDK-reserved)
   - **C1 constraint**: `def.tools` excludes `'Task'` / `'Agent'`; sub-Agents cannot spawn sub-Agents

<a id="34-snapshot-形状"></a>

### 3.4 snapshot() Shape

```ts
// L200-206
snapshot(): { agents: Record<string, AgentDefinition> }
```

Only `kind === 'subagent'` entries; Skill / MCP use separate channels (Skill → inline system prompt; MCP → `options.mcpServers` via `composeMcpServers`).

### 3.5 list() API

```ts
list(filter?: { kind?, source?, packId? }): readonly RegistryEntry[]
```

**A2 invariant**: `snapshot().agents` keys equal `list({ kind: 'subagent' }).map(e => e.name)`.

---

<a id="4-七个-builtin-subagent"></a>

## §4 Seven Builtin SubAgents

[`subagent-registry-seed.ts`](../../apps/electron/src/main/lib/subagent-registry-seed.ts) calls [`buildBuiltinAgents()`](../../apps/electron/src/main/lib/agent-prompt-builder.ts) to seed7 builtin entries at registry startup:

| SubAgent | Prompt location | Model | tools | Responsibility |
|---|---|---|---|---|
| **searcher** | [agent-prompt-builder.ts:161-196](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L161-L196) | haiku | Read/Glob/Grep/Bash/WebSearch/WebFetch | Iterative multisource keyword search + Evidence Table |
| **reader** | [L197-247](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L197-L247) | haiku | Read/Glob/Grep/Bash/WebFetch | Precise single-PDF extraction; abstract fallback on failure (spec §5.7 item4) |
| **synthesizer** | [L249-305](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L249-L305) | sonnet | Read/Glob/Grep/Bash/Write/Edit | lit-review core: Agent-loop streaming HTML-fragment review (spec §5.4 / PR-H) |
| **fact-checker** | [L307-370](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L307-L370) | haiku | Read/Glob/Grep/Bash | Sentence-level traceability; labels `verified / unsupported / contradicted / unchecked` |
| **relevance-scorer** | [L370-401](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L370-L401) | haiku | Read/Glob/Grep/Bash | F22 ranking + batch LLM rerank |
| **citation-explorer** | [L402-430](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L402-L430) | haiku | Read/Glob/Grep/Bash/WebSearch/WebFetch | Forward/backward snowball citations + graph |
| **review-proposer** | [L431-510](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L431-L510) | sonnet | Read/Glob/Grep | lit-review Turn1:3 directions + outline proposal |

<a id="41-共享-schema跨-subagent-协议"></a>

### 4.1 Shared Schema (Cross-SubAgent Protocol)

Central definitions in `agent-prompt-builder.ts`, reused across SubAgent prompts:

- **`RED_LINES`** (L60-92):9 anti-hallucination constraints shared by Section 7/SubAgents
- **`renderEvidenceSchema()`** (L95-108): Evidence Table JSON shared by searcher/reader/synthesizer/fact-checker
- **`buildSubAgentOutputLanguageSection()`** (L123-130): repeat parent language decision to avoid wrong-language output

<a id="42-模型选择策略"></a>

### 4.2 Model Selection

- **haiku** (searcher / reader / fact-checker / relevance-scorer / citation-explorer): frequent, focused, cost-sensitive tasks
- **sonnet** (synthesizer / review-proposer): long reasoning chains

See [agent-prompt-builder.ts:703-712](../../apps/electron/src/main/lib/agent-prompt-builder.ts#L703-L712).

---

<a id="5-能力包子系统"></a>

## §5 Capability-Pack Subsystem

<a id="51-manifest-schema-四红线"></a>

### 5.1 Four Manifest Schema Constraints

[`packages/shared/src/schemas/capability-pack.ts`](../../packages/shared/src/schemas/capability-pack.ts) validates with Zod `.strict()`:

| # | Constraint | Error purpose |
|---|---|---|
| 1 | `strict()` rejects unknown fields | Blocks unauthorized main-Agent overrides such as `masterPrompt` |
| 2 | `packId` kebab-case; scenarioAgent.name cannot equal `'general-purpose'` | Naming constraints |
| 3 | scenarioAgent.prompt must be English (CJK heuristic rejects) | Builtin prompts English (CLAUDE.md §2) |
| 4 | scenarioAgent.tools excludes `'Task'` / `'Agent'` (C1) | Scenario Agent is a SubAgent and cannot spawn more |

<a id="52-加载链路"></a>

### 5.2 Loading Chain

[`capability-pack-loader.ts loadCapabilityPacks()`](../../apps/electron/src/main/lib/capability-pack-loader.ts)：

```
loadCapabilityPacks(registry, opts)
   │
   ├─ 1. reseed：registry.unregister(e => e.source === 'capability-pack')
   │
   ├─ 2. discover: scan packsDir children (default default-capability-packs + ~/.asci/capabilities)
   │
   ├─ 3. Process each pack:
   │      ├─ Read manifest.json → CapabilityPackSchema.safeParse
   │      ├─ User-level isPackEnabled(packId)
   │      ├─ Workspace-level getWorkspacePackOverride(packId)
   │      ├─ resolveEffectiveEnabled(user, override): combine three states
   │      └─ effective=true → registerPack(registry, manifest)
   │
   └─ 4. registerPack：
          ├─ registry.register({ kind: 'subagent', source: 'capability-pack',
          │                       packId, name: scenarioAgent.name, def })
          ├─ For each skillRefs → registry.register({ kind: 'skill', ... })
          └─ For each mcpRefs → registry.register({ kind: 'mcp', ... })
```

<a id="53-用户级-&#45;工作区级三态语义"></a>

### 5.3 User × Workspace Three-State Semantics

[`workspace-capability-pack-state.ts`](../../apps/electron/src/main/lib/workspace-capability-pack-state.ts) `resolveEffectiveEnabled`：

| Workspace override | User isPackEnabled | effective |
|---|---|---|
| Missing key (inherit) | true | ✅ enabled |
| Missing key (inherit) | false | ❌ disabled |
| Explicit `true` | Any | ✅ enabled (workspace force-enable) |
| Explicit `false` | Any | ❌ disabled (workspace disable) |

- **User state**: `~/.asci/capability-pack-state.json` ([`config-paths.ts:518-520`](../../apps/electron/src/main/lib/config-paths.ts#L518-L520) `getCapabilityPackStatePath()`)
- **Workspace state**: `~/.asci/agent-workspaces/<slug>/capabilities.json` ([`config-paths.ts:533-535`](../../apps/electron/src/main/lib/config-paths.ts#L533-L535) `getWorkspaceCapabilitiesPath()`)

<a id="54-toggle-行为"></a>

### 5.4 Toggle Behavior

[`capability-pack-service.ts:149`](../../apps/electron/src/main/lib/capability-pack-service.ts#L149) `toggleCapabilityPack(packId, enabled)`：
- Write state JSON only
- **No proactive Registry reseed**: next `runAgent` → `loadCapabilityPacks` naturally reseeds under new state
- Fallback implementation of spec §6.3 immediate enumeration: the next query necessarily reseeds

<a id="55-02-首发三包"></a>

### 5.5 Three Initial 0.2 Packs

| Pack | Path | scenarioAgent | mcpRefs | subAgentRefs | uiFramework |
|---|---|---|---|---|---|
| **lit-search** | [apps/electron/default-capability-packs/lit-search/manifest.json](../../apps/electron/default-capability-packs/lit-search/manifest.json) | name=`lit-search`, model=sonnet, tools=[] | `paper-search` | `searcher` / `relevance-scorer` / `citation-explorer` | `conversation-and-artifact` |
| **lit-review** | [apps/electron/default-capability-packs/lit-review/manifest.json](../../apps/electron/default-capability-packs/lit-review/manifest.json) | name=`lit-review`, model=sonnet, tools=[] | `paper-search` | `review-proposer` / `synthesizer` / `reader` / `fact-checker` | `conversation-and-artifact` |
| **mock-pack-1** | [apps/electron/test-fixtures/capability-packs/mock-pack-1/](../../apps/electron/test-fixtures/capability-packs/mock-pack-1/) | Test fixture | — | — | — |

> lit-search / lit-review scenarioAgents are minimal PLAN-only dispatchers (spec §5.1 principle01: only 2 LLM calls per turn, opening + closing, without interrupting SubAgent execution).\
> Empty tools means the scenario Agent **calls no MCP itself**; all work goes to builtin subAgentRefs.\
> mcpRefs only tells Master the pack needs paper-search MCP; `composeMcpServers` merges actual injection during query assembly.

<a id="56-配置页"></a>

### 5.6 Configuration Page

[`apps/electron/src/renderer/components/config/ConfigView.tsx`](../../apps/electron/src/renderer/components/config/ConfigView.tsx) is the sidebar's independent “Configuration” route, alongside “Library.” Two sections:

- **Capability packs**: [`CapabilityPackPanel.tsx`](../../apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx), list + toggle + manifest errors
- **Skills**: placeholder (`t('skillsPanel.comingSoon')`), spec §6.4 pending

---

<a id="6-sdk-options-装配"></a>

## §6 SDK Options Assembly

<a id="61-assemblequeryoptions-全景"></a>

### 6.1 assembleQueryOptions Overview

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

<a id="62-关键约束"></a>

### 6.2 Key Constraints

- **Full agents replacement**: `snapshot.agents` replaces `baseOptions.agents` entirely (`Omit<..., 'agents'>` prevents accidental input); all sub-Agents register through Registry, not caller construction
- **Hook merging**: all four hooks use `concat`, not `overwrite`; retain base entries and append new ones
- **PreToolUse / PostToolUse order**: baseOptions first (permission hard rules), paper-meta-cap afterward

<a id="63-baseoptions-的提供方"></a>

### 6.3 baseOptions Provider

[`agent-orchestrator.ts:1576-1604`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1576-L1604) prefills:

- **PreToolUse**: `permissionService.createPreToolUseHardRuleHookForSession(sessionId, ...)`
- **PostToolUse**: language-lock additionalContext injection (H1)

`assembleQueryOptions` appends paper-meta-cap entries after these.

---

<a id="7-hooks-链"></a>

## §7 Hook Chains

<a id="71-pretooluse-链"></a>

### 7.1 PreToolUse Chain

| Order | Entry matcher | Source | Purpose |
|---|---|---|---|
| 1 | `'*'` | [`agent-permission-service.ts:138-163`](../../apps/electron/src/main/lib/agent-permission-service.ts#L138-L163) | Hard rules (Bash blacklist / dangerous paths / filesystem constraints) |
| 2 | `'mcp__paper-search__get_paper_meta'` | [`paper-meta-cap-hook.ts`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) | spec §5.6 cap=3 / fail≥2 early stop; limit returns `permissionDecision: 'deny'` |

<a id="72-posttooluse-链"></a>

### 7.2 PostToolUse Chain

| Order | Entry matcher | Source | Purpose |
|---|---|---|---|
| 1 | `'*'` | [`agent-orchestrator.ts:1590-1604`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1590-L1604) | H1 language lock: append additionalContext repeating Output Language directive after every tool_result |
| 2 | `'mcp__paper-search__get_paper_meta'` | [`paper-meta-cap-hook.ts`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) | Count attempts/failures; MCP `tool_response.isError === true` means failure |

<a id="73-subagentstart-链"></a>

### 7.3 SubagentStart Chain

| Order | matcher | Source | Purpose |
|---|---|---|---|
| 1 | `'*'` | [`subagent-spans-hook.ts:38-44`](../../apps/electron/src/main/lib/subagent-spans-hook.ts#L38-L44) | A0a append scenarioAgentName + startedAt span to SpanSink; persist session meta |

<a id="74-subagentstop-链"></a>

### 7.4 SubagentStop Chain

| Order | matcher | Source | Purpose |
|---|---|---|---|
| 1 | `'*'` | [`subagent-spans-hook.ts:46-64`](../../apps/electron/src/main/lib/subagent-spans-hook.ts#L46-L64) | A0a FIFO pair earliest start; fill finishedAt/success/durationMs |
| 2 | `'*'` | [`pack-task-completed-hook.ts:43-49`](../../apps/electron/src/main/lib/pack-task-completed-hook.ts#L43-L49) | spec §3.1 #9 emit `pack.taskCompleted` to WorkspaceEventBus for capability-pack entries |

<a id="75-paper-meta-cap-工作流细节"></a>

### 7.5 paper-meta-cap Workflow Details

```
get_paper_meta called N times:
  N=1: PreToolUse(attempts=0) → allow → tool runs → PostToolUse → attempts=1
  N=2: PreToolUse(attempts=1) → allow → tool runs → PostToolUse → attempts=2
  N=3: PreToolUse(attempts=2) → allow → tool runs → PostToolUse → attempts=3
  N=4: PreToolUse(attempts=3) → DENY ❌ → Chinese reason (review reached 3-call cap): "[paper-meta-cap] 本轮综述已调用 3 次（上限 3）..."

Or failure early stop:
  N=1: PreToolUse → allow → tool runs（isError=true）→ PostToolUse → attempts=1, failures=1
  N=2: PreToolUse → allow → tool runs（isError=true）→ PostToolUse → attempts=2, failures=2
  N=3: PreToolUse(failures=2 ≥ 2)→ DENY ❌ "连续失败 2 次（早停阈值 2）" (2 consecutive failures, early-stop threshold 2)
```

Constants ([`paper-meta-cap-hook.ts:24-28`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts#L24-L28)):
- `GET_PAPER_META_TOOL = 'mcp__paper-search__get_paper_meta'`
- `GET_PAPER_META_CAP = 3`
- `GET_PAPER_META_FAIL_EARLY_STOP = 2`

---

<a id="8-工作区事件总线"></a>

## §8 Workspace Event Bus

<a id="81-总线-api"></a>

### 8.1 Bus API

[`workspace-event-bus.ts`](../../apps/electron/src/main/lib/workspace-event-bus.ts): module singleton `workspaceEventBus`.

```ts
class WorkspaceEventBus {
  emit(event: WorkspaceEvent): void                              // 同步 emit；handler 错误 swallow + console.error
  on(handler): () => void                                        // 全量监听
  on<K>(kind: K, handler: Handler<Extract<E, {kind: K}>>): () => void  // 按 kind 过滤
  dispose(): void                                                // 测试隔离
}
```

Design tradeoffs:
- **Synchronous emit**: spec §3.3 forbids async
- **Swallow handler errors**: subscribers must not break Repository CRUD
- **No middleware**: no0.2 speaker/scoped requirements; adding them blurs semantics

<a id="82-四个事件spec-31"></a>

### 8.2 Four Events (Spec §3.1)

Types in [`packages/shared/src/types/workspace-events.ts`](../../packages/shared/src/types/workspace-events.ts).
Historical removals: `evidenceSet.created` / `evidenceSet.paperAdded` / `note.created` / `note.updated`
were removed with the0.2 data-model refactor (c1fda468); `citationRelation.created` removed with 0.4 CitationRelation
retirement (#718).

| # | Event kind | Emit location | Trigger |
|---|---|---|---|
| 1 | `paper.created` | [paper-repository.ts:89](../../apps/electron/src/main/lib/objects/repositories/paper-repository.ts#L89) | createPaper |
| 2 | `paper.deleted` | [paper-repository.ts:227](../../apps/electron/src/main/lib/objects/repositories/paper-repository.ts#L227) | softDeletePaper |
| 3 | `evidenceRef.created` | [evidence-ref-repository.ts:67](../../apps/electron/src/main/lib/objects/repositories/evidence-ref-repository.ts#L67) | createEvidenceRef (review pipeline inline output) |
| 4 | `pack.taskCompleted` | [pack-task-completed-hook.ts](../../apps/electron/src/main/lib/pack-task-completed-hook.ts) → SubagentStop hook | Scenario Agent completion with `source='capability-pack'` |

<a id="83-emit-owner-划分spec-32"></a>

### 8.3 Emit Ownership (Spec §3.2)

| Events | Owner | Implementation |
|---|---|---|
| #1-#2 | **fanlizhi** | Inline Repository CRUD emit |
| #3 | **liningftp** | Review createEvidenceRef → inline Repository emit |
| #4 | **liningftp** | SDK SubagentStop → registry lookup → capability-pack only |

> 0.2 §3.2 assigned inline Repository emits to fanlizhi; liningftp implemented them this session to close the event-bus loop. Later fanlizhi review/takeover is inexpensive because emits are localized changes.

<a id="84-订阅者"></a>

### 8.4 Subscribers

- **0.2**: tests (5 `workspaceEventBus.on` calls, all `*.test.ts`); **no production runtime subscribers**
- **0.3**: `ProposalDispatcher.subscribe('paper.created', ...)` etc. → background async subprocesses automatically produce Proposals

---

<a id="9-会话粘滞-&#45;意图切换"></a>

## §9 Session Stickiness + Intent Switching

<a id="91-stickycapabilitypackid-数据流"></a>

### 9.1 stickyCapabilityPackId Data Flow

```
                         ┌─────────────────────────┐
        sessionMeta:     │ stickyCapabilityPackId? │
                         └─────────────────────────┘
                                  ↑           ↓
       Cleared by IPC when intent           Read (agent-orchestrator.ts:1536)
       switch is detected                              ↓
   (detect-intent-switch.ts)             Registry lookup resolves
                                  stickyCapabilityPack: {
                                    packId, scenarioAgentName,
                                    scenarioAgentDescription
                                  }
                                              ↓
                          Inject into buildSystemPrompt(ctx.stickyCapabilityPack)
                                              ↓
                    agent-prompt-builder.ts:821-831 appends "Active sticky pack"
                    after the "Capability Pack Routing" section
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

<a id="92-意图切换检测"></a>

### 9.2 Intent-Switch Detection

[`detect-intent-switch.ts`](../../apps/electron/src/main/lib/detect-intent-switch.ts)（spec §4.3）：
- Clear `stickyCapabilityPackId` when user intent clearly diverges from sticky pack
- Explicit user `@主` (“main”) forces rerouting too

<a id="93-默认透传d-c"></a>

### 9.3 Default Passthrough (D-C)

Scenario Agent events (tool_use / tool_result / streamed text) **bypass Master directly to UI**: `convertSDKMessage` converts to `AgentEvent`, `webContents.send` pushes renderer-side with speaker identity ([`resolve-message-speaker.ts`](../../apps/electron/src/renderer/components/agent/resolve-message-speaker.ts)).

---

<a id="10-task-&#45;agent-双名兼容c5"></a>

## §10 Task ↔ Agent Dual-Name Compatibility (C5)

Around SDK v2.1.63, `tool_use.name` switches between `'Task'` / `'Agent'`; all sub-Agent dispatch detection must **OR both names**, while `system:init` / `permission_denials` / `options.allowedTools` input sites **accept only `'Task'`**.

<a id="101-派发语义位点双名-or"></a>

### 10.1 Dispatch Sites (Dual-Name OR)

Unified through [`subagent-tool-name.ts isSubagentToolUse()`](../../packages/shared/src/utils/subagent-tool-name.ts):

```ts
export const SUBAGENT_TOOL_NAMES = ['Task', 'Agent'] as const
export const isSubagentToolUse = (tool: { name: string }): boolean =>
  SUBAGENT_TOOL_NAMES.includes(tool.name as never)
```

Call sites:

| File:line | Purpose |
|---|---|
| [message-stream-converter.ts:29](../../packages/shared/src/utils/message-stream-converter.ts#L29) | SDK→AgentEvent sub-Agent dispatch detection |
| [agent-permission-service.ts:392](../../apps/electron/src/main/lib/agent-permission-service.ts#L392) | Permission UI banner description |
| [agent-permission-service.ts:428](../../apps/electron/src/main/lib/agent-permission-service.ts#L428) | i18n key routing |
| [agent-permission-service.ts:452](../../apps/electron/src/main/lib/agent-permission-service.ts#L452) | Danger-level classification |
| [subagent-registry.ts:133](../../apps/electron/src/main/lib/subagent-registry.ts#L133) | C1 excludes Task/Agent from child tools |
| [capability-pack.ts:41](../../packages/shared/src/schemas/capability-pack.ts#L41) | Same validation for scenarioAgent.tools |

<a id="102-输入侧-only-task-位点"></a>

### 10.2 Input Sites Accepting Only `'Task'`

| File:line | Purpose |
|---|---|
| [subagent-tool-name.ts:22](../../packages/shared/src/utils/subagent-tool-name.ts#L22) | `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT = 'Task'` constant |
| [agent-allowed-tools.ts:14](../../apps/electron/src/main/lib/agent-allowed-tools.ts#L14) | `PLAN_MODE_ALLOWED_TOOLS` contains `'Task'` (also `'Agent'`, but used for PreToolUse filtering, not top-level allowedTools) |
| [agent-orchestrator.master-tools.ts:42](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts#L42) | acceptEdits injects `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT` |

<a id="103-c5-验收锚点"></a>

### 10.3 C5 Acceptance Anchor

Search all `block.name === '` / `.tool_name === '` / `tool_use.name ===` sites: dispatch uses dual-name OR; `system:init` / `permission_denials` only `"Task"`; zero mismatches.

---

<a id="11-关键文件索引"></a>

## §11 Key File Index

<a id="主进程-lib"></a>

### Main-Process lib/

| File | Responsibility |
|---|---|
| [agent-orchestrator.ts](../../apps/electron/src/main/lib/agent-orchestrator.ts) | Orchestration; runAgent / persistSDKMessages / canUseTool queue / watchdog / retry |
| [agent-orchestrator.master-tools.ts](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts) | `resolveMasterAllowedTools` decisions |
| [agent-allowed-tools.ts](../../apps/electron/src/main/lib/agent-allowed-tools.ts) | `PLAN_MODE_ALLOWED_TOOLS` set |
| [run-orchestrator-query.ts](../../apps/electron/src/main/lib/run-orchestrator-query.ts) | **Sole** indirect SDK `query` entry + `assembleQueryOptions` |
| [agent-prompt-builder.ts](../../apps/electron/src/main/lib/agent-prompt-builder.ts) | `buildSystemPrompt` +7 builtin prompts + RED_LINES |
| [agent-permission-service.ts](../../apps/electron/src/main/lib/agent-permission-service.ts) | Permissions + PreToolUse hard rules + canUseTool |
| [agent-event-bus.ts](../../apps/electron/src/main/lib/agent-event-bus.ts) | **SDK stream event bus**, distinct from workspace bus |
| [agent-session-manager.ts](../../apps/electron/src/main/lib/agent-session-manager.ts) | Session persistence; stickyCapabilityPackId |
| [subagent-registry.ts](../../apps/electron/src/main/lib/subagent-registry.ts) | Three sources × three kinds |
| [subagent-registry-seed.ts](../../apps/electron/src/main/lib/subagent-registry-seed.ts) | `seedBuiltinSubagents` registers7 builtins at startup |
| [subagent-spans-hook.ts](../../apps/electron/src/main/lib/subagent-spans-hook.ts) | SubagentStart/Stop telemetry hook |
| [pack-task-completed-hook.ts](../../apps/electron/src/main/lib/pack-task-completed-hook.ts) | SubagentStop → `pack.taskCompleted` |
| [paper-meta-cap-hook.ts](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) | spec §5.6 cross-pack gap-fill cap=3 / fail≥2 early stop |
| [capability-pack-loader.ts](../../apps/electron/src/main/lib/capability-pack-loader.ts) | `loadCapabilityPacks` scan + reseed + register |
| [capability-pack-service.ts](../../apps/electron/src/main/lib/capability-pack-service.ts) | `toggleCapabilityPack` writes state |
| [workspace-capability-pack-state.ts](../../apps/electron/src/main/lib/workspace-capability-pack-state.ts) | Workspace three-state overrides |
| [workspace-event-bus.ts](../../apps/electron/src/main/lib/workspace-event-bus.ts) | **Workspace object event bus** (9 events) |
| [detect-intent-switch.ts](../../apps/electron/src/main/lib/detect-intent-switch.ts) | Sticky-pack intent changes |
| [litreview-sdk-mcp.ts](../../apps/electron/src/main/lib/litreview-sdk-mcp.ts) | In-pack lit-review SDK MCP server (present_directions tool) |

### Shared types

| File | Responsibility |
|---|---|
| [packages/shared/src/types/workspace-events.ts](../../packages/shared/src/types/workspace-events.ts) | 9 `WorkspaceEvent` types |
| [packages/shared/src/schemas/capability-pack.ts](../../packages/shared/src/schemas/capability-pack.ts) | Zod manifest + four constraints |
| [packages/shared/src/utils/subagent-tool-name.ts](../../packages/shared/src/utils/subagent-tool-name.ts) | `SUBAGENT_TOOL_NAMES` / `isSubagentToolUse` / `SUBAGENT_TOOL_ALLOWED_TOOLS_INPUT` |
| [packages/shared/src/constants/permission-rules.ts](../../packages/shared/src/constants/permission-rules.ts) | `SAFE_TOOLS` |

### Renderer

| File | Responsibility |
|---|---|
| [config/ConfigView.tsx](../../apps/electron/src/renderer/components/config/ConfigView.tsx) | Sidebar Configuration page (packs + Skills placeholder) |
| [config/CapabilityPackPanel.tsx](../../apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx) | Pack list + toggles |
| [settings/SettingsPanel.tsx](../../apps/electron/src/renderer/components/settings/SettingsPanel.tsx) | Settings dialog11 tabs (including mcp + datacollection) |
| [agent/resolve-message-speaker.ts](../../apps/electron/src/renderer/components/agent/resolve-message-speaker.ts) | Speaker badges (main/scenario Agent/pack name) |

<a id="内置能力包"></a>

### Builtin Capability Packs

| Path | Description |
|---|---|
| [apps/electron/default-capability-packs/lit-search/](../../apps/electron/default-capability-packs/lit-search/) | Search manifest |
| [apps/electron/default-capability-packs/lit-review/](../../apps/electron/default-capability-packs/lit-review/) | Review manifest |
| [apps/electron/test-fixtures/capability-packs/](../../apps/electron/test-fixtures/capability-packs/) | Fixtures (mock-pack-1 / mock-pack-broken-redline) |

---

<a id="附录-a硬约束清单速查"></a>

## Appendix A: Hard-Constraint Quick Reference

| ID | Constraint | Acceptance anchor |
|---|---|---|
| A0 ① | `import { query }` only in `run-orchestrator-query.ts`, once | Repository search finds exactly 1 occurrence in that file |
| A0 ② | Master allowedTools excludes Bash/Edit/Write (except acceptEdits, which includes SAFE_TOOLS but still excludes Bash/Edit/Write) | [`agent-orchestrator.master-tools.ts:26-48`](../../apps/electron/src/main/lib/agent-orchestrator.master-tools.ts#L26-L48) |
| A0a | SubagentStart/Stop hooks connected | [`run-orchestrator-query.ts:69-77`](../../apps/electron/src/main/lib/run-orchestrator-query.ts#L69-L77) |
| A0b / C5 | Task↔Agent dual-name compatibility | §10 |
| A2 | snapshot.agents keys = list({kind:'subagent'}).map(name) | [`subagent-registry.ts:200-206`](../../apps/electron/src/main/lib/subagent-registry.ts#L200-L206) |
| A3 | Mock pack contract registration + routing + UI + `pack.taskCompleted` emit | §7.4 + §8.2 #9 |
| C1 | Child tools exclude Task/Agent | [`subagent-registry.ts:131-138`](../../apps/electron/src/main/lib/subagent-registry.ts#L131-L138) + [`capability-pack.ts:41`](../../packages/shared/src/schemas/capability-pack.ts#L41) |
| H1 | PostToolUse repeats language lock (except anthropic native) | [`agent-orchestrator.ts:1590-1604`](../../apps/electron/src/main/lib/agent-orchestrator.ts#L1590-L1604) |
| §3.3 | Synchronous9-event emit | [`workspace-event-bus.ts`](../../apps/electron/src/main/lib/workspace-event-bus.ts), no async in emit |
| §5.6 | get_paper_meta cap=3 / fail≥2 early stop | [`paper-meta-cap-hook.ts`](../../apps/electron/src/main/lib/paper-meta-cap-hook.ts) |

---

<a id="附录-b版本注记"></a>

## Appendix B: Version Notes

- **Document version**: first edition2026-05-25
- **Aligned source**: [`agent-and-capability-pack-spec.md`](../milestones/0.2/agent-and-capability-pack-spec.md),2026-05-23
- **Future revisions**: line numbers drift; use this as a roadmap, with source comments + git blame authoritative for implementation
