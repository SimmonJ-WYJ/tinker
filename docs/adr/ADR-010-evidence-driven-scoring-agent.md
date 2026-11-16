<a id="adr-010文献评分从f22-五维质量分升级为证据驱动相关性主导评分score与-f22-耦合并行"></a>

# ADR-010: Upgrade Literature Scoring from "F22 Five-dimensional Quality Scores" to "Evidence-driven, Relevance-led Scoring (score)," Operating Alongside and Coupled to F22

| Field | Content |
|------|------|
| **Status** | Accepted (2026-06-04, lee; score MVP implemented, parameters still iterating) |
| **Decision date** | 2026-06-04 |
| **Decision maker** | lee |
| **Decision deadline** | Before switching the lit-search panel's "relevance" sorting/display from F22 to score (implemented) |
| **Related PR** | [#511](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/511) |
| **Related** | [Implementation spec `docs/specs/lit-scoring-agent-spec.md`](../specs/lit-scoring-agent-spec.md) · `paper_search/service/paper_scoring.py` / `venue_tier.py` · F22 `paper_search/service/scoring.py` · `default-capability-packs/lit-search/sub-agents/scorer.md` · [CONTEXT.md](../../CONTEXT.md) · Design source "ASCI Literature Scoring and Ranking Agent Proposal, Revised v3" (Obsidian; Appendix C maps the current ASCI implementation) |

---

<a id="一背景"></a>

## I. Background

Default search-result ranking has always used **F22 five-dimensional scoring** (`scoring.py` → `extra.relevance`): `citations .25 + recency .25 + citation_velocity .15 + venue_presence .15 + keyword_relevance .20`, fully deterministic and calculable in seconds.

But F22 is **quality-oriented**:

- Relevance is just one dimension, `keyword_relevance` (.20), measured as **literal keyword term hit rate** (no semantics or LLM): matching words in the same discipline can yield a high score;
- Citations + recency dominate ranking at .65 → **highly cited classics / prolific journals can rise to the top even when off-topic**;
- `venue_presence` checks only "is there a journal name" (binary 0.5/null), without using the integrated EasyScholar IF / JCR / Chinese Academy of Sciences tiers.

Actual example: For "deep learning methods for extending microscope depth of field with light fields," F22 ranked the classic plenoptic-camera paper *The Light Field Camera: Extended Depth of Field* first (highly cited, strong venue, all literal keywords matched, but neither deep learning nor microscopy). Users want "papers that answer my question"; F22 supplies "high-quality papers."

Infrastructure already implemented in this session (venue alignment across sources, EasyScholar IF/tiers in `extra.journalRank`, and main-journal reverse lookup) supplies the data required for "evidence-driven + semantic discrimination" scoring.

<a id="二决策维度"></a>

## II. Decision Dimensions

1. **Replace or coexist**: Does new scoring replace F22 or operate alongside it?
2. **Determine relevance**: Literal keyword matching (current F22) or LLM semantic judgment against the user's original question?
3. **Role of quality signals**: Do venue/IF/tier/influence dominate ranking, or become secondary signals + card annotations?
4. **Before LLM scoring**: What value should papers lacking relevance dimensions receive?

<a id="三候选方案"></a>

## III. Alternatives

| | A. Keep F22 | B. Parallel score + **decoupling** | C. Parallel score + **F22 coupling** (**selected**) |
|---|---|---|---|
| Relevance judgment | Literal keyword hit rate | LLM judges semantic+method (original question + hard negative constraints) | Same as B |
| Quality role | Citations+recency dominate (.65) | Quality becomes secondary (finalScore assigns 0.8 to relevance) | Same as B |
| Not judged by scorer | — (no such concept) | `null` = **unscored**, no F22 fallback, ranked last | **Fall back to F22** (`finalRelevance ?? keywordRelevance ?? relevance`), ensuring every paper has a score |
| Experience | Instant but off-topic | Many "unscored" papers remain unordered until LLM judgment completes | Use F22 as a background baseline ordering, then refine after scorer judgment |
| Scores shared between systems | — | Fully isolated | score semantic can fall back to F22 signals |

> **B was prototyped and promptly reverted (2026-06-04, lee)**: Decoupling marked every paper not judged by scorer (outside top-50 or before judgment) as "unscored" and sent it to the bottom, leaving large gaps in candidate display and fragmenting the experience. The tradeoff favored a coupled fallback: use weak F22 signals as placeholders rather than exposing "not judged yet" as "no score."

<a id="四决策"></a>

## IV. Decision

**Adopt C: Introduce evidence-driven score, led by relevance and coupled alongside F22; retain F22 unchanged.**

- **Structure (relevance leads, quality is secondary)**:
  - `relevanceScore = 加权(semantic .35 + method .20)` (the Chinese literal means "weighted"), judged by the LLM `scorer` sub-Agent against the user's `research_question` (including hard negative constraints: "same discipline/modality ≠ relevant"; papers not addressing the question's specific objective receive a low ceiling);
  - `qualityScore = 加权(venue_quality .15 + publication_status .10 + recency .10 + paper_influence .05 + reproducibility .05)` ("weighted"), computed deterministically server-side from record fields (including `extra.journalRank`);
  - `finalScore = 0.8 × relevanceScore + 0.2 × qualityScore` (relevance dominates at 80%; quality provides only secondary adjustment + card annotations).
- **null weight redistribution**: Exclude dimensions with missing data and redistribute weights proportionally to other dimensions in the same group (`unknown(null) ≠ negative(0)`).
- **F22 coupling**: When `semantic` is absent (scorer has not judged this paper), fall back to `finalRelevance ?? keywordRelevance ?? relevance ?? 50`; F22 still internally supports "sort by relevance and select the first 50 papers for scorer."
- **Runtime chain**: Default PLAN `searcher → scorer` (scorer = default judge); after search, `enrich_session_async` performs background fire-and-forget venue/tier/IF enrichment and baseline score computation, with panel polling every 5s. Results go to **`extra.score`** (version 3) in session JSONL; no v1 fields change.
- No new SQLite tables or raw/evidence/canonical layers (MVP tradeoffs in design source Appendix C).

<a id="五反转-&#45;影响"></a>

## V. Reversals / Impact

- Default "relevance" sorting and card display switch from **F22 (`extra.relevance`) to `score.finalScore`**; F22 and v1 `finalRelevance` remain unchanged in the backend but are no longer displayed (`RelevanceBadge` retires, file retained).
- Scoring grades S/A/B/C/D are still calculated internally; **the frontend displays only the `finalScore` number**, without a letter.

<a id="六后果"></a>

## VI. Consequences

- **Positive**: On-topic papers first (relevance dominates at 0.8); explainable (`reason` + seven-dimensional breakdown + `data_confidence`); IF/JCR/Chinese Academy of Sciences tiers formally enter scoring (five venue_tier levels); low risk around F22 separation because the coupled fallback retains an immediate rollback path to the old chain.
- **Negative / costs**:
  - **Slow**: An additional full LLM judging round (scorer reads and judges the first 50 papers individually, approximately 10–30s); IF/tiers/scores appear incrementally through background enrichment + 5s polling (EasyScholar concurrency 3, timeout 6s, free keys prone to 403/429 rate limits followed by backoff retries).
  - score quality **depends on retrieval recall quality**: When the candidate pool is off-topic, scorer honestly assigns uniformly low scores. This exposes upstream retrieval problems (such as drifting discipline anchors causing cross-domain noise), **not a scoring bug**.
- **Risks**: LLM judging stability and cost; EasyScholar rate limiting prolongs enrichment.
- **Follow-up / undecided**:
  - Whether scorer dispatches by default or runs in the background (performance vs immediate reranking); judging-window size (currently top-50);
  - Paid / higher-quota EasyScholar keys to eliminate rate-limit backoff;
  - Upstream search-anchor fixes (`object_terms` contains only research objects, anchor uses the most specific term), reducing cross-domain noise at the source;
  - Retain decoupled alternative B for the future if frontend solutions absorb the "unscored" experience issue.
- **Related switches**: `PAPER_SEARCH_MCP_DISABLE_EASYSCHOLAR` (disable IF/tiers) · `PAPER_SEARCH_MCP_EASYSCHOLAR_CONCURRENCY` (enrichment concurrency) · `PAPER_SEARCH_MCP_ENRICH_TOP_N` (number of papers enriched). Seven-dimensional scoring always runs and has no off switch.
