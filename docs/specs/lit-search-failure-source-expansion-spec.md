> Historical research specification: preserves earlier designs and data semantics; it does not require new features or restoration of runtime wiring. Active research features are being retired in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records define actual completion and unaccepted scope.

<a id="失败触发扩源failure-triggered-source-expansion"></a>

# Failure-Triggered Source Expansion

| Item | Value |
|---|---|
| Status | Implemented but **default-OFF (opt-in)**—measurements found automatic expansion slow and backup quality poor (see §6/§9), so `PAPER_SEARCH_FAILURE_EXPANSION` defaults to `0` and requires explicit enabling |
| Related issue | (to be created) |
| Related PR | (to be opened; `feat/refactor-lit-search` retrieval stability series) |
| Domain language source of truth | `CONTEXT.md`; terminology: source health `source_health`, failed sources `failed_sources`, backup source |

---

<a id="1-背景与动机"></a>

## 1. Background and Motivation

Paper sources underpin all subsequent work. Multiple measured traces show occasional **whole-source failures** from primary `openalex`/`crossref` (0 returns / timeouts / rate limits), with per-source counts for similar queries fluctuating between 0↔45. Existing resilience:

- Server-side **single retry for failed sources** (`_fanout_with_single_retry`, only `verdict=failed`; genuinely empty results are not retried);
- Real email for polite-pool reduces rate limiting;
- After search, **report failed platforms and offer user-triggered retrieval again**.

**Missing link**: when primary sources **still fail after retry**, nothing queries **other sources** to recover lost coverage. The only related mechanism, `arxiv_top_up`, triggers on low recall, adds only arxiv, and does not run when arxiv is already requested; it does not address primary-source failures.

<a id="2-目标-&#45;非目标"></a>

## 2. Goals / Non-goals

**Goal**: when primary-source failures leave coverage gaps, automatically query a **bounded backup-source set** to reduce empty/incomplete results, with bounded, nonrecursive execution.

**Non-goals**:
- Does not solve complete network outages (backup sources also fail; use existing user reporting + later retry);
- Does not solve genuinely empty/0-data results (no matches; expansion is meaningless—**0 data does not expand sources**, consistent with existing boundaries);
- Does not replace caching or provide offline operation (separate discussion).

<a id="3-现状精确"></a>

## 3. Current Behavior (Precisely)

The only runtime expansion in `retrieve` is `arxiv_top_up`: when `distinct < 20` **and** `"arxiv" not in sources` **and** arxiv is available, add one arxiv round. It neither triggers for nor addresses source failures. See `search_service.py:427`.

<a id="4-设计"></a>

## 4. Design

<a id="40-默认关闭opt-in-实测结论"></a>

### 4.0 Default Off (Opt-in)—Measured Conclusion

Measurements: automatic expansion is **slow** (most backups fall back to a 20s default timeout plus another serial stage; worst-case retrieval exceeds 30s) and **poor for general queries** (doaj/openaire favor peripheral material; europepmc/pmc biomedical material). Existing single failure retry + honest final reporting + user-triggered primary-source retries adequately cover failures. Therefore expansion is **off by default**, opt-in through env `PAPER_SEARCH_FAILURE_EXPANSION=1` (preferably after configuring a semantic key). `_failure_expansion_enabled()` gates it; disabled means `failure_expansion.triggered=False` and no backup requests. Sections 4.1–4.5 describe **enabled** behavior.

<a id="41-触发"></a>

### 4.1 Trigger

When enabled **and** `_fanout_with_single_retry` returns nonempty `failed_sources` (requested sources still `verdict=failed` after retry), trigger one expansion. `empty` (genuinely empty) does not trigger.

<a id="42-备用源池分层领域感知"></a>

### 4.2 Backup Pool (Tiered, Domain-Aware)

Always filter first: dead/blacklisted sources (zenodo/base/citeseerx/google_scholar/chemrxiv/ssrn/dblp) and **sources already in this request's `sources`**, including failures, which have already been retried.

Candidates by availability:

| Tier | Sources | Condition |
|---|---|---|
| General, no key | `doaj`, `openaire` | Always eligible (cross-domain OA aggregators, alive) |
| General, key required | `semantic` | **Only with `PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY` configured**, otherwise fail-fast empty results waste a slot |
| Domain-specific | `europepmc`/`pmc`/`pubmed` | `domains` includes biology/medicine/life sciences |
| Domain-specific | `iacr` | `domains` includes cryptography/security |

Domain source: add optional `domains: List[str]` to `retrieve` (planner already has `domains`, forwarded through searcher brief; default uses only general tiers).

**Cap**: ≤ 3 final backup sources (latency/quota control). Priority: domain-specific > semantic (with key) > doaj/openaire.

<a id="43-机制-&#45;合并"></a>

### 4.3 Mechanism / Merge

1. `backup_sources = (候选 ∩ 可用) − 死源 − 请求源` (candidates intersect available, minus dead/requested), take first ≤3.
2. Build backup matrix with `build_query_matrix(keywords, sources=backup_sources, object_terms, ...)`.
3. Run **one round** through `_fanout_cells(backup_matrix)`—**no** single retry and **no** recursion; accept backup empty/failure outcomes.
4. Merge into `by_source`, then use the primary dedup / enrich / F22 / rerank pipeline.

<a id="44-顺序插在-single-retry-之后arxiv_top_up-之前"></a>

### 4.4 Ordering (After Single Retry, Before arxiv_top_up)

The diagram describes first fan-out → one failed-source retry → if still failed, expansion → recalculate distinct → if below threshold, arxiv_top_up → dedup/enrich/score.

```
First fan-out → single failed-source retry → [still failed?] → failure-triggered expansion (this spec)
              → recalculate distinct → [still < threshold?] → arxiv_top_up → dedup/enrich/score
```

Expansion precedes arxiv_top_up so top-up's `distinct` reflects expanded results; sufficient expansion eliminates unnecessary top-up.

<a id="45-与用户上报协同已落地的-p3"></a>

### 4.5 Coordination with User Reporting (Existing P3)

Expansion is **one automatic recovery layer**; existing failure reporting + user-triggered retries remain a **second line of defense** if coverage is still incomplete. Final copy should distinguish honestly:
- “openalex failed; doaj/openaire backups supplied N additional papers” (transparent backup usage);
- Users may search again if they still want primary-source coverage.

Add `failure_expansion = {triggered, sources, added}` to stats for reporting.

<a id="5-边界硬约束沿用既定纪律"></a>

## 5. Boundaries (Hard Constraints, Existing Discipline)

- Trigger only with nonempty `failed_sources`; genuine empty/low yield does not trigger this mechanism.
- **One round**; no recursion or separate backup retries.
- ≤ 3 backups; dead/requested sources never enter the pool.
- No semantic without a key.

<a id="6-诚实局限"></a>

## 6. Honest Limitations

- **Thin general-CS backup pool**: when openalex+crossref both fail, only doaj/openaire are general keyless backups, with less coverage; semantic requires a key. A configured semantic key makes the pool adequate.
- **Global/local network failure**: backups are also unreachable; this mechanism is ineffective and falls back to user reporting.

<a id="7-实现落点"></a>

## 7. Implementation Locations

- `paper_search/service/search_service.py`: add `domains` to `retrieve` and §4.4 expansion; new `_pick_backup_sources(requested, domains)` helper (pure, easily tested).
- `paper_search/service/query_matrix.py`: verify per-source query shaping for doaj/openaire/europepmc/iacr, adding defaults where absent.
- `default-capability-packs/lit-search/sub-agents/searcher.md`: forward `domains` to retrieve in brief (**English only, red line 3**).
- Versions: patch increments for paper-search + @asci/electron.

<a id="8-测试计划"></a>

## 8. Test Plan

- `_pick_backup_sources` unit tests: exclude dead/requested sources, domain mapping, semantic removed without key, ≤3 cap.
- Expansion integration: fake registry primary failure → expansion and backup merge; genuine empty does not trigger; one nonrecursive round.
- Regression: `default-capability-packs-load` (no CJK after searcher.md changes), existing retrieve/timeout tests.

<a id="9-待定决策"></a>

## 9. Pending Decisions

1. Forwarding `domains`: this spec recommends a retrieve parameter; alternative infers from arxiv_categories (less plumbing, but non-arxiv plans lack categories).
2. Configure a semantic key by default? Moves general backups from thin to adequate; an operations decision outside this spec.
3. Is a backup cap of 3 appropriate (latency vs coverage)?
