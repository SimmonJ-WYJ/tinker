> Historical research specification: Preserves previous designs and data semantics, not requirements for current features or restoring runtime wiring. Active research features are being retired in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records define actual completion and unaccepted scope.

<a id="检索报告lit-search-report"></a>

# Search Report (lit-search report)

| Item | Value |
|---|---|
| Status | Draft · Awaiting review (2026-06-04 v2: tiered reports, see §4bis) |
| Related issue | Decision parent #454; implementation children #496 (on-demand minimal report · end-to-end skeleton), #497 (automatic large-search trigger, blocked by #496) |
| Related PR | Not yet opened (feat/capability-pack-v3) |
| Connections | #437 / `lit-search-failure-source-expansion-spec` (coverage/limitations data source); follows `lit-review-pipeline-decomposition-spec` (terminal_skill → HTML artifact) |
| Domain language source of truth | `CONTEXT.md`; this spec's terms: search report, report skill `lit-search-report`, search panel, closing summary, report entry |

---

<a id="1-背景与动机"></a>

## 1. Background and Motivation

After lit-search, the main Agent writes only a **≤60-word closing summary** (see lit-search `scenario/system-prompt.md` §Closing turn). It prioritizes speed (no closing turn by default, saving 3–5s) and lacks sufficient information for a search report.

Xuwu's feedback (#454 item 9): Produce a **complete search report**, with a dedicated orchestration skill and fixed structure to avoid inconsistent Agent improvisation.

#454 triage settled four decisions (see its decision-record comment):

1. **Dedicated terminal skill** `lit-search-report` (following `literature-review-result`), **without** expanding the ≤60-word closing summary.
2. **Presentation**: Independent HTML document in right-side artifacts + closing summary and entry in conversation.
3. **Trigger**: On demand by default (conversation entry); automatic for large topic searches (general-query with ≥N results); none for identifier lookup / citation tracing.
4. **Minimal content**: ① Search strategy ② Key findings + top-scoring papers ③ Coverage and limitations.

---

<a id="2-范围与非目标"></a>

## 2. Scope and Non-Goals

**Scope**: Skill orchestration + presentation + triggering for structured reports after lit-search.

**Explicit non-goals**:

- ❌ **Full-text close reading**: Consume search metadata + candidate titles/abstracts/scores only, **without full-text reading** (the lit-review `reader` handles that).
- ❌ ~~Research gaps / next steps, topic clusters/research development: optional future enhancements outside minimal scope~~ — **Overturned 2026-06-04**: Included in FULL reports (§4bis); MINIMAL retains the minimum.
- ❌ **Author affiliations**: Candidate data lacks institutions; filling from model knowledge fabricates facts. Key Research Teams lists only frequent authors + hit counts + representative papers, **without an institution column** (2026-06-04 decision).
- ❌ Report export / sharing: Discuss separately.

---

<a id="3-数据来源报告能放什么由可得数据决定"></a>

## 3. Data Sources (Available Data Determines Report Contents)

Available at lit-search completion **without close reading**:

| Data | Source |
|------|------|
| Search strategy (keywords / rewrites / sources / method_terms / object_terms / time range) | Scenario PLAN |
| Per-source hits, deduplicated counts, panel display count | `mcp__paper-search__process_search_results` return (`source_counts` / `source_new_counts` / `total_from_sources` / `new_records` / `display_count`) |
| Top-N papers (title / authors / year / finalRelevance / abstract) | Candidate JSONL (searcher writes in session cwd; relevance-scorer writes scores; report skill follows cwd convention) |
| Failed / zero-result / rate-limited sources | `source_counts` (=0 or missing means failure), connects to #437 |

The report skill generates **relevance reasons** from abstracts on demand (no close reading).

---

<a id="4-报告内容-&#45;minimal-档最小集-13"></a>

## 4. Report Contents — MINIMAL Tier (Minimum §1–§3)

Output an **HTML fragment** renderable in right-side artifacts, with one top-level `<article class="asci-search-report" data-version="1">` (following review sanitizer-friendly conventions).

- **§1 Search strategy** — Research question / keywords and rewrites / sources / method-object terms / time range / per-source hits.
- **§2 Key findings & top papers** — Top-N (recommended ≤10), each with bibliographic metadata (title/authors/year) + finalRelevance + one relevance sentence from abstract. Cite using `<cite data-ref="N">` to reuse citation decoration.
- **§3 Coverage & limitations** — Hit distribution, failed/zero/low-yield-early-stopped sources, visible blind spots; connect to #437 failure-driven expansion.

All numbers come from `process_search_results` (same source as closing summary to prevent inconsistent accounting); state missing values honestly, never invent them.

---

<a id="4bis-报告分级2026-06-04-决策v2"></a>

## 4bis. Report Tiers (2026-06-04 Decision, v2)

Comparing an external six-section example (overview table / topic distribution / topic recommendations / teams / trends and gaps / management suggestions), Xuwu selected **candidate-count tiers** and expanded scope from the current turn to **all search turns in this session** (skill Step 1 deduplicates globally across `turn_id`).

| Tier | Condition (deduplicated candidates across session) | Structure |
|------|------|------|
| No trigger | < 20 | Hide panel button (`REPORT_BUTTON_MIN_RESULTS = 20`, aligned with `AUTO_REPORT_MIN_RESULTS`); direct conversational requests still gracefully produce MINIMAL |
| **MINIMAL** | 20 – 49 | §1 Search overview · §2 Key findings/top papers (≤10) · §3 Coverage/limitations · References (minimum in §4) |
| **FULL** | ≥ 50 (`FULL_REPORT_MIN_RESULTS = 50`, hardcoded in SKILL.md) | §1 Overview (table + per-round statistics) · §2 Core topics (3–6) · §3 Recommendations in per-topic tables (≤40 papers) · §4 Key teams (frequent authors, **no institutions**) · §5 Trends/gaps (trends cite candidates; gaps framed as absent from this candidate set) · §6 Next steps · References |

Additional FULL anti-hallucination boundaries:

- **Per-round keywords**: JSONL lacks query text; display only when the main Agent supplies `input.rounds`; disclose missing values.
- **Institutions**: Excluded (see §2).
- **Trends**: Each must have `<cite data-ref>` to at least 1 candidate; remove unsupported claims.
- **Gaps**: Frame as inference from this candidate set and explicitly state that scope in the report.

Tier determination occurs inside skill Step 1 script (prints `tier=`), independent of entry parameters.

Create `apps/electron/default-skills/lit-search-report/SKILL.md`, following `literature-review-result` structure but acting as a **search-metadata consumer**, not a review-body generator.

<a id="51-输入契约skill-的-input由主-agent-携-plan-的-terminal_skillinput-传入"></a>

### 5.1 Input Contract (`Skill` `input`, Passed by Main Agent from PLAN `terminal_skill.input`)

The original example includes optional time range and chronologically ordered round strategies; query text is supplied only from main Agent context, panel values come from process_search_results, and candidates_path points to session-cwd JSONL metadata/abstracts/scores.

```jsonc
{
  "plan_summary": {
    "research_question": "...",
    "keywords": [...], "rewrites": [...],
    "sources": [...], "method_terms": [...], "object_terms": [...],
    "time_range": { "from": 2020, "to": 2024 }   // 可选
  },
  "rounds": [                                      // 可选（v2）：各轮检索策略，按时间正序；
    { "round": 1, "kind": "keyword", "keywords": [] } // JSONL 不存 query 文本，仅主 Agent 上下文可得时传
  ],
  "panel": {                                       // 取自 process_search_results 返回
    "display_count": 0, "new_records": 0, "total_from_sources": 0,
    "source_counts": {}, "source_new_counts": {}
  },
  "candidates_path": "<session cwd 下候选 JSONL 路径>"  // skill 读取 top-N 题录+摘要+分数
}
```

<a id="52-输出契约"></a>

### 5.2 Output Contract

- Path: `searches/{YYYY-MM-DD_HH-mm}-{slug}.html` (**relative** to session cwd, timestamp prefix included).
- Content: One `<article class="asci-search-report" data-version="1">` fragment, without `<html>/<body>` wrappers or markdown syntax.

<a id="53-allowed-tools-与硬约束"></a>

### 5.3 allowed-tools and Hard Constraints

- `allowed-tools`: `Write`, `Read`/`Glob`/`Bash` (only to locate/read candidate JSONL).
- **Prohibit** `papers_read_outline` / `papers_read_article_section` / full-text `Read` of mdPath; no full-text close reading.
- No repeated searches, reranking, or panel rewriting.

---

<a id="6-触发与入口"></a>

## 6. Triggers and Entry

<a id="61-按需496默认"></a>

### 6.1 On Demand (#496, Default)

After the closing summary, the main Agent offers an **entry** to generate a complete report; once triggered, it invokes `Skill(lit-search-report)` with §5.1 input. The lit-search manifest declares `skillRefs: ["lit-search-report"]` so `<available_skills>` includes it.

**Entry decision: Panel button (A).** Add Generate Search Report to `SessionPapersToolbar` → main Agent invokes `Skill(lit-search-report)` with §5.1 input. This follows present_search_plan Banner/Card interactions, places a clear entry beside results, and best matches #454's summary + entry requirement.

Implemented in #496:

- Button on `SessionPapersToolbar` (beside results; ~~`totalCount > 0`~~ **v2: show only at `totalCount >= REPORT_BUTTON_MIN_RESULTS (= 20)`**, §4bis), click → `setPendingPrompt({ sessionId, message })` (reuse `agentPendingPromptAtom`, like `SendToAgentButton`, automatically sending to current session).
- Message is an i18n **natural-language canned prompt** (`sessionPapers.report.prompt`, e.g. English translation: “Please generate a complete search report from the current results”); Skills-First Protocol routes to the skill (manifest registers the `lit-search-report` skillRef).
- **Known tracer-bullet tradeoff**: Natural language + LLM routing is more fragile than lit-review PLAN `terminal_skill` structured routing (copy/model changes may misroute). Acceptable now: registered skillRef, explicit Skills-First, i18n copy, immediately visible failures. **Deeper approach**: Move to explicit structured routing (button → lit-search scenario Agent PLAN attaches `terminal_skill: { name: 'lit-search-report', input }`), matching lit-review. **Dev validation**: Actually verify button messages reliably route to the skill rather than bare tools.
- Shared rendering route: Extend rich matcher in `registrations.ts` to `searches/` (via `isAsciRichHtmlPath`) only. Review-only Parse Citations (`InlinePreview` `isReviewHtml`) and server cited-paper enrichment (`SDKMessageRenderer` `isReviewOutput`) **deliberately remain restricted to `reviews/`**; reports need neither.

> Rejected alternatives: B prompt_suggestion (stored by renderer but not rendered as clickable buttons, requires general UI); C prose-only entry (thinnest but weakest access).

<a id="62-自动497已落地"></a>

### 6.2 Automatic (#497, Implemented)

**Challenge**: Planning happens **before** search, so result counts are unknown; cannot choose based on ≥N results during planning.

**Mechanism: Conditional terminal_skill.** Add optional `condition` to PLAN `terminal_skill`: a short predicate over accumulated tool_results, evaluated by the main Agent after all `steps` complete (`process_search_results` counts now known); **invoke only when true**. This **general orchestration protocol extension** defaults to unconditional when `condition` is missing, preserving lit-review, rather than special-casing lit-search.

- `intent = general-query`: Scenario PLAN attaches
  `terminal_skill: { name: "lit-search-report", input: {...}, condition: "process_search_results.display_count >= 20" }`.
  Threshold **20** appears as readable scenario-prompt constant (`AUTO_REPORT_MIN_RESULTS`).
- `exact-lookup` / `citation-tracing`: **Do not attach** `terminal_skill` (never automatic).
- Preserve §6.1 panel button: below-threshold general-query or user clicks under any intent use on-demand generation.
- Automatic triggering preserves the ≤60-word closing summary (step 5 still writes it; report adds a right-side artifact).

Main Agent implementation: PLAN dispatch protocol step 4 (condition evaluation) in `agent-prompt-builder.ts`.

---

<a id="7-前端呈现"></a>

## 7. Frontend Presentation

Right-side artifacts dispatch renderers by extension + path (`renderer/components/preview/registrations.ts`). Currently `reviews/*.html` uses `ReviewHtmlPreviewRenderer` (DOMPurify + KaTeX + citation decoration); other `.html` falls through to general `HtmlRenderer`.

**Minimal change**: Extend `ReviewHtmlPreviewRenderer` `matches` regex from `/(?:^|\/)reviews\//` to also match `searches/`, reusing rich rendering (citation decoration serves §2 `<cite>`). Add cases to `preview-registry.test.ts`.

---

<a id="8-实现计划映射子-issue"></a>

## 8. Implementation Plan (Mapped to Child Issues)

<a id="496-&#45;按需生成最小集端到端骨架"></a>

### #496 — On-Demand Minimal Report (End-to-End Skeleton)

1. Create `default-skills/lit-search-report/SKILL.md` (§4 contents, §5 contracts, constraints).
2. lit-search manifest: `skillRefs: ["lit-search-report"]`; version 0.2.15 → 0.2.16.
3. Scenario `system-prompt.md`: Explain on-demand `terminal_skill` and entry copy in closing section.
4. Frontend: §7 matcher extension; entry form per §6.1 review (A/C).
5. i18n: Entry copy via `useT`/`t`, synchronized en + zh, key parity passes.
6. Tests: `default-capability-packs-load.test.ts` (skillRef registration), `preview-registry.test.ts`, key parity.

<a id="497-&#45;大检索自动触发"></a>

### #497 — Automatic Large-Search Trigger

1. Scenario PLAN: Automatically attach terminal_skill for general-query with results ≥threshold (§6.2); constant threshold.
2. No automatic trigger for identifier lookup / citation tracing.
3. Preserve default closing-summary behavior.

---

<a id="9-风险与开放问题"></a>

## 9. Risks and Open Questions

1. ~~Entry form~~ — Panel button decided (§6.1); remaining implementation detail is button→skill routing (canned message vs. `respondSearchPlan` pattern).
2. **Candidate JSONL path convention**: Read cwd candidates using relevance-scorer's existing cwd derivation, avoiding orchestration drift; verify source of truth at implementation.
3. **Automatic threshold**: Default ~20; tune after limited traffic observation.
4. **Latency**: Extra Skill call; on-demand avoids frequent identifier-lookup overhead, automatic only for large topic searches.
