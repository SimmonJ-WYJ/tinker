<a id="文献检索阶段提速重构-speclit-search-latency-refactor"></a>

# Literature Search Latency Refactor Spec

> **Status**: phase 1 implemented (Python only, zero orchestration changes) · phase 1.5+ awaiting review
> **Sole goal**: substantially reduce end-to-end literature-search duration and time to first visible results
> **Related branch**: `feat/refactor-lit-search`
> **Domain language sources of truth**: `CONTEXT.md` · `docs/specs/capability-package-spec.md` · `docs/specs/execution-step-grouping-spec.md`
> **Affected packages**: `apps/electron` (capability packs / orchestrator) · `apps/electron/resources/paper-search-mcp` (Python MCP)
> **Unchanged contracts**: no retrieval-quality regression (deduplication / F22 scoring / LLM rerank order); right-panel data shape and `process_search_results` count semantics stay compatible

---

<a id="0-实现进度"></a>

## 0. Implementation Progress

**Phase 1 (Python only · implemented, paper-search `0.3.8 → 0.3.9` / electron `0.1.367 → 0.1.368`):**

| Item | Status | Location | Validation |
|----|------|------|------|
| P2-2 Tiered timeouts | ✅ | `search_service.py`: `source_timeout()` + `SOURCE_TIMEOUT_OVERRIDES` (openalex/crossref=8s, doaj=10s, configurable through `PAPER_SEARCH_SOURCE_TIMEOUTS`); `_timed_search` takes per-source timeout | +5 `test_timeouts.py` cases |
| P0-4 Citation speed | ✅ | `search_service.py` `snowball()`: concurrent backward/forward for same pid via `asyncio.gather`, remove inter-direction 1.5s sleep; hard depth limit `SNOWBALL_MAX_DEPTH=1`; configurable inter-pid sleep | 4 new `test_snowball.py` cases |
| P0-1 Enrich speed | ✅ | `process_service.py`: three controls, `ENRICH_BATCH_SIZE` (10→16), `ENRICH_INTER_BATCH_SLEEP_SEC` (0.3→0), `ENRICH_MAX_PAPERS` (0=unlimited) | 5 new `test_enrich_batching.py` cases |
| P1-2 arxiv throttling | ⏸ Deferred | 3s follows official arXiv courtesy limits and PR#380 ban lessons; blindly reducing it risks bans. Correct solution is **fewer arxiv calls** (phase 3 `retrieve`); interval already env-configurable, no stage-1 code changes | — |

Full `paper_search/` suite: **129 passed**; `bun run typecheck` passed all packages.

> ⚠️ **Background/progressive enrich (P0-1 option 2 + P0-2)** needs UI/IPC and belongs to phase 2, unimplemented here. Phase 1 only speeds same-source/batch concurrency + adds caps, without changing enriched paper coverage (behaviorally safe).

---

<a id="1-背景与目标"></a>

## 1. Background and Goals

Literature search is central to ASCI lit-search. An ordinary `general-query` currently takes **80–125s** end to end (longer worst-case), leaving users without results for a long time. This spec's **sole goal** is **about one-third that time (25–40s)**, reducing time to first result (TTFR) from 40–60s to **10–12s**.

Non-goals:
- No recall/ranking algorithm changes (F22 formula, LLM rerank weights retained)
- No right-panel presentation or JSONL format changes beyond backward-compatible additions
- No new global state library / storage engine

---

<a id="2-现状架构与端到端耗时分解"></a>

## 2. Current Architecture and End-to-End Timing

<a id="21-当前管线general-query-主路径"></a>

### 2.1 Current Pipeline (general-query Main Path)

```
User query
  │
  ├─[Turn A] Main Agent routes → lit-search scenario Agent
  │            scenario Planning turn generates ## SEARCH PLAN JSON
  │            (intent classification + keyword rewriting + method/object terms)
  │
  ├─[Turn B] Main reads PLAN → dispatches searcher subagent (haiku)
  │            searcher: emit plan preface
  │                    → parallel fan-out 15–18 search_* (H4/H6 matrix)
  │                    → one process_search_results (dedup + full enrich + F22 + JSONL write)
  │                    → long hits-per-source report back into context
  │
  ├─[Turn C] Main dispatches relevance-scorer subagent (haiku)
  │            scorer: Python loads JSONL + Stage1 F22 scores full set
  │                  → Stage2 LLM rerank (top min(N,50), 5 parallel batches×10)
  │                  → emit **entire** ranked set as context text
  │
  └─[Turn D] Optional closing turn (off by default)
```

**Sources of truth**:
- Orchestration: `apps/electron/src/main/lib/agent-orchestrator.ts`, `run-orchestrator-query.ts`
- prompt：`apps/electron/default-capability-packs/lit-search/scenario/system-prompt.md`、`sub-agents/searcher.md`、`sub-agents/relevance-scorer.md`
- Retrieval/processing: `apps/electron/resources/paper-search-mcp/paper_search/service/{search_service,process_service,scoring}.py`

<a id="22-耗时分解模型实测按代码配置估算"></a>

### 2.2 Timing Model (Measured / Estimated from Configuration)

| Phase | Current time | Main cost | Critical path? |
|------|---------|-------------|---------------|
| A. scenario planning turn | 5–10s | Subagent dispatch + JSON generation (full LLM turn) | Yes |
| B1. Dispatch searcher (turn-switch) | 3–5s | Orchestrator switching | Yes |
| B2. search_* parallel fan-out | 8–15s | **arxiv 3s/request serial lock** (5–6 calls serialized by `threading.Lock` ≈ 15–18s); other sources concurrent, bounded by slow-source timeout | Yes |
| B3. process_search_results **full enrich** | **17–27s** | All missing abstracts (~50 papers), 5 batches × 3–5s + 0.3s between batches | Yes |
| B4. Searcher report | 10–15s | Long hits-per-source **output tokens** | Yes |
| C1. Dispatch scorer (turn-switch) | 3–5s | Orchestrator switching | Yes |
| C2. Stage 1 F22 (Python) | 2–5s | Subprocess cold start + JSONL loading | Yes |
| C3. Stage 2 LLM rerank | 10–15s | Parallel batches, ≈ one round trip | Yes |
| C4. Scorer emits **full** ranked text | 10–20s | Structured **output tokens** for 70+ papers | Yes |
| **Total** | **≈ 80–125s** | — | — |

<a id="23-瓶颈定位按可回收时间排序"></a>

### 2.3 Bottlenecks (By Recoverable Time)

1. **Full enrichment on critical path** (17–27s): abstracts are unnecessary for first panel results yet block them.
2. **Three serial Agents + turn-switches** (A+B1+C1 ≈ 11–20s overhead): scenario→searcher→scorer; searcher calls and Stage 1 scoring are almost **deterministic**, requiring no LLM.
3. **Two large text outputs** (B4+C4 ≈ 20–35s): reports/full rankings **reenter context** as generation overhead, with no downstream consumer needing them (panel uses JSONL/tool writes).
4. **Serial arxiv throttling** (hidden ≈ 15s): promised `H4 并行 fan-out` (H4 parallel fan-out) is negated by process-wide `threading.Lock + 3s min interval`; 6 calls execute serially.
5. **Scorer subprocess startup/loading** (2–5s): removable with server-side Stage 1.

---

<a id="3-目标架构"></a>

## 3. Target Architecture

Core: **consolidate deterministic search+dedup+Stage 1 scoring from multiple LLM subagents into one server-side MCP tool; move enrich off the critical path into background/progressive updates; write results through tools instead of emitting context text.** Retain only LLM-required intent/keyword planning and top-K semantic reranking.

```
User query
  │
  ├─[Turn 1] Planning: intent classification + keywords/method/object terms
  │            (thin scenario planner or folded into main; TTFT ≤ 1s)
  │
  ├─[Deterministic] One mcp__paper-search__retrieve(...)
  │            Server performs together:
  │              · H6 query shaping in code (short arxiv queries / domain anchors for openalex/semantic)
  │              · parallel search_* fan-out (also fix arxiv throttling)
  │              · exact + fuzzy deduplication
  │              · server F22 Stage1 scoring (existing scoring.py)
  │              · write JSONL + IMMEDIATELY push panel (raw hits, progressive)
  │              · parallel enrich only top-K (≤50 display/rerank papers)
  │            Return slim ranked top-K (handle/title/abstract/stage1) for rerank
  │
  └─[Turn 2] LLM rerank (top min(N,50), parallel batches)
               · mcp__paper-search__apply_rerank writes scores to JSONL/panel
               · no full ranked-set context-text output
```

<a id="31-收敛对照"></a>

### 3.1 Consolidation Comparison

| Current | Target |
|------|------|
| Scenario planning turn (LLM) | Thin planning or fold into main Agent (P1 folding) |
| Searcher LLM (build H4/H6 matrix, search_*, process_search_results, report) | **Remove** → one deterministic `retrieve` MCP call |
| Scorer Stage 1 (Python block in LLM subagent) | **Remove** → server F22, reuse `scoring.py` |
| Scorer Stage 2 + full-text ranking output | Keep rerank, **write output through tool** |

---

<a id="4-具体改造项"></a>

## 4. Refactor Items

<a id="p0-1-&#45;enrich-移出关键路径最大单点收益约-1725s"></a>

### P0-1 · Remove Enrich from Critical Path (Largest Single Gain: −17~25s)

**Problem**: `enrich_missing_abstracts` (`process_service.py:197`) batches the **entire** deduplicated set (~50 missing abstracts), blocking `process_search_results`. First panel view needs only title/authors/year/venue/doi/url, not abstracts.

**Options** (combine the three; recommend all):
1. **Narrow scope**: enrich only display/rerank top-K (≤50 after Stage 1), not long tail. Typical N≈70 saves ~20 enrichments.
2. **Background**: `process_search_results` immediately returns + persists + pushes panel with `abstractPending`; background enrich fills abstracts via incremental IPC. Critical-path enrich time = 0.
3. **More concurrency**: if synchronous, raise `batch_size` 10→~25 and remove 0.3s batch sleep (connectors already rate-limit), reducing 50 papers from 5 batches to 2.

**Changes**: `process_service.py` detachable enrich call + `enrich_scope=top_k`; panel incremental IPC with four layers (shared constants → main ipc → preload → renderer atom).

**Risk**: rerank needs abstracts; **top-K must finish enrichment before rerank**, covered by option 1; asynchronous long-tail abstracts need UI loading.

---

<a id="p0-2-&#45;渐进式结果回流最大感知收益ttfr-4060s-&#45;10s"></a>

### P0-2 · Progressive Results (Largest Perceived Gain: TTFR 40–60s → ~10s)

**Problem**: users see nothing until search + enrich + rerank finish.

**Approach**: three progressive panel stages:
- **T+~10s**: after search fan-out, deduplicated raw hits appear immediately in Stage 1 order with placeholder abstracts.
- **T+~15s**: top-K enrichment fills abstracts.
- **T+~30s**: LLM rerank reorders and highlights final scores.

**Changes**: phased progress/partial-result emission within `retrieve`; panel supports in-place score/order updates rather than whole-batch replacement (possibly partly supported; see `session-papers-utils.ts`).

**Risk**: reranking shifts order; one smooth transition, top-K only, stable tail.

---

<a id="p0-3-&#45;收敛-searcher-子-agent-为确定性-retrieve-工具约-1525s去掉-1-次派发-&#45;长报告输出-&#45;llm-拼矩阵"></a>

### P0-3 · Replace Searcher with Deterministic `retrieve` (−15~25s: Dispatch + Report + LLM Matrix)

**Problem**: 95% of haiku searcher's work is deterministic: H6 keyword×source matrix, parallel search_*, process_search_results, report. Code can perform it.

**Approach**: new `mcp__paper-search__retrieve(research_question, keywords, method_terms, object_terms, sources, arxiv_categories, top_k=50)`:
- Move `searcher.md` **H5/H6 query shaping** and **round-1 matrix** into Python `build_query_matrix()` in `search_service.py` (short arxiv queries, `<anchor> <method>` for openalex/semantic).
- Existing `search()` parallel fan-out + `process_results_core()` dedup + `scoring.py` Stage 1 F22.
- H1 low-yield early stopping and H3 budgets become deterministic server rules, not prompt discipline.
- Return slim top-K ranking for rerank + counts (`total_from_sources/new_records/display_count`).

**Gain**: remove dispatch (−3~5s), long searcher report (−10~15s), matrix/early-stop variation. Code-driven retrieval is reproducible, testable, cacheable.

**Changes**: Python `retrieve` + `build_query_matrix()`; reduce `searcher.md` to calling retrieve or remove searcher PLAN step so main calls `retrieve` directly; update `lit-search/manifest.json` topology.

**Risk**: H1–H6 prompt experience must become tested code (extend existing `test_*`); retain atomic `search_*` escape hatches.

---

<a id="p1-1-&#45;评分结果经工具回写不再吐-context约-1020s-输出-token"></a>

### P1-1 · Write Scores Through Tools, Not Context (−10~20s Output Tokens)

**Problem**: relevance-scorer emits **all** 70+ ranked papers as structured context text (`relevance-scorer.md:208`), pure output overhead unnecessary for JSONL-backed panel.

**Approach**: new `mcp__paper-search__apply_rerank(turn_id, scores: {handle: llm_relevance})`; rerank subagent/main emits only small top-K `{handle: score}` JSON, calls tool; server computes `final = 0.30*kr + 0.40*llm + 0.15*rec + 0.15*trust`, updates JSONL in place, pushes panel. LLM outputs only scores, without repeating papers.

**Changes**: Python `apply_rerank` including final formula from `relevance-scorer.md:197`; slim scorer prompt: read top-K → {handle: 0–1} → apply_rerank.

**Risk**: formula migration must match current behavior exactly, fixed by unit tests.

---

<a id="p1-2-&#45;修复-arxiv-串行节流约-1015s"></a>

### P1-2 · Fix Serial arxiv Throttling (−10~15s)

**Problem**: `connectors/arxiv.py` serializes all arxiv requests via process-wide `threading.Lock + ARXIV_MIN_INTERVAL_SEC=3`; 5–6 queries turn H4 fan-out into ~18s serial execution.

**Options**:
- **Merge queries**: fewer, broader arxiv queries (1–2), using `categories` rather than repeated keyword calls.
- **Lower interval + jitter**: `ARXIV_MIN_INTERVAL_SEC` ~1s with jitter (courtesy ~1 req/3s is conservative; short bursts acceptable), or global token bucket instead of strict serialization.
- **Conditional arxiv**: default `openalex+crossref` fast path returns 60–100 hits within 5s; add arxiv only if insufficient, accepting its separate delay.

**Changes**: `connectors/arxiv.py` throttle; limit arxiv query count in `build_query_matrix()`.

**Risk**: arXiv rate-limit/ban; conservatively 1.5s + jitter, retaining 429 backoff.

---

<a id="p1-3-&#45;折叠-scenario-planning-turn约-510s"></a>

### P1-3 · Fold Scenario Planning Turn (−5~10s)

**Problem**: separate LLM planner turn only generates keywords/terms JSON.

**Options** (recommend A):
- **A (conservative)**: retain planner but enforce declared thinking disabled + TTFT ≤1s, default closing turn off; keep planner and first `retrieve` adjacent to reduce idle time.
- **B (aggressive)**: inline intent classification + keyword expansion into main orchestrator's same turn (pack supplies prompt fragment, not separate Agent); main generates terms and calls `retrieve` in the decision turn, removing dispatch.

**Changes**: A validation only; B changes `capability-pack-loader.ts` / routing / `lit-search` topology, substantial, recommended phase two.

**Risk**: B changes scenario-Agent pack contract; align with capability-package-spec as separate task.

---

<a id="p2-1-&#45;查询级持久缓存重复近似查询-&#45;近乎瞬时"></a>

### P2-1 · Persistent Query Cache (Repeated/Similar Queries Almost Instant)

**Approach**: short-TTL (e.g. 24h) `(normalized_query, sources)` → hits cache under `~/.asci/`; retrieve returns hits directly and populates panel. Cross-session/serializable, unlike existing in-process 10min handle cache.

**Risk**: freshness; short TTL + user force refresh. Incremental phase-three optimization.

---

<a id="p2-2-&#45;enrich网络层杂项"></a>

### P2-2 · Enrich / Network Miscellany
- Semantic without key already fails fast; retain.
- `PER_SOURCE_TIMEOUT_SEC=20` is long; tier fast sources (openalex/crossref usually <2s) at 8s and flaky ones at 15s, reducing tail waits.
- Dead sources dblp/google_scholar/zenodo/base/citeseerx already disabled by default; retain.

---

<a id="5-目标端到端耗时模型before-&#45;after"></a>

## 5. Target End-to-End Model (Before / After)

| Phase | Before | After | Explanation |
|------|--------|-------|------|
| Planning | 5–10s | 3–5s | Tighten planner (P1-3 A) / fold (B) |
| Dispatch searcher | 3–5s | 0 | Removed by P0-3 |
| Search fan-out | 8–18s | 6–10s | P1-2 arxiv serialization fix |
| Critical-path enrich | 17–27s | **0** background / 3–5s synchronous top-K | P0-1 |
| Searcher report | 10–15s | 0 | Removed by P0-3 |
| Dispatch scorer | 3–5s | 0 | Inline or single-turn rerank |
| Stage 1 F22 | 2–5s | <1s | P0-3 server-side |
| Stage 2 LLM rerank | 10–15s | 10–15s | Retained for quality |
| Score output | 10–20s | <2s | P1-1 tool writes |
| **Total** | **≈ 80–125s** | **≈ 25–40s** | **About 3× faster** |
| **First visible results (TTFR)** | **40–60s** | **~10–12s** | P0-2 progressive |

---

<a id="6-分阶段落地路线图每阶段独立可交付可回滚"></a>

## 6. Phased Roadmap (Each Deliverable and Reversible)

> ⚠️ First-round roadmap; **final roadmap incorporating round-two additions is §11**, which is authoritative.

- **Phase 1 (highest ROI, Python only, zero orchestration)**: P0-1 background/top-K enrich + P1-2 arxiv throttling + P2-2 tiered timeouts; estimated ~100s→~55s alone.
- **Phase 2 (progressive UI)**: P0-2 + four-layer incremental panel IPC, TTFR ~10s.
- **Phase 3 (retrieve consolidation)**: P0-3 + P1-1, `retrieve` / `apply_rerank`, slimmer prompts, 25–40s end to end.
- **Phase 4 (optional orchestration folding)**: P1-3 B + P2-1 cache, additional improvement.

Each phase: BDD behavior → Python tests beside `test_timeouts.py`/`test_enrich.py` → `bun run typecheck && bun test` → `dist:fast` smoke if packaging/MCP startup involved.

---

<a id="7-风险与回滚"></a>

## 7. Risks and Rollback

| Risk | Mitigation |
|------|------|
| Behavior drift moving query shaping / early stop / final formula from prompts to code | Unit-test each existing rule against golden behavior, matching exactly before switching |
| Recall/ranking quality regression | Retain `search_*` / `process_search_results` for escape/comparison; fixed-query before/after recall and top-20 overlap |
| Background enrich leaves abstracts/citations missing | Synchronous top-K enrich for rerank/display; asynchronous tail + UI loading |
| arxiv throttling bans | Conservative 1.5s + jitter + 429 backoff |
| P1-3 B breaks pack contract | Separate task aligned with capability-package-spec; default A |

---

<a id="8-验证方法"></a>

## 8. Validation

1. **Performance logs**: reuse `[perf] search completed ... total_wall=Zms timings={...}` in `search_service.py`; add `[perf]` timing to `retrieve` / enrich / rerank and one end-to-end aggregate.
2. **Benchmark queries**: fixed 5–8 representative queries (LLM long-context, biomedical, crypto, cross-domain…), scripted before/after timing, TTFR, top-20 overlap, per-source hits.
3. **Quality regression**: top-20 Jaccard/overlap ≥ threshold (e.g. 0.8) for no regression.
4. **UI checks**: `bun run dev` golden paths (ordinary search / citation tracing / exact lookup), progressive display + abstract fill + rerank without flicker; zh↔en once each, no raw keys.

---

<a id="9-受影响的包与版本号"></a>

## 9. Affected Packages and Versions

| Package | Change | Version |
|----|------|--------|
| `apps/electron` (packs / orchestrator / IPC / panel atoms) | Slim prompts, retrieve/apply_rerank routing, progressive panel, four-layer IPC | patch ++ |
| `apps/electron/resources/paper-search-mcp` (Python) | Background enrich, retrieve/apply_rerank, build_query_matrix, arxiv throttle, timeouts | Synchronize internal version |

> Python MCP ships with `apps/electron`; increment `apps/electron/package.json` according to the affected-package patch convention.

---

<a id="10-第二轮审核补充改进项"></a>

## 10. Second Review: Additional Improvements

Round one focused on `general-query`. Connector/orchestration review found these omissions/corrections.

<a id="100-对第一轮判断的修正重要"></a>

### 10.0 Corrections to First-Round Assessment (Important)

- **Connectors are singletons**: `ConnectorRegistry` instantiates once at startup (`registry.py` `_instantiate_all` → `self._instances[name]=cls()`); `get()` returns the same object. Each `requests.Session()` is process-long, so TLS/keep-alive **already work**, contrary to the repeated-handshake concern. Real HTTP bottleneck is **synchronous `requests` in default thread pool** (P2-3).
- HTTP rewrite priority therefore **drops to P2**, with marginal gains.

<a id="p0-4-&#45;citation-tracing-路径提速第一轮完全遗漏"></a>

### P0-4 · Citation-Tracing Speed (Omitted in Round One)

**Problem**: `citation-tracing` uses `citation-explorer → relevance-scorer`; `snowball()` (`search_service.py:150`) has serious independent serialization:
- **Single source**: Semantic Scholar only (`registry.get("semantic")`), fails/empty without key.
- **Serial `await asyncio.sleep(1.5)` per pid**: 1.5s between seeds, plus another 1.5s between backward/forward for `direction="both"`. depth=1 single seed ≈ 3s + 2 semantic trips; depth≥2 yields 30–40 layer-1 IDs ×3s = **90–120s** (prompt caps depth=1, server does not).

**Approach**:
1. **Concurrent forward/backward**: remove same-pid 1.5s delay; `asyncio.gather` both endpoints, which do not rate-limit each other. Save 1.5s + half round-trip time per seed.
2. **Token bucket between pids**: global ~1 req/1.5s, allow short concurrent bursts rather than strict serialization; Semantic key can reduce interval to ~0.5s.
3. **Server hard limit depth≤1**, unless explicitly relaxed, matching prompt and preventing explosive layers.

**Changes**: `search_service.py` `snowball()`; optionally slim `citation-explorer.md`.
**Gain**: typical tracing ~12–18s→~6–8s; eliminate minute-long depth tails.

<a id="p1-4-&#45;mcp-进程预热消除首查冷启动-25s"></a>

### P1-4 · MCP Prewarming (Remove 2–5s First-Query Startup)

**Problem**: paper-search is a stdio subprocess `uv run ... paper-search-mcp` (`builtin-mcp-resolver.ts`, 60s startup timeout). If spawned on first tool_call, **first retrieval** pays `uv` resolution + Python imports + connector instantiation (~2–5s).

**Approach**:
1. **Prestart paper-search MCP at session/app startup**, before first search, completing imports/registry before user retrieval.
2. **Optional network warmup**: one lightweight openalex/crossref request after startup creates pooled connections, working with singleton Sessions.

**Changes**: trigger MCP spawn during session initialization in `agent-orchestrator.ts` / MCP lifecycle.
**Risk**: idle resources; warm only when entering lit-search/lit-review pack context.

<a id="p1-5-&#45;source-级渐进上屏强化-p0-2-的-race-to-first"></a>

### P1-5 · Source-Level Progressive Display (Strengthen P0-2 Race-to-First)

**Problem**: P0-2 waits for all search gather results per phase. `search()` uses `asyncio.gather` across **all** sources, so fastest openalex (<1s often) waits for slowest.

**Approach**: `asyncio.as_completed` or callbacks within retrieve; **push each source as soon as it returns**, rolling dedup over accumulated hits. Fastest hits visible ~2s rather than 8–10s.

**Changes**: `search_service.py` incremental callbacks; incremental panel merging through P0-2 channel.

<a id="p2-3-&#45;同步-requests-&#45;线程池上限-&#45;迁移-async-http"></a>

### P2-3 · Synchronous `requests` → Larger Thread Pool / Async HTTP

**Problem**: synchronous `requests` + `asyncio.to_thread` in all connectors hits default `ThreadPoolExecutor` limits (~`min(32, cpu+4)`). Multi-source×keywords, 15–18 concurrent to_thread calls, **queue** on low-core machines.

**Options** (marginal gains, P2):
- Explicitly enlarge executor during retrieve (`loop.set_default_executor(ThreadPoolExecutor(max_workers=24))`).
- Or migrate hot openalex/crossref/semantic to shared `httpx.AsyncClient` (HTTP/2 multiplexing + native async, no thread-pool limit).

<a id="p2-4-&#45;rerank-降本prefill-&#45;可选-embedding-分流"></a>

### P2-4 · Lower Rerank Cost (Prefill + Optional Embedding Split)

**Problem**: Stage 2 always LLM-reranks top-50 title+abstract input/prefill in 10–15s.

**Approach**:
1. **Truncate input**: title + first ~300 abstract characters lowers prefill with little quality loss.
2. **Optional embedding presort**: provider embeddings compute query×paper cosine; **LLM only top-20**, embeddings score 21–50. Subsecond embeddings shrink rerank coverage while preserving quality. Evaluate provider support; P2/phase three.

<a id="10x-二阶收益无需额外改动自然获得"></a>

### 10.x Secondary Gains (Automatic, No Extra Work)

P0-3 + P1-1 remove long reports/full rankings, **shrinking context** and speeding/lowering token cost of later prefills, including lit-review. Observe during validation rather than making a separate task.

---

<a id="11-更新后的落地路线图含补充项"></a>

## 11. Updated Roadmap (With Additions)

- **Phase 1 (highest ROI, Python only, zero orchestration)**: P0-1 background/top-K enrich + P1-2 arxiv throttle + **P0-4 citation concurrency/remove sleeps** + P2-2 timeouts.
- **Phase 1.5 (independent, low risk)**: **P1-4 MCP prewarming**, small lifecycle changes with immediate first-query gains.
- **Phase 2 (progressive UI)**: P0-2 + **P1-5 source-level race-to-first** + four-layer panel IPC.
- **Phase 3 (retrieve consolidation)**: P0-3 + P1-1, `retrieve` / `apply_rerank`, slimmer prompts.
- **Phase 4 (optional / third stage)**: P1-3 B folding + P2-1 cache + P2-3 async HTTP + P2-4 embedding rerank.

---

<a id="12-待用户确认的开放问题"></a>

## 12. Open Questions for User Confirmation

1. **Background enrichment**: accept first view without abstracts and later fill (P0-1 option 2), or require abstracts initially (options 1+3, 3–5s slower)?
2. **Orchestration folding P1-3 B** in scope? Changes scenario-Agent contract; recommend separate phase-two task.
3. What **top-20 overlap quality threshold** counts as acceptable no-regression?
4. Include **embedding rerank P2-4**? Depends on provider embedding availability and ranking-quality tolerance.
5. **MCP prewarm timing P1-4**: app startup, or only entering lit-search/lit-review to save idle resources?
