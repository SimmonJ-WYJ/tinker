<a id="asci-040-&#45;050-范围对齐与决策稿"></a>

# ASCI 0.4.0 / 0.5.0 Scope Alignment and Decision Draft

> **Purpose**: preread + meeting decisions for 0.4 / 0.5. Audience: product / engineering / design.
> **Goal**: align scope, gates, dependencies, open decisions, and follow-up in one set of tables for issue breakdown, scheduling, and risk tracking.
> **Status**: awaiting review · 2026-06-22.
> **Authority**: scope/decision alignment only; version PRDs govern requirements, north-star documents govern goals/acceptance, ADRs govern architecture.

---

<a id="0-一页速览"></a>

## 0. One-Page Overview

| Version | Goal | Delivery | Release / start gates | Main meeting decisions |
|------|----------|----------|-----------------|--------------------|
| **0.4.0** | Launch small Research Gaps: AI compares selected papers, identifies gaps/conflicts; users decide | 1 new feature: small Research Gaps; 2 improvements: evidence-set/note basics, P0 security | Extraction-quality spike before core implementation; P0 security before public release | Extraction depth, multiple membership in 0.4, P1 security window, table-column interaction |
| **0.5.0** | Upgrade literature entry to fast, accurate, self-built search data service; expand gaps to domain-level recalled corpus | Deep-dive trio: OpenAlex metadata index, intelligent search/rerank, key-field full-text acceleration; new Full Frontier Research Gaps | Cost + retrieval-evaluation spikes; GS inline results need feasibility spike | Deep-dive spike criteria, GS strategy/owner, 0.5 acceptance |
| **0.6+** | Reserve experimental design/query flywheel | Outside 0.4 / 0.5 core | Laboratory partnerships before experiments; redefine flywheel privacy | Confirm deferral only, no detailed design |

**Ordering rationale**:
- **0.4 does not depend on 0.5 search engine**: validate the gap scenario while improving evidence retention and secure-release fundamentals.
- **0.5 is the heavy infrastructure window**: once deep-dive works, gaps naturally expand from selected papers to field-level recalled corpus.
- **Trust baseline unchanged**: AI fills tables, finds blanks/conflicts; users decide which are worth pursuing. AI never declares innovation on their behalf.

---

<a id="1-会上要拍板什么"></a>

## 1. Meeting Decisions

| Decision | Default recommendation | Impact | Owner | Due | Risk if unresolved |
|--------|----------|----------|-------|-----|----------|
| D1: 0.4 extraction depth | Spike with 15–20 real papers, quantify accuracy/count cap/BYOK cost; if inadequate, reduce paper count or dimensions | Feature depth, schedule, cost | Engineering, unclaimed | TBD | Core schedule could depend on unreliable extraction |
| D2: multiple membership in 0.4? | Exclude; only details-page evidence/notes, multiple notes per set, peer note/evidence management | Evidence model/interaction | Product / engineering at meeting | Close after this meeting | Complexity displaces research-gap work |
| D3: all P1 security in 0.4? | P0 mandatory release gate; P1 only within prelaunch window, remainder 0.5+ governance without changing P0 release decision | Release gates/security issues | Engineering, unclaimed | TBD | All P1 would reduce feature-validation time |
| D4: north-star audit criteria as acceptance? | Use 0.4 / 0.5 north-star audits as primary; PRDs add stories/details | Acceptance | Everyone at meeting | Close after meeting | Inconsistent interpretation after issue breakdown |
| D5: table-column interaction | AI proposes columns, users add/delete/edit; only right-side gap table view, no generic renderer framework | Design/frontend | Product/design/engineering at meeting | Close after meeting | Generic framework exceeds minimum delivery |
| D6: GS strategy | Guaranteed one-click GS navigation; inline results only after feasibility spike | Sources/anti-bot/cost | Engineering, unclaimed | TBD | No API, strong anti-bot controls make direct investment risky |

---

<a id="2-已定边界"></a>

## 2. Settled Boundaries

| Decision | Execution meaning |
|----------|--------------|
| Continue serving individual researchers, not vertical B2B | Personal research workflows, no institutional administration |
| Only one new term: Research Gaps | Keep evidence sets/items, notes, comparison tables and other existing/plain concepts |
| Augment rather than replace | AI compares/finds gaps/conflicts; users judge innovation value |
| 0.4 = 1 new feature + 2 improvements | Small gaps + evidence/note basics + security |
| 0.5 directly adopts ADR-013 / ADR-014 / ADR-012 | Do not reopen deep-dive architecture; discuss scope/acceptance/spikes/owners |
| Writing/data-analysis packs, default-page redesign, autonomous multi-capability orchestration, personalization excluded from 0.4 / 0.5 | No scheduled issues this round |
| Experiments deferred to 0.6+ | Separate track after partnership discussions |

---

<a id="3-040-范围"></a>

## 3. 0.4.0 Scope

<a id="31-目标"></a>

### 3.1 Goal

Make Research Gaps a verifiable new scenario: selected papers → AI comparison of prior work → traceable gaps/conflicts → user decision → evidence-set retention.

### 3.2 In Scope

| Module | Product behavior | Engineering | Acceptance |
|------|----------|----------|----------|
| Small Research Gaps | Start from evidence set/selected papers; AI proposes columns, users edit; AI fills/flags; users select worthwhile gaps and save | Reuse parsing/semantic search/evidence sets; new right-side table; IPC changes synchronize shared constants/main handler/preload/renderer | Every filled cell traces to source; selected-papers-only scope; zero worldwide novelty/innovation declarations; artifacts save/read back |
| Evidence-set/note basics | Add evidence/notes directly in details; multiple notes per set, peer management | Reuse `notes:*` / `evidenceSets:*` and services; store gap artifacts | Add 2+ notes; delete individual note/evidence without affecting others; full artifact readback |
| P0 security | No internal prompts/raw tool data/sensitive information leaks through product outputs | P0 checklist in `docs/specs/0.4.0/prompt-disclosure-redaction-spec.md`, existing redaction | Zero hits in debug copy/export/permission IPC/package settings/third-party telemetry/error monitoring/build artifacts/SDK injection |

### 3.3 Out of Scope

| Exclusion | Destination |
|--------|------|
| Full Frontier gaps | 0.5, depends on corpus/search |
| Full multiple-membership/bidirectional links/knowledge graph | Later |
| P2 postlaunch security governance | 0.5+ |
| Writing/data-analysis packs, default page, autonomous orchestration, personalization | Excluded this round |
| Experimental design | 0.6+, partnerships first |

<a id="34-门禁与依赖"></a>

### 3.4 Gates and Dependencies

| Type | Gate / dependency | Pass criterion | Default if failed |
|------|-------------|----------|----------------------|
| Core start gate | Extraction-quality spike | Quantified accuracy, paper cap, BYOK cost on 15–20 real papers | Reduce count/dimensions or defer depth |
| Public release | P0 security | Entire P0 list passes | No public release |
| Functional dependency | Gap retention requires evidence/note basics | Save/read table + selected gaps | Basics first, then retention |

---

<a id="4-050-范围"></a>

## 4. 0.5.0 Scope

<a id="41-目标"></a>

### 4.1 Goal

Replace unstable live external API calls at the literature entry with a self-built search data service; reuse 0.4 gap form, expanding input from users' dozens of papers to intelligently retrieved field-level corpus.

### 4.2 In Scope

| Module | Product behavior | Engineering | Acceptance |
|------|----------|----------|----------|
| Corpus foundation | Independent of live source health; OpenAlex index; lawful OA cache | ADR-013 metadata on server; lawfully redistributable OA; non-API sources ADR-014 user-local fetch + links, never server scraping | Same query hits local index; license samples; arXiv/non-OA/NC-ND not stored by default |
| Intelligent search/rerank | Casual query returns ten/twenty professionally relevant papers in seconds | BM25 + dense hybrid, LLM rerank, agentic iteration; BYOK default; existing lit-search | Benchmark recall beats BM25; relevant golden path; inference on user channel |
| Key-field full-text acceleration | Lawful cache hits open reading/reviews in seconds; misses fetch/parse/link | Open-source parsers, no custom; full-text RAG from search to reading | Seconds for hits; misses usable, compliant cache |
| Full Frontier gaps | Direction → domain recall → table/gaps/conflicts → user decisions/retention | Reuse 0.4 form, only change input to intelligent recall; explicit boundaries | Traceable items; UI sources/coverage/likely omissions; zero absolute novelty/innovation claims |

### 4.3 Out of Scope

| Exclusion | Reason / destination |
|--------|-------------|
| Full semantic embeddings | Poor cost/freshness tradeoff for four people, ADR-013 excludes |
| Self-host all original full text including arXiv/non-OA/NC-ND | Licensing boundaries; only lawful OA subset |
| Query flywheel | 0.6 opt-in, query/click/accept signals require privacy redefinition |
| Experimental design | 0.6+ laboratory track |

<a id="44-门禁与依赖"></a>

### 4.4 Gates and Dependencies

| Type | Gate / dependency | Pass criterion | Default if failed |
|------|-------------|----------|----------------------|
| Infrastructure | Cost/engineer-month spike | Three quantified real monthly-cost/effort tiers | Narrow corpus/cache/rerank depth |
| Search | Agentic search/rerank benchmark | Quantified relevance improvement | Hybrid + basic rerank, no multiround promise |
| Sources | GS feasibility | Quantify local/SERP availability, latency, CAPTCHA/block rates, costs | One-click GS navigation only |
| Feature | Full Frontier requires deep-dive P1/P2/P3 | Domain recall/rerank/traceability/boundary disclosure | Keep 0.4 small form, no Full Frontier claim |

---

<a id="5-实施顺序"></a>

## 5. Implementation Order

Planning diagram: 0.4 starts P0, evidence/note basics, and a 15–20-paper extraction spike in parallel, then core selected-papers→table→gaps/conflicts→decisions→retention. 0.5 stage 1 builds index with cost/evaluation/GS spikes; stage 2 hybrid/LLM/agentic search integrated with lit-search; stage 3 full-text acceleration + Full Frontier.

```text
0.4 (independent launch, no waiting for the search engine)
  Start in parallel:
    - P0 security: independent work, public-release gate
    - Evidence-set/note basics: retention capabilities first
    - Extraction spike: 15–20 real papers, quantify accuracy / paper count / BYOK cost

  After spike conclusions:
    - Small Research Gaps core: selected papers → table → gaps/conflicts → user decision → evidence sets

0.5 (heavy literature infrastructure window)
  Stage 1: OpenAlex metadata index + cost spike + search benchmark + Google Scholar feasibility spike
  Stage 2: Hybrid recall + LLM reranking + agentic iterative search, integrated with existing lit-search
  Stage 3: Key-field full-text acceleration + Full Frontier Research Gaps
```

Two execution principles:
- Validate scenario value in 0.4 without search infrastructure as a prerequisite.
- Stabilize retrieval in 0.5 before expanding gap inputs.

---

<a id="6-风险触发条件与降级策略"></a>

## 6. Risks, Triggers, and Fallbacks

| Risk | Trigger | Impact | Default fallback |
|------|----------|------|--------------|
| Poor extraction | Unacceptable accuracy/count/cost on 15–20 papers | 0.4 value fails | Reduce count/dimensions/automation depth |
| P0 delay | Incomplete P0 checklist | No public release | Highest P0 priority; internal tests only |
| 0.4 scope growth | Multiple membership/generic renderer/all P1 absorbed | Main feature delay | Keep basics + minimum gap loop |
| Cost/copyright exceeds expectations | Cost spike/license samples fail | 0.5 infrastructure narrows | Lawful OA subset + on-demand fetching |
| Insufficient search gains | Benchmark cannot show relevance improvement | Weak differentiation | Hybrid/basic rerank first, agentic later |
| GS instability | CAPTCHA/blocking/latency/cost exceeds threshold | Uncontrolled source UX | One-click GS only, no inline results |

---

<a id="7-行动项"></a>

## 7. Actions

| # | Action | Owner | Due | Status | Blocker |
|---|------|-------|-----|------|--------|
| 1 | Review both PRDs and this alignment | Everyone | Before/during meeting | Pending | None |
| 2 | Close D1–D6 with meeting conclusions | Everyone | After meeting | Pending | Product/engineering/design confirmation |
| 3 | Schedule 0.4 15–20-paper accuracy/count/BYOK spike | Engineering, unclaimed | TBD | Unclaimed | Samples/evaluation criteria |
| 4 | Schedule 0.5 cost + retrieval evaluation spikes | Engineering, unclaimed | TBD | Unclaimed | ADR-013 cost/evaluation criteria |
| 5 | Schedule GS feasibility spike | Engineering, unclaimed | TBD | Unclaimed | Define investable-inline-result thresholds |
| 6 | Break down Epic issues after PRD approval | PM | After PRD review | Not started | D1–D6 |
| 7 | Create security issues, confirm upstream references | Engineering, unclaimed | TBD | Unclaimed | P0/P1 split criteria |

---

<a id="8-各职能阅读指引"></a>

## 8. Reading Guide by Function

| Function | Focus | Meeting output |
|------|------------|----------------|
| Product | §1 decisions, §3/§4 scope, gap trust boundaries | Close tradeoffs; determine 0.4/0.5 issues |
| Engineering | §3.4/§4.4 gates, §5 order, §6 fallbacks | Claim spikes, confirm technical gates/acceptance |
| Design | Five-step gaps, right table, details-page notes/evidence | Column interaction, trustworthy presentation, recall disclosure |

---

<a id="附录-a最小术语对齐"></a>

## Appendix A: Minimal Terminology

| Term | Meaning |
|----|------|
| Research gap | Unfilled attribute combinations in a comparison table, plus AI-flagged conclusion conflicts; 0.4 selected papers only, 0.5 recalled field corpus only |
| Evidence set | Topic-centered material container; both gap-analysis input and artifact destination |
| Evidence item | Citation anchor to a source; every filled cell needs traceable evidence |
| Note | Evidence-set annotation, managed alongside evidence |
| Comparison table | Ordinary table comparing papers by dimensions, not a new term |

**Evidence = filled cells; research gaps = empty cells; users decide which gaps merit investigation.**

---

<a id="附录-b事实源与深入阅读"></a>

## Appendix B: Sources and Further Reading

- 0.4 PRD: `docs/specs/0.4.0/0.4.0-prd.md`
- 0.5 PRD: `docs/specs/0.5.0/0.5.0-prd.md`
- 0.4 north-star: `docs/milestones/0.4/north-star.md`
- 0.5 north-star: `docs/milestones/0.5/north-star.md`
- Security: `docs/specs/0.4.0/prompt-disclosure-redaction-spec.md`
- Deep-dive ADR: `docs/adr/ADR-013-literature-relevance-service.md`
- Non-API ADR: `docs/adr/ADR-014-non-api-sources-and-demand-driven-fill.md`
- Local vector ADR: `docs/adr/ADR-012-local-embedding-vector-index.md`
- Server stack: `docs/adr/ADR-002-server-stack.md`
- Direction research: `ya-docs/milestones/0.4/new-direction-research.md`
- Terminology: `CONTEXT.md` (Research Gaps, evidence sets/notes, literature search data service domains)
