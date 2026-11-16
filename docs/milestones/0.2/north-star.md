<a id="02-北极星目标beta科研对象底座"></a>

# 0.2 North-Star Goals (Beta: Research Object Foundation)

**Positioning**: define the research object model and read/write protocols, validating the foundation through ASCI's own applications.
**Deadline**: 2026-06-05 (start immediately after 0.1 delivery, approximately 3 weeks)
**Release**: internal dogfood / limited beta, no public release
**Audit principle**: each goal must be verifiable by yes/no or a concrete number, without subjective judgment; every criterion must carry a priority.
**Single authority**: this is the sole authoritative 0.2 milestone definition. GitHub milestone description is only a short guide (≤200 characters + link), without duplication; scope changes are governed here.

> **Scope principle**: all 0.2 work is a hard prerequisite for 0.3 public release (objects, Agent extensibility, capability-package contracts), with no overall downgrade; every audit criterion defaults to Required. Downgrades concentrate in 0.3.0 (see 0.3 §X).

| Label | Meaning |
|------|------|
| Required | Must pass before 0.2 delivery |
| Observe | Track without blocking delivery |
| Degradable | May move to 0.3 in extreme circumstances |

> **Revision**: 2026-05-14 added §0 Agent-led principles, §I-A Proposal model/triggers, §I-B research journey, and multiple Agent-triggered criteria/Proposal paths in §III.

---

<a id="section-zero"></a>

<a id="零asci-agent-主导原则总则"></a>

## 0. ASCI Agent-Led Principles (General Rules)

ASCI's philosophy is **“Agents lead, users decide”**: Agents perform all feasible **observation / synthesis / annotation / organization**; users **set goals, review judgments, and make final decisions**. Apply this filter to all later criteria: every manual-user design must first ask, *“Can the Agent propose first, leaving only the decision to the user?”*

<a id="落地姿态按当前阶段优先级"></a>

### Delivery Modes (Current Priority)

| Mode | Agent work | User work | Current priority |
|------|------------|----------|---------------|
| **C. Triggered (preferred)** | Automatically evaluate object changes, produce judgment cards (Proposals) | Accept / modify / reject | ✅ Main path in 0.2 / 0.3 |
| **B. Background batch** | Periodically scan workspace and produce review list | Review queue in one batch | Assess in 0.4+ |
| **A. Real-time suggestions** | Surface side notes during user actions | Accept / modify / reject | Assess in 0.4+ |

<a id="兜底通道"></a>

### Fallback Channels

Retain manual relationship creation / categorization / hypothesis registration as **fallbacks**, **never presented alongside the primary Agent proposal path**. Place entries in the detail-page “⋯” menu or “+ Add one myself” below pending proposals, never as primary action buttons.

<a id="区分原则"></a>

### Distinguishing Principles

| Behavior | Nature | Lead |
|---------|-----|---------|
| Write “This method could inform my project” | Creative thought | ✅ User |
| Mark “A contradicts B” | Relationship observation | ❌ Agent, user decides |
| Write “I hypothesize X outperforms Y” | Assertion registration | ⚠️ User may write; Agent should identify and propose classification |

**Principle**: Agents replace work **with standard answers** (observe, synthesize, annotate, organize); users retain work **without standard answers** (judge, create, decide, record intuitions).

<a id="灰度回退条件"></a>

### Staged Rollback Conditions

§0 is philosophy; validate acceptance in §III-4 X1 interviews. **Rollback criteria**:

| Trigger | Action |
|---------|------|
| ≥ 50% in X1 do not want proactive proposals | Downgrade primary path to A (real-time side notes) or B (batch review), exact choice at end-of-0.2 retrospective |
| < 50% but ≥ 20% resistant | Retain C primary; add Settings option disabling proactive proposals by default for resistant users |
| < 20% resistant | Retain C as sole primary path |

> **Rollback does not overturn §I-A Proposal model**: state machine/dismissPolicy apply in every mode; only timing changes (passive vs proactive), not interaction form.

---

<a id="section-1"></a>

<a id="一科研对象模型5-核心对象-&#45;1-交互对象"></a>

## I. Research Object Model (5 Core + 1 Interaction Object)

Core principle: **each object has a unique ID, `supports` references and appends, and is independent of specific UI**.

| Object | Category | Description | Relations |
|------|------|------|---------|
| Paper | Core | Paper entity inherited from 0.1 | Referenced by EvidenceRef, Note |
| EvidenceRef | Core | Binding from conclusion to paper paragraph | source: Paper.paragraph; target: Review.sentence |
| Note | Core | Annotation on any object, **semantic types distinguished by `kind`**; `kind: "hypothesis"` additionally enables `hypothesisStatus` lifecycle | target: Paper / EvidenceSet; `kind: "note" \| "hypothesis"` (default `"note"`; `"hypothesis"` **primarily registered after Agent-triggered assertion Proposal and user decision**, manual `kind` is fallback); `hypothesisStatus: "unknown" \| "supported" \| "contradicted" \| "suspended"` (default `"unknown"`, updated after accepting V6d judgment; [§III-2 V6d](#section-3-2)) |
| EvidenceSet | Core | Named papers+evidence; **primary path: Agent Proposal after review/search/new-paper ingestion**, user decides; manual creation fallback | contains: Paper[] + EvidenceRef[] |
| CitationRelation | Core | Logical paper relationship; **primary path: Agent candidates after review/search ingestion**, decisions on cards; manual fallback | type: supports/contradicts/method-ref; from: Paper; to: Paper |
| **Proposal** | **Interaction** | **Proactive Agent candidate with proposal→user-decision state machine**; fields/triggers in [§I-A](#一-aproposal-对象模型与触发路径) | kind: `citation-relation` / `evidence-set` / `hypothesis-promote` / `hypothesis-review`; status: pending / accepted / rejected / modified |

> **Hypothesis**: a Note type (`kind: "hypothesis"`), not an independent model. Explicit hypothesis declaration is rare during dogfood; writing assertions on papers/sets is common, and the forms overlap. Separate only when real demand emerges.

> **Proposal**: interaction object for Agent-led/user-decided philosophy, **not a core research output**. Relationship/set candidates, hypothesis suggestions, and V6d evaluations first become Proposals, converting to CitationRelation / EvidenceSet / Note after user decisions. Proposal also carries decision telemetry (0.3 §III-A), a key Agent-evolution input.

---

<a id="section-1a"></a>

<a id="一-aproposal-对象模型与触发路径"></a>

## I-A. Proposal Model and Trigger Paths

<a id="proposal-字段"></a>

### Proposal Fields

| Field | Description |
|------|------|
| id | Unique ID |
| kind | `citation-relation` / `evidence-set` / `hypothesis-promote` / `hypothesis-review` |
| sourceCapability | Originating package identifier for provenance/acceptance statistics |
| payload | Candidate relationship triple / paper IDs / hypothesis suggestion / V6d evaluation |
| `reasoning` | Agent explanation supporting user decisions |
| status | `pending` / `accepted` / `rejected` / `modified` |
| createdAt / decidedAt | Timestamps |
| targetObjectRef | Target Paper / EvidenceSet / Note ID, defining `scoped` silence granularity |
| `dismissPolicy` | Three rejection policies:<br>• `once`: suppress this proposal only<br>• `scoped`: no further same-kind proposals from this sourceCapability within `targetObjectRef`, still allowed on other objects<br>• `silence-this-kind`: permanently suppress this sourceCapability/kind workspace-wide |

<a id="触发式产出点c-姿态落地02-必做"></a>

### Trigger Points (Mode C, Required in 0.2)

| Event | Producer | Proposal kind | Audit |
|---------|---------|---------------|-----------|
| Review completed | Review package | `citation-relation` | V2b |
| Review completed | Review package | `hypothesis-promote` | V6c' |
| Search results ingested | Search package | `evidence-set` (append candidates to existing set) | Same V2b pipeline |
| Search results ingested | Search package | `citation-relation` (relationships among new papers) | V2b |
| Paper added to EvidenceSet | Review package | `hypothesis-review` (supports/contradicts/neutral + reasoning for attached hypotheses) | V6d |
| Assertion recognized in user Note | Review package | `hypothesis-promote` | V6c' |

> Implement only **triggered C mode** in 0.2; evaluate batch B / real-time A in 0.4+.

<a id="ui-位置约定"></a>

### UI Placement

- **Primary**: inline pending-proposals region in Paper / EvidenceSet / hypothesis Note details, close to objects; avoid separate proposal center losing context.
- **Fallback**: detail “⋯” or **“+ Add one myself”** below proposals; no primary action slot.
- **Decisions**: five actions `采纳` / `修改` / `拒绝` / `仅本对象不再提示（scoped）` / `不再提示这类（silence-this-kind）` (accept / modify / reject / silence this object / silence this kind). `拒绝` defaults `once`, dropdown upgrades to `scoped` / `silence-this-kind`. Acceptance creates formal CitationRelation / EvidenceSet / Note; retain original `status: accepted` for history.
- **Reasoning**: every Proposal shows `reasoning`; no unexplained bare candidates.
- **Telemetry**: decisions use 0.3 §III-A self-evolution user-feedback channel, acceptance grouped by sourceCapability × kind, physically separate from product telemetry.

---

<a id="一-b典型科研旅程phd-王老师做-rag-综述"></a>

## I-B. Typical Research Journey (PhD Wang's RAG Review)

> **Purpose**: model tables alone make it hard to assess 5 objects + Proposal states + 4 workstreams for real research. This complete story maps §I / §I-A / §III audits to user actions. **Scenario aligns with 0.3 §III-C.1 review-package launch**, keeping validation and implementation consistent.

**Protagonist**: Wang, third-year CS PhD, writing a RAG (Retrieval-Augmented Generation) literature survey.

**Day 1 — Workspace and Direction**

1. Create `rag-survey-2026`, intent (English translation): “Systematically review 2023-2026 RAG work, focusing on strengths/weaknesses versus long-context models.”
2. Start **search package** ([0.3 §III-C.1](../0.3/north-star.md#三-c-1-首发场景能力包-2-个)), keywords `RAG long-context survey`.
3. Agent searches arXiv / Semantic Scholar / OpenReview, returns 30 candidates; select 12 for ingestion → 12 **Paper** objects ([§I object 1](#section-1)).
4. Ingestion triggers search package:
   - `evidence-set` candidate ([§I-A](#section-1a)), but no existing sets, so no Proposal yet.
   - `citation-relation` Proposals ([V2b](#section-3-1)): 8 `citation-relation` candidates across 12 Paper detail pending regions, e.g. Paper-RAG-Survey-2024 method-ref Paper-FiD-2020.

**Day 2 — Reading and Hypothesis**

5. Open Paper-RAG-Survey-2024, see 3 `citation-relation` cards with reasoning.
6. Accept 2 → formal **CitationRelation** ([object 5](#section-1)); reject 1 with `scoped` ([dismissPolicy](#section-1a)): same source/kind silenced on this Paper, not others.
7. Write **Note** ([object 3](#section-1)) beside the paper, English translation: “I hypothesize RAG still beats long-context beyond 1M tokens because retrieval precision does not degrade linearly with context length.”
8. Review package recognizes an assertion and prepares a `hypothesis-promote` Proposal ([V6c'](#section-3-2)) and shows `hypothesis-promote`; reasoning identifies X outperforms Y because Z.
9. Accept → Note `kind` becomes `hypothesis`, `hypothesisStatus` starts `unknown` ([fields](#section-1)).

**Day 3 — Evidence Organization and Review**

10. Manually group 5 of the 12 papers on RAG vs long context in new **EvidenceSet** RAG-vs-LongContext ([object 4](#section-1)); this is fallback until V2b review-triggered suggestions.
11. Attach the beyond-1M-token hypothesis Note to that set for later `hypothesis-review`.
12. Start review package, generating Review HTML with clickable citations inherited from 0.1; split into **EvidenceRef** objects ([object 2](#section-1)), each binding review sentence → Paper paragraph.

**Day 4 — Agent Hypothesis Evaluation**

13. Review completion triggers:
    - `citation-relation` candidates newly recognized between review sections.
    - `hypothesis-promote` candidates for other falsifiable assertions.
14. Add 3 new arXiv papers to RAG-vs-LongContext; **new Paper event** triggers `hypothesis-review` ([V6d](#section-3-2)):
    - Evaluate new evidence for the beyond-1M hypothesis in the `hypothesis-review` Proposal.
    - Reasoning: Paper-A shows precision declining to 73% at 2M, contradicts; Paper-B retains 91% at 1.5M, supports; Paper-C does not test this range, neutral.
    - Recommend `unknown` → `suspended`: evidence points both ways, more data needed.
15. After reading reasoning, **accept** → Note `hypothesisStatus` automatically `unknown` → `suspended` ([fields](#section-1) + V6d writeback).

**Day 5 — Retention**

16. Open sidebar notes ([V6a/V6b](#section-3-2)), filter `kind: hypothesis`: 5 hypotheses, `hypothesisStatus` values 1 `supported` / 1 contradicted / 3 `suspended`.
17. These support Discussion. The result is a **structured object library**, not 12 scattered PDFs: 12 Paper + 38 EvidenceRef + 17 CitationRelation + 23 Note (5 hypothesis Notes + statuses) + 3 EvidenceSet.

<a id="故事覆盖的审计项"></a>

### Audits Covered by the Story

| Steps | Object / Proposal | Audit |
|------|---------------------|-----------|
| 1-3 | Paper ingestion | Inherited 0.1 |
| 4 | `citation-relation` Proposal | [V2b](#section-3-1) |
| 5-6 | Decision + `scoped` dismiss | [V2b](#section-3-1) + [V6f](#section-3-2) |
| 7-9 | Note + `hypothesis-promote` | [V6](#section-3-2) + [V6c'](#section-3-2) |
| 10-11 | Manual EvidenceSet fallback | [§I EvidenceSet](#section-1) |
| 12 | EvidenceRef splitting | [V1](#section-3-1) |
| 13 | Review triggers `citation-relation` and `hypothesis-promote` Proposals | [V2b](#section-3-1) + [V6c'](#section-3-2) |
| 14-15 | `hypothesis-review` Proposal + `hypothesisStatus` writeback | [V6d](#section-3-2) |
| 16-17 | Notes panel + filtering + query performance | [V6a/V6b/V6e](#section-3-2) |

<a id="故事不覆盖的仍需独立验证"></a>

### Not Covered (Independent Verification Required)

- Deleted Paper → EvidenceRef “Source removed” ([V3](#section-3-1)).
- Reverse-query time with 100+ Notes ([V6e](#section-3-2)), requiring load testing beyond the journey.
- Agent extensibility A0/A1/A2/A3 and capability concepts X1-X4, architecture/concept validation.

---

<a id="二读写协议三条铁律"></a>

## II. Read/Write Protocols (Three Strict Rules)

| # | Protocol | Audit |
|---|------|---------|
| P1 | **Append, never overwrite**: add evidence without deleting old data | Repeated writes under Paper retain old records |
| P2 | **Reference, never copy**: associate by ID, not duplicated contents | Deleted source shows “Source removed” at references, not empty |
| P3 | **Query, never scan**: relation indexes instead of full traversal | All Notes for Paper X without scanning every Note |

Implementation form (JSON Schema / TypeScript interface / other) follows technical design.

<a id="设计约束面向外部-api-的扩展性"></a>

### Design Constraints: External API Extensibility

Though local in 0.2, reserve future MCP/A2A exposure:

| # | Constraint | Description | Priority |
|---|------|------|--------|
| D1 | **Stable serialization** | Independent per-object JSON Schema, decoupled from UI/storage | Required |
| D2 | **ID references, no nested objects** | Consistent with P2; bounded API responses instead of entire graphs | Required |
| D3 | **Parameterized queries** | Query by type, relationships, time ranges; no hardcoded logic | Required |

No added 0.2 workload: P2/P3 already require IDs/indexes. Remember external callers to avoid component-only query logic.

<a id="section-open-standard"></a>

<a id="对象标准开放护城河-p0"></a>

### Open Object Standard (Moat P0)

> Strategy: [moat-analysis.md](./moat-analysis.md) §4.3 🥇 P0—open ASCI object formats, a niche like BibTeX/Zotero CSL.

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| O1 | Externally accessible independent JSON Schema docs for 5 core objects (README + `schema/` or separate repo) | External developer implements compatible objects without reading ASCI code | Required |
| O2 | Schema decoupled from UI/storage, no internal leakage | No `_uiState` / `_dirty` runtime fields | Required |
| O3 | At least 1 export example, local library → standard JSON | Pass generic JSON Schema validation such as `ajv` | Required |

Minimal incremental work; P2/P3/D1-D3 already require independent schemas. Core deliverable is **explicit external documentation**, elevating internal constraints to public contracts.

---

<a id="三02-工作主线按依赖顺序"></a>

## III. 0.2 Workstreams (Dependency Order)

> 1-2 validate object foundation, following 0.1; 3-4 are parallel Agent architecture/experience workstreams alongside 1-2.

<a id="section-3-1"></a>

<a id="1-证据链查看器p0-&#45;最先"></a>

### 1. Evidence Chain Viewer (P0, First)

**Validation**: object model + P2 references
**Inherited from 0.1**: group B, traceable reviews

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| V1 | Review citation click locates specific Paper paragraph | Any review/reference opens corresponding paragraph | Required |
| V2 | Paper lists all associated EvidenceRefs, Notes, CitationRelations | Inspect related-object list | Required |
| V2a | **Fallback**: Paper A “⋯” manually adds relation to B (supports/contradicts/method-ref), visible in both details; no primary action slot | Menu → add relationship → B + type → save; same relation on both sides | Required, fallback |
| V2b | **Agent primary**: review completion/search ingestion triggers `citation-relation` Proposals with from/to/type/`reasoning`, in relevant Paper pending regions; five decisions ([§I-A](#section-1a): `采纳 / 修改 / 拒绝 / 仅本对象不再提示 / 不再提示这类`, accept/modify/reject/object silence/kind silence); accepted becomes bidirectional formal relation | Review → ≥1 candidate with reasoning → accept → visible both ways | Required |
| V3 | Delete Paper → referencing EvidenceRef shows “Source removed” | Simulate deletion and inspect state | Required |

<a id="section-3-2"></a>

<a id="2-札记面板p1-&#45;第二"></a>

### 2. Notes Panel (P1, Second)

**Validation**: P1 append + P2 references + P3 queries (V6e directly) + Note kinds and `hypothesisStatus` lifecycle
**Dependency**: evidence viewer, model validated

> **Review capability ownership** (for 0.3 §III-C.1): ASCI review capability consists of **0.1 review pipeline (B: generation + traceability)** plus **0.2 V1 evidence viewer (objectified citations, bidirectionality, Proposal triggers)**. 0.3 package **does not reimplement it**; it packages existing capability under 0.2 §III-3 A3 (scenario Agent + Skills + UI rendering configuration).

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| V4 | Note beside paper automatically associates with Paper | Write and inspect Paper notes | Required |
| V5 | Repeated Notes append, preserving earlier ones | Write 3, all visible | Required |
| V6 | Associated Notes searchable in EvidenceSet | Search Note content in set view | Required |
| V6a | Sidebar Notes shows all Notes, searchable | Open, inspect, filter keywords | Required |
| V6b | Click Note navigates associated Paper/EvidenceSet | Right panel locates object | Required |
| V6c | **Fallback**: manual `kind` (`note` / `hypothesis`) during edit/create; sidebar kind filtering; Paper-specific hypothesis list | 5 Notes (3 ordinary + 2 hypotheses), filters show 3 / 2 | Required, fallback |
| V6c' | **Agent primary**: assertion-bearing Note or completed review triggers `hypothesis-promote`, payload sentence + reasoning; five actions ([§I-A](#section-1a)); acceptance flips kind | Write “X outperforms Y because…” → candidate/reasoning → accept → hypothesis | Required |
| V6d | **Agent primary**: new Paper in set triggers `hypothesis-review` for each attached hypothesis, `supports` / `contradicts` / `neutral` + reasoning + recommendation, in Note pending region; decide accept / mark doubtful / read then judge / reject. **Acceptance writes Note `hypothesisStatus`** ([§I](#section-1)): `supports` → `supported`, `contradicts` → `contradicted`; recommended `suspended` (e.g. mixed evidence) requires confirmation during acceptance. Manual override fallback | Attach `hypothesisStatus: unknown` Note → add paper → candidate with label/reasoning → accept supports → supported; rejection leaves fields unchanged | Required |
| V6e | With 100+ Notes, reverse query by Paper has latency independent of total count (P3) | Create 100+, query Paper X, response independent of count | Required |
| V6f | Persist Proposal `accepted` / `rejected` / `modified`; all dismiss policies work: `once` default / `scoped` permanently silences source/kind within `targetObjectRef` / `silence-this-kind` workspace-wide | ① once rejection then rerun allows same-place kind again; ② `scoped` suppresses Paper-A but allows Paper-B; ③ `silence-this-kind` suppresses everywhere | Required |

<a id="section-3-3"></a>

<a id="3-agent-拓展性重构与-1-2-并行"></a>

### 3. Agent Extensibility Refactoring (Parallel with 1-2)

**Purpose**: foundation for capability packages, third-party extensions, Provider decoupling. Agent calls/tool-Skill-MCP registration are scattered in main; **current multi-Agent form does not align with Claude Code SDK's recommended Orchestrator + subagents**, limiting upcoming packages (§4).

**Scope**:
- **Align recommended SDK architecture**: layered Orchestrator + domain subagents (search/review/Zotero), standard SDK registration replacing temporary scattered main-process orchestration.
- Abstract SDK call layer: single entrypoint, decouple Provider/model.
- Unified tool / Skill / MCP registration/discovery, reserving one-click package install interfaces.
- **UI framework library**: one built-in conversation-primary + right-artifact framework; contract reserves framework selection (0.4+ extensible registration for writing/experiment logs etc.).
- Reserve package interfaces, registration/invocation contract only, no concrete packages.

**Audit criteria**:

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| A0 | One Orchestrator entry, SDK-standard subagent registration/routing | Update `docs/architecture.md`; mock subagent routes without Orchestrator changes | Required |
| A1 | One invocation entrypoint, all Providers via adapters | Add mock adapter without entrypoint changes | Required |
| A2 | Unified registration, runtime enumeration | Registry API returns all metadata: name/source/capabilities | Required |
| A3 | Four-part package contract: **scenario Agent + Skill references + MCP references + UI framework selection/render config**; main framework library (one built-in in 0.3, extensible 0.4+), documented for direct 0.3 use. **Reserve `capabilities.proposals[]`** declaring kinds/triggers/reasoning templates so main routes to object pending regions (§I-A) | Independent `schema/capabilities/` docs with four-part schema + framework registry interface + `proposals[]` schema; ≥1 mock package registers, is called, renders output, **produces ≥1 mock Proposal in pending region with user decisions** | Required |

<a id="section-3-4"></a>

<a id="4-前端交互体验优化-&#45;能力包范式与-1-2-并行"></a>

### 4. Frontend Experience: Capability-Package Paradigm (Parallel with 1-2)

**Purpose**: current configuration resembles Coding Agents requiring separate MCP/Skill/Provider setup. Start shifting from configuration-driven to capability-package-driven: understandable search/review/writing/experiment packages, one-click install then task assignment.

**0.2 scope**: direction + validation + concepts, no implementation:
- Research needs, validate paradigm, identify candidates.
- Concept spec: naming/granularity/contents/dependencies/install/uninstall.
- UI concepts: browse/install/manage/task entry.
- Migration from old configuration flow without breaking 0.1 experience.

**Audit criteria**:

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| X1 | Interview ≥5 target users; ≥3 candidate categories; explicit findings supporting/refuting/narrowing 0.3 §III-C | Accessible interviews/list + archived validation/refutation conclusion | Required |
| X1.1 | Validate **proactive-proposal acceptance** ([§0 rollback](#section-zero)): show one reasoning-bearing card each for relationship/promotion/review, rate 1-5; ≥50% scoring ≤2 triggers primary-path downgrade assessment | Per-user ratings for all three; resistance proportion (≤2) summarized in X1 output | Required |
| X1.2 | Validate **Skill/package mental distinction** (0.3 §III-C.0): show system foundation Settings vs Agent ecosystem sidebar Configuration; distinguish system parameters vs Agent capabilities within 30s; accuracy <60% triggers 0.3 CP5 mandatory-constraint downgrade assessment | Each user independently locates Provider API key and review-package enablement, aggregate accuracy | Required |
| X2 | Concept spec covers naming/granularity/four-part contents; **byproducts `capabilities.proposals[]` kind/trigger/reasoning contract**; dependencies/install/uninstall; Skills/packages split and Settings/page hierarchy | Peer-reviewed accessible spec; Proposal lists for both launch packages | Required |
| X3 | UI concepts cover Configuration page (Skills/packages browse/detail/enable/install/uninstall/preferences), task handoff, **Paper/EvidenceSet/hypothesis pending regions**, cards/reasoning/five actions `采纳 / 修改 / 拒绝 / 仅本对象不再提示（scoped）/ 不再提示这类（silence-this-kind）` (accept/modify/reject/object/kind silence), manual “⋯” fallback; one 0.3 conversation/right-artifact framework for both launch packs; explain 0.4+ framework registration | Clickable happy path with **≥1 Proposal walkthrough**, candidate + reasoning + decision + state change, including ≥1 scoped rejection | Required |
| X4 | Document old Settings→0.3 mapping: MCP→new MCP tab, package items→sidebar Configuration; Zotero/Provider/proxy unchanged; no 0.1/0.2 configuration loss | Mapping + executable upgrade verification before implementation | Required |

> 0.2 delivers only visible/decidable concepts (spec/UI concepts/validation/migration). **Implementation (2 launch packages, Configuration page, Settings/default page) belongs to 0.3 §III-C**.

---

<a id="四与-01-的关系"></a>

## IV. Relationship to 0.1

Diagram: 0.1 Paper[] search results become Paper objects; Review HTML conclusions become EvidenceRefs; user feedback/corrections become Notes; Zotero library associates with EvidenceSets.

```
0.1 output                       0.2 consumption
──────────                       ───────────────
Search results (Paper[])   →     Ingest as Paper objects
Review conclusions (Review HTML) → Split into EvidenceRef[]
User feedback/corrections  →     Write Note
Zotero paper library       →     Associate with EvidenceSet
```

0.1 trustworthy search/reviews are 0.2's **data sources**; 0.2 objects make 0.1 outputs **accumulable and reusable**.

---

<a id="五02-不做的事"></a>

## V. Exclusions from 0.2

- Full multi-Agent collaborative orchestration (V1).
- Plugin marketplace / developer docs (V2).
- Covering all research scenarios in object model.
- Separate literature manager; continue Zotero integration.
- User accounts (0.3).
- Public release (0.3).
- MCP Server / A2A exposure (V1 roadmap); reserve extensibility only.
- Concrete packages: concepts/UI/validation only; implement in 0.3 §III-C.
- Retiring old configuration flow: migration plan now, remove corresponding Settings in 0.3 §III-C.
- Independent Hypothesis object: Note `kind: hypothesis` until strong user demand.

---

<a id="六03-前置准备"></a>

## VI. Preparation for 0.3

Dev D progresses F1/F2/F3 during 0.2 for 0.3 readiness, without blocking 0.2.

<a id="f1后端栈选型-adr4-粒度03-启动前置"></a>

### F1: Backend Stack ADR (4 Dimensions, Prerequisite for 0.3)

> **Terminology**: custom server means writing backend code, **not avoiding AWS/GCP**. Public-cloud deployment is certain; decide stack/cloud/SaaS vs custom auth.

End of Week 1: **ADR-002 server stack selection**, `docs/adr/ADR-002-server-stack.md`, covering:

| Dimension | Candidates | Key basis | Priority |
|------|------|-------------|--------|
| ① Deployment | AWS / GCP / Hetzner / DigitalOcean | GDPR sovereignty, EU/US nodes, monthly cost | Required |
| ② Database | AWS RDS / Neon / Supabase DB-only / self-managed PG | Managed vs operations cost | Required |
| ③ Authentication | Custom / Auth0 / Clerk / WorkOS | ORCID integration, monthly thresholds (Auth0 free tier ends beyond 7000 MAU) | Required |
| ④ Framework | Bun + Hono / Go + Gin / Node + Fastify | Learning cost, ~2-week 0.3 window, performance | Required |

Include TCO and decision basis per dimension. Full Firebase/Supabase BaaS can generally be eliminated in §3 for GDPR sovereignty, nondefault ORCID, local-first architecture, with reasons recorded.

> **F1 is a decision, not research only**: research + review + decision maker + record, not an option list. Signed conclusions govern 0.3; changes require ADR revision.

<a id="f2gdpr-mvp-合规启动03-公开发布前置"></a>

### F2: GDPR MVP Compliance Start (Public 0.3 Prerequisite)

Week 1: Privacy Policy / ToS templates (lawyer review, not drafting), DPA signatures using Sentry/PostHog/email-provider templates, outsourced EU Representative (GDPR Art.27). Complete first Privacy Policy draft by Week 2 end.

| Item | Timing | Priority |
|------|------|--------|
| Lawyer reviews policy/ToS templates | Week 1 | Required |
| DPA signing, Sentry/PostHog/email | Week 1-2 | Required |
| EU Representative outsourcing, Art.27 | Week 1-2 | Required |
| First Privacy Policy draft | End Week 2 | Required |

> **F2 scope**: DPO selection / formal DPIA / lawyer-drafted compliance documents **defer until 0.4/V1 scale triggers** (1k+ EU users or charging). ASCI currently does not meet Art.37 mandatory DPO conditions: not public authority / large-scale monitoring / special data.
>
> Full 0.3 MVP list: [0.3 north-star §V](../0.3/north-star.md#五安全机制).

<a id="f3本地存储后端-adrv6e-实现前置"></a>

### F3: Local Storage Backend ADR (Before V6e Implementation)

> **Trigger**: V6e requires reverse-query latency independent of count at 100+ Notes. This needs indexes: JSON files cannot, SQLite can, custom formats need an indexer. Finish ADR-001 before opening V6e implementation issues.

End of Week 1: **ADR-001 local storage selection**, `docs/adr/ADR-001-local-storage.md`, covering:

| Dimension | Key question | Priority |
|------|---------|--------|
| Performance | Query/write latency at 100+ / 1k+ / 10k+ EvidenceRefs | Required |
| Indexes | Secondary indexes, multirelation joins, full-text search native? | Required |
| Cross-platform | macOS/Windows/Linux consistency, native binary packaging? | Required |
| Backup/recovery | File copies vs dump, single file vs tree | Required |
| Migration | Schema evolution, old data migration | Required |
| Offline-first | Fully offline reliability | Required |
| Agent SDK compatibility | Main-process blocking, SDK subprocess concurrency | Required |
| Electron packaging | Binary size, code signing | Required |

Candidates: JSON / SQLite / DuckDB / custom binary / others from research.

> **Hard deadline**: ADR-001 before opening V6e issues, otherwise the 100+ Notes query-time audit cannot run.
