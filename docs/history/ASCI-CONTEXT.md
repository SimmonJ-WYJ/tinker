> **Historical archive, not the current product specification.** Preserved from ASCI domain documentation at baseline `4ca339592668581c1dc36abc9097fc9bf0aa1650`, archived 2026-11-10.
> Source: [`OPENSCI-Labs/ASCI-Alpha`](https://github.com/OPENSCI-Labs/ASCI-Alpha); original domain definitions and contributor attribution retained; see [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
> Version goals, [Current] labels, and implementation claims refer to historical context at archival, not current Tinker goals; current entry: [CONTEXT.md](../../CONTEXT.md).

<a id="asci-对话流conversation-flow"></a>

# ASCI Conversation Flow

The visual area of the ASCI desktop app where Agents converse with users. This file records the domain's ubiquitous language,
so product and engineering align terminology when discussing conversation rendering and execution presentation.

## Language

**Turn**:
Continuous Agent output between two user inputs (may contain multiple assistant messages).
_Avoid_: message group (implementation terminology, not for product discussion)

**Process Block**:
Intermediate Agent steps before the final answer: thinking blocks and tool-call blocks.
_Avoid_: intermediate message, step (ambiguous alone)

**Final Answer**:
Agent's user-facing textual output (text block). The conclusion users care about; always visible at the top level, never collapsed.
_Avoid_: text block (implementation terminology)

**Execution Step Group**:
An expandable parent grouping of consecutive (≥2) process blocks, occupying one top-level conversation row when collapsed.
Collapsed: current step with spinner while running; "Executed N steps" on completion; error badge "⚠ Executed N steps · M failed" if steps fail, without auto-expansion.
Collapsed by default; click to view individual details in original styles.
**Single-step fallback**: one step is not grouped; show the process block directly, retaining the actual tool name.
_Avoid_: parent group (informal abbreviation; formal documents use Execution Step Group), TodoBoard (another existing concept)

**Teammate (scenario sub-agent)**:
Subagent dispatched by the main Agent through `Task`/`Agent` (e.g. Fox Nick, Eagle Nick).
Each teammate's process blocks form their own **Execution Step Group**, with teammate-name badge on its collapsed row (⊙ Name · N steps).
_Avoid_: subagent in badges (fine informally; badges consistently use nicknames)

**TodoBoard (Task Progress Card)**:
Agent's real-time todo list, driven by `TodoWrite`/`TaskCreate`/`TaskUpdate`, rendered as a progress card.
**Unrelated to Execution Step Groups**: a status board rather than a hidden process.
_Avoid_: confusing it with Task/Agent teammate dispatch; both contain "Task" but mean different things.

## Relationships

- A **Turn** alternates between **Process Blocks** and **Final Answers**
- Consecutive (≥2) **Process Blocks** collapse into an **Execution Step Group**; **Final Answers** break grouping
- **Speaker changes** (main ↔ teammate, teammate A ↔ B) also break groups; each **Teammate** has its own group
- **TodoBoard**, a top-level visible card, also breaks grouping (group → TodoBoard → group)
- Top-level conversation therefore displays: `最终回答 → 执行步骤组（一行）→ 最终回答 → 执行步骤组 → …` (Final Answer → Execution Step Group, one row → Final Answer → group → …)

## Example dialogue

> **PM (translated):** If the Agent thinks, checks three tools, then answers in one turn, what appears?
> **Engineering (translated):** One **Execution Step Group** (one "3 steps" row), followed by the **Final Answer**. Open that row to see the process.
> **PM (translated):** What if it answers half a sentence before checking more?
> **Engineering (translated):** That **Final Answer** breaks grouping: group → text → new group → text.
> **PM (translated):** What if it assigns Fox Nick and Eagle Nick?
> **Engineering (translated):** Main has one group, Fox Nick another (⊙ Fox Nick · 6 steps), Eagle Nick another, each collapsed.

## Flagged ambiguities

- "Execution step" could mean one block or the collapsed group; distinguish **Process Block** for one and **Execution Step Group** for the parent.
- "Task" ambiguity: `Task`/`Agent` dispatch **Teammates**; `TaskCreate`/`TaskUpdate`/`TodoWrite` manage **TodoBoard**. Unrelated.
- One process block is not grouped (**single-step fallback**), avoiding meaningless "1 step" rows.

---

<a id="证据集与笔记evidence-set-&#45;note"></a>

# Evidence Sets and Notes

Ubiquitous language for evidence sets / notes / evidence, aligning product and engineering on literature reading, review traceability, and knowledge retention.

> **0.4 P2 is redefining evidence sets** (grill session 2026-06-01): from evidence for one note (1:1) to research-topic container (1:N), final form pending research-scenario discovery. Below, [Current] = implemented v0.2; [0.4 Target] = redefinition direction.

## Language

**Evidence Set**:
[Current] One **Note** plus its referenced **Evidence**, strictly bound 1:1 to the note.
[0.4 Target] A **research-topic container**: multiple notes + evidence + tags + timestamps, a first-class unit for organizing research materials; notes/evidence may have **multiple memberships** (M:N, shared across containers).
_Avoid_: evidence list (implementation term), favorites folder (too weak, loses topic semantics)

**Note**:
User's interpretation of papers/reviews, one form, plain text (Markdown).
[Current] Created only by highlighting literature/reviews, necessarily in an evidence set, one note per set.
[0.4 Target] Multiple per set; explore **free notes**, ideas independent of literature.
_Avoid_: hypothesis (retired form), annotation (narrows independent-idea meaning)

**Evidence (EvidenceRef)**:
Reference anchor to a source: paper passage, review sentence, or conversation message. The cited material in an evidence set.
_Avoid_: citation (confused with literature citations), quotation

**Evidence Granularity**:
Evidence points to sources at **passage level** (precise highlighted original excerpt) or **object level** (whole paper/review, using representative title / first abstract paragraph / chapter heading). Both require a verbatim quotation, essential for provenance and deduplication identity; only location precision differs. Add Evidence in details produces object-level references; highlighting adds precise passages.
_Avoid_: interpreting object-level reference as having no quotation; all evidence includes quoted text.

**Add Evidence**:
Action adding new evidence to an existing set.
[Current] Only through selecting an existing evidence set during Agent conversation.
[0.4 Target] Direct entry in evidence-set details.

## Relationships

- [Current] Note 1:1 Evidence Set; Evidence Set 1:N Evidence.
- [0.4 Target] Evidence Set ⟷ Note and Evidence Set ⟷ Evidence are **M:N**, with multiple memberships; sets have tags/timestamps.
- Evidence associates through source kinds with Paper / Review / Conversation.

## Flagged ambiguities

- **Core evidence-set metaphor**: decided as multiple-membership research-topic container, M:N ([ADR-007](../adr/ADR-007-evidence-set-topic-container.md), supported by 0.4 P2 discovery): N notes + N evidence, shared across containers.
- **Can notes exist independently?** Decided **yes**: free notes are durable first-class objects (ADR-007 / discovery); evidence links are optional.
- **Notes vs evidence**: peers (container co-members connected by references/links), not evidence subordinate to notes.
- **Evidence sets vs library**: Library contains all Papers; sets are users' thematic selections + interpretation; never conflate them.
- **Ambiguous "literature library"** (0.5 grill, 2026-06-02): in this repo **Library = personal literature library**, all locally saved Papers (device-level, `~/.asci/`, as above). 0.5's **self-hosted literature library is different**: potential server-side **public retrieval assets**, provisionally **Corpus**, decided as a **relevance/curation layer** (open-data cache+index + AI reranking + discipline seed sets), not self-hosted raw corpus. This server infrastructure **does not yet exist** (local-first architecture, ADR-001; server only auth+telemetry, ADR-002). Storage, ownership, and existence differ.

---

<a id="研究空白research-gap-&#45;04-新功能"></a>

# Research Gaps (New in 0.4)

Ubiquitous language for finding research gaps across papers. **Only one new term, Research Gap**; everything else uses evidence set / evidence item / note (minimal terminology). 0.4 covers selected papers; 0.5 expands to field-level retrieved literature.

## Language

**Research Gap**:
Arrange comparable properties of papers in a **comparison table**; **unfilled property combinations (empty cells) = gaps**, plus AI-flagged conflicting conclusions. **Strictly within the selected literature**, never a claim that nobody worldwide has done it.
_Avoid_: hypothesis (retired under Note); research-gap map / evidence grid / scoped corpus / final ruling (retired, replaced respectively by plain comparison table, existing evidence set/evidence item, selected literature, user judgment).

## Relationships

- **Input = evidence set (or selected papers)**; outputs (comparison table + selected gaps) **return to evidence sets** as notes/evidence.
- **Each table cell = EvidenceRef**, with provenance anchor; gaps simply arrange existing evidence as papers × properties and identify empty cells; **no new primitive**.
- Complements **Semantic Search**: search vertically asks what one paper says; table horizontally compares values across N papers.

## Flagged ambiguities

- **Gap scope** always means selected papers (0.4), or retrieved field literature + explicit retrieval boundaries (0.5); copy and AI output **must not claim nobody in the entire field/world has done it**.
- **Table columns**: AI proposes, user adds/removes/edits; neither fixed discipline templates nor fully manual. Comparison table is plain description, not a formal term.
- **Relation to retired hypotheses**: does not revive Note's hypothesis form; outputs traceable gaps/conflicts rather than AI-generated hypothesis claims.

---

<a id="agent-编排orchestration"></a>

# Agent Orchestration

Ubiquitous language for supervisor / subagent dispatch / multi-pack collaboration. Teammates in Conversation Flow are its visible counterpart: orchestration is backend behavior, teammates its conversational presentation.

## Language

**Supervisor**:
Main Agent receiving high-level requests. First **clarifies requirements**, then **autonomously orchestrates** capability-pack scenario Agents (teammates); chooses packs/order itself, **without user-authored workflows or predefined flows**.
_Avoid_: router (narrows to one pack, losing multi-pack orchestration), workflow engine (ASCI does not use human-defined fixed workflows)

**Clarification**:
Supervisor's questions to align intent before orchestration. User's primary control point before autonomy; clarification quality directly determines orchestration quality.

**Autonomous Orchestration**:
Supervisor dynamically chooses capability-pack teammates and collaboration order after clarification. Execution Step Groups and teammate badges make the process transparent; user reviews final outputs.
_Avoid_: workflow orchestration (implies fixed/human-defined flows)

**Inter-Pack Contract**:
Prerequisite for autonomous multi-pack work: each pack declares **capabilities** for dispatch decisions and **inputs/outputs** for passing artifacts among teammates.
_Avoid_: confusing this with the four pack elements (scenario Agent/Skill/MCP/UI framework); contract is an additional declaration for Supervisor decisions.

## Relationships

- High-level user need → Supervisor clarification → autonomous orchestration → multiple teammates (pack scenario Agents) → transparent conversation process → user reviews final outputs.
- Supervisor relies on **Inter-Pack Contracts**, realizing the higher layer above 0.2's reserved object JSON Schema / A2A exchange.

## Flagged ambiguities

- **Supervisor capability tier**: design-input with 2 packs specified single-pack routing, multi-pack in V1; 0.4 with 4 packs upgrades to autonomous multi-pack collaboration. Reverses design-input §5's launch packs never calling each other, requiring an ADR.
- **User control**: clarify, then delegate to Supervisor without mandatory node reviews; transparent and nonblocking by default. Mid-run stop/correction remains an undecided safety valve.

---

<a id="文献检索数据服务literature-relevance-service05-方向-&#45;未实现"></a>

# Literature Relevance Service (0.5 Direction · Unimplemented)

> ✅ **Direction decided** (2026-06-02, grill + 2 deep-research rounds): 0.5 uses **partially self-hosted layers**—OpenAlex metadata index + legally redistributable preprocessed full text, on-demand fetching respecting licensing, greatest investment in agentic retrieval/reranking using BYOK. Architecture/licensing/cost/reversals: [ADR-013](../adr/ADR-013-literature-relevance-service.md) + [0.5 north-star](../milestones/0.5/north-star.md). **Unimplemented**; terminology only, strictly distinct from personal Library.

## Language

**Corpus**:
Public paper-retrieval assets on ASCI's **server**, partially self-hosted: **self-host** complete OpenAlex metadata index + legally redistributable preprocessed text (peS2o/S2ORC ODC-By, PMC oa_comm CC0/CC-BY, XML/plain text); **fetch on demand + external links, no storage** for arXiv, non-OA, CC-NC/ND; **no** full semantic embeddings.
Two full-text/parsing ingestion paths: **batch ingestion** (ADR-013 P1, eager) + **demand-driven lazy fill** (ADR-014, OA added for close-reading demand; see below).
_Avoid_: Library (user-local personal Library), self-hosted paper repository (implies all raw full text; only legally redistributable OA subset is self-hosted)

**Smart Search**:
Relevance over Corpus: agentic iterative retrieval + hybrid (BM25⊕dense) recall + LLM reranking + full-text RAG close reading, promoting canonical and specialist-relevant papers. 0.5's **differentiating software layer**; **retrieval/reranking intelligence defaults to user BYOK keys**, zero ASCI inference cost per query; server hosts only index/corpus.
_Avoid_: search alone (plain BM25 / fan-out are search too; qualify Smart)

**Relevance / Curation**:
Distinctive value: **AI ranks the right papers first and preprocessing enables instant close reading, rather than stockpiling papers**. Defensible asset = relevance/reading software quality + query flywheel from 0.6, not raw corpus (supports 0.2 moat-analysis: software+flywheel moat).

**Non-API Source Access (0.5+ Direction · [ADR-014](../adr/ADR-014-non-api-sources-and-demand-driven-fill.md))**:
Retrieval from **platforms without APIs** (Google Scholar first, later ResearchGate / CNKI / Wanfang / publishers). ToS prohibits scraping/cache redistribution → **live fetching + external links, never Corpus storage**. Fetching **defaults to user-local IP/session**; users may supply **third-party SERP API BYOK** fallback. **ASCI server never scrapes**, preserving local-first + zero BYOK cost/legal risk.
_Avoid_: bare crawler/scraping (loses non-API-source semantics and may imply explicitly excluded server scraping).

**Demand-driven Corpus Fill (0.5+ Direction · [ADR-014](../adr/ADR-014-non-api-sources-and-demand-driven-fill.md))**:
An **additional lazy-fill path** over batch ingestion (ADR-013 P1): when a user close-reads an OA paper, client sends **unlinked "need DOI Y" signal**, and **ASCI server fetches/parses OA itself** into shared cache. **Contribution = signals + server fetch/parse**, not uploaded user copies: prevents poisoning (ASCI controls parsing), copyright redistribution of user copies (direct OA fetch), and heavy privacy exposure (demand signal only). **Only redistributable OA enters shared storage**; non-OA / arXiv / NC-ND unavailable to server never enters shared cache, at most device-local cache (ADR-013 R3). Off by default, opt-in + unlinking.
_Avoid_: user-contributed library / uploaded parsing (rejected user copies; server fetches/parses), query flywheel (0.6 relevance signals, orthogonal; see Flagged ambiguities).

## Relationships

- User query → **Smart Search** agentic recall/reranking on **Corpus** → instant specialist results; legal-cache hits open instantly, otherwise on-demand fetch + links.
- Orthogonal to **personal Library**: Corpus is public/server; personal Library is saved/local subset.

## Flagged ambiguities

- **"No self-built metadata database" vs ADR-013 self-hosted OpenAlex index** (0.5+ grill, 2026-06-03): no conflict. **Mirroring OpenAlex open data is reuse, not creating a metadata database**; the prohibition means no proprietary catalog or metadata authority. Full OpenAlex index remains **self-hosted** (ADR-013 P1). User-driven return concerns **parsed full text/reading data**, a separate layer, not metadata.
- **Corpus vs personal Library**: similarly named repositories, different objects; never conflate (same item under Evidence Sets and Notes §Flagged ambiguities).
- **Demand-driven Corpus Fill (content flywheel) vs Query Flywheel (signal flywheel)** (0.5+ grill, 2026-06-03): orthogonal. First returns **public OA content**, DOI-keyed/unlinked, to fill full-text cache; light privacy exposure, **0.5 opt-in**. Second returns **query/click/adoption signals** to improve relevance; per-user research behavior more strongly conflicts with 0.3 boundaries, **deferred to 0.6**.
- **Non-API access vs OpenAlex coverage** (0.5+ grill, 2026-06-03): complementary. Self-hosted OpenAlex covers open metadata long tail; GS-like sources fill gray literature, citation discovery, non-English papers, theses, some non-OA. GS was blacklisted as dead in expansion spec §4.2 for fragility/IP blocks; ADR-014 reevaluates through **user-local fetching + quantified spike availability + observe tier**, **without reviving server fan-out**.
- **Monetization / 0.6 query flywheel / privacy boundaries** are product decisions under ADR-013 + 0.5 north-star. Freemium **optional**, not forced by cost, but reputation fixes belong in free tier. Query terms may be research content, conflicting with 0.3's no-research-content telemetry rule; untouched in 0.5.

---

<a id="文献语料与检索literature-corpus-&#45;retrieval"></a>

# Literature Corpus and Retrieval

Ubiquitous language for full text / LLMWiki / semantic search, aligning product and engineering on literature Q&A, review acceleration, and evidence assembly.

## Language

**LLMWiki / Enhanced Literature Reading**:
LLM-enhanced per-paper output with paragraph summaries and key-term annotations, corresponding one-to-one with original passages.
Supports both human enhanced reading and a high-signal **Semantic Search** corpus layer.
_Avoid_: article generation (implementation term), bare wiki (confused with wiki corpus directory)

**Vector Index**:
**Rebuildable derived cache** of literature chunks/embeddings for semantic similarity recall.
One global index follows Library, not workspace partitions; deletable/rebuildable, not user data.
_Avoid_: vector database/knowledge base (implies primary assets rather than cache), RAG (bundles retrieval/generation and obscures their boundary)

**Semantic Search**:
Natural-language retrieval of relevant **passages** across the library, returning original anchors.
Autonomously invoked by Agent for Q&A/reviews; complements per-paper reading by retrieving first, then deciding where to read deeply.
_Avoid_: fuzzy search (semantic ≠ fuzzy), full-text search (keyword path)

**Hybrid Retrieval**:
Fusion of semantic vectors and exact-term keyword recall. Research queries often contain precise terms
(gene names/method abbreviations/authors); semantics alone misses them, keywords alone lack generalization.

**Evaluation Toggle**:
Master gate for semantic search participation in Agent workflows; off returns to per-paper baseline,
allowing A/B assessment of actual value.

## Relationships

- Paper parsing → raw full text → optional **LLMWiki**; both plus article abstracts form the **Vector Index**'s three corpus layers.
- Retrieved anchors + source excerpts convert directly to **EvidenceRef**, closing retrieval→better evidence assembly.
- **Vector Index** follows global corpus/Library; **Evidence Sets** follow user/workspace; query-time filters connect differing scopes.

## Flagged ambiguities

- **Searching evidence sets themselves** is excluded now; revisit after ADR-007 M:N containers and larger scale. Semantic Search currently covers literature only.
- **Embedding source**: local-model-first decided ([ADR-012](../adr/ADR-012-local-embedding-vector-index.md)); remote embeddings are future extensions, not initial path.
---

<a id="遥测埋点telemetry"></a>

# Telemetry

Ubiquitous language for crash reports / behavior events / self-evolution signals. Architecture: [ADR-011](../adr/ADR-011-telemetry-architecture.md); implementation map: [telemetry-spec](../specs/telemetry-spec.md).

## Language

**Three Telemetry Layers**:
Sentry crashes (always on, redacted), PostHog behavior (toggle ①), self-evolution signals (toggle ②, independent channel). Independent layers; first two are 0.3 operational minimums.
_Avoid_: one generic telemetry toggle; Sentry has none, other two control separate layers.

**deviceId (Anonymous Device Identifier)**:
Locally generated UUID assigning events/signals. Sole identity before #420 sign-in; later identify/alias merges into account without changing it.
_Avoid_: user ID; it contains no user information and cannot reveal it by reversal.

**Consent Mode / Opt-in vs Opt-out**:
GDPR regions (EEA/UK included, local-time-zone heuristic, unknown treated as GDPR) default off, explicit enable = opt-in; others default on, can disable = opt-out. Persisted explicit choices override regional defaults.
_Avoid_: EU-IP detection (local-time-zone heuristic, no IP lookup; ADR-011 §2).

**Full-Stop Gate**:
Consent off means no local buffering and no reporting, rather than local recording with reporting alone gated.
_Avoid_: reporting toggle, which implies continued local recording.

**Self-Evolution Signal**:
5 structured categories (task structure, tool usage, model selection, errors, workspace structure) + implicit feedback. Fields audited against `schema/telemetry/*.schema.json` (Zod-generated, tracked); outbound Zod strip enforces allowlist.
_Avoid_: 6 categories (Proposal decision signals left 0.3 with Proposal).

**Implicit Feedback**:
Indirect quality signals from actions: copy / save / cite / discard / retry (thumbs_up/down reserved enum, no 0.3 UI). Collect only actions/object kinds, never content.

**Redaction Boundary**:
No outgoing full literature text, PDFs, note/conversation originals, search terms, credentials, emails, IPs, usernames, or username-bearing paths; replace username path segments with `<USER>`.

## Relationships

- Explicit renderer events → IPC → main telemetry-service (sole gate: consent → allowlist → redaction → deviceId) → SaaS / local JSONL.
- Event names/property allowlists authoritative in `packages/shared/src/telemetry/event-registry.ts`; no bare strings at call sites.
- Pluggable self-evolution sender: only local `signals.jsonl` until backend ADR-002 is ready.

## Flagged ambiguities

- **T-6 (self-evolution endpoint persistence)** awaits ADR-002 backend decision; local JSONL compensates this release.
- **Thumbs UI**: schema enum reserved; separate UI issue.
- **Native minidump redaction**: Crashpad binary dumps cannot be redacted client-side; no ASCI-injected user fields, known Sentry limit.

---

<a id="数据所有权data-ownership"></a>

# Data Ownership

Ubiquitous language for exports / object standards, aligning product and engineering on GDPR portability (Art.20)
and open-standard ecosystem positioning (grill session 2026-06-02, issue #419 / PRD 0.3.0 Epic 4).

## Language

**Export Bundle**:
One-click zip from Settings account tab, containing all local research objects (6 persistent kinds),
manifest, copies of object-standard schemas, and review bodies. Implements GDPR Art.20 portability.
_Avoid_: backup (implies reimport into ASCI, not promised in 0.3), dump (implies private format, contrary to open standards)

**Object Standard (O1 Schema)**:
Open JSON Schemas for core objects, generated from TS types as **sole source of truth**, stored in `schema/objects/`.
External tools should parse bundles without ASCI source (BibTeX / Zotero CSL ecosystem role).
_Avoid_: internal schema; this is an external contract.

**Manifest**:
Self-description inside the bundle: export time, app version, object counts, data-file↔schema mapping.
Importers should read it before data.

## Relationships

- One JSON-array file per object kind in an **Export Bundle**, each entry satisfying **Object Standard**; **Manifest** describes the whole.
- Soft-deleted visibility='deleted' objects **are included**: complete portability, not a filtered view; importers filter themselves.
- Review metadata is JSON, body a separate bundled file referenced through a bundle-relative path.

## Flagged ambiguities

- Two counts of core objects: export covers 6 **persistent** kinds (Review included, Proposal excluded because it has no table);
  schema generation covers all 7 TS objects, including Proposal for #243 documentation.
- Export ≠ backup: 0.3 promises taking data out for third-party parsing, not reimport, which is out of scope.
