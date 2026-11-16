<a id="tinker-领域语言"></a>

# Tinker Domain Language

The current product serves general chat, writing, coding, image, and file tasks. This document retains general definitions for conversations, orchestration, telemetry, and data ownership.
Research evidence sets, research gaps, paper corpora, and earlier roadmaps are archived in the [historical CONTEXT](docs/history/ASCI-CONTEXT.md). They explain old data, protocols, and code origins and are not current product goals.
See [NOTICE](NOTICE), [LICENSE](LICENSE), and the [historical README](docs/history/ASCI-README.md) for origins and licensing.

---

<a id="对话流conversation-flow"></a>

# Conversation Flow

The visual area in the Tinker desktop application where the Agent and user converse. This document establishes shared language for product and engineering discussions about conversation rendering and execution display.

## Language

**Turn**:
A continuous sequence of Agent output between two user inputs, potentially containing multiple assistant messages.
_Avoid_: message group, an implementation term that should not be used in product discussions.

**Process Block**:
An intermediate step before the Agent reaches its final answer: a thinking block or a tool-call block.
_Avoid_: intermediate message or step, since step alone is ambiguous.

**Final Answer**:
The Agent's user-facing text output. It is the conclusion users care about and always remains visible at the top level, without collapsing.
_Avoid_: text block, an implementation term.

**Execution Step Group**:
An expandable parent containing a consecutive sequence of at least two collapsed Process Blocks. It occupies one top-level row in the conversation flow.
When collapsed, it shows the current step with a spinner while running and “N steps executed” after completion. Failed steps add a badge, “⚠ N steps · M failed”, without automatically expanding the group.
It is collapsed by default. Clicking expands the individual details in their original style.
**Single-step fallback**: a sequence with only one step is not grouped. Display the Process Block itself, retaining its specific tool name.
_Avoid_: parent group as an informal abbreviation in formal documents, or TodoBoard, which is a separate existing concept.

**Teammate (scenario sub-agent)**:
A child Agent dispatched by the main Agent through the `Task`/`Agent` tools, such as Fox Nick or Eagle Nick.
Each teammate's Process Blocks form a separate **Execution Step Group**, with a nickname badge on the collapsed row (⊙ Name · N steps).
_Avoid_: subagent in badges. The term is acceptable in informal discussion, but badges consistently use nicknames.

**TodoBoard (task progress card)**:
The Agent's live to-do list, driven by `TodoWrite`/`TaskCreate`/`TaskUpdate` and rendered as a progress card.
**It is separate from Execution Step Groups**: a status board rather than a process to hide.
_Avoid_: confusing it with Task/Agent dispatch of teammates. Both include “Task” in their names but have different meanings.

## Relationships

- A **Turn** alternates between **Process Blocks** and **Final Answers**.
- Consecutive sequences of at least two **Process Blocks** collapse into an **Execution Step Group**. A **Final Answer** ends the group.
- A **speaker change** (main Agent ↔ teammate, teammate A ↔ teammate B) also ends the group. Each **teammate** has its own group.
- **TodoBoard** is a top-level visible card and also separates groups (group → TodoBoard → group).
- The top-level conversation therefore appears as: Final Answer → Execution Step Group (one row) → Final Answer → Execution Step Group → …

## Example dialogue

> **PM:** Within one turn, the Agent thinks, checks three tools, and answers. What appears in the conversation flow?
> **Engineering:** An **Execution Step Group** (one “3 steps” row), followed by the **Final Answer**. Click the row to see the process.
> **PM:** What if it replies with half a sentence and then keeps checking?
> **Engineering:** That partial **Final Answer** splits the groups: group → text → new group → text.
> **PM:** What if it dispatches Fox Nick and Eagle Nick?
> **Engineering:** The main Agent has one group, Fox Nick another (⊙ Fox Nick · 6 steps), and Eagle Nick another. Each is collapsed separately.

## Flagged ambiguities

- “Execution step” can mean one Process Block or the collapsed group. The terms are now distinct: **Process Block** for one and **Execution Step Group** for the collapsed parent.
- “Task” is ambiguous: `Task`/`Agent` dispatch **teammates**, while `TaskCreate`/`TaskUpdate`/`TodoWrite` manage the **TodoBoard** to-do list. They are unrelated.
- One Process Block is not grouped (**single-step fallback**), avoiding a meaningless “1 step” wrapper.

---

<a id="agent-编排orchestration"></a>

# Agent Orchestration

General language for the main Agent, child Agents, and tool execution. Current execution boundaries are defined by `agent-orchestrator.ts`, `run-orchestrator-query.ts`, `agent-prompt-builder.ts`, and the registry source.

## Language

**Master Agent**:
The Agent that receives the user's request and decides how to act using the tools and teammates allowed in the current mode. Runtime configuration constrains permissions, tool scope, model, and language.

**Teammate (SubAgent)**:
An independent child context assigned by the main Agent, displayed as a teammate Execution Step Group. Dispatch depends on the task and currently available registry entries. Not every task requires multiple Agents or a capability pack.

**Capability Pack**:
An extension container organizing scenario Agents, Skill / MCP references, and UI configuration. The term does not imply that any research pack is enabled by default. Installed resources, historical-data compatibility, and currently executable workflows are separate boundaries.

**Permission Boundary**:
Constraints applied when the main process assembles SDK queries, allowed tools, and permission requests. Child Agents and tools cannot bypass them through wording.

## Relationships

- User request → main Agent → direct answer, tool call, or teammate dispatch → conversation display of the process and final answer.
- Available capabilities depend on the current mode, settings, and registries. Workspace identity files declare the host and isolate unrelated ambient `CLAUDE.md` files. They cannot override the primary system prompt or language directive.
- Historical Supervisor coordination across packs, research roadmaps, and unimplemented protocols remain in the [historical CONTEXT](docs/history/ASCI-CONTEXT.md#agent-编排orchestration). They do not establish what is currently implemented.

---

<a id="遥测埋点telemetry"></a>

# Telemetry

Shared language for crash reporting, behavioral analytics, and self-evolution signals. See [ADR-011](docs/adr/ADR-011-telemetry-architecture.md) for architecture decisions and [telemetry-spec](docs/specs/telemetry-spec.md) for the implementation map.

## Language

**Three Telemetry Layers**:
Sentry crash reporting (always on, redacted), PostHog behavioral analytics (toggle ①), and self-evolution signals (toggle ②, a separate channel). The layers are independent. Sentry initialization still depends on the DSN and runtime environment. Behavioral analytics and self-evolution signals have separate consent controls.
_Avoid_: treating these as one “telemetry switch”. Sentry has no switch, and the two independent toggles each control one layer.

**deviceId (anonymous device identifier)**:
A locally generated UUID. It identifies behavioral events before sign-in. After sign-in, behavioral events use the account uid and identify merges anonymous history. The device identifier itself does not change.
_Avoid_: user ID. It contains no user information and cannot be reversed to infer it.

**Consent mode / opt-in vs opt-out**:
In GDPR regions (including EEA/UK, inferred from the local timezone, with unknown regions treated as GDPR), collection defaults off and requires explicit enablement: opt-in. Elsewhere it defaults on and can be disabled at any time: opt-out. A persisted explicit choice takes precedence over regional defaults.
_Avoid_: “EU IP detection”. The implementation uses a local timezone heuristic and performs no IP lookup. See ADR-011 §2.

**Full-Stop Gate**:
When consent is off, nothing is written to the local buffer or reported. It does not mean “keep writing locally and only gate reporting”.
_Avoid_: reporting switch, which incorrectly implies local recording continues.

**Self-Evolution Signal**:
Five categories of structured signals (task structure, tool use, model selection, errors/exceptions, workspace structure), plus implicit feedback. The tracked, Zod-generated `schema/telemetry/*.schema.json` files are authoritative for field auditing. Zod strip before egress enforces the allowlist.
_Avoid_: six categories. Proposal decision signals were removed from 0.3 together with Proposal.

**Implicit Feedback**:
Indirect quality signals from user actions on Agent output: copy / save / cite / discard / retry. The event registry, signal schemas, and call sites define actual events and actions. Collect actions and object types only, never content.

**Redaction Red Line**:
No egress may contain full papers, PDFs, original notes, conversation content, search terms, credentials, email addresses, IP addresses, usernames, or paths containing usernames. Replace the username segment of a path with `<USER>`.

## Relationships

- Explicit renderer event → IPC → main-process telemetry-service (the sole gate: consent → allowlist → redaction → deviceId injection) → SaaS / local JSONL.
- `packages/shared/src/telemetry/event-registry.ts` is authoritative for event names and property allowlists. Call sites must not use bare strings.
- The self-evolution sender is pluggable. Without `ASCI_EVOLUTION_ENDPOINT`, signals are buffered only in local `signals.jsonl`. Network egress also requires consent and runtime-environment gates.

## Flagged ambiguities

- **Telemetry source of truth**: switches, permitted fields, redaction, and sending conditions are defined by `telemetry-service.ts`, `sentry-init.ts`, and `schema/telemetry/`. Historical version goals do not prove that a feature is enabled in production.
- **Native minidump redaction**: Crashpad binary dumps cannot be redacted client-side. They do not contain user fields injected by the application. This is a known Sentry limitation.

---

<a id="数据所有权data-ownership"></a>

# Data Ownership

Local user data belongs to the user. Rebranding or retiring research entry points must not delete historical objects, break schemas, clear resource directories, or automatically migrate real directories. Configuration and database compatibility paths continue to use `.asci` / `.asci-dev`.

## Language

**Export Bundle**:
The zip generated by the data-export action in settings. The current `objects/export-service.ts` exports five persistent object types: Paper, EvidenceRef, Note, EvidenceSet, and Review, together with a manifest, schema copies, and available Review bodies. This is a historical-data portability contract. It does not imply that new research workflows remain available or that the export includes all chats, images, channel settings, or a complete restorable application.
_Avoid_: complete backup / backup. The current export does not promise full recovery or import.

**Object Standard (O1 Schema)**:
Open JSON Schema generated from TypeScript types into `schema/objects/`. Export bundles include the corresponding schemas so external tools can parse the data. Historical object names remain compatible.

**Manifest**:
The self-describing file inside the export bundle, recording application version, time, object counts, and the schema corresponding to each data file. Readers load the manifest before parsing data.

## Relationships

- Each exported object type has one JSON-array file. Soft-deleted objects are exported too, and readers filter by visibility.
- Review metadata links to bodies through bundle-relative paths. Missing bodies produce warnings without revealing absolute paths on the user's machine.
- If an object fails schema validation, export aborts without writing a partial bundle. Proposal includes schemas only, not object data. CitationRelation is no longer part of the export contract.
- Existing storage contracts for session-history reading, image-version references, ordinary files, and project data are preserved separately. This object-export list does not remove or reduce them.
