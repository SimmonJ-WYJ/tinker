<a id="并行化-v2-scorer-shards-specparallel-scorer-shards"></a>

# Parallel V2 scorer shards Spec (Parallel Scorer Shards)

> **Status**: Draft · Review pending
> **Related issue**: #689 (lit-search: parallelize V2 scorer shards to accelerate scoring large candidate sets)
> **Related PR**: TBD
> **Domain-language source of truth**: Terminology in §2 of this spec; aligned with `CONTEXT.md` / `docs/specs/lit-scoring-agent-spec.md`
> **Dependencies**: `docs/specs/lit-scoring-agent-spec.md` (score / scorer v2), `docs/specs/execution-step-grouping-spec.md` (PLAN parallel steps)

---

<a id="1-背景与问题"></a>

## 1. Background and problem

The current default lit-search V2 scoring pipeline is `searcher/retrieve → scorer` (a **single** scorer sub-Agent). In Step 0, scorer uses **handwritten Python** to read the entire session JSONL → filter this turn → sort by F22 `extra.relevance` → select the scoring window (F22>50 OR method≥70, floor 50, cap 120, merging seeds) → print all window candidates into context, then judge `semantic` / `method` paper by paper and use one final `apply_scoring` call to write back `extra.score`.

Problem: **LLM judging is the most expensive search stage**. A window can contain 120 papers; a single scorer judges them all serially, increasing latency with candidate count. Papers in the scoring window are independent and naturally parallelizable.

<a id="2-术语领域语言"></a>

## 2. Terminology (domain language)

- **V2 scoring window**: Candidates in this turn requiring LLM `semantic`/`method` judgments. Rules are determined **server-side** (F22>50 OR methodRelevance≥70, floor 50, cap 120, merging forced seeds).
- **shard**: A **disjoint subset** of the scoring window. N shards do not overlap, and their union == the complete window.
- **scorer shard**: One `scorer` sub-Agent instance judging only papers in its own shard.
- **DEFAULT_SCORING_SHARD_COUNT**: Default shard count, initially **3**.

<a id="3-目标与边界"></a>

## 3. Goals and boundaries

After completion, ordinary literature search retains **unchanged user-visible behavior** for `searcher/retrieve → scorer`, but for large candidate sets the system deterministically splits the scoring window into multiple shards and dispatches multiple `scorer` instances in parallel. Two hard boundaries:

1. **Parallelism occurs only in the LLM judge stage**. Candidate-window, sharding, and writeback-merge rules **must be determined server-side**; scorer prompts no longer handwrite Bash/Python to read and slice the entire JSONL.
2. **Concurrent write safety**. When multiple scorers concurrently write different handles in the same session JSONL, the `apply_scoring` read-modify-write must be concurrency-safe; later shards must not overwrite earlier shards' `score`.

Old `relevance-scorer` / `finalRelevance` (v1) remain legacy fallbacks outside the default path.

<a id="4-设计"></a>

## 4. Design

<a id="41-服务端窗口-&#45;分片工具paper-search-mcp"></a>

### 4.1 Server-side window + sharding tool (paper-search MCP)

- `select_scoring_window(records, turn_id=None) -> (resolved_turn_id, window_records)`: Move window rules previously scattered across scorer.md into a **deterministic server-side function** (same thresholds/floor/cap/seed merging; stable F22 desc sort).
- New MCP tool `get_scoring_shard(shard_index, shard_count=3, session_id="", turn_id="")`:
  - Read JSONL → `select_scoring_window` → select this shard using **round-robin** `window[shard_index::shard_count]` (stable, disjoint, complete union, balanced difficulty).
  - Return `{turn_id, shard_index, shard_count, window_total, shard_size, candidates:[{handle,title,abstract,year}], note?}`.
  - **Boundaries**: `shard_count<1` or out-of-range `shard_index` (<0 or ≥shard_count) → `{error}`; empty window / shard → `candidates: []`, `shard_size: 0`, explanatory `note` (scorer reports scored 0), **without error**.
  - Single-scorer fallback = `shard_count=1, shard_index=0` → return the entire window.

<a id="42-jsonl-回写并发安全"></a>

### 4.2 Concurrent JSONL writeback safety

- Maintain an in-process `asyncio.Lock` per `out_path` (module-level dict keyed by path; reuse the same lock within the same loop under MCP's single-process, single-event-loop model).
- **All writers that read the entire JSONL → modify → atomically rewrite that same JSONL must acquire the same lock**, or later writers overwrite earlier fields with a stale read snapshot:
  - `apply_scoring` (multiple scorer shards concurrently writing `score`);
  - `enrich_session_async` (background venue lookup + ranking + seven-dimensional score writeback): lock its read→merge→rewrite critical section; perform slow network enrichment outside the lock to keep lock duration short.
- Each writer's RMW reads the **current** file (including fields already persisted by other writers), modifies only its own fields/handles, then rewrites atomically → correct merging without lost scores (shard↔shard preserves `score`; shard↔enrich preserves `journalRank`/`venue`).
- ⚠️ Historical lesson: Changing file I/O in `apply_scoring` to `await to_thread` introduced yield points; without the same lock, `enrich` interleaved with shards and overwrote their changes. Sharing the lock across both sections eliminated this.

<a id="43-scorer-子-agent"></a>

### 4.3 scorer sub-Agent

- Tool allowlist: `["mcp__paper-search__get_scoring_shard", "mcp__paper-search__apply_scoring"]` (remove Bash; no more handwritten Python slicing).
- Change Step 0 to **one `get_scoring_shard` call**, taking `shard_index`/`shard_count` from the dispatch brief (default = 0/1, judging the full window). Other judging/writeback logic stays unchanged.

<a id="44-plan-&#45;派活协议"></a>

### 4.4 PLAN / dispatch protocol

- Scenarios `general-query` / `citation-tracing` default to emitting **3 `parallel: true` `scorer` shard steps** after `searcher` / `citation-explorer` (`shard_index` 0/1/2, `shard_count` 3).
- Main Agent dispatch protocol (agent-prompt-builder): **Consecutive `parallel: true` steps form a parallel group**, dispatched concurrently in one batch; wait for all tool_result responses in the group (barrier) before the next sequential step / terminal skill. `searcher` has no `parallel` (sequential), ensuring the scorer group starts only after candidates are persisted.

<a id="5-验收见-issue-689-acceptance-criteria"></a>

## 5. Acceptance (see issue #689 Acceptance criteria)

- Python unit tests: disjoint window shards + complete union, empty shard, out-of-range shard, single-shard fallback, concurrent `apply_scoring` without lost scores.
- Bun contract tests: scenarios produce parallel scorer shards, scorer allowlist includes `get_scoring_shard` + `apply_scoring`, PLAN dispatch protocol supports parallel steps in one group.
- `bun run typecheck` / `bun test` pass; increment patch versions of affected packages.
