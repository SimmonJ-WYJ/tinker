<a id="agent-sdk-集成架构"></a>

# Agent SDK Integration Architecture

The current Tinker production app continues to use Electron + React/TypeScript and `@anthropic-ai/claude-agent-sdk`. Rust/Tauri remains on an isolated experimental path and has not replaced production entry points, session data, or the model executor. This document records runtime boundaries after research retirement; old investigations and research designs are archived in [historical SDK records](./history/ASCI-agent-sdk-integration.md), no longer requirements to restore old features.

<a id="核心调用链"></a>

## Core Call Chain

```text
User input → agent-orchestrator.ts
  → selectRuntimePolicy（conversation / general / coding）
  → Generic dynamic context, available tools, custom capability packs
  → SubagentRegistry.snapshot
  → runOrchestratorQuery → ClaudeAgentAdapter → SDK query
  → convertSDKMessage → AgentEvent → IPC
  → useGlobalAgentListeners → Jotai → React UI
```

`runOrchestratorQuery` is the SDK query assembly entry. Main orchestration retains concurrency guards, channel selection, message persistence, image request authorization, permissions and AskUser, stream conversion, cancellation, errors, and recovery. Research keywords, old research profiles, and sticky research state no longer route tasks into a dedicated research execution chain.

| Location | Current responsibility |
|---|---|
| `agent-orchestrator.ts` | Construct this turn's options and lifecycle; retain generic model, image, file, and project capabilities |
| `agent-prompt-builder.ts` | Generic role, tool/file rules, workspace, available Agents, language and permission instructions; `buildBuiltinAgents` currently returns an empty dictionary |
| `capability-pack-loader.ts` / `capability-pack-service.ts` | Load custom capability packs, model/prompt/MCP references, and read-only lists; no toggle/import/uninstall; skip three reserved retired builtin packIds |
| `subagent-registry.ts` / `subagent-registry-seed.ts` | Registry sources and priority; an empty builtin seed must not be described as a remaining research squad |
| `run-orchestrator-query.ts` | Registry snapshots override options.agents; append generic spans and custom-pack completion hooks, retaining other existing hooks |
| `agent-orchestrator-mcp.ts` / `mcp/builtin-mcp-resolver.ts` | Available Python, PDF, independent OCR/ASR, and user-created MCP; image/web/project tools are assembled separately by runtime profile |
| `agent-permission-service.ts` / `agent-ask-user-service.ts` | Permission and user-input waits; research cleanup must not loosen other sensitive-tool boundaries |
| `agent-session-manager.ts` | Existing metadata and SDK JSONL read/write compatibility |

Distribution, automatic seeding, and registration of builtin `lit-search`, `lit-review`, and `research-gap` are retired. Dedicated paper-search/Zotero/review/research-gap/searchplan MCP, research hooks, session papers watchers, and research background startup are disconnected. Old source, schemas, and renderers remain for historical reading/export, not as evidence they still handle new production tasks. See [this round's report](./reports/2026-11-10-research-retirement.md) for migratable and legacy inventories.

<a id="agentmcp-和技能边界"></a>

## Agent, MCP, and Skill Boundaries

Custom Agents are injected through Registry and SDK `options.agents`; MCP is supplied explicitly through `mcpServers`. Original naming, models, and generic hooks remain; explicit tools lists do not clear selected Agents. Existing `pack.taskCompleted` / span writes still support generic extensions.

Production orchestration no longer calls `emitFilesystemAgents`, `emitMcpConfigFile`, or `markClaudeProjectTrusted`. Never automatically clear `.claude/agents`, overwrite `.mcp.json`, copy keys, or modify Claude trust to support old dispatch behavior. SDK type declarations support programmatic agents; this round's simulated-host tests prove wrapper/adapter forwarding, **not native CLI dispatch**. Neither old historical investigations nor type declarations are native acceptance results.

Ordinary tasks retain `settingSources: ['project']`; simple conversation uses empty sources. This retains project CLAUDE/settings and existing user configuration without adding user/global sources. Old `.claude/agents`, `.mcp.json`, and user instructions of uncertain ownership remain untouched and may still be discovered by the SDK. `strictMcpConfig` is not used as a discovery-isolation switch this round.

Skill seed/copy/upgrade skips retired builtin resources without automatically deleting installed copies. Runtime excludes known retired copies only by exact released layout and fingerprints; unknown/modified content remains user-owned. Identification first performs bounded metadata checks, reading limited body content only for exact known layouts, without scanning user attachments. Each turn creates its own temporary plugin, using the same `asci-workspace-${workspaceSlug}` namespace as explicit Skill mentions.

Temporary directories carry leases from main orchestration, the SDK iterator, and started background tasks. Normal main-output completion must not prematurely delete child-task resources; supported SDK `close()` terminates the query before its task pins are released. At most 64 active projections are allowed; do not evict active directories to free capacity. Errors/stop/repeated stop all need regression tests; actual native process-tree lifecycle still awaits dedicated acceptance.

<a id="输出语言与上下文"></a>

## Output Language and Context

Builtin static prompts use English. `detectOutputLanguage` resolves this turn's output language from the current user message, cache, and UI language; main-prompt and child-Agent language directives retain existing policy. User-visible natural-language values follow the resolved language; tool names/code/JSON keys/paths/source quotations retain protocol or original text. Tool/Skill/child-Agent output language cannot independently switch this turn's reply language.

Workspace context retains file, todo, plan, and project-instruction rules while removing mandatory paper-corpus indexing and research routing. Users determine their own prompt/Skill language; UI `nameI18n` does not change skill protocol names. Language directives are source-code policy; no real-model adherence tests ran this round.

<a id="流式状态与权限"></a>

## Streaming State and Permissions

- `convertSDKMessage` / tool matching converts SDK messages to unified `AgentEvent` values.
- `applyAgentEvent` updates incremental state; top-level `useGlobalAgentListeners` remains mounted across page switches.
- Permissions and AskUser queue by sessionId, retaining existing cancellation, waits, image continuation scope, and sensitive-operation boundaries.
- The sink persists `SubagentStart/Stop` spans with debouncing and cleanup flush; it is not a research collector.
- Historical JSONL, object schemas, image versions, and exports remain compatible, without destructive user-data migration.

<a id="sdk-环境和打包红线"></a>

## SDK Environment and Packaging Constraints

`buildSdkEnv()` explicitly constructs the complete environment rather than relying on version-specific SDK merge/replacement defaults for options.env:

1. Filter ambient `ANTHROPIC_*` before inheritance.
2. Write SDK env managed by this application.
3. Explicitly clear remaining unmanaged `ANTHROPIC_*` variables.

New SDK-recognized variables must be explicitly managed so they are neither accidentally inherited nor erased by the final loop. SDK external/native binary and packaging rules are in [build documentation](./build-and-packaging.md); old-version environment semantics are in [upgrade notes](./history/sdk-upgrade-notes.md). Research-resource retirement does not change SDK external, OAuth, app identifiers, or `.asci` data paths.

<a id="验证边界与参考"></a>

## Validation Boundaries and References

Automation uses synthetic directories, fake Electron, real IPC/query wrappers/adapters, and a mocked SDK. It neither reads real sessions/credentials nor calls paid models. Exact counts and per-batch rollback are in the [execution record](./reports/2026-11-10-research-retirement.md). Native SDK child-Agent/skill discovery, GUI, actual OCR/ASR/Python, and online models are not accepted on that evidence.

- [Architecture reference](./architecture.md)
- [Project rules](../CLAUDE.md)
- [Official Agent SDK TypeScript entry](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Historical SDK investigation](./history/ASCI-agent-sdk-integration.md)
