---
name: litreview
description: >
  Multi-round literature search: confirm params → parallel multi-source query → dedupe + write →
  round summary → iterative expansion. Backed by paper-search MCP tools (search_arxiv,
  search_semantic, etc.); results auto-write to the session paper index and stream live to the
  right-side "current search" panel.
  Use when user says "搜论文" "检索文献" "开始搜索" or "search papers" "find papers" —
  only after paper-source-selection has confirmed parameters.
  This is search only, NOT review writing — "写综述 / 生成综述 / 综述论文 / literature review"
  routes to review-proposer / literature-review-result, not here.
allowed-tools: Read Write Bash
version: "1.0.0"
category: general
---

# Litreview: Multi-round Paper Search

## Precondition

**Before searching, you MUST run `paper-source-selection` first to confirm parameters with the user.**
Only after receiving the confirmed parameters (field, keywords, sources, year range, results per source)
may you proceed into this Skill's execution flow.

If the user jumps straight to "搜论文" / "search papers" without going through confirmation,
invoke `paper-source-selection` first to complete confirmation.

### Same-session multi-round recap (issue #90)

If a `<session_paper_index>` block appears in the per-turn context, this is **NOT the first search in the session** — prior rounds have already retrieved K papers (the block lists their identifiers). Branch up front:

- **Follow-up / supplemental retrieval** (cues: "再多找一些 / 补充几篇 / 扩展一下 / more on this / find more / expand"): treat the listed identifiers as the dedup baseline; reuse Round 1's confirmed parameters (sources / max_results / enrich) per the "Cross-round parameter reuse" rule below. Do NOT re-invoke `paper-source-selection`. Only the new keyword set needs to be confirmed (a recap line, not a full reconfirm). Skip straight to Phase 1.
- **Fresh / new-topic retrieval** (cues: "重新开始 / 忽略上一轮 / 重新检索 / start over / fresh search / new search, ignore prior"): announce once "Starting a fresh round; the K previously retrieved papers remain in the panel but are not used as a baseline." Then proceed normally — `paper-source-selection` may need to re-run if the new topic changes the field.
- **Ambiguous**: route through AskUserQuestion before launching the search; do not guess.

---

## Workflow Overview

```text
User-confirmed params (from paper-source-selection)
  → Phase 0.5: dimension extraction (method × object, scoring axes)
  → Phase 1: search execution (parallel multi-source MCP calls)
  → Phase 2: result landing (format as PaperRecord, write JSONL)
  → Phase 3: round summary (quantitative stats, 3-5 lines)
  → Phase 4: next-round proposal (new keywords / citation trace / done)
  → user picks → loop...
  → Phase 5: search complete (final summary)
```

---

## Phase 0.5: Dimension Extraction (research method × research object)

**F21 (issue #98) — 双维相关度评分**

After confirming keywords with `paper-source-selection`, **before issuing search rounds**, split each keyword phrase into two semantic axes:

- **method_terms**: research techniques / models / algorithms / approaches
  (e.g., `"transformer"`, `"graph neural network"`, `"diffusion model"`, `"contrastive learning"`)
- **object_terms**: research subjects — diseases, materials, populations, species, datasets, biological entities, social groups, or any "what is being studied"
  (e.g., `"mouse model"`, `"alzheimer's disease"`, `"CIFAR-10"`, `"elderly patients"`, `"perovskite"`)

Output the split explicitly to the user before Phase 1:

> 本轮检索维度拆解：
> - 研究方法：transformer, attention mechanism
> - 研究对象：mouse model, alzheimer's disease

If a keyword genuinely has no one of the two dimensions (e.g., a methodology-only "review of X" keyword, or a pure dataset survey), leave that axis empty — `process_search_results` falls back to query-bag matching with no degradation.

Prefer canonical English forms; if the user gave Chinese terms, **include both forms** so substring matching covers both languages, e.g. `["mouse model", "小鼠模型"]`.

Pass both arrays to `mcp__paper-search__process_search_results` (as JSON-encoded strings — same convention as `handles`):

```
mcp__paper-search__process_search_results(
    handles='["ps_abc123", "ps_def456"]',
    query="transformer mouse model",
    method_terms='["transformer", "attention mechanism"]',
    object_terms='["mouse model", "小鼠模型"]',
)
```

**These are scoring parameters, NOT search parameters.** Do NOT pass them to `search_*` tools.

---

## Phase 1: Search Execution

### Hard Rules

1. Use the data sources confirmed by paper-source-selection; **do not add or drop sources on your own**
2. 1-2 keyword phrases per round (more keywords = tighter intersection = fewer results)
3. Call all sources in parallel (do not serialize)
4. Assign each round an ID: "r1", "r2", ...

### Execution

For each confirmed data source, invoke the corresponding per-source paper-search MCP tool in parallel.
**These are MCP tools — call them as tools directly. Absolutely do not invoke them via Bash / python3 scripts.**

MCP tool names follow the pattern `mcp__paper-search__search_{source}`. Examples:

```
mcp__paper-search__search_arxiv(query="large language model alignment", max_results=15)
mcp__paper-search__search_semantic(query="large language model alignment", year="2022-2026", max_results=15)
mcp__paper-search__search_dblp(query="large language model alignment", max_results=15)
mcp__paper-search__search_iacr(query="zero knowledge proof", max_results=15)
```

**Parameter mapping** (full table in [references/query-mapping.md](references/query-mapping.md)):
- `query`: keyword phrase; pass one primary keyword per round (do not concatenate multiple)
- `year`: only `mcp__paper-search__search_semantic` supports year filtering (format "2022-2026")
- `max_results`: user-confirmed per-source count (default 15). Values >30 risk hitting the Agent SDK single-tool response threshold and trigger chunked-read fallback, which breaks Phase 2 — keep at default unless the user explicitly asks for a wider sweep.
- `slim`: search_* tools default to `slim=True`. The returned `papers` array is identity-only (title / authors / year / doi / url / venue / source); the **full untouched papers stay in MCP server memory under the `_handle` field** — pass that handle to `process_search_results(handles=[...])` in Phase 2. Do NOT pass `slim=False` unless the user explicitly needs full payload in agent context.

### Return Shape

Every `search_*` call returns a dict:

```
{
  "_handle": "ps_abc123def456",   # opaque handle, valid 10 min
  "count": 15,                     # number of papers stored
  "papers": [ ...slim papers... ]  # identity fields only when slim=True
}
```

The agent uses `papers` for round-summary stats (title / year / source distribution); the `_handle` is the contract with Phase 2 — it lets Phase 2 retrieve the full papers without re-emitting JSON through agent context.

### Result Handoff (Hard Constraint — Violation = Failure)

Once all per-source searches return, **collect all `_handle` values and call `mcp__paper-search__process_search_results(handles=[...])` immediately**. This is the only correct post-processing path.

**🚫 The following are strictly forbidden (any one of them leaves the right-side paper panel empty or burns 7+ minutes):**
- Skipping `mcp__paper-search__process_search_results` — papers are **not auto-persisted**; this tool MUST be called explicitly to write JSONL
- Re-emitting the per-source `papers` arrays back into `process_search_results` via the legacy `inputs` parameter — this costs 10,000+ output tokens (~7 minutes wall-clock) for no benefit; use `handles` instead
- Using `Read` to open the SDK's internal tool-results file
- Using `Bash` / `python3` to hand-process search results
- Writing search results to a temp JSON file before processing
- Implementing dedupe / format conversion / JSONL write logic yourself
- Pulling search results into the conversation context for manual cleanup

**✅ Only correct flow:** search_* returns → collect `_handle` values → call `process_search_results(handles=["ps_xxx", "ps_yyy", ...])` (see Phase 2)

---

## Phase 2: Dedupe + Abstract Enrichment + Landing

**Hand-processing of search results is forbidden.** Use the `mcp__paper-search__process_search_results`
MCP tool to do dedupe, abstract enrichment, and JSONL write in one step.

### Invocation (handles path — REQUIRED)

After search completes, collect every `_handle` returned by the search_* calls and pass them as a JSON-string array. The MCP server retrieves the full papers from its internal memory — agent does NOT re-emit any paper JSON:

```
mcp__paper-search__process_search_results(
  query="large language model alignment",
  handles='["ps_abc123def456", "ps_xyz789ghi012", "ps_lmn345opq678"]',
  enrich=true
)
```

If a `_handle` is `""` (no results from that source), skip it.

### Parameters

- `query`: the search keyword
- `handles`: ✅ **REQUIRED in normal flow**. JSON-string array of `_handle` values from this round's search_* calls. The MCP server resolves each handle to its full per-source paper list. Handles expire 10 minutes after the search call.
- `inputs`: ⚠️ **Legacy fallback only**. Same JSON structure as before (`'[{"source": "...", "papers": [...]}, ...]'`). Use **only** when `process_search_results` returned `"handles expired"` error in a previous attempt — in that case re-run the search_* tools first to get fresh handles; do not manually pack papers into `inputs` unless absolutely no other path works.
- `enrich`: whether to call enrich_paper on abstract-less papers (default true)
- `session_id`: optional. If omitted, read from env var `ASCI_SESSION_ID`

### Handles expired? Refresh, don't fall back

If the tool returns `{"error": "all handles expired or not found..."}`, **re-run the search_* tools** to get fresh handles, then retry process_search_results with the new handles. Do NOT try to recover by re-emitting old search results through the `inputs` parameter — that defeats the entire purpose and costs minutes of wall-clock.

### Return Value

The tool returns stats (JSON) suitable for direct use in the round summary:

```json
{
  "total_from_sources": 150,
  "duplicates_removed": 11,
  "new_records": 139,
  "papers_without_url": 3,
  "display_count": 136,
  "enriched_abstracts": 45,
  "source_counts": {"arxiv": 50, "semantic": 50, "dblp": 50},
  "output_path": "..."
}
```

**Build the round summary from this stats blob — do not sum per-source results yourself; those are pre-dedupe numbers.**

When reporting to the user, use the returned fields. Suggested phrasing:
- "Retrieved {total_from_sources} papers across N sources; {new_records} new after dedupe; {display_count} shown in the right-side panel."
- If `papers_without_url > 0`, add: "{papers_without_url} papers omitted from the list due to missing links."

### Hard Rules (Any Violation = Empty Right-side Panel or 7+ Minute Delay = Task Failed)

1. **Use `handles` not `inputs`** — re-emitting search results back through agent context costs ~10K output tokens and adds 5–7 minutes of wall-clock. The `_handle` route bypasses this entirely.
2. **Do not process search results via Bash / python3** — everything goes through `mcp__paper-search__process_search_results`
3. **Do not Read the SDK's tool-results file** — pass handles, not raw payload
4. **Do not hand-write JSONL** — `process_search_results` writes it for you
5. **Do not pull search results into the conversation context for manual cleanup** — slim mode already gives you enough for round-summary; full data is preserved in MCP memory under the handle
6. Results auto-write to `agent-sessions-papers/{sessionId}.jsonl`; the right-side "current search" panel polls this file automatically

---

## Phase 3: Round Summary

After each search round, emit a short quantitative summary (3-5 lines):

```
Round 1 "large language model alignment":
  arXiv: 48 | Semantic Scholar: 50 | DBLP: 23
  New after dedupe: 89 (32 duplicates)
  Year distribution: 2024 (41) | 2023 (28) | 2025 (15) | other (5)
```

### Cross-round delta (issue #90 — required when prior rounds exist in the session)

If a `<session_paper_index>` block was present at the start of this turn (i.e. the session already had K papers before this round), append one extra line to the round summary that announces the **cumulative-vs-incremental** delta. Use the latest `process_search_results` call's `display_count` for the delta:

- EN: `Round N: M new papers added on top of the K already retrieved (after dedup).`
- ZH: `本轮新增 M 篇，已有 K 篇之外（去重后）。`

Pick the language consistent with the resolved output language for this turn. The intra-round "New after dedupe" line is about within-round duplicates; the cross-round line is about the cumulative session index. Both must appear when applicable.

### Dimension hit stats (F21 — show only when Phase 0.5 provided method/object)

If Phase 0.5 produced non-empty `method_terms` / `object_terms`, append these stats to the round summary (count papers in the round's returned records by axis hit):

- 双维命中（方法+对象）：N1 篇
- 仅方法命中：N2 篇
- 仅对象命中：N3 篇
- 都未命中：N4 篇

Compute by reading `extra.methodTerms` / `extra.objectTerms` on each record (or directly use the Phase 0.5 arrays) and substring-matching against each paper's title + abstract.

### Do NOT include in the summary

- Per-paper descriptions
- Topic groupings
- (Author, Year) citation form
- Evidence tags or structured outlines
- Raw JSON

---

## Phase 4: Next-round Proposal

Analyze current results and propose one of the following:

1. **New keyword round** — pick 1-2 unsearched keyword phrases from high-frequency terms
2. **Citation trace** — for highly-cited seed papers, run `snowball_search` for forward/backward tracking
3. **Similar recommendations** — for highly-relevant papers, call `recommend_papers` to discover related work
4. **Done** — coverage is sufficient; recommend ending the search

After the user picks:
- New keywords → back to Phase 1, show an updated confirmation checklist
- Citation trace → enter Phase 4a
- Done → enter Phase 5

**Cross-round parameter reuse (Hard Rule)**:
On subsequent rounds, reuse the source list / max_results / enrich confirmed in Round 1.
**Do NOT re-invoke `paper-source-selection` skill** unless the user explicitly asks to change
those parameters (e.g. "换数据源" / "改成 30 篇"). The confirmation checklist shown in the
new-keyword round only echoes Round 1 params plus the new keywords — it is a recap, not a
re-confirmation. This avoids burning an extra LLM turn + user wait time per round.

### Phase 4a: Citation Trace (Snowball)

```
snowball_search(paper_id="DOI:10.1234/example", direction="both", max_results_per_direction=30)
```

- "who cites this" → `direction="forward"`
- "what this paper cites" → `direction="backward"`
- default → `direction="both"`

Snowball results also land via `process_search_results` using the same handles path:

```
# snowball_search returns: {"_handle": "ps_xxx", "count": N, "papers": [...slim...], ...}
process_search_results(
  query="snowball: Training language models...",
  handles='["ps_xxx"]',
  enrich=true
)
```

Build the round summary from the returned stats.

---

## Phase 5: Search Complete

When the user says "done" / "完成", emit the final summary:

```
Search complete (N rounds total):
  Round 1 [keyword] "large language model alignment" → 89 papers
  Round 2 [keyword] "RLHF reward modeling" → 56 papers
  Round 3 [citation trace] "Training language models..." → 28 papers
  ────────────────────────────────
  Raw total: 173 → New after dedupe: 134 candidates
```

---

## References

- [references/query-mapping.md](references/query-mapping.md) — keyword-to-API-parameter mapping rules
- [references/expansion-prompts.md](references/expansion-prompts.md) — concept-expansion prompt templates (for Phase 4 new-keyword discovery)

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| A source returns an error | Report the error, continue with other sources |
| Zero results | Suggest broadening keywords, removing year filter, trying a different source |
| JSONL write failure | Report the error path; do not block subsequent flow |
| `snowball_search` failure | Verify DOI/ID validity; suggest switching seed paper |
