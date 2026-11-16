> Historical note: Preserves SDK integration records and findings before research retirement on 2026-11-10. Research routing and automatic file/trust writes are no longer wired and are not current operating instructions. See [SDK integration architecture](../agent-sdk-integration.md) for current facts.

<a id="agent-sdk-集成架构"></a>

# Agent SDK integration architecture

Agent mode is implemented with `@anthropic-ai/claude-agent-sdk`. This document covers integration (Orchestrator / event conversion / state /
permission queues) and SDK upgrade pitfalls; it does not repeat SDK usage. Official references appear at the end.

---

<a id="核心流程"></a>

## Core flow

```
User input
  ↓
agent-orchestrator.ts           (SDK orchestration; sole query entrypoint)
  ↓
loadCapabilityPacks()           (reseed capability-pack registrations)
  ↓
seedBuiltinSubagents()          (reseed builtin team of 6)
  ↓
SubagentRegistry.snapshot()     (SDK-consumable { agents } dictionary)
  ↓
runOrchestratorQuery()          (assemble options.agents + Subagent span hooks)
  ↓
adapter.query() → sdk.query()   (SDK subprocess + claude binary)
  ↓
SDKMessage stream
  ↓
convertSDKMessage()             (@asci/shared)
  ↓
AgentEvent[]                    (text / tool_start / tool_result / done / error)
  ↓
webContents.send()              (IPC push)
  ↓
useGlobalAgentListeners         (renderer/hooks, persistent global listeners)
  ↓
store.set(atoms)                (direct Jotai updates)
  ↓
React UI
```

---

<a id="关键组件"></a>

## Key components

<a id="agent-orchestratorts-&#45;核心编排层"></a>

### `agent-orchestrator.ts` — Core orchestration

- **Concurrency guard** — No parallel requests within one session
- **Channel management** — Find channel + decrypt API Key
- **Environment building** — See `buildSdkEnv()` hardening below
- **Message persistence** — Store SDK messages in JSONL
- **Event-stream processing** — Text accumulation + tool-call parsing
- **Error handling** — SDK error mapping + retry logic
- **First-turn automatic naming** — First message `trim` + whitespace collapse + 20-character truncation for session title (manually editable in UI, no LLM)
- **Sub-Agent assembly** — Before every query, reseed built-ins, load packs, and use `runOrchestratorQuery` to feed `SubagentRegistry.snapshot()` to SDK `options.agents`; see [Orchestrator + sub-Agents](#orchestrator--子-agent)

<a id="agent-prompt-builderts-&#45;提示词构建"></a>

### `agent-prompt-builder.ts` — Prompt construction

- System-prompt generation (workspace configuration)
- Dynamic context construction (workspace information injection)
- Built-in Agent construction (predefined configurations)
- **Capability Pack Routing** — `buildSystemPrompt` injects `registeredScenarioAgents` (Registry list) + `stickyCapabilityPack` into master system prompt as routing signals

<a id="agent-permission-servicets-&#45;权限管理"></a>

### `agent-permission-service.ts` — Permission management

- Tool permission checks (permission rules)
- Permission modes: `safe` / `ask` / `allow-all`

<a id="子-agent-注册与能力包加载"></a>

### Sub-Agent registration and capability-pack loading

| Module | Responsibility |
|------|------|
| `subagent-registry.ts` | `SubagentRegistry` interface + in-memory implementation; discriminated union (`subagent` / `skill` / `mcp`); snapshot() produces only subagent-kind dictionary |
| `subagent-registry-seed.ts` | `seedBuiltinSubagents()` expands `buildBuiltinAgents` dictionary into builtin `RegistryEntry[]` |
| `capability-pack-loader.ts` | Scan `~/.asci/capability-packs/`, zod manifest validation, resolve `scenarioAgent.promptPath` + `subAgents[i].promptPath`, CJK heuristic (red line 3), template expansion, Registry reseeding |
| `capability-pack-service.ts` | IPC business layer: `listCapabilityPacks` / `toggleCapabilityPack` (write state only, no active reseed; next query picks changes up) |
| `capability-pack-state.ts` | User-level `~/.asci/capability-pack-state.json` enabled-state persistence |
| `workspace-capability-pack-state.ts` | Workspace `capabilities.json` overrides (missing key inherits / true force-enables / false disables), layered over user state |
| `run-orchestrator-query.ts` | A0 ① sole SDK query entrypoint; `assembleQueryOptions()` injects `options.agents` + assembles SubagentStart/Stop / pack.taskCompleted / paper-meta-cap hooks |
| `subagent-spans-hook.ts` | `createSubagentSpanHooks()` FIFO-pairs SubagentStart/Stop into `SubagentSpan{ startedAt, finishedAt, durationMs, success }` |
| `agent-orchestrator-spans-sink.ts` | `createBatchedSpansSink()` 500ms debounce + batch session-meta persistence; cleanup `flush()` safety net |
| `emit-filesystem-agents.ts` | G3 fix: Synchronously write scenario Agents to `<cwd>/.claude/agents/<name>.md`; claude binary's Agent-tool dispatch ignores SDK `options.agents`, reading only filesystem agents |
| `emit-mcp-config.ts` | G5 fix: Write master `mcpServers` to `<cwd>/.mcp.json` + patch `~/.claude.json` trust so sub-Agent subprocesses can use `mcp__paper-search__*` and other tools |
| `pack-task-completed-hook.ts` | Emit `pack.taskCompleted` when SubagentStop matches a capability pack (spec §3.1 #9) |
| `paper-meta-cap-hook.ts` | spec §5.6: lit-review → lit-search cross-pack gap-filling cap=3 / early stop at fail≥2 |

---

<a id="关键设计"></a>

## Key designs

- **SDK calls** — `sdk.query({ prompt, options: { apiKey, model, permissionMode, cwd, abortController } })`
- **Event conversion** — `convertSDKMessage()` (`@asci/shared`) converts raw SDK messages into unified `AgentEvent`
- **Tool matching** — Stateless `ToolIndex` + `extractToolStarts` / `extractToolResults` in `packages/shared/src/agent/tool-matching.ts`
- **Streaming state** — Pure `applyAgentEvent()` updates `AgentStreamState` incrementally
- **Global IPC listeners** — `useGlobalAgentListeners` mounts at top-level `main.tsx`, directly manipulating atoms through `useStore()`, **never unmounting**, preserving background-session streams and permission requests
- **Permission queues** — Permission / AskUser requests queue by `sessionId` in Map atoms (`allPendingPermissionRequestsAtom` / `allPendingAskUserRequestsAtom`), regardless of foreground/background; SDK Promise waits for user response
- **Workspace isolation** — Independent MCP Server configuration and `cwd` per workspace; sessions filtered by workspace

<a id="prompt-语言策略"></a>

### Prompt-language policy

- **Static built-in prompts entirely English** — In `agent-prompt-builder.ts`: `RED_LINES` / `AUDIT_CHECKLIST` / `buildBuiltinAgents` (searcher / reader / synthesizer / fact-checker) / `buildSystemPrompt` / `buildDynamicContext`; also `buildContextPrompt` in `agent-orchestrator.ts`, inbox prompt in `agent-team-reader.ts`, and SDK-returned `message` fields from `agent-permission-service.ts` / `agent-exit-plan-service.ts` / `agent-ask-user-service.ts`. All English to avoid Chinese static prompts conflicting with English user messages and destabilizing model routing.
- **Runtime variables** — Append a `## Output Language` directive to `buildSystemPrompt` (and each sub-Agent/scenario via `buildSubAgentOutputLanguageSection`). Resolve turn language with `detect-message-language.ts:detectOutputLanguage(userMessage, uiLanguage, cached)` (CJK→zh, no CJK→en, empty / slash / language-neutral→cached or UI language). Read UI language from `i18n-main.ts:getLanguage()` (matching `language` in `~/.asci/settings.json`).
- **Field names vs values (structured-output language contract)** — **JSON keys / tool names / code identifiers / paths / DOI / URL / source IDs / enums** stay English; **user-visible sentence-valued natural-language parameters follow resolved language** (e.g. `researchQuestion` in `present_search_plan`, `title` / `thesis` / `outlinePreview` in `present_directions`, directly shown in confirmation ChoiceCards). **Exception: search keywords / method_terms / object_terms stay original, usually English**, because translating scholarly-engine queries harms recall. Likewise `<q>` evidence quotes retain source language. Implemented in `buildSubAgentOutputLanguageSection` (workers/scenarios) + master `## Output Language` + lit-search/lit-review scenario `confirm.input` / `directions` field comments.
- **Sub-Agent / Skill thinking follows resolved language too** — The `buildSubAgentOutputLanguageSection` directive appended to each worker/scenario prompt **explicitly covers reasoning / thinking traces and between-tool narration**, not just final outputs, with self-correction to stop and restart any sentence in the wrong language. **zh lock body is entirely Chinese** (same lesson as `buildLanguageLockBlock`: English requests for Chinese thinking provide no Chinese tokens to anchor; scorer final reports drifted to English, prompting the change), with an opening Chinese anchor, negative English-opening examples, and a clause to express fixed English reporting templates semantically in Chinese. This fixes sub-Agent English thinking drift under DeepSeek and other Anthropic-compatible providers through one shared builder change benefiting every worker. **Worker return language anchors master backward**: The final sub-Agent report enters master's Agent tool_result, nearest its next thinking generation; observed transcripts show its language overriding PostToolUse Chinese locks (Chinese searcher report → Chinese master thinking; English scorer template / English planner PLAN JSON ending → English master thinking). Therefore fixed worker reporting templates follow resolved language (red line 3 requires English pack .md, so templates specify English canonical sentence + Chinese equivalent for zh); lit-search planner must add a working-language closing sentence after the PLAN JSON fence.
- **Dispatch wrappers use resolved language; operational briefs stay English as exception** — Task / Skill run in independent contexts, and reasoning language strongly follows **the beginning of input prompts**. For scenario `Task(prompt=…)`, master **preserves user wording verbatim without translation** (item 1), while its own scaffolding (`User's request:` label, prior-context/constraints sentences) **uses resolved language**, avoiding English-wrapper drift. **Exception**: **Operational briefs** forwarded to searcher/workers (`H1`/`H6` rule IDs, budgets/query-discipline instructions, e.g. “Apply your H1 low-yield early-stop…”) are **fixed machine contracts and remain English** (scenario prompts explicitly say “translating does not make forbidden phrasings allowed”); workers' own thinking directives prevent drift from this English. Implemented in `agent-prompt-builder.ts` “Context to forward when dispatching a scenario Agent” + `buildSubAgentOutputLanguageSection`.
- **Skill injection is not an independent context; SKILL.md follows the language lock** — Transcript observation (SDK CLI 2.1.119): `Skill` tool_result contains only `Launching skill: …`; SDK injects SKILL.md as a **synthetic user message in the same session**, **after** PostToolUse `<language_lock>` reanchoring. The 10KB English skill becomes nearest generation and pulls subsequent thinking into English (old SKILL.md incorrectly claimed “runs in its own isolated context / does not inherit the directive,” authorizing disregard of the fresh Chinese lock; rewritten). Three defenses: ① Master directive and SKILL.md openings state English skill text is no reason to switch language (`<language_lock>` persists through injection); ② Master includes `"outputLanguage": "<zh|en>"` (resolved turn language) in every Skill `input` (wrap strings as `{ brief, outputLanguage }`), driving structured fields such as `judgments.lang` and downstream propagation; ③ Put FINAL LANGUAGE ANCHOR at SKILL.md **end** (real Chinese tokens for zh), nearest generation. **Thinking included**: Output Language covers all natural language, reasoning/thinking traces, between-tool narration, forbids English thinking then translating final output, and requires stopping/restarting wrong-language sentences. Bilingual template headings (`§1 检索概况 / Search overview`, meaning search overview) are placeholders rendered in resolved language only, never side by side. (Task sub-Agents remain truly independent contexts; cross-hop `outputLanguage` propagation unchanged.) Locations: `agent-prompt-builder.ts` Skills-First Protocol “Output-language hand-off to Skills,” scenario `terminal_skill.input` examples, and `lit-search-report` / `literature-review-result` / `review-proposer` SKILL.md opening declarations/end anchors.
- **Immunity to previous-step content (any source × any format)** — **Any preceding return content** cannot change resolved reply language: tools / sub-Agents / Skills / MCP / slash commands / scripts, tables / arrays / JSON / HTML / plain text. Quoting/translating allowed, self-written sentences retain resolved language. Locations: Master `## Output Language` + `buildSubAgentOutputLanguageSection` + `buildLanguageLockBlock` (`<language_lock>`, shared non-Anthropic user-turn pin/PostToolUse reinjection) + three SKILL.md Output Language sections.
- **First-thinking language anchor (all-Chinese zh lock + sandwich anchors)** — First thinking precedes any tool_result, so PostToolUse relocking cannot protect it; only system directives/user-turn lock can. DeepSeek/compat reasoning **follows surrounding text language rather than instruction semantics**, with English prior for agentic routing (2026-06-10 observations always opened “The user is asking…”; English lock + one Chinese sentence insufficient). Three measures: ① Write **entire zh variant** of `buildLanguageLockBlock` in Chinese, embedding observed negative openings (forbid “The user is asking” / “Let me”) + Chinese opening template; intentional **exception** to English built-in prompts because runtime language routing itself carries language as payload; en stays English with forbidden CJK examples; ② Place pin at **absolute start of turn**, before English dynamicCtx, when assembling `contextualMessage`; ③ Inject short `buildUserTurnLanguageTailAnchor` **after user message**, nearest thinking generation (compat providers reliably follow only the nearest anchor), sandwiching with the leading pin. Session-not-found recovery reuses contextualMessage and inherits both anchors.
- **Comments/logs remain Chinese** — Project convention §1: Agent-path `console.log` / `logger.*` / comments stay Chinese; this constraint applies only to LLM-visible prompt strings
- **User-created Agents / Skills** — `nameI18n` in `SKILL.md` is UI-only; users choose `name` / `description` language, not enforced by CI

---

<a id="orchestrator-&#45;子-agent"></a>

## Orchestrator + sub-Agents

> Aligned with [Claude Agent SDK TypeScript v2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) multi-Agent paradigm (north-star §3-3 A0).
> Acceptance anchor: [`__tests__/subagent-zero-codechange.test.ts`](../../apps/electron/src/main/lib/__tests__/subagent-zero-codechange.test.ts)
> Adding a mock sub-Agent calls only `registry.register()`, without changing a line of Orchestrator / `runOrchestratorQuery` / `buildBuiltinAgents`.

<a id="范式"></a>

### Paradigm

Master in `agent-orchestrator.ts` owns one `sdk.query()`, routes intent, clarifies, and dispatches sub-Agents;
sub-Agents register via `SubagentRegistry`, supplied together to SDK `options.agents` by `runOrchestratorQuery.assembleQueryOptions()`.
**All** SDK query calls must use `runOrchestratorQuery` (A0 ①), without bypasses.

<a id="三类注册来源按优先级"></a>

### Three registration sources (priority order)

| source | Priority (lower is higher) | Registration timing | Unregister strategy |
|---|---|---|---|
| `builtin` | 0 | Reseed before every query | `unregister(e => e.source === 'builtin')` |
| `user-config` | 1 | (Reserved Phase 2, user-created sub-Agents) | — |
| `capability-pack` | 2 | Reseed before every query (loader unregisters first) | `unregister(e => e.source === 'capability-pack')` |

Conflict policy: Same `name` within `kind` overrides by priority; duplicate `name` across two capability packs throws (later activation fails rather than silently overwrites).
Same `name` across `kind` does not conflict.

<a id="注册红线"></a>

### Registration red lines

- C1: Sub-Agent `def.tools` **must not contain** `'Task'` / `'Agent'` (no sub-Agent spawning sub-Agents)
- Names must not match SDK built-in `'general-purpose'`
- `packId` required for `source === 'capability-pack'`
- Red line 3 (loader): Capability-pack SubAgent prompt `.md` files **forbid CJK characters**; built-in prompts uniformly English (CLAUDE.md §1 / §7.4)

<a id="双轨注册g3-&#45;g5-修复"></a>

### Dual registration (G3 / G5 fixes)

The claude binary (closed-source CLI) Agent-tool dispatch **ignores** SDK `options.agents`, reading only filesystem `.claude/agents/*.md`;
sub-Agent dispatch uses another claude subprocess that **does not inherit** master `mcpServers`.
Therefore, before every query the orchestrator operates under session `cwd`:

1. `emit-filesystem-agents.ts` writes all Registry `kind === 'subagent'` entries as `<cwd>/.claude/agents/<name>.md` (frontmatter + body)
2. `emit-mcp-config.ts` writes master's `mcpServers` dictionary to `<cwd>/.mcp.json`; `mark-claude-project-trusted.ts` patches trust to simulate user trust, loading the same MCP servers in sub-Agent subprocesses. Trust is **written twice**: `~/.claude.json` (backward compatibility) and `$CLAUDE_CONFIG_DIR/.claude.json` (`~/.asci(-dev)/sdk-config/.claude.json`, actually consumed by binary). Root cause of #587: Only homedir was written, while ASCI sets `CLAUDE_CONFIG_DIR` for every claude subprocess; binary read sdk-config, trust never applied, and sub-Agents intermittently could not resolve `mcp__paper-search__*`.

Both programmatic registration (SDK `options.agents`) and filesystem registration (`.claude/agents/`) are required.

<a id="工作区级-override"></a>

### Workspace overrides

`capability-pack-loader` overlays user `~/.asci/capability-pack-state.json` with
`~/.asci/agent-workspaces/{slug}/capabilities.json`: Missing key inherits user state / `true` force-enables / `false` disables.
Without `workspaceSlug` (homedir sessions/tests), read user-level state only.

<a id="subagent-span-遥测"></a>

### Subagent Span telemetry

`SubagentStart/Stop` hooks in `subagent-spans-hook.ts` FIFO-pair startedAt / finishedAt by `subagent_type`,
batch-persisting `AgentSessionMeta.subagentSpans` through `agent-orchestrator-spans-sink.ts` 500ms debounce;
orchestrator cleanup `flush()` persists spans still within debounce window.
The 0.3 §3-A telemetry consumer can subscribe directly to sink output.

<a id="集成清单修改-orchestrator-子-agent-链路时必读"></a>

### Integration checklist (required when changing Orchestrator sub-Agent path)

1. New builtin sub-Agent → modify `buildBuiltinAgents` (`agent-prompt-builder.ts`), not Orchestrator
2. New capability-pack sub-Agent → user places pack at `~/.asci/capability-packs/<packId>/`, no code changes
3. New user-config sub-Agent (Phase 2) → call `registry.register({ source: 'user-config', ... })` in seed path, not Orchestrator
4. New SubagentStart/Stop hook purpose → merge into corresponding hooks array in `assembleQueryOptions` in `run-orchestrator-query.ts`, preserving span hooks
5. Changing `runOrchestratorQuery`: **Read** `subagent-zero-codechange.test.ts`, the A0 ④ acceptance anchor

---

<a id="sdk-版本升级注意事项"></a>

## SDK version upgrade considerations

<a id="optionsenv-语义变更"></a>

### `options.env` semantics changes

- SDK 0.2.111 changed `options.env` from replacing `process.env` to overlaying `process.env`
- SDK 0.2.113 restored replacement of `process.env`
- Shell variables such as `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_CUSTOM_HEADERS` / `ANTHROPIC_MODEL` cannot be isolated by relying on SDK default env semantics

<a id="加固方案"></a>

### Hardening approach

`buildSdkEnv()` in `agent-orchestrator.ts` explicitly builds complete env: inherit non-`ANTHROPIC_*` system variables, write project-managed SDK env, then iterate `process.env` and explicitly empty all `ANTHROPIC_*` keys **not explicitly managed by sdkEnv**.

ASCI therefore controls the final Claude Code subprocess env before/after upgrades, independent of SDK overlay/replacement defaults.

<a id="修改-buildsdkenv-检查清单"></a>

### Checklist for changing `buildSdkEnv()`

1. ✅ Preserve `cleanEnv` filtering of `ANTHROPIC_` prefix
2. ✅ Preserve final `ANTHROPIC_*` empty-string override loop
3. ✅ Explicitly add new SDK-recognized environment variables to `sdkEnv` (otherwise the empty-string loop overwrites them)

Reevaluate this hardening if future major upgrades change `undefined` / empty-string handling.

<a id="关键-breaking-changes"></a>

### Key Breaking Changes

- `0.2.111`: `options.env` replacement → overlay; see hardening above
- `0.2.113`: `options.env` restored to replacement; native Claude Code binary distributed through per-platform optional dependencies

See [`history/sdk-upgrade-notes.md`](./sdk-upgrade-notes.md) for earlier history.

---

<a id="共享类型ascishared"></a>

## Shared types (`@asci/shared`)

| Type | Description |
|------|------|
| `AgentEvent` | Agent events (`text` / `tool_start` / `tool_result` / `done` / `error`) |
| `AgentSessionMeta` | Session metadata (`id` / `title` / `channelId` / `workspaceId`) |
| `AgentMessage` | Persisted message (`role` + content blocks) |
| `AgentSendInput` | Send-request input |
| `AGENT_IPC_CHANNELS` | Agent IPC channel constants |
| `WorkspaceCapabilities` | Workspace capabilities (MCP Server list + Skills list) |
| `SubagentSpan` | Sub-Agent dispatch span (`scenarioAgentName` / `startedAt` / `finishedAt` / `durationMs` / `success`), stored in `AgentSessionMeta.subagentSpans` |
| `CapabilityPackManifest` | Pack manifest zod schema: `packId` / `scenarioAgent` / `subAgents` / `skillRefs` / `mcpRefs` |
| `CAPABILITY_PACK_IPC_CHANNELS` | Pack listing / enabled-state IPC constants |

---

<a id="设计参照"></a>

## Design references

Follows [craft-agents-oss](https://github.com/craftship/craft-agents-oss) patterns:

- Session management — Inbox / archive workflows
- Permission modes — `safe` / `ask` / `allow-all`
- MCP integration — Model Context Protocol for external data
- Credential storage — AES-256-GCM encryption
- Configuration location — `~/.asci/` (like `~/.craft-agent/`)

<a id="外部文档"></a>

## External documentation

- [Agent SDK TypeScript v1](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Agent SDK TypeScript v2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)

<a id="相关资料"></a>

## Related resources

- [`architecture.md`](../architecture.md) — IPC communication, state layer, component layer
- [`build-and-packaging.md`](../build-and-packaging.md) — SDK external packaging rules
- [`../CLAUDE.md`](../../CLAUDE.md) — Top-level hard constraints and development discipline
