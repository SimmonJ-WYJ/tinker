> Historical research specification: preserves earlier designs and data semantics; it does not require new features or restoration of runtime wiring. Active research features are being retired in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records define actual completion and unaccepted scope.

<a id="精确核心词全量召回-specprecise-core-exhaustive-retrieval"></a>

# Precise-Core Exhaustive Retrieval Spec

> **Status**: implemented · PR under review
> **Related issue**: none (direct PR)
> **Related PR**: [#553](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/553)
> **Domain language source of truth**: `CONTEXT.md` (object anchor / anchor / recall)
> **Dependencies**: `lit-search-failure-source-expansion-spec.md` (retrieve orchestration), `search_service.py` `build_query_matrix` / `retrieve`

---

<a id="1-背景与动机"></a>

## 1. Background and Motivation

Current retrieve caps every keyword × source query at `RETRIEVE_MAX_RESULTS_PER_QUERY = 10` papers. This broad-recall setting takes only the first 10 even for tens of thousands of matches. The problem: **severely insufficient recall of precise, on-topic core papers**.

Measurements (query, English translation: “How do deep learning methods extend the depth of field of light field microscopy?”, OpenAlex `meta.count`):

| object_term | Full `title.search:` | Full broad `search=` |
|---|---|---|
| light field microscopy | **611** | 723,960 |
| extended depth of field | **705** | 1,877,659 |
| computational microscopy | **878** | 327,040 |
| volumetric imaging | 4,918 | 436,969 |
| microscopy imaging | 29,370 | 1,743,719 |

Conclusions:
- **Exhaustive broad `search=` is meaningless** (hundreds of thousands to millions, broad-term noise); retain cap=10.
- **Precise `title.search:` yields only hundreds for specific core terms** (611/705/878), feasible to retrieve fully; only generic terms balloon (volumetric 4918 / microscopy imaging 29370).

**Goal**: retrieve all precise-core matches (`title.search` total ≤ threshold); do not exhaust generic terms or broad queries.

<a id="2-决策已与用户敲定"></a>

## 2. Decisions (Confirmed with User)

1. **Core threshold = 1000**: `title.search` `meta.count ≤ 1000` means precise core, retrieve all; `> 1000` means generic, **do not paginate exhaustively**, but return the first `generic_fallback` (= bare cell cap, default 10) papers from the already-fetched first page.
   > Revision (PR #553 review P1): original generic-term behavior returned `[]`, but an exhaust cell replaces the same query's bare cell in the matrix; zeroing generic terms regresses its OpenAlex recall. The first page is already fetched, so its head costs nothing extra and ordering matches the bare cell's title-first phase.
2. **Keep method keywords @10**: retain all existing bare/anchored keyword cells (cap=10) in `build_query_matrix`, preserving method recall (e.g. deep learning).
3. **OpenAlex only**: exhaustion applies only to OpenAlex (`meta.count` + cursor pagination); crossref / arxiv etc. stay unchanged.

<a id="3-设计"></a>

## 3. Design

<a id="31-闸门下沉到连接器openalex-modetitle_exhaust"></a>

### 3.1 Move the Gate into the Connector (OpenAlex `mode="title_exhaust"`)

Add a `mode` branch to `OpenAlexConnector.search(query, max_results, **kwargs)`. The preserved algorithm fetches page 1 with title.search, per_page=200 and cursor='*', reads meta.count; above threshold returns first-page fallback without pagination; at/below threshold paginates to min(count, max_results).

```
mode == "title_exhaust":
  ① Fetch page 1 filter=title.search:<query>, per_page=200, cursor='*'; read meta.count
  ② count > core_threshold(default 1000) → generic → first generic_fallback papers from page 1
     (no pagination; replace bare-cell fallback without zero recall—§2 decision 1 revision)
  ③ count ≤ threshold → cursor pagination, accumulate to min(count, max_results)
```

- Worst case per term: 1000 papers = 5 pages (per_page=200); title_exhaust cells use independent `PRECISE_CORE_TIMEOUT_SEC` (25s), not OpenAlex fast-path 8s.
- **Per-page timeout = 10s** (PR #553 review P3): substantially below the 25s cell budget. Measured pages take <1–3s; a 30s page would consume the whole budget and `asyncio.wait_for` timeout discards all completed pages, so stalled pages must fail fast.
- Forward `core_threshold` / `generic_fallback` through cell kwargs for tests / env tuning.
- Reuse `_parse_item` (extract existing per-item `_fetch_works` parsing into a reusable unit).

<a id="32-矩阵保持纯函数build_query_matrix-只加-cell"></a>

### 3.2 Keep the Matrix Pure (`build_query_matrix` Only Adds Cells)

When `"openalex" in sources`, `object_terms` is nonempty, and `PRECISE_CORE_ENABLED`, `build_query_matrix` adds an OpenAlex title_exhaust cell for each of the first `PRECISE_CORE_TERM_CAP` **most specific** object_terms (reuse `_rank_object_anchors` descending token count). The preserved code comment specifies generic fallback equal to the bare cell cap.

```python
{"source": "openalex", "query": term,
 "max_results": PRECISE_CORE_HARD_CAP,
 "kwargs": {"mode": "title_exhaust",
            "core_threshold": PRECISE_CORE_COUNT_THRESHOLD,
            "generic_fallback": max_results}}  # 泛词兜底量 = 裸 cell cap
```

- Exhaust cell replaces the existing same-query OpenAlex bare cell (deduplication; connector's first-page generic fallback matches bare title-first behavior without recall regression).
- **TERM_CAP bound** (PR #553 review P2): planner LLM may supply 6–8 object_terms; unbounded 25s × up-to-5-page cells cause uncontrolled tail latency. Like anchored `QUERY_MATRIX_ANCHOR_CAP`, take the N most specific (default 4).
- **No networking**: connector determines generic/core at runtime from `meta.count`; matrix remains deterministic and unit-testable.

<a id="33-常量"></a>

### 3.3 Constants

The declarations below specify default values in order: enabled "1", threshold 1000, hard cap 1000, term cap 4, timeout 25.

```python
PRECISE_CORE_ENABLED          = env "PAPER_SEARCH_PRECISE_CORE" 默认 "1"
PRECISE_CORE_COUNT_THRESHOLD  = env "PAPER_SEARCH_PRECISE_CORE_THRESHOLD" 默认 1000
PRECISE_CORE_HARD_CAP         = env "PAPER_SEARCH_PRECISE_CORE_HARD_CAP" 默认 1000
PRECISE_CORE_TERM_CAP         = env "PAPER_SEARCH_PRECISE_CORE_TERM_CAP" 默认 4
PRECISE_CORE_TIMEOUT_SEC      = env "PAPER_SEARCH_PRECISE_CORE_TIMEOUT_SEC" 默认 25
```

<a id="4-预期影响"></a>

## 4. Expected Impact

- Candidate pool: current ~80–128 → estimated ~1500–2200 (hundreds per each of 3 core terms, deduplicated).
- Generic terms (microscopy imaging 29370 / volumetric 4918) contribute only first-page top 10 fallback, equivalent to original bare cells, rather than all results.
- Downstream F22 local ranking / dedupe unchanged; score still judges only top_k=50 (precise core is highly on-topic, so filling the window with relevant papers improves rather than dilutes quality); local fenqu journalRank scales; venue backfill retains top-N network fallback.

<a id="5-测试bdd"></a>

## 5. Tests (BDD)

- `test_query_matrix.py`: openalex+object_terms → title_exhaust cells with mode/core_threshold/generic_fallback; keyword @10 cells remain; no additions for non-OpenAlex sources; above TERM_CAP retain N most specific (`test_precise_core_term_cap_most_specific_first`).
- OpenAlex connector unit tests (mock requests):
  - count ≤ threshold → cursor pagination retrieves all (page timeout < 25s cell budget);
  - count > threshold → first generic_fallback results of page 1, no pagination (`test_title_exhaust_generic_term_falls_back_to_first_page_head`);
  - pagination stops at max_results.

<a id="6-回滚"></a>

## 6. Rollback

`PAPER_SEARCH_PRECISE_CORE=0` disables the feature and restores pure @10 behavior.

<a id="7-配套f22-调权为对题度主导"></a>

## 7. Companion Change: F22 Weights Favor Topical Relevance

Exhaustive core retrieval expands candidates from ~80 to ~2000, but LLM scorer still receives only F22's top_k=50. Original F22 weights put 50% on citations 0.25 + recency 0.25, with keyword_relevance only 0.20. For precise-core papers (titles all contain object terms, similarly on-topic), ranking effectively becomes high citations + recent, excluding new, method-relevant low-citation papers.

Therefore adjust `scoring.py` `DEFAULT_WEIGHTS` together (user decision):

| Dimension | Old | New |
|---|---|---|
| keyword_relevance (topical relevance) | 0.20 | **0.50** |
| citations (citation count) | 0.25 | **0.10** |
| recency | 0.25 | **0.10** |
| citation_velocity | 0.15 | 0.15 (unchanged) |
| venue_presence | 0.15 | 0.15 (unchanged) |

Total remains 1.0. Behavior guard: `test_scoring.py::test_relevance_dominates_over_citations` (fully relevant, low-citation recent papers must outrank highly cited, irrelevant old papers).

<a id="8-配套多锚召回降低锚抖动spec-b-选项"></a>

## 8. Companion Change: Multi-Anchor Recall (Reduce Anchor Jitter, Spec B Option)

Planner LLM generates anchors; two samples (especially Chinese/English queries) produce different most-specific object_terms (measured A=`light field microscopy` vs B=`extended depth of field`, zero overlap). Previously each keyword had one anchored `<anchor> <kw>` query, with anchor as **prefix** multiplied into every query; an anchor change shifts **all** anchored queries (multiplicative effect), greatly diverging top_k.

Use **multiple anchors** (`_rank_object_anchors` + `QUERY_MATRIX_ANCHOR_CAP`, default 3): for each OpenAlex/crossref keyword, issue an anchored version for each of the N most-specific object_terms. Single-anchor jitter affects only one version, and overlapping anchor sets across runs stabilize recall/top_k. Strict arxiv throttling retains only the single most-specific anchor.

- Cost: OpenAlex/crossref cells ≈ `per_source_cap × (1 + ANCHOR_CAP)`; cap=3 is approximately 2× single-anchor cost.
- Tuning: `PAPER_SEARCH_QUERY_MATRIX_ANCHOR_CAP`; larger is steadier but issues more requests (typical object_terms ≤5; 5 includes all).
- Guards: `test_query_matrix.py` `test_openalex_multi_anchor_all_object_terms` / `test_multi_anchor_capped_most_specific_first` / `test_arxiv_uses_single_most_specific_anchor`.

<a id="9-配套keyword_relevance-公式修复a-饱和分-&#45;b-变体归一化"></a>

## 9. Companion Change: keyword_relevance Formula Fix (A Saturating Score + B Variant Normalization)

Measurements found highly relevant papers sinking: 65 papers matching all three dimensions of deep learning × light field × depth of field fell outside top_k=50 (including textbook-relevant `DeepDOF: Deep learning extended depth-of-field`, ranked #137). Root cause: old `_score_keyword_relevance` = matches / full vocabulary length:

1. **Dilution**: planner supplies 6 method + 6 object terms; a focused paper matches only 1 core term → 1/6≈0.17, scarcely distinguishable from no match. A generic DL review (method 2/6, object 0/6) instead ranked #2 through citations.
2. **Variant misses**: `extended depth-of-field` (hyphenated) fails to match `extended depth of field`; similarly `light-field`↔`light field`.

Fix (`scoring.py`):
- **A Saturating score**: per-axis `_axis_saturating_score(hits, n) = base + (1-base)×(hits/n)`, base=0.6. Any hit receives 0.6, establishing relevance; additional matches add only a small bonus. Single-term axes (n=1) yield 1.0 on match and 0.0 otherwise, backward-compatible with old {0,0.5,1.0} two-dimensional semantics.
- **B Variant normalization**: `_norm_match` converts hyphens/underscores/dashes to spaces and collapses whitespace, normalizing both text and terms before matching.

Effect (rescoring ea086796): focused-paper KR 17→70+; three-dimensional matches in top50 9→17; two papers directly recovered into top50. Guards: `test_scoring.py` `test_focused_paper_not_diluted_by_long_term_list` / `test_variant_normalization_hyphen`.

> Remaining: some relevant low-citation papers (e.g. DeepLFM cc=17) still miss top50 with KR 70+. The bottleneck is then citation/recency dimensions (the other 0.5 weight), not keyword_relevance; adjusting citations weights or top_k is outside this change.
