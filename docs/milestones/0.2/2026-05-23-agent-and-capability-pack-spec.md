<a id="agent-重构-&#45;能力包-实现规格02-对象底座-&#45;03-能力包首发"></a>

# Agent refactor + capability-pack implementation specification (0.2 object foundation / 0.3 pack launch)

> **Role**: From signing, **this file is the sole implementation alignment source for 0.2 (excluding Proposal generation) and 0.3 capability-pack features**. It governs any conflicting implementation / acceptance / interface descriptions.
>
> **Generated**: 2026-05-23
>
> **Responsibility boundaries (important)**: Organized from liningftp's ownership perspective:
> - **liningftp**: Agent extensibility (§4), launch lit-search / lit-review / Mock packs (§5), CP1 infrastructure (§6), documentation alignment, X1-X4 conceptual outputs.
> - **fanlizhi** (PR #284 / #308 implemented): 5 objects (Paper / EvidenceRef / EvidenceSet / Note / CitationRelation) + Proposal types, JSON Schema, SQLite persistence, Repository CRUD, Proposal state machine + dismissPolicy service.
> - **itpretty** (PR #286 implemented): Proposal / Note / CitationRelation detail UI (PaperProposalsPanel / ProposalCard / NoteDetailDialog / `proposals.json` i18n, etc.).
> - **Collaboration rule**: For fanlizhi / itpretty code, this document **locks interface contracts only** (schema field names, event names, state enums, three dismissPolicy meanings), **not implementation details**. liningftp does not proactively add/change Proposal / CitationRelation code unless interface alignment requires it (e.g. pack loader reading Proposal repository).
>
> **Source lineage (absorbed here; do not use as independent authorities)**:
> - [`north-star.md`](./north-star.md) — Core 0.2 definitions (§0 / §1 / §1-A / §1-B / §3-1/2/3/4)
> - [`north-star-patch.md`](./north-star-patch.md) — Proposed §3-3 A0-A4 + C5 dual-name replacement
> - [`paper-semantics.md`](./paper-semantics.md) / [`evidence-ref-semantics.md`](./evidence-ref-semantics.md) / [`evidence-set-semantics.md`](./evidence-set-semantics.md) / [`note-semantics.md`](./note-semantics.md) / [`citation-relation-semantics.md`](./citation-relation-semantics.md) — Five-object semantics
> - [`2026-05-22-pack-orchestration-overview.md`](./2026-05-22-pack-orchestration-overview.md) — Shared two-pack principles + workflows
> - [`subagents-more.md`](./subagents-more.md) — Pack contracts → SDK field mappings
> - [`sdk-orchestrator-subagents-spec.md`](./sdk-orchestrator-subagents-spec.md) — Native SDK paradigm
> - [`architecture-audit-2026-05-21.md`](./architecture-audit-2026-05-21.md) — D-A/B/C implementation audit
> - [`lit-search场景 Agent 编排说明.md`](./lit-search场景%20Agent%20编排说明.md) / [`lit-review场景 Agent 编排说明.md`](./lit-review场景%20Agent%20编排说明.md) — Detailed scenario-Agent orchestration explanations for both packs (not repeated; skeleton in §5)
> - [`../0.3/north-star.md`](../0.3/north-star.md) §3-C — 0.3 pack implementation layer
>
> **Not absorbed (archived background)**: `moat-analysis.md` / `milestone-review.md` / `issue-{170,263,266}-*-reply-draft.md` (strategy / review / design defense, no effect on requirements here).
>
> **Not repeated**: Cross-cutting CSS / Tailwind / i18n / TS constraints (root `CLAUDE.md` §2 / §7); IPC naming and Bun workspaces (`docs/architecture.md`).

---

<a id="目录"></a>

## Contents

- [§0 Scope and red lines](#0-范围与红线)
- [§1 Object model (5 core objects + Proposal)](#1-对象模型5-核心对象--proposal-类型定义)
- [§2 Read/write protocols + open standards](#2-读写协议--开放标准)
- [§3 Workspace event bus (9 events)](#3-工作区事件总线9-事件)
- [§4 Agent extensibility (D-A / D-B / D-C)](#4-agent-拓展性架构d-a--d-b--d-c-三决策)
- [§5 0.2 launch packs: search + review + Mock](#5-02-能力包首发检索--综述--mock)
- [§6 0.3 pack infrastructure (CP1 + minimal local loop)](#6-03-能力包基础设施cp1--本地最小闭环)
- [§7 User journey validation (Professor Wang's RAG review)](#7-用户旅程验证王老师-rag-综述)
- [§8 Combined acceptance criteria](#8-验收标准合表)
- [§9 Detailed 0.2 / 0.3 exclusions](#9-02--03-排除项明细)
- [Appendix A Source-lineage status](#附录-a-来源文档谱系状态)

---

<a id="0-范围与红线"></a>

## §0 Scope and red lines

<a id="01-本文档实现范围"></a>

### 0.1 Implementation scope

> **Core delivery (no weakening)**: **Complete capability-pack functionality (§4 Agent extensibility + §5 0.2 lit-search/lit-review/Mock + §6 0.3 CP1 minimal local loop)** is central. Others own and have partly implemented Proposal / CitationRelation; this spec locks their interfaces only (pack code must not touch them). That boundary **must not reduce completeness of pack functionality itself**.

| Scope layer | Included? | Notes | Owner |
|--------|----------|------|-------|
| **5 objects + Proposal types / schemas / persistence / repositories** | 📌 **Interface alignment only, no implementation prescribed** | PR #284 / #308 implemented; lock field/event names, state enums, three dismissPolicy levels only; liningftp does not change code | fanlizhi |
| **Proposal / Note / CitationRelation detail UI** | 📌 **Interface alignment only, no implementation prescribed** | PR #286 implemented; lock i18n key names / five action meanings only | itpretty |
| **Proposal generation** (Dispatcher / background subprocess / automatic production) | ❌ **Excluded** | No automatic Proposal production in 0.2 → defer 0.3 | — |
| **CitationRelation creation** (V2a manual / V2b Agent) | ❌ **Excluded** | No creation entry in 0.2 → defer 0.3 | — |
| **0.2 Agent extensibility A0-A4 / C5** | ✅ Included | Master/sub-Agent native SDK paradigm, unified registry, four-element pack contract, Task ↔ Agent compatibility | **liningftp** |
| **0.2 launch packs** | ✅ lit-search + lit-review + Mock | See §5; close-reading pack not in launch, candidate for 0.3 CP1 | **liningftp** |
| **0.2 workspace event emit framework** | ✅ Included | Correctly emit `pack.taskCompleted` in pack workflows; fanlizhi repositories emit other object events | **liningftp** + fanlizhi |
| **0.2 conceptual X1-X4** | ✅ Included | User interviews / pack Spec / UI concepts / legacy configuration migration plan | **liningftp** |
| **0.3 pack infrastructure (CP1)** | ✅ Included | Manifest / registry / local import and toggles / configuration skeleton / Settings restructuring skeleton | **liningftp** |
| **0.3 accounts / servers / telemetry / GDPR / self-evolution / default page** | ❌ **Excluded** | Independently governed by [0.3 north-star.md](../0.3/north-star.md) §1 / §2 / §3 / §3-A / §3-D / §5 / §5-A, not expanded here | — |
| **0.3 pack distribution (central registry / third-party uploads)** | ❌ **Excluded** | 0.3 §3-C.5 explicitly deferred to 0.5 / V1 | — |

**Legend**: ✅ Included = implementation prescribed here; 📌 Interface contract = interface only (others delivered); ❌ Excluded = deferred to 0.3+, **no preparatory code here**.

<a id="02-零-哲学红线一段总则"></a>

### 0.2 §0 philosophical red line (general principle)

> **ASCI Agent-led principle**: Agents perform all **observation / induction / annotation / organization** they can handle; users only **set goals, review judgments, make final decisions**. Filter every audit item through this: For any manual-user design, ask *Can the Agent propose first and the user only decide?* Agents replace work **with standard answers**; users retain work **without standard answers** (judgment / creation / intuitive notes).
>
> **Relationship to §0**: Excluding Proposal generation in 0.2 defers propose-decide interactions to 0.3, but **object types + event enums + state fields land in 0.2**; philosophy applies directly when Dispatcher arrives in 0.3 without retrofitting the foundation.

<a id="03-灰度回退条件继承自-02-零"></a>

### 0.3 Rollout fallback conditions (inherited from 0.2 §0)

| X1 interview result | Response |
|------------|------|
| ≥50% rate proactive Agent proposals ≤2 | Downgrade §0 main path to stance A (real-time suggestions) or B (background batches); choose before 0.3 Dispatcher |
| <50% but ≥20% resist | Retain C as main path, add default-off proactive-proposal toggle in 0.3 Settings |
| <20% resist | Keep §0 unchanged |

> Rollout fallback **does not overturn** Proposal types or dismissPolicy; affects triggering (passive/proactive), not carrier form.

---

<a id="1-对象模型5-核心对象-&#45;proposal-类型定义"></a>

<a id="1-对象模型接口契约-&#45;实现由-fanlizhi-pr-284308-落地"></a>

## §1 Object model (interface contracts; fanlizhi PR #284/#308 implementation)

> **Purpose**: **Lock object-layer contracts consumed/referenced** by liningftp pack / Agent / event-bus code: fields, enums, events, invariants. **No implementation prescription** for objects/Proposal; implemented [`packages/shared/src/types/objects/`](packages/shared/src/types/objects/) + [`apps/electron/src/main/lib/objects/`](apps/electron/src/main/lib/objects/) code is the single authority.
>
> **If fields differ from implemented code**: Code prevails; raise differences with owners fanlizhi / itpretty for reviewed revision.

<a id="11-5-大对象-&#45;proposal-速览"></a>

### 1.1 Five objects + Proposal overview

| Object | Category | 0.2 state | User-visible in 0.2 | Relationships |
|------|------|----------|------------|---------|
| Paper | Core | Implemented | ✅ List / details / import / soft delete | Referenced by EvidenceRef / Note, contained by EvidenceSet, linked by CitationRelation (0.3+) |
| EvidenceRef | Core | Implemented | ✅ Review-sentence drill-through | source: Paper.paragraph; target: Review.sentence |
| EvidenceSet | Core | Implemented | ✅ Fallback creation / naming / contains editing | contains: Paper[] + EvidenceRef[] |
| Note | Core | Implemented (including `kind` + `hypothesisStatus`) | ✅ Notes panel / fallback kind setting / status override | target: Paper / EvidenceSet |
| **CitationRelation** | Core | Types + Repository implemented | ❌ **No creation path in 0.2** (V2a / V2b deferred 0.3) | type: supports / contradicts / method-ref; from: Paper; to: Paper |
| **Proposal** | Interaction | Types + Repository + dismiss service implemented | ❌ **No automatic production in 0.2** (generation deferred 0.3, no Mock preparation) | kind: citation-relation / evidence-set / hypothesis-promote / hypothesis-review |

**General principle**: Every object has unique ID, is referenceable/appendable, independent of specific UI.

<a id="12-接口契约liningftp-代码需对齐的字段-&#45;事件-&#45;枚举"></a>

### 1.2 Interface contracts (fields / events / enums for liningftp alignment)

#### Paper
- Identity: `Paper.id` stable across main paths — DOI → arXiv ID → Semantic Scholar paperId → content hash
- Coordinates: `Paper.paragraph` virtual coordinate system (not independent object), stable chunk IDs based on content hashes
- Soft deletion: Preserve ID; referrers mark `sourceRemoved: true`
- Relationship performance: Paper.id → EvidenceRef[] / Note[] independent of total size (V6e, storage backend ADR-001)

#### EvidenceRef
- Field direction (counterintuitive, explicit): `source = Paper.paragraph` (evidence origin), `target = Review.sentence` (evidence use)
- Creation: Inline within review pipeline only, **no independent manual entry**; review pack must write through Repository inside that pipeline

#### EvidenceSet
- Container: `contains: { paperIds: string[], evidenceRefIds: string[] }` — references only, no nested objects
- Unique naming: Workspace-unique name
- Key event: Adding Paper must trigger `evidenceSet.paperAdded`; Repository additions automatically emit in pack workflows

#### Note
- Fields: `kind: "note" | "hypothesis"` (default `"note"`), `hypothesisStatus: "unknown" | "supported" | "contradicted" | "suspended"` (default `"unknown"`, meaningful only when `kind === "hypothesis"`)
- Target: `target: { type: 'paper' | 'evidence-set', id: string }` — type annotation required
- Transitions: Manual user transitions available (V6c fallback); Agent main-path transitions (V6c') arrive with Proposal generation in 0.3

#### CitationRelation
- Fields: `{ id, from: Paper.id, to: Paper.id, type: "supports"|"contradicts"|"method-ref", reasoning, createdAt }`
- No citation prerequisite (can hold without cite; differentiating capability)
- Bidirectional: Symmetrically visible from both Papers' details (0.3+, no 0.2 UI)
- **0.2 constraint**: liningftp pack/review/search code **does not** proactively write through CitationRelation Repository or depend on it

#### Proposal
- Fields: `{ id, kind, sourceCapability, payload, reasoning, status, createdAt, decidedAt?, targetObjectRef, dismissPolicy }`
- `kind`: `"citation-relation" | "evidence-set" | "hypothesis-promote" | "hypothesis-review"`
- `status`: `"pending" | "accepted" | "rejected" | "modified"`
- `dismissPolicy`: `"once" | "scoped" | "silence-this-kind"`
- **0.2 constraint**: liningftp packs/Mock/review/search **do not** proactively write through Proposal Repository; ProposalDispatcher has no 0.2 subscriber to `pack.taskCompleted`, so packs need not know Proposal

<a id="13-dismisspolicy-三档语义liningftp-代码需感知的策略边界"></a>

### 1.3 Three dismissPolicy levels (policy boundary liningftp must understand)

| Level | Meaning |
|------|------|
| `once` | Dismiss this item only (default) |
| `scoped` | Stop same `kind` proposals from `sourceCapability` within `targetObjectRef`; still allowed for other objects |
| `silence-this-kind` | Permanently stop same `kind` proposals from `sourceCapability` across **entire workspace** |

> 0.3 ProposalDispatcher reads dismissPolicy to decide production; liningftp packs do not consume it directly.

<a id="14-详细语义参考fanlizhi-&#45;itpretty-范围本文不深入"></a>

### 1.4 Detailed semantics (fanlizhi / itpretty scope, not expanded)

Detailed five-object concepts (creation, direction, invariants, tradeoffs) are in companion semantic documents (review reference only, not in git): [`paper-semantics.md`](./paper-semantics.md) / [`evidence-ref-semantics.md`](./evidence-ref-semantics.md) / [`evidence-set-semantics.md`](./evidence-set-semantics.md) / [`note-semantics.md`](./note-semantics.md) / [`citation-relation-semantics.md`](./citation-relation-semantics.md).

**Hard constraints for liningftp (repeated)**:

1. Never proactively write Proposal via `proposal-repository.ts`, even for Mock acceptance; A3 anchor becomes “Mock registration + invocation + UI rendering + emit `pack.taskCompleted` only” (see §5.5 / §8.3).
2. Never proactively write CitationRelation via `citation-relation-repository.ts`; review/search pipelines do not depend on it.
3. Packs consume objects through high-level Services / Repositories exposed by `objects/`, never direct SQLite reads.

---

<a id="2-读写协议-&#45;开放标准"></a>

## §2 Read/write protocols + open standards

<a id="21-三条铁律"></a>

### 2.1 Three hard rules

| # | Protocol | Audit |
|---|------|---------|
| P1 | **Append, never overwrite**: Add evidence to existing objects without deleting old data | Repeated writes under one Paper retain queryable old entries |
| P2 | **Reference, never copy**: Link objects by ID without copying content | Deleted source is marked “Source removed” at references, not null |
| P3 | **Query, never traverse**: Use relationship indexes, not full scans | All Notes for Paper X require no traversal of every Note |

Technical design chooses representation (JSON Schema / TypeScript interfaces / others), but **object schemas must be independent of UI and storage**.

<a id="22-d1-d3-外部-api-扩展性"></a>

### 2.2 D1-D3 external API extensibility

Object models are local in 0.2 but reserve future exposure through MCP / A2A services:

| # | Constraint | Notes |
|---|------|------|
| D1 | **Stable object serialization** | Independently defined JSON Schema per type, uncoupled from UI/storage |
| D2 | **ID-based relationships, no nesting** | Same as P2; bounded responses avoid fetching entire object graphs |
| D3 | **Parameterized queries** | By type, relationship, time range, etc.; no hardcoded query logic |

<a id="23-o1-o3-对象标准开放护城河-p0"></a>

### 2.3 O1-O3 open object standards (moat P0)

| # | Audit criterion | Validation |
|---|---------|---------|
| O1 | External access to standalone JSON Schemas for 5 core objects (README + `schema/` or separate repo) | Developers can implement compatible objects from schema docs without ASCI source |
| O2 | Schemas uncoupled from UI/storage, zero internal-field leakage | No `_uiState` / `_dirty` runtime fields |
| O3 | At least 1 sample export of local object library as standard JSON bundle | Passes generic JSON Schema validation such as `ajv` |

> Proposal also gets standalone JSON Schema beside the 5 objects, but **outside mandatory O1 opening**; interaction semantics remain externally unstable until 0.3 Dispatcher.

---

<a id="3-工作区事件总线9-事件"></a>

## §3 Workspace event bus (9 events)

<a id="31-事件枚举"></a>

### 3.1 Event enumeration

| # | Event | Emit timing | 0.2 subscriber | 0.3 subscriber |
|---|--------|----------|----------|----------|
| 1 | `paper.created` | Persisted Paper after deduplication | — | ProposalDispatcher |
| 2 | `paper.deleted` | Paper soft deletion | EvidenceRef marks `sourceRemoved` | — |
| 3 | `evidenceSet.created` | New set (manual fallback or accepted 0.3 proposal) | — | ProposalDispatcher |
| 4 | `evidenceSet.paperAdded` | Paper added to set | — | ProposalDispatcher (V6d hypothesis-review) |
| 5 | `note.created` | New Note | — | ProposalDispatcher (V6c' hypothesis-promote) |
| 6 | `note.updated` | Content / kind / hypothesisStatus update | — | ProposalDispatcher |
| 7 | `evidenceRef.created` | Inline review-pipeline output | — | — |
| 8 | `citationRelation.created` | Persisted relation | **No 0.2 emit source** (V2a/V2b deferred 0.3); emit framework ready | V2a manual / V2b main path |
| 9 | `pack.taskCompleted` | Scenario Agent finishes | — | ProposalDispatcher (V2b / V6c' post-review/search flows) |

<a id="32-emit-实现归属按代码-owner-区分"></a>

### 3.2 Emit ownership (by code owner)

| Event | Trigger | Owner |
|------|--------------|------|
| `paper.created` / `paper.deleted` | Paper Repository CRUD | fanlizhi (implemented) |
| `evidenceSet.created` / `evidenceSet.paperAdded` | EvidenceSet Repository CRUD | fanlizhi (implemented) |
| `note.created` / `note.updated` | Note Repository CRUD | fanlizhi (implemented) |
| `evidenceRef.created` | Inline review pipeline (review pack) | **liningftp** (lit-review) |
| `citationRelation.created` | CitationRelation Repository (no 0.2 callers) | fanlizhi (implemented) |
| `pack.taskCompleted` | Scenario Agent finishes | **liningftp** (pack workflow) |

**liningftp emit responsibilities**: Only `evidenceRef.created` (review pipeline) and `pack.taskCompleted` (scenario completion). fanlizhi repositories automatically emit other CRUD events; liningftp never emits directly or bypasses Repository.

<a id="33-实现约束"></a>

### 3.3 Implementation constraints

- fanlizhi defined payload types + JSON Schemas in [`packages/shared/src/types/objects/`](packages/shared/src/types/objects/); liningftp consumes types without adding fields
- Emit **synchronously**, independent of future async Dispatcher
- Event persistence/replay: Unneeded in 0.2; assess 0.4+

---

<a id="4-agent-拓展性架构d-a-&#45;d-b-&#45;d-c-三决策"></a>

## §4 Agent extensibility (D-A / D-B / D-C decisions)

> Decisions from 0.2 architecture PDF (2026-05-18 / ADR-004-*.md / PR #265):
> - **D-A**: Packs are containers, not configurations; carry scenario Agent, subagents, resource references, Proposal declarations.
> - **D-B**: Master routes, never performs specialist work; β tasks dispatch through SDK Task, cross-pack sharing through objects.
> - **D-C**: Default passthrough; scenario events go directly to UI, D2 session stickiness remembers active pack, master can explicitly intervene.

<a id="41-主-orchestrator-路由d-b"></a>

### 4.1 Master Orchestrator routing (D-B)

Align with **Claude Agent SDK recommended paradigm**: **No Orchestrator class, only master + sub-Agents**.

**Three master responsibilities**:

1. **Intent recognition + clarification**: Model-based dispatch; autonomous for sequential tasks, ask for discontinuous intent;
2. **Task dispatch + stickiness**: `SDK options.agents` injection + `stickyCapabilityPackId`;
3. **System Prompt sandwich**: Platform identity + §0 philosophy + object model + workspace context + red lines + Output Language directive.

**Hard constraints**:

- Main imports `import { query }` **only inside** `runOrchestratorQuery`; all other paths call `runOrchestratorQuery(opts)` indirectly (grep main code finds **one** `import { query }`);
- Master does not execute work: `options.allowedTools` includes `Task` + very few master-only tools, **no** `Bash` / `Edit` / `Write`;
- Standard SDK registration: `options.agents = subagentRegistry.snapshot()`;
- New mock sub-Agent requires no Orchestrator change; only `subagentRegistry.register(def)`.

<a id="42-能力包容器d-a"></a>

### 4.2 Pack container (D-A)

Each pack is an **independent directory + manifest + scenario Agent + subagents + resource references + Proposal declarations**:

```
{packId}/
  manifest.json
  scenario/
    system-prompt.md              # Scenario Agent configuration
    agent.json                    # AgentDefinition（model / allowedTools / hooks…）
  sub-agents/
    {name}.md                     # Each SubAgent configuration
  bundled-mcp.json                # Bundled MCP (e.g. lit-search paper-search)
  bundled-skills/                 # Bundled Skills (e.g. lit-review review-proposer)
  resources/                      # Other bundled resources (e.g. PDF reader / OCR)
  proposals/                      # Proposal declarations (0.3)
    {kind}-prompt.md
    {kind}-schema.json
```

<a id="43-默认透传-&#45;会话粘滞d-c"></a>

### 4.3 Default passthrough + session stickiness (D-C)

- **Default passthrough**: Scenario events **bypass master** to UI (Conversation + RightSidePanel Artifact tab);
- **Session stickiness**: Consecutive same-pack turns **do not rematch** master; changed intent triggers rerouting;
- **Explicit master intervention**: User invokes `@主` (master) or intent clearly leaves current sticky pack;
- **Speaker identity**: Each UI message carries master / scenario / pack speaker badge.

<a id="44-注册中心"></a>

### 4.4 Registries

**D-3 unified registry** (runtime enumeration):

| Registry | Contents | Source distinction |
|----------|------|---------|
| **Skill registry** | Built-in / user / workspace / pack | `source: builtin \| user-config \| capability-pack` |
| **MCP registry** | Global / pack | Mount on activation, unregister on disable |
| **Capability pack registry** | User `~/.asci/capabilities/`, workspace `capabilities.json` | Enable/disable granularity |
| **Subagent registry** (native SDK) | Builtin + pack | `snapshot()` injected into `options.agents` |
| **ProposalDispatcher** (0.3) | subscribe(trigger, packId) → fire(event) | Main subscribes to EventBus |

**Common API**:

- `registry.list({ kind?, source?, packId? })` returns metadata `kind / name / source / packId?`
- `registry.snapshot()` returns flat SDK-consumable structures (e.g. `snapshot.agents`, `snapshot.mcpServers`)
- **A2 loop**: `snapshot.agents` keys exactly match `registry.list({ kind: 'subagent' }).map(e => e.name)`

<a id="45-能力包契约四要素-&#45;sdk-字段映射"></a>

### 4.5 Four-element pack contract → SDK mappings

| Manifest field | SDK destination | Resolution timing |
|---|---|---|
| **Scenario Agent configuration** | `options.agents[scenarioAgentName]: AgentDefinition` | Activation → `registry.register` |
| **Skill references** | Inject resolved `AgentDefinition.skills: string[]` | Activation; unregistered → failure |
| **MCP references** | Merge into `options.mcpServers` | Activation; unregistered → failure |
| **UI framework** | ❌ Outside SDK options, into `uiFrameworkRegistry` | Renderer consumes |
| **`capabilities.proposals[]`** (0.3) | ❌ Outside SDK options, into `proposalRouter` | Main subscribes to workspace events |

> 0.2 ships **1 UI framework**, conversation + right-side artifacts; pack contract reserves framework selection; multiple-framework registration/switching deferred 0.4+.

<a id="46-命名空间冲突策略"></a>

### 4.6 Namespace conflict policy

| Scenario | Behavior |
|------|------|
| builtin × user-config | builtin wins + log warn |
| builtin × capability-pack | builtin wins + log warn |
| **capability-pack × capability-pack** | **Later activation fails + shows conflicting entries** |
| capability-pack × user-config | user-config wins + log warn |

<a id="47-task-&#45;agent-双名兼容c5"></a>

### 4.7 Task ↔ Agent dual-name compatibility (C5)

Past SDK versions switched `tool_use.name` between `'Task'` and `'Agent'`; **every sub-Agent dispatch / invocation / event-ownership check must OR both names**:

```ts
// ✅ 派发语义位点（双名 OR）
if (block.name === 'Task' || block.name === 'Agent') { ... }

// ✅ system:init / permission_denials 语义位点（only Task）
if (denial.tool_name === 'Task') { ... }
```

C5 pass criterion: Grep all `block.name === '` / `.tool_name === '` / `tool_use.name ===` sites; dispatch uses dual-name OR, `system:init / permission_denials` uses only `"Task"`, zero mismatches.

<a id="48-sdk-env-红线继承-claudemd-72"></a>

### 4.8 SDK env red line (inherits CLAUDE.md §7.2)

When modifying `buildSdkEnv()`:

1. Preserve `cleanEnv` filtering of `ANTHROPIC_` prefixes;
2. Preserve final `ANTHROPIC_*` empty-string override loop;
3. Explicitly add every new SDK-recognized environment variable to `sdkEnv`, or the empty-string loop will wrongly override it.

---

<a id="5-02-能力包首发检索-&#45;综述-&#45;mock"></a>

## §5 0.2 launch packs: search + review + Mock

<a id="51-5-条共享设计原则"></a>

### 5.1 Five shared design principles

**Principle 01 · Scenario Agent is a minimal planner**
Only **2 LLM calls per scenario turn**: Opening (intent classification + PLAN together), closing (summary). No interruption during SubAgent execution. **Hard constraint**: Disable thinking in scenario prompts.

**Principle 02 · Dispatch once, runtime (master) takes over**
Scenario Agent emits **one full PLAN at opening**; master dispatches SubAgents in order, removing 1-3 intermediate LLM round trips.

**Principle 03 · Deterministic pipelines over Agent loops**
Do not ask LLMs to decide fixed pipelines dynamically. All 3 lit-search SubAgents are deterministic. Sole exception: lit-review synthesizer Agent loop.

**Principle 04 · Async by default, nonblocking main flow**
Parallelize/background wherever possible (multisource fan-out / relevance-scorer LLM rerank batches / reader warmup / asynchronous fact-checker / cross-pack paper-meta gap filling).

**Principle 05 · Fallback over perfection**
Never let one failure break the main flow (single-paper reader failure → abstract; fact-checker failure → `unchecked`; cross-pack failure → `[待补充]`, meaning to be supplemented).

<a id="52-两包速览"></a>

### 5.2 Two-pack overview

| Dimension | lit-search · Search pack | lit-review · Review pack |
|---|---|---|
| Work | Search + scoring (list) | **Long-form generation** (review.md) |
| Input | Natural-language query | **Selected EvidenceSet** |
| Session topology | One turn | **Mandatory two-turn breakpoint** (choose direction, then write) |
| Lead writer | Scenario Agent (minimal dispatcher) | **synthesizer** (Agent loop) |
| 3 SubAgent | searcher · relevance-scorer · citation-explorer | synthesizer · fact-checker · reader |
| Typical TTLT | 3-20s | 80-215s |
| LLM calls | 3-5 | 40-95 |

> Detailed prompts / SDK options / JSON schemas / typical-query walkthroughs: [`lit-search场景 Agent 编排说明.md`](./lit-search场景%20Agent%20编排说明.md) and [`lit-review场景 Agent 编排说明.md`](./lit-review场景%20Agent%20编排说明.md) (scenario-Agent orchestration explanations). Skeleton only here to avoid dual authority.

<a id="53-lit-search-工作流骨架"></a>

### 5.3 lit-search workflow skeleton

```
User message → [Scenario Agent opening] → Three-way intent classification:
  Exact lookup → Call paper-search MCP directly
  General search → searcher → relevance-scorer → ranked list
  Citation tracing → citation-explorer → ranked citations + graph
         ↓
[Scenario Agent closing] → emit pack.taskCompleted
```

**SubAgent responsibilities**:

| SubAgent | Type | Responsibility |
|----------|------|------|
| `searcher` | deterministic | Multisource fan-out (arXiv / Semantic Scholar / IACR / OpenReview) |
| `relevance-scorer` | deterministic (LLM rerank batch) | F22 sorting + LLM reranking |
| `citation-explorer` | deterministic | Citation snowball + graph |

**0.2 Proposal byproducts (generation deferred 0.3)**:

| Proposal kind | Trigger | Delivery |
|---------------|--------|------|
| `evidence-set` (candidate additions) | Search results persisted | Relevant EvidenceSet details in 0.3 |
| `citation-relation` (newly imported papers) | Search results persisted | Involved Paper details in 0.3 |

> In 0.2, `pack.taskCompleted` emits normally, with no subscriber and no Proposal production.

<a id="54-lit-review-工作流骨架"></a>

### 5.4 lit-review workflow skeleton

**Turn 1 · Direction selection**:

```
Scenario Agent opening → Dispatch review-proposer Skill (1 LLM call)
                       → Scenario Agent closing
                       → Invoke litreview.present_directions tool
                       → Render ChoiceCard (3 directions + 2 special options) → User chooses
```

**Turn 2 · Review generation**:

```
Scenario Agent opening → Dispatch synthesizer (parallel outline splitting + reader fan-out)
                       → synthesizer streams review body
                       → Each paragraph triggers async fact-checker
                       → Scenario Agent closing → emit pack.taskCompleted
```

**SubAgent responsibilities**:

| SubAgent | Type | Responsibility |
|----------|------|------|
| `synthesizer` | **Agent loop** (sole exception) | Outline splitting + streaming review body |
| `fact-checker` | deterministic (async) | Paragraph fact checks, `verified / unchecked / failed` |
| `reader` | deterministic | Single-paper full-text reading, fan-out warmup; abstract fallback |

**0.2 Proposal byproducts (generation deferred 0.3)**:

| Proposal kind | Trigger | Delivery |
|---------------|--------|------|
| `citation-relation` (review paragraphs) | Review completed | 0.3 |
| `hypothesis-promote` (falsifiable review claims) | Review completed / user Note with claim | 0.3 |
| `hypothesis-review` (evaluate attached hypotheses after Paper addition) | Paper added to EvidenceSet | 0.3 |

<a id="55-mock-包d-4-契约验收"></a>

### 5.5 Mock pack (D-4 contract acceptance)

**Purpose**: Minimize cost to validate A3 contract + registry + routing + UI rendering + event bus end to end.

**Contents**:

```
mock-pack/
  manifest.json
  scenario/system-prompt.md       # Minimal scenario Agent, sufficient for contract validation
```

**Acceptance red lines** (liningftp scope):

1. Register successfully through A3 contract in Capability pack registry
2. Invoke through master routing (stream `tool_use.name ∈ {'Task','Agent'}` + `subagent_type === 'mock-x'`)
3. Render artifacts within selected UI framework
4. Emit `pack.taskCompleted` (no 0.2 subscribers, mandatory emission; 0.3 Dispatcher connects without changes)

> **No Proposal involvement**: Mock **does not** call Proposal Repository or write Proposal objects. All generation (including synchronous Mock writes) deferred to ProposalDispatcher in 0.3; A3 `capabilities.proposals[]` may be declared, but has no 0.2 runtime consumer.

<a id="56-包间协作"></a>

### 5.6 Cross-pack collaboration

**lit-search → lit-review one-way handoff**: User saves search results as EvidenceSet → switches to lit-review → Turn 1 takes that set as input.

**lit-review → lit-search targeted gap filling**: Missing metadata for one synthesizer paper invokes `get_paper_meta(pmid|doi)` (cap=3, stop after cumulative fail ≥2 in one turn).

<a id="57-失败兜底统一总集"></a>

### 5.7 Unified failure fallbacks

| Failure | Handling |
|---|---|
| Single searcher source fails | `Promise.allSettled`, preserve overall flow |
| relevance-scorer LLM batch fails | Keep F22 order, no output blocking |
| Partial citation-explorer snowball failure | Continue with partial results |
| reader cannot fetch one full text | Abstract fallback, mark “Degraded” |
| Entire reader fails | Mark “Read failed,” synthesizer skips |
| fact-checker paragraph/all fails | Mark `unchecked` |
| Cross-pack `get_paper_meta` fails | Inline `[待补充]` (to be supplemented); stop at cumulative fail ≥2 |
| synthesizer LLM fails midway | Turn 2 fails, “Previous run incomplete” banner |

---

<a id="6-03-能力包基础设施cp1-&#45;本地最小闭环"></a>

## §6 0.3 pack infrastructure (CP1 + minimal local loop)

> **Scope**: Local minimal loop of 0.3 §3-C. **Includes** manifest / registry / local import and toggles / configuration skeleton / Settings restructuring. **Excludes** accounts, servers, telemetry, self-evolution, default-page redesign, Windows signing, GDPR, independently governed by [0.3 north-star.md](../0.3/north-star.md) §1 / §2 / §3 / §3-A / §3-D / §5 / §5-A.
>
> **Third-party uploads / central registry / marketplace**: Explicitly deferred to 0.5 / V1 in 0.3 §3-C.5, not expanded here.

<a id="61-manifest-格式"></a>

### 6.1 Manifest format

```jsonc
{
  "id": "lit-search",                            // 唯一标识，kebab-case
  "name": { "en": "Literature Search", "zh": "文献检索" },
  "version": "0.2.0",
  "description": { "en": "...", "zh": "..." },
  "scenarioAgent": {
    "promptPath": "scenario/system-prompt.md",
    "agentDefinitionPath": "scenario/agent.json"  // AgentDefinition 完整字段
  },
  "subAgents": [
    { "name": "searcher", "promptPath": "sub-agents/searcher.md" },
    ...
  ],
  "skills": [                                     // Skill 引用（builtin / pack 自带）
    { "name": "review-proposer", "source": "bundled", "path": "bundled-skills/review-proposer" }
  ],
  "mcpServers": [                                 // MCP 引用
    { "name": "paper-search", "source": "bundled", "configPath": "bundled-mcp.json" }
  ],
  "uiFramework": {                                // UI 框架选择 + 渲染配置
    "framework": "conversation-with-artifact",    // 0.3 主程序唯一内置
    "config": { "artifactType": "paper-list" }
  },
  "proposals": [                                  // 0.3 落地（0.2 字段留位）
    { "kind": "evidence-set", "trigger": "search.complete", "promptPath": "proposals/evidence-set.md" }
  ]
}
```

<a id="62-注册中心用户级-vs-工作区级"></a>

### 6.2 Registry (user vs workspace)

| Level | Storage | Enable/disable | Use |
|------|---------|---------|------|
| **User** | `~/.asci/capabilities/{packId}/` | User toggles in Settings | Shared across workspaces |
| **Workspace** | `{workspace}/.asci/capabilities.json` | Within workspace | Project-specific packs |

**Priority**: Workspace overrides user level; workspace wins conflicts + log warn.

<a id="63-本地导入-&#45;启用-&#45;禁用-&#45;卸载"></a>

### 6.3 Local import / enable / disable / uninstall

| Action | Entry | Behavior |
|------|---------|------|
| **Local import** | Configuration → Packs → Import → local directory | Validate manifest → write `~/.asci/capabilities/` |
| **Enable** | Configuration → pack details → toggle | Register pack + associated Skills / MCP |
| **Disable** | Same | Unregister Skills / MCP; keep files |
| **Uninstall** | Configuration → pack details → Uninstall | Unregister + delete directory |

**Constraints**:

- Before activation validate all `skills[].source = bundled` and `mcpServers[].source = bundled` resources;
- Registry immediately enumerable after activation (A2 loop);
- Uninstall preserves historical Papers/Notes, etc. (P2 references, not copies).

<a id="64-配置页骨架左侧-sidebar配置"></a>

### 6.4 Configuration-page skeleton (left sidebar)

New left-sidebar “Configuration” entry (peer of “Library,” independent route), two sections:

<a id="skill-板块"></a>

#### Skill section

- Overview of **all available Skills** (built-ins / packs / user-installed), source labeled
- Per Skill: enable/disable, metadata (name/version/capabilities/source), backlinks to using packs
- Filter by source / enabled state

<a id="能力包板块"></a>

#### Capability-pack section

- Installed packs, including lit-search / lit-review launch packs; Mock excluded from production UI
- Pack details: Scenario Agent preview, Skills linking to Skill section, MCP references, UI selection/rendering configuration, **Proposal outputs section** listing declared `capabilities.proposals[]` kinds/triggers (active with 0.3 Dispatcher), pack preferences
- Local import / enable / disable / uninstall

<a id="65-settings-弹窗结构调整骨架"></a>

### 6.5 Settings-dialog restructuring skeleton

| Tab | 0.3 state | Content |
|-----|---------|------|
| General | Retained | UI preferences, language |
| Models | Retained | Provider API keys (system credentials shared across scenarios) |
| Zotero | Retained | Zotero credentials + optional ASR model download |
| Proxy | Retained | Network configuration |
| **MCP** | **New** | Server list (system infrastructure across scenarios), replaces old Configuration tab |
| **Data Collection** | **New** | T3 PostHog opt-in/out + AE2 self-evolution toggle (compliance minimum, minimal UI) |
| Shortcuts | Retained | — |
| Archived | Retained | — |
| About | Retained | — |

**Changes**: Remove old Configuration tab; move MCP servers to independent MCP tab, Skills/packs to left Configuration page, add Data Collection tab.

**Two-part principle**:

> System-level parameter adjustment belongs in Settings dialog; Agent capability management belongs in left Configuration page. Entirely separate entries/pages.

<a id="66-升级迁移"></a>

### 6.6 Upgrade migration

For existing 0.1 / 0.2 users upgrading to 0.3:

| Old location | New location | Rule |
|--------|--------|---------|
| Settings → Configuration → MCP servers | Settings → MCP | Automatic migration |
| Settings → Configuration → packs / Skills | Left Configuration page | Automatic migration |
| Settings → Zotero / Provider / Proxy | Same | Unchanged |

**After migration**: Old Configuration tab route returns 404; search/review/Zotero work immediately after login without reentering settings.

---

<a id="7-用户旅程验证王老师-rag-综述"></a>

## §7 User journey validation (Professor Wang's RAG review)

> **Purpose**: Connect 5 objects + 9 events + 3 decisions + 2 workflows in one story. For 0.2, **Proposal steps are marked object/event complete, UI/generation deferred 0.3**.

**Protagonist**: Professor Wang, third-year CS PhD student, writing a RAG literature review.

**Day 1 — Workspace and direction**

1. Wang creates workspace `rag-survey-2026` and states intent.
2. Starts **lit-search**, enters `RAG long-context survey`.
3. Multisource search returns 30 candidates; user selects 12 → 12 **Paper** objects + 12 `paper.created` events.
4. Results persisted → `pack.taskCompleted`:
   - 0.2: Event emitted, **no subscriber, no Proposal**.
   - ⚠️ 0.3: ProposalDispatcher → background `sdk.query()` + haiku → `evidence-set` + `citation-relation` Proposals in pending-proposal details section.

**Day 2 — Read papers, write hypotheses**

5. Opens Paper-RAG-Survey-2024 details.
   - 0.2: **No pending-proposal section** (Proposal UI deferred 0.3), **no associated CitationRelation list** (UI deferred 0.3).
   - ⚠️ 0.3: `citation-relation` Proposal with reasoning + associated relation list.
6. **0.2 cannot add CitationRelation** (V2a manual fallback and V2b Agent path deferred 0.3; object/event skeleton ready, no creation entry).
   - ⚠️ 0.3: V2a fallback “⋯” → Add relation manually → Paper-B + type=method-ref → persistence → `citationRelation.created` → visible both ways.
7. Writes **Note** (default kind `note`) beside Paper-RAG-Survey-2024 with claim “X outperforms Y because Z” (English translation) → `note.created`.
   - 0.2: Event emitted, **no hypothesis-promote Proposal**.
   - ⚠️ 0.3: Automatic `hypothesis-promote` Proposal.
8. V6c fallback: Manually set `kind=hypothesis` → `hypothesisStatus` initialized `unknown` → `note.updated`.

**Day 3 — Organize evidence, generate review**

9. Same V6c fallback: Manually create **EvidenceSet** “RAG-vs-LongContext,” contains 5 Papers → `evidenceSet.created`.
10. Attach hypothesis Note to set (edit Note.target) → `note.updated`.
11. Start **lit-review**:
    - Turn 1: Select direction (ChoiceCard)
    - Turn 2: synthesizer streams body; synchronously produces **EvidenceRef** sentence by sentence → `evidenceRef.created` × N
    - Finish with `pack.taskCompleted`
    - 0.2: Event emitted, **no citation-relation / hypothesis-promote Proposal**.

**Day 4 — Agent hypothesis evaluation**

12. Search arXiv and add 3 new Papers to set → `evidenceSet.paperAdded` × 3.
    - 0.2: Event emitted, **no hypothesis-review Proposal**.
    - ⚠️ 0.3: Automatic `hypothesis-review` evaluates the 3 papers' tendencies.
13. V6c fallback editor: Manually set hypothesis Note `hypothesisStatus` to `suspended` → `note.updated`.

**Day 5 — Consolidation**

14. Open sidebar Notes (V6a), filter `kind: hypothesis` (V6c), see 5 hypothesis Notes + each `hypothesisStatus`.
15. Data becomes core evidence for review Discussion; takeaway **structured object library**: 12 Paper + 38 EvidenceRef + 17 CitationRelation + 23 Note (5 hypothesis) + 3 EvidenceSet.

<a id="71-02-阶段故事可走通的最小集"></a>

### 7.1 Minimal feasible 0.2 story

| Steps | 0.2 delivery | 0.3 upgrade |
|---------|---------|---------|
| 1-4 | ✅ Complete (9 event emissions; no `pack.taskCompleted` subscriber) | Automatic Proposals |
| 5 | ✅ Details without pending proposals or associated CitationRelation list | Add both sections + Proposal cards/list UI |
| 6 | ❌ **Not delivered in 0.2** (V2a/V2b deferred 0.3, object/events ready) | Add V2a “⋯” fallback + V2b Agent path |
| 7 | ✅ Note creation + event | + hypothesis-promote |
| 8 | ✅ Complete V6c fallback | + Agent transition path |
| 9-10 | ✅ V6c fallback + events | + main path |
| 11 | ✅ Full review + events | + Proposal |
| 12-13 | ✅ V6c fallback + events | + hypothesis-review automatic status writeback |
| 14-15 | ✅ Complete V6a/V6b/V6e | — |

**Conclusion**: In 0.2 Wang can complete **object foundation + review + hypothesis registration + efficient queries** (4 core objects' fallback paths complete, 9 events ready). Missing only ① proactive proposals reducing effort (0.3 generation) and ② creating/viewing logical paper relationships (0.3 CitationRelation creation). Together they deliver the 0.3 experience of an Agent increasingly fitting the user.

---

<a id="8-验收标准合表"></a>

## §8 Combined acceptance criteria

> All 0.2 V / A / C / X criteria appear here. **Owner** identifies implementation ownership; this document **locks liningftp criteria only**; other owners handle their own acceptance.
>
> Legend: ✅ delivered in 0.2; ⚠️ fields/fallback delivered, main path deferred; ❌ not delivered; 📌 outside liningftp scope, progress not tracked here, interface reference only.

<a id="81-对象底座v1-v6f"></a>

### 8.1 Object foundation (V1-V6f)

| # | Criterion | 0.2 state | Owner |
|---|------|---------|------|
| V1 | Click review citation → Paper paragraph | ✅ | fanlizhi (objects) + itpretty (UI) |
| V2 | Associated EvidenceRef / Note / CitationRelation visible under Paper | 📌 EvidenceRef + Note implemented; relation-list UI deferred 0.3 | itpretty |
| V2a | **Fallback**: Details “⋯” manually adds relation, visible both ways | ❌ Deferred 0.3 | itpretty |
| V2b | **Main path**: Agent produces `citation-relation` after review/search | ❌ Deferred 0.3 | fanlizhi (generation subscribes `pack.taskCompleted`, no pack changes) |
| V3 | Deleted Paper marks EvidenceRef “Source removed” | 📌 Implemented | fanlizhi |
| V4 | New Note automatically associates current Paper | 📌 Implemented | fanlizhi + itpretty |
| V5 | Repeated Notes under same Paper retain old Notes | 📌 Implemented | fanlizhi |
| V6 | Query related Notes in EvidenceSet | 📌 Implemented | fanlizhi + itpretty |
| V6a | Sidebar Notes entry visible/searchable | 📌 Implemented | itpretty |
| V6b | Note click jumps to associated Paper / EvidenceSet | 📌 Implemented | itpretty |
| V6c | **Fallback**: Manually set Note kind, sidebar kind filter | 📌 Implemented | itpretty |
| V6c' | **Main path**: Note claim / completed review → `hypothesis-promote` | ❌ Deferred 0.3 | fanlizhi (subscribes `note.created` / `pack.taskCompleted`, no pack changes) |
| V6d | **Main path**: Added Paper → `hypothesis-review`, acceptance writes `hypothesisStatus` | ❌ Deferred 0.3 | fanlizhi (subscribes `evidenceSet.paperAdded`, no pack changes) |
| V6e | Reverse Paper lookup with 100+ Notes independent of total count | 📌 Implemented (performance in ADR-001 chosen storage backend) | fanlizhi |
| V6f | Proposal persistence + three dismissPolicy levels | 📌 Fields/storage/state API implemented; decision-button UI deferred 0.3 | fanlizhi (persistence) + itpretty (UI) |

<a id="82-开放标准o1-o3-设计约束d1-d3"></a>

### 8.2 Open standards (O1-O3) + design constraints (D1-D3)

| # | Criterion | 0.2 state |
|---|------|----------|
| O1 | 5 independent externally accessible object JSON Schemas | ✅ |
| O2 | UI/storage-independent schemas, no internal fields | ✅ |
| O3 | At least 1 sample export passes `ajv` | ✅ |
| D1-D3 | Stable serialization + nonnested ID references + parameterized queries | ✅ |

<a id="83-agent-拓展性a0-a4-&#45;c5"></a>

### 8.3 Agent extensibility (A0-A4 + C5)

| # | Criterion | 0.2 state |
|---|------|----------|
| A0 | Sole entrypoint + master delegates + standard SDK registration + mock adds no Orchestrator changes | ✅ |
| A0a | SubagentStart / SubagentStop hooks connected | ✅ |
| A0b / C5 | Task ↔ Agent dual-name OR for dispatch, `system:init`/`permission_denials` only `Task` | ✅ |
| A1 | Single Agent entrypoint, mock Provider adds no entrypoint changes | ✅ |
| A2 | Unified tool / Skill / MCP / sub-Agent Registry; `list()` has `kind / name / source / packId?`; matching snapshot, namespace conflict policy | ✅ |
| A3 | Four-element pack contract (scenario / Skill / MCP / UI) + declarable `capabilities.proposals[]` (no 0.2 consumer); at least 1 mock **registers / invokes / renders / emits `pack.taskCompleted`** | ✅ (**No** Proposal write in A3; end-to-end Proposal deferred 0.3) |
| A4 | Event passthrough + speakers + stickiness; mock scenario name visible, two same-pack turns avoid rerouting, intent switch reroutes | ✅ |

<a id="84-概念层x1-x4"></a>

### 8.4 Conceptual layer (X1-X4)

| # | Criterion | 0.2 state |
|---|------|----------|
| X1 | 5 target interviews + ≥3 candidate pack types + paradigm validation/rejection | ✅ |
| X1.1 | Proactive-proposal acceptance (1 example per 3 Proposal kinds + 1-5 rating; ≥50% at ≤2 triggers §0 downgrade assessment) | ✅ |
| X1.2 | Skill/pack mental-model recognition (distinguish system foundation / Agent ecosystem within 30 seconds; <60% triggers 0.3 CP5 mandatory-constraint downgrade assessment) | ✅ |
| X2 | Pack concept Spec (naming / granularity / 4 elements / byproducts / dependencies / install-uninstall semantics) | ✅ |
| X3 | UI concepts (Configuration page + task entry + pending proposals + decision walkthrough) | ✅ (at least 1 `scoped` rejection) |
| X4 | Migration mapping from old Settings to 0.3, no lost configuration | ✅ |

<a id="85-03-能力包基础设施cp1-本地最小闭环子集"></a>

### 8.5 0.3 infrastructure (CP1 minimal local subset)

> Only this document's scope; CP2-CP5/accounts/servers/telemetry/default page governed independently by [0.3 north-star.md](../0.3/north-star.md).

| # | Criterion | 0.3 state |
|---|------|----------|
| CP1-a | lit-search connects through A3 | Required |
| CP1-b | lit-review connects through A3 | Required |
| CP1-c | Working manifests + user/workspace registries | Required |
| CP1-d | Import / enable / disable / uninstall happy path; §4.6 conflicts | Required |
| CP1-e | 9 Settings tabs adjusted (add MCP + Data Collection, remove Configuration, others retained) | Required |
| CP1-f | Left Configuration Skill/pack sections per §6.4 | Required |
| CP1-g | Automatic 0.1/0.2 migration (MCP/packs/Skills moved, Zotero/Provider/Proxy unchanged) | Required |

---

<a id="9-02-&#45;03-排除项明细"></a>

## §9 Detailed 0.2 / 0.3 exclusions

<a id="91-02-排除liningftp-不参与列出仅为接口对齐"></a>

### 9.1 0.2 exclusions (liningftp not involved; interface alignment only)

**Proposal generation** (fanlizhi / itpretty, 0.3; liningftp connects triggers in review/search only):

- ❌ ProposalDispatcher subscriptions
- ❌ Background async subprocess (independent `sdk.query()` + haiku + json_schema)
- ❌ Pending-proposal UI in Paper / EvidenceSet / hypothesis Note details
- ❌ RightSidePanel Proposal tab
- ❌ Five decision buttons (accept / modify / reject / scoped / silence-this-kind)
- ❌ Automatic Proposals (V2b / V6c' / V6d Agent paths)
- ❌ V6d automatic `hypothesisStatus` writeback

**CitationRelation creation + UI** (itpretty, 0.3):

- ❌ V2a “⋯” → Add relation manually
- ❌ V2b Agent-triggered `citation-relation` (including generation, 0.3)
- ❌ Associated CitationRelation list in Paper details
- ❌ Cascading “Source removed” marking after Paper deletion

**Hard 0.2 constraints for liningftp**:

- No proactive Proposal / CitationRelation code additions/changes unless interface alignment requires
- Review/search pipelines never depend on writes to Proposal / CitationRelation repositories
- Mock acceptance excludes Proposal writes (removed from §5.5 / §8.3 A3)

**0.3 scope (0.3 north-star sole authority, not repeated)**:

- ❌ Accounts (U1-U5)
- ❌ Servers (S1-S5)
- ❌ Telemetry (T1-T4a)
- ❌ Agent self-evolution instrumentation (AE1-AE5)
- ❌ Default-page redesign (deferred 0.4)
- ❌ Public-release operations SOP (deferred 0.4 / V1)
- ❌ Legal text/prerelease tasks (LT0-LT3)
- ❌ Security mechanisms (TLS / JWT / Rate Limiting, server/network)
- ❌ Data-ownership narrative UI (DO1-DO4); O1-O3 standards completed in 0.2
- ❌ User activation AC1-AC3

<a id="92-03-能力包排除本文档仅含-cp1-&#45;本地最小闭环"></a>

### 9.2 0.3 pack exclusions (CP1 minimal local loop only)

- ❌ Third-party pack extension points (0.5 / V1)
- ❌ Marketplace / remote discovery / central registry (0.5 / V1)
- ❌ Pack versioning / auto-updates (follow app versions)
- ❌ Cross-pack dependency resolution (2 launch packs independent)
- ❌ User-installed / third-party Skills (0.3 only built-ins and pack-provided)
- ❌ UI framework library extensions (one conversation + right-artifact framework in 0.3; multi-registration/switching 0.4+)
- ❌ Proposal decisions feeding self-evolution (separate 0.3 AE2)
- ❌ Close-reading pack (PDF reader + OCR + highlight); skeleton reserved by 0.2 D-A, candidate beyond 0.3 CP1

<a id="93-v1-远期排除"></a>

### 9.3 Long-term V1+ exclusions

- ❌ External MCP Server / A2A exposure (D1-D3 design extensibility only)
- ❌ Full multi-Agent orchestration (V1)
- ❌ Plugin marketplace / developer docs (V2)
- ❌ Web / desktop ↔ Web synchronization
- ❌ OPENSCI OAuth binding (reserved fields only)

---

<a id="附录-a-来源文档谱系状态"></a>

## Appendix A Source-lineage status

| Source | Type | Status | Treatment |
|---------|------|------|------|
| [`north-star.md`](./north-star.md) | Authority | Former sole authority | Absorb §0 / §1-B / §3-3 / §3-4; object details defer to implemented fanlizhi PR #284/#308 |
| [`north-star-patch.md`](./north-star-patch.md) | Proposed §3-3 replacement | Awaiting north-star merge | Absorb A0-A4 + C5 (liningftp scope) |
| [`paper-semantics.md`](./paper-semantics.md) | Object draft | Not in git | Reference §1.4; lock fields/invariants §1.2, derivation remains draft |
| [`evidence-ref-semantics.md`](./evidence-ref-semantics.md) | Object draft | Not in git | Same |
| [`evidence-set-semantics.md`](./evidence-set-semantics.md) | Object draft | Not in git | Same |
| [`note-semantics.md`](./note-semantics.md) | Object draft | Not in git | Same |
| [`citation-relation-semantics.md`](./citation-relation-semantics.md) | Object draft | Not in git | Same |
| [`2026-05-22-pack-orchestration-overview.md`](./2026-05-22-pack-orchestration-overview.md) | Orchestration | Committed | Absorb skeleton §5.1-5.6; detailed prompts/schemas remain original |
| [`sdk-orchestrator-subagents-spec.md`](./sdk-orchestrator-subagents-spec.md) | SDK paradigm | Committed | Absorb §4.1-4.5; SDK/AgentDefinition field details remain original |
| [`subagents-more.md`](./subagents-more.md) | SDK mapping | Committed | Absorb mappings + namespaces + audit anchors §4.5-4.7 |
| [`architecture-audit-2026-05-21.md`](./architecture-audit-2026-05-21.md) | Audit | Committed | Do not repeat F1-G5 fixes; cite implemented D-A/B/C conclusion |
| [`lit-search场景 Agent 编排说明.md`](./lit-search场景%20Agent%20编排说明.md) | Detailed attachment | Committed | §5.3 skeleton only; prompts/options/query walkthroughs retained as detail |
| [`lit-review场景 Agent 编排说明.md`](./lit-review场景%20Agent%20编排说明.md) | Detailed attachment | Committed | §5.4 skeleton only; details as above |
| [`../0.3/north-star.md`](../0.3/north-star.md) | 0.3 authority | Committed | §6 absorbs §3-C CP1 minimal local loop; accounts/servers/telemetry/default page/etc. remain exclusively governed by 0.3 north-star |
| `moat-analysis.md` / `milestone-review.md` / `issue-{170,263,266}-*-reply-draft.md` | Strategy/review/defense | Committed | **Excluded**, retained as archived background |

---

**Version note**: First edition 2026-05-23. All later scope/acceptance/launch-list revisions use this document as baseline, without modifying north-star / patch / semantics drafts retrospectively.
