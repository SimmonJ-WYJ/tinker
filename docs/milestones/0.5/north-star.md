<a id="05-北极星目标文献深钻-&#45;研究空白全前沿版"></a>

# 0.5 North-Star Goals (Deep Literature Reading + Research Gaps, Full-Frontier Edition)

> **Positioning**: upgrade ASCI's literature entry point from live calls to flaky external APIs into a **self-hosted, fast, accurate search data service** (ASCI's first data-service foundation); expand research gaps from the user's few dozen papers to all papers in a field.
> **Deadline**: TBD.
> **Prerequisites**: 0.4.0 delivery (research gaps, small edition + basic evidence-set/note experience + safety boundaries) · sign-off on [ADR-013](../../adr/ADR-013-literature-relevance-service.md) / [ADR-014](../../adr/ADR-014-non-api-sources-and-demand-driven-fill.md) / [ADR-012](../../adr/ADR-012-local-embedding-vector-index.md) · extend [ADR-002](../../adr/ADR-002-server-stack.md) to retrieval workloads.
> **Design philosophy**: **store relevance, not papers**. Retrieval/reranking defaults to user BYOK (zero per-query server inference cost for ASCI); the server hosts only index/corpus, respecting local-first and privacy boundaries.
>
> **Single-source-of-truth boundaries**:
> - This document is authoritative for 0.5 **goals + audit criteria + priorities + implementation order**.
> - **Requirement details** follow [`docs/specs/0.5.0/0.5.0-prd.md`](../../specs/0.5.0/0.5.0-prd.md).
> - **Architecture / licensing / cost / reversibility** follow [ADR-013](../../adr/ADR-013-literature-relevance-service.md) / [ADR-014](../../adr/ADR-014-non-api-sources-and-demand-driven-fill.md); **domain language** follows [`CONTEXT.md`](../../../CONTEXT.md).

**Scope**: 3 existing-capability improvements (literature corpus foundation, intelligent retrieval/reranking, full-text acceleration) + 2 new features (full-frontier research gaps, non-API sources / direct GS scraping).
**Audit principle**: every criterion can be validated as yes/no or numerically and carries a priority.
**Priority labels**: required / prerequisite / observe / second release in 0.6.

---

<a id="〇痛点-&#45;支柱映射"></a>

## 0. Pain Points → Pillars

| Real pain point | Pillar | One-sentence solution |
|--------|------|-----------|
| **Incomplete** retrieval | P1 Literature corpus foundation | Self-host a complete OpenAlex metadata index covering the long tail |
| **Inaccurate** retrieval | P2 Intelligent retrieval/reranking | Agentic iteration + hybrid (BM25⊕dense) recall + LLM reranking |
| **Slow** close reading | P3 Full-text acceleration | Reuse open-source parsing + instantly open legally cacheable OA full text on hits; otherwise fetch on demand |
| **Narrow scope** for gap judgments | P4 Full-frontier research gaps | Expand selected literature from a few dozen available papers to a field-level retrieved corpus |
| **Incomplete** retrieval (non-API long tail) | P5 Non-API sources / direct GS scraping | User-local direct GS scraping fills OpenAlex gaps in gray literature / non-English work / theses |

---

<a id="一p1-文献语料底座已有优化基础设施"></a>

## 1. P1 Literature Corpus Foundation (Existing Improvement / Infrastructure)

**Goal**: self-host an OpenAlex metadata index + cache legally redistributable OA full text, respecting licensing boundaries ([ADR-013](../../adr/ADR-013-literature-relevance-service.md)).

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| C1 | Full OpenAlex metadata in server index; search the index instead of live fan-out | Same query hits local index in milliseconds, independent of external-source availability | Required |
| C2 | Legally redistributable OA full text (peS2o/S2ORC ODC-By + PMC oa_comm CC0/CC-BY) cached | Sample-check per-paper licenses and exclusion of NC/ND | Required |
| C3 | arXiv / non-OA / NC-ND **not stored**; fetch on demand + backlink | Corpus audit finds no default-license arXiv full text; arXiv results include backlinks | Required |
| C4 | GDPR-compliant ingestion (robots/ai.txt, opt-out lists, author-email pseudonymization, TDM Art.4) | Check compliance list item by item | Required |
| C5 | **Prerequisite spike①**: real monthly costs / engineering person-months at three scales | Internal infra spike provides quantified conclusions | **Prerequisite** |

---

<a id="二p2-智能检索与重排已有优化-&#45;差异化核心"></a>

## 2. P2 Intelligent Retrieval and Reranking (Existing Improvement · Core Differentiator)

**Goal**: deliver capabilities others cannot on top of the corpus—agentic iterative retrieval + hybrid recall + LLM reranking, using BYOK.

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| S1 | Hybrid retrieval (BM25 ⊕ dense) replaces plain lexical recall | Evaluation-set recall improves significantly over plain BM25 | Required |
| S2 | LLM reranking brings canonical / closely relevant specialist papers into top N | Golden path: a casual search instantly returns ten to twenty closely relevant papers | Required |
| S3 | Agentic iterative retrieval (multiple rounds along citation chains/query evolution) replaces one-shot retrieval | Multi-round recall > one-shot for complex queries | Required |
| S4 | Retrieval/reranking defaults to user BYOK, zero server inference cost per query | Audit call chain: inference uses the user's channel | Required |
| S5 | Integrate existing lit-search capability pack (searcher/relevance-scorer), without a separate system | Existing pack works by pointing to new index + reranker | Required |
| S6 | **Prerequisite spike②**: quantify specialist scrutiny using an agentic retrieval/reranking evaluation set | Small in-house evaluation set produces quantified conclusions | **Prerequisite** |

---

<a id="三p3-重点领域全文加速已有优化"></a>

## 3. P3 Full-Text Acceleration in Priority Fields (Existing Improvement)

**Goal**: reduce close reading per paper from minutes to seconds ([ADR-013](../../adr/ADR-013-literature-relevance-service.md) P3 + [ADR-014](../../adr/ADR-014-non-api-sources-and-demand-driven-fill.md)).

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| R1 | Reuse open-source SOTA parsing (MinerU/olmOCR), rather than building our own | Parsing quality/speed meets baseline; no in-house parser | Required |
| R2 | Instantly open close reading for legally cacheable OA full-text hits (preparsed + prechunked) | Hit papers open for close reading in < seconds | Required |
| R3 | Misses fetch + parse + RAG on demand; results cacheable subject to licensing | Non-OA close reading works and caching is compliant | Required |
| R4 | Full-text RAG connects retrieval→close-reading loop | Retrieved papers support direct deep-reading Q&A | May degrade |

---

<a id="四p4-研究空白全前沿版新功能"></a>

## 4. P4 Full-Frontier Research Gaps (New Feature)

**Goal**: reuse the research-gap product form (comparison table / gap judgment / decision / retention), **changing only selected literature from the user's few dozen papers to a field-level corpus retrieved intelligently**; preserve trustworthiness and explicitly disclose retrieval limits.

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| GF1 | Research direction → field-level corpus retrieval → field-level comparison table and research gaps, each traceable | End-to-end walkthrough | Required |
| GF2 | **Explicit retrieval boundaries** (sources searched / coverage / possible omissions) | UI walkthrough shows boundary disclosure | Required |
| GF3 | **Zero** AI claims such as "absolutely nobody in the world has done this / this is novel" | Regression scans wording | Required |

---

<a id="五p5-无-api-源接入-&#45;gs-直抓新功能"></a>

## 5. P5 Non-API Sources / Direct GS Scraping (New Feature)

**Goal**: let the retrieval Agent **scrape Google Scholar directly** through user-local fetching, filling OpenAlex's long tail (gray literature / citations / non-English work / theses / some non-OA); fetch live + external links, **never store in Corpus** ([ADR-014](../../adr/ADR-014-non-api-sources-and-demand-driven-fill.md) D1–D3). Prerequisite feasibility is already being explored **in parallel during 0.4** (see [0.4 north-star](../0.4/north-star.md) §4).

| # | Audit criterion | Verification | Priority |
|---|---------|---------|--------|
| NA1 | Retrieval Agent gets GS results directly through L1 (user-local fetching), live + external links | End-to-end walkthrough: one query returns GS results with backlinks | Required (depends on 0.4 exploration passing thresholds) |
| NA2 | Fallback chain ready: L2 third-party SERP API (BYOK fallback) + L3 one-click GS access (safety floor) | L1 failure degrades to L2; L3 remains available if all fail | Required |
| NA3 | ASCI server **never scrapes itself**; GS results **never enter Corpus** | Audit call chain + no GS-scraped content in corpus | Required |
| NA4 | Threshold-based tier: 0.4 exploration passes → L1 primary; otherwise → L2 primary, L1 best effort, L3 always available | Set tier from 0.4 GS-E1~E4 conclusions | Required |

> 0.5 integrates **GS as the only reference source** (observe tier); more sources (ResearchGate / CNKI / Wanfang / publisher pages) → 0.6/V1, gated on real GS experience.

---

<a id="六实施顺序"></a>

## 6. Implementation Order

```
Phase 1 · Foundation + spikes (parallel)
  P1 ▸ OpenAlex metadata-index ingestion + compliance list (C5 cost spike)
  P2 ▸ S6 agentic retrieval/rerank evaluation set
Phase 2 · Software (core differentiation)
  P2 ▸ Hybrid recall + LLM reranking + agentic iteration, existing lit-search pack (BYOK)
Phase 3 · Deep reading + new features
  P1 ▸ OA full-text corpus cache
  P3 ▸ Reuse parsing + instant hits + on-demand fetching
  P4 ▸ Full-frontier research gaps (existing form, new input + retrieval boundaries)
  P5 ▸ Non-API GS scraping (lit-search sources + fallback; depends on 0.4 exploration, independent/parallel)
```

Dependencies: P4 ⬅ P1/P2/P3 ready; P2 software layer ⬅ phase 1 spike conclusions. P5 ⬅ 0.4 GS exploration conclusions (independent of P1/P2/P3 and can run in parallel).

<a id="七不做的事"></a>

## 7. Exclusions

- Full semantic vector embeddings (200 million+) → excluded (cost/freshness is not worthwhile for a 4-person team, ADR-013).
- Self-hosting all raw full text (including arXiv cache, non-OA, NC-ND) → excluded (licensing boundary; cache only legally redistributable OA subset).
- 0.6 query flywheel (query/click/adoption signals driving relevance) → 0.6 opt-in (privacy boundary requires redefinition + disclosure).
- Experimental design → 0.6+ (lab-collaboration track; discuss partners first).
