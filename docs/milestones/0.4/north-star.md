<a id="04-北极星目标研究空白"></a>

# 0.4 North Star (Research Gaps)

> **Positioning**: ASCI's first new scenario targets cognitive work where AI is weakest yet value is highest: **helping researchers see research gaps**. Augmentation rather than replacement: **AI lays out the frontier; users decide**.
> **Deadline**: TBD.
> **Prerequisites**: 0.3.0 delivery (OPENSCI account + configurable capability packs + cloud server/database + collection of 5 self-evolution signal types) · existing literature parsing / LLMWiki / semantic retrieval infrastructure (`CONTEXT.md`, “Literature Corpus and Retrieval”).
> **Design philosophy**: HITL (human in the loop) + augmentation rather than replacement; local-first / BYOK / Agent-led / desktop. AI does not decide whether something is innovative for the user.
>
> **Single authoritative source boundaries**:
> - This document is authoritative for 0.4 **goals + audit criteria + priorities + implementation order**.
> - **Requirement details** (User Stories / Implementation / Testing) follow [`docs/specs/0.4.0/0.4.0-prd.md`](../../specs/0.4.0/0.4.0-prd.md).
> - **Domain language** follows [`CONTEXT.md`](../../../CONTEXT.md); **security-boundary implementation** follows [`docs/specs/0.4.0/prompt-disclosure-redaction-spec.md`](../../specs/0.4.0/prompt-disclosure-redaction-spec.md).

**Scope**: 1 new feature (research gaps) + 2 existing-feature improvements (evidence-set/note basics, security boundaries).
**Also included**: 1 preparatory exploration for 0.5 (Google Scholar scraping feasibility), **outside 0.4 delivery scope**, parallelizable and nonblocking for research gaps (see §IV).
**Audit principle**: every criterion has yes/no or numeric verification and a priority label.
**Priority labels**: Required / Prerequisite / Observe / Second release in 0.5.

---

<a id="一p1-研究空白新功能"></a>

## I. P1 Research Gaps (New Feature)

**Goal**: for a user-selected group of literature, AI extracts a “who did what” comparison table and presents research gaps (gaps + conflicts), each traceable; users decide, and results persist in evidence sets. **Scope is limited to “within selected literature”** (full-frontier version → 0.5).

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| GM1 | Selected literature: users can initiate analysis from an evidence set or checked papers | Successfully initiate once from each entry | Required |
| GM2 | Comparison table: AI proposes columns; users can add/delete/edit; each nonempty cell traces to source text | Click any cell to jump to its source anchor | Required |
| GM3 | Research gaps: show sparse/empty attribute combinations + AI-marked conflicting conclusions, each traceable | Walk through gap and conflict annotations | Required |
| GM4 | Scope: product copy and AI output both say “within selected literature,” with **zero** claims that nobody in the entire field has done it | Dedicated wording regression scan | Required |
| GM5 | User decision: AI **does not** decide for users with conclusions such as “this is an innovation” | Regression scan of output | Required |
| GM6 | Persistence: comparison table + selected gaps can be written to evidence sets and read back completely in order | Store, reread, compare | Required |
| GM7 | **Prerequisite extraction-quality spike**: validate accuracy / paper-count limits / BYOK costs on 15–20 real papers before core implementation | Three quantified spike conclusions | **Prerequisite (required)** |

---

<a id="二p2-证据集笔记基础体验已有优化"></a>

## II. P2 Evidence-Set/Note Basics (Existing-Feature Improvement)

**Goal**: align with “evidence set = topic container; notes = comments inside it”; allow adding notes/evidence anytime and accommodate P1 artifacts.

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| EN1 | Detail pages can **directly add evidence / notes**, beyond Agent conversations | Direct detail-page operations succeed | Required |
| EN2 | One evidence set supports **multiple notes** | Add 2+ consecutively | Required |
| EN3 | Notes and evidence are **peers**, individually manageable; evidence remains traceable | Manage each + click source | Required |
| EN4 | Deleting one note/evidence item leaves other members intact | Delete one and check the rest | Required |
| EN5 | P1 artifacts (comparison table + selected gaps) can persist here | Store and reread | Required |

> **Multiple membership**, where one note/evidence item belongs to multiple sets, is not required this phase (may open later); the minimum is “add anytime, support multiple items.”

---

<a id="三p3-安全边界已有优化-&#45;公开发布上线门禁"></a>

## III. P3 Security Boundaries (Existing-Feature Improvement · Public Release Gate)

**Goal**: classify and redact prompt / data disclosure, closing product exits for internal prompts, raw tool I/O, thinking, and sensitive data. Implementation: [`prompt-disclosure-redaction-spec.md`](../../specs/0.4.0/prompt-disclosure-redaction-spec.md).

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| SB1 | All spec P0 release gates pass (“0 hits” for each of debug copy / export / permission IPC / capability-pack configuration page / third-party telemetry / error / packaged artifacts / SDK injection surface) | Use spec §15 release-gate checklist | **Required (release gate)** |
| SB2 | Include spec P1 (complete prompt registry, release-artifact scanning, actual SDK injection-surface tests, etc.) in the prerelease window | Check each item | Observe |

> P2 (postrelease governance) → 0.5+.

---

<a id="四面向-05-的前置探索google-scholar-抓取可行性不计入-04-交付范围"></a>

## IV. Preparatory Exploration for 0.5: Google Scholar Scraping Feasibility (Outside 0.4 Delivery Scope)

> **Tracking issue**: [#722 [spike] GS scraping feasibility exploration](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/722) (GS-E1~E4 acceptance checklist · dual owners: engineering + legal)

**Positioning**: formal GS integration (the benchmark non-API source, [ADR-014](../../adr/ADR-014-non-api-sources-and-demand-driven-fill.md) D2/D3) **is a new 0.5 feature** (see [0.5 north-star](../0.5/north-star.md) §V P5). Whether our user-local scraping can reliably retrieve GS papers is technically unknown, so **parallel exploration during 0.4 must produce conclusions** to support 0.5. **Explore only; no formal 0.4 integration**; parallel and nonblocking for research gaps.

**Top priority**: let the search Agent scrape GS directly through our own implementation (user-local scraping), and define fallbacks.

| # | Audit criterion (exploration output) | Verification | Priority |
|---|---------|---------|--------|
| GS-E1 | Quantified actual GS user-local scraping **availability / latency / CAPTCHA rate / blocking rate** | Run real queries in the spike for all four metrics | Prerequisite (for 0.5) |
| GS-E2 | Select and verify a user-local scraping path (headless choice + anti-scraping responses + GS page parsing), producing a minimal PoC | PoC completes “query → structured results + backlinks” | Prerequisite (for 0.5) |
| GS-E3 | Fallback-chain conclusions: integration costs/boundaries for L2 third-party SERP API (BYOK fallback) + L3 one-click GS navigation (safety floor) | Feasibility assessment for each of three fallback layers | Prerequisite (for 0.5) |
| GS-E4 | Legal concurrently confirms ToS / reputational boundaries for “providing scraping tools vs scraping on users' behalf” | Legal boundary conclusion | Prerequisite (for 0.5) |

**Threshold decision**: pass → make L1 (user-local) the primary 0.5 path; fail → use L2 (SERP API) as primary, L1 best-effort, and always retain L3. ASCI servers **never scrape directly** (ADR-014 D2).

---

<a id="五实施顺序"></a>

## V. Implementation Order

```
Parallel start:
  P3 security P0 (release gate, independent, reuse existing redaction, start immediately)
  P2 evidence-set/note basics (incremental, low risk)
  P1 prerequisite extraction-quality spike (GM7 on real papers)
  [For0.5] GS scraping-feasibility spike (user-local + fallbacks; nonblocking0.4, conclusions to0.5 E5)

After spike conclusions:
  P1 core: selected literature → table → gaps → user decision → persistence (P2 integration)
```

Dependencies: P1 persistence ⬅ P2 evidence-set additions; P1 core ⬅ GM7 spike conclusions. P3 is independent. GS exploration proceeds independently in parallel and blocks no 0.4 pillar.

<a id="六不做的事"></a>

## VI. Out of Scope

- Full-frontier research gaps (open world) → 0.5 (depends on the full deep-literature corpus).
- Formal non-API source (GS) integration → 0.5 (E5); **0.4 explores feasibility in parallel only, without formal integration**.
- Experiment design → 0.6+ (requires laboratory partnership discussions first).
- Writing / data analysis / experiment-log capability packs, default-page redesign, Supervisor autonomous multi-pack orchestration, self-evolution personalization, generic pluggable renderer framework → excluded.
