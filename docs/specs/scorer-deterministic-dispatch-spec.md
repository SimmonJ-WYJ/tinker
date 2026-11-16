<a id="scorer-确定性派发-specscorer-deterministic-dispatch"></a>

# Scorer Deterministic Dispatch Specification

> **Status**: implementation landed (judge + `score_window` + channel injection + orchestration removals/changes; unit/contract/typecheck all green) · awaiting full dev validation (flash/pro AC#1/#2) + review/PR
> **Related issue**: #745 (parallel scorer shards need harness-enforced single-batch dispatch)
> **Related PR**: TBD
> **Domain language source of truth**: §2; aligned with `docs/specs/parallel-scorer-shards-spec.md` (#689), `docs/specs/lit-scoring-agent-spec.md` (`score`)
> **Supersedes**: #689 §4.3 (scorer subagent form) + §4.4 (PLAN parallel dispatch)—see §6
> **Retains**: #689 §4.1 (server window/shard tools) + §4.2 (JSONL concurrent-write lock) **unchanged**

---

<a id="1-背景与根因"></a>

## 1. Background and Root Cause

During lit-search scoring, N=3 `scorer` shards marked `parallel: true` should dispatch concurrently in one orchestrator turn. Measurements on the weaker dev `deepseek-v4-flash` show **serial degeneration**: shard 0 → wait → shard 1/2, wasting a full round trip.

**Verified root cause**: single-batch parallel-group dispatch **relies entirely on prompt compliance, with zero code enforcement**.

- Prompt only: `agent-prompt-builder.ts:575` (“issue all their Task calls together in a single batch”); comments at `:555-556` acknowledge PLAN dispatch is advisory, not mandatory.
- SDK manages all Task dispatch internally; orchestrator (`agent-orchestrator.ts:1928-2051`) only forwards SDK messages serially. No code parses `steps[].parallel` to enforce concurrency.
- #689 §4.4 builds parallelism **on this prompt discipline**; #745 reports its failure.

<a id="11-为何不是方案-bguard或-issue-字面的方案-c"></a>

## 1.1 Why Not Option b (Guard) or the Issue's Literal Option c

Both rejected after code inspection (firsthand evidence):

- **Option b (PreToolUse guard) treats symptoms**: guards can check / deny / inject additionalContext, **not rewrite tool arguments, proxy execution, or collect multiple tool_use calls for batch dispatch within one turn** (`canUseTool` returns `PermissionResult = {behavior:'allow', updatedInput?} | {behavior:'deny'}`, SDK `sdk.d.ts:1779`). At most, request missing dispatch afterward; LLM retains dispatch control, so behavior remains probabilistic and fails model-independent AC.
- **Literal option c (harness takes over subagent dispatch) is blocked by SDK**: Task is an ordinary tool without parallel/barrier semantics or APIs to inject tool_use into the message stream. Harness dispatch on the Agent's behalf requires hacking SDK streams—high-risk, prone to deadlock, with no clean intervention point.

<a id="12-解法把打分下沉成确定性工具c-干净版"></a>

## 1.2 Solution: Move Scoring into a Deterministic Tool (Clean Version C)

The scorer subagent performs **only 2 LLM judgments**, `semantic` + `method` (`sub-agents/scorer.md` Step 1). Window rules, sharding, merging, other dimensions, and score writes are **deterministic Python server work**, already implemented in #689 §4.1/§4.2.

Replace 3 scorer agents each doing `get_scoring_shard` → LLM judgment → `apply_scoring` with **one new paper-search MCP `score_window` tool**: main Agent calls **once**; Python **deterministically** uses `asyncio.gather` to judge `semantic`/`method` concurrently, then reuses `apply_scoring` for score calculation and persistence.

**Remove the weak model's parallel-dispatch decision entirely**, since dispatch is no longer a step. Deterministic work belongs in deterministic code rather than Agents.

> **Architecture decision (2026-06-29, confirmed through O1)**: judging runs in **Python paper-search MCP**, not Node main-process service. ① Main has no direct paper-search MCP channel: it is an SDK-injected stdio child through mcp.json. ② Scoring logic is entirely Python (`select_scoring_window`, `get_scoring_shard`, seven-dimensional `score_record`, `_scoring_write_lock` in `process_service.py`); rewriting in Node causes drift. ③ Injecting child-process keys is existing practice (`paper-search.env` already carries academic-source keys). Node requires new Node→Python MCP client glue and is inferior. See §6.

<a id="13-设计判断scorer-为何下沉为确定性工具而非保留子-agent"></a>

## 1.3 Design Judgment: Why a Deterministic Tool Rather Than a Subagent

This **removes a subagent** from lit-search, raising two foundational questions. Conclusion: **it corrects a stage that should not have been agent-based; moving it does not remove LLM judgment**, rather than casually eroding capability-pack design.

**Criterion: what belongs in subagents vs deterministic tools?**

- **Subagents** suit **autonomous planning / multiround exploration / uncertain paths**, such as `searcher` deciding sources, rounds, and early stop.
- **Deterministic tools** suit **fixed workflows**, even with internal LLM calls.

Scorer is the latter: fixed rubric, only two fixed allowed tool calls (`get_scoring_shard` / `apply_scoring`), no multiround autonomous decisions, structured JSON output. Packaging a fixed procedure plus one LLM judgment as an agent is a design smell. **#745 arises directly from it**: obtaining LLM scoring requires an uncertain orchestrator-driven dispatch path.

**Clarification: deterministic tool does not mean no LLM.**

The two core judgments are **real LLM work** (`semantic` / `method`; `semantic` relevance cannot be reduced to rules), **fully retained** (§4.1 step 2: handler calls model API with rubric as system prompt). Only **orchestration** changes:

| Work | Owner | Change |
|--------|--------|------|
| Judge `semantic` / `method` for each paper | **LLM** | Unchanged, no papers omitted |
| Shard / concurrent model calls / persistence | Deterministic code | Improvised subagent dispatch → concurrent API calls in code |

Subagents bind judging intelligence to dispatch orchestration; moving scoring **decouples** them. LLM retains `semantic` and `method` judgment work, code handles deterministic work, consistent with using LLM only where intelligence is required.

**Counterargument recorded (why move now)**: the only substantive value of retaining a scorer subagent is **future extensibility**—full-text reading / verification / multiround reasoning might need agent flexibility while tools become rigid. Current scorer only judges two `abstract` dimensions, far from agent-level needs; this option value is speculative (YAGNI). Reintroduce an agent if evidence later warrants it, as a justified redesign rather than preserving an unjustified current form.

<a id="2-术语领域语言"></a>

## 2. Terms (Domain Language)

- **V2 scoring window / shard / scorer**: unchanged from #689 §2.
- **Scoring service**: new deterministic main-process module for concurrent per-shard semantic/method model judging and persistence, replacing scorer judgment duties.
- **`score_papers` tool**: in-process MCP tool for main orchestrator (`mcp__scoring__score_papers`), completing a round in one call.
- **`score_window` tool**: new paper-search MCP tool (`mcp__paper-search__score_window`), completing window selection → concurrent judging → persistence in one call, replacing 3 scorer subagents.
- **Judge module**: new Python paper-search module calling models for `semantic`/`method`—the scorer's only LLM duty moves here.
- **Judging rubric**: 0–100 semantic/method rules + constraints (missing abstract ≤50, field overlap ≤50 etc.), currently `scorer.md` Step 1, moved to judge system prompt.

<a id="3-目标与边界"></a>

## 3. Goals and Boundaries

After completion:

1. lit-search **user-visible scoring behavior stays the same** (after searcher, UI displays all sorted scores), but **one deterministic `score_window` call** handles scoring, with Python-internal deterministic shard concurrency using `asyncio.gather`.
2. **Works for both `deepseek-v4-flash` and `deepseek-pro`, independent of instruction-following strength** (core AC).
3. **Barrier semantics retained**: a failed/timed-out shard does not prevent other shards finishing/persisting (`asyncio.gather(return_exceptions=True)`).
4. Sequential steps unaffected, no regression.

**Hard boundaries**:

- Scoring model/channel **must match production main pipeline** (prod = `deepseek-pro`), reusing orchestrator channel + model resolution via env injection; no new model configuration surface.
- **Reuse Python scoring pieces unchanged**: `select_scoring_window` / `get_scoring_shard` slicing / `apply_scoring` / `score_record` (#689 §4.1/§4.2, including write lock); only model-judging layer is new.
- API keys use existing **paper-search env injection** (`paper-search.env` + `getConfigEnvForChildren`), same as academic-source keys, without new leakage patterns.

<a id="4-设计"></a>

## 4. Design

<a id="41-新增python-判分模块-paper_scoring_judgepy"></a>

### 4.1 New Python Judge `paper_scoring_judge.py`

`apps/electron/resources/paper-search-mcp/paper_search/service/paper_scoring_judge.py` (new)

Given candidates + research_question/method_terms/object_terms, call model for semantic/method and return `{handle:{semantic,method}}`.

- `async def judge_candidates(candidates, research_question, method_terms, object_terms) -> dict`:
  - Read `ASCI_SCORING_MODEL` / `ASCI_SCORING_BASE_URL` / `ASCI_SCORING_API_KEY` from env injected by main (§4.4).
  - System prompt = rubric (§4.3); user message = candidates `{handle,title,abstract,year}`.
  - Call **nonstreaming** messages endpoint (final JSON only, no SSE parsing), using `httpx.AsyncClient` (existing connectors use synchronous `requests`; add async HTTP for judging).
  - Parse `{handle:{semantic,method}}`; clamp missing/out-of-range values per rubric (missing abstract ≤50 etc.).
  - Timeout via `ASCI_SCORING_TIMEOUT_SEC`, `default` aligned with enrich scale; propagate errors for per-shard handling (§4.2).

<a id="42-新增mcp-工具-score_windowmcp_serverpy"></a>

### 4.2 New MCP `score_window` (`mcp_server.py`)

Register `@mcp.tool() async def score_window(...)` alongside `retrieve` / `apply_scoring`. Original comments specify JSON-array-string `method` terms, default 3 concurrent batches, existing round-robin window[i::n] slicing, independent gather failures, merge, locked `apply_scoring`, and return fields.

```python
@mcp.tool()
async def score_window(
    research_question: str,
    method_terms: str = "",      # JSON 数组字符串，与 retrieve 同形
    object_terms: str = "",
    shard_count: int = DEFAULT_SCORING_SHARD_COUNT,   # 内部并发批数，默认 3
    session_id: str = "",
    turn_id: str = "",
) -> dict:
    # 1. 读 JSONL → select_scoring_window(records, turn_id) → window（复用）
    # 2. round-robin 切 shard_count 批（复用 get_scoring_shard 的切片口径 window[i::n]）
    # 3. asyncio.gather(*[judge_candidates(批)...], return_exceptions=True) —— barrier
    #    每批独立调模型；某批 raise → 记 failed_shards，不阻断其余
    # 4. 合并各批 {handle:{semantic,method}}
    # 5. await apply_scoring(merged, session_id, turn_id) —— 复用，算 score + 写回 + 锁
    # 6. return {scored, missing, window_total, shard_count, failed_shards}
```

- Main calls `mcp__paper-search__score_window` **once**—deterministic, without parallel dispatch issues.
- Empty window (`window_total==0`): return `{scored:0, window_total:0, note}` without model call/error, preserving `scorer.md` semantics for reporting no candidates.
- Shards are internal **implementation details** (concurrent batch count), no longer visible PLAN steps.

<a id="43-判分-rubric-下沉"></a>

### 4.3 Move the Rubric

Extract `sub-agents/scorer.md` **Step 1 + Hard constraints** to a Python prompt constant (`paper_scoring_judge.py` or adjacent `judge_rubric.txt`), used by §4.1.

- Remove SDK-specific parts (Step 0/2 tools, Step 3 output language, tool allowlist), now deterministically handled.
- Retain all semantics (0–100 bands, missing abstract ≤50, field overlap ≤50, calibration anchors); **judgment quality unchanged**, same rubric/model.

<a id="44-模型渠道注入主进程-&#45;paper-search-env"></a>

### 4.4 Model Channel Injection (Main → paper-search env)

`apps/electron/src/main/lib/paper-search-integration.ts` + orchestrator resolution:

- Reuse orchestrator channel/model resolution (`agent-orchestrator.ts:607 buildSdkEnv` / `:1620` manifest aliases / `:1708` effectiveModelId + `channel-manager.decryptApiKey` / `getChannelById().baseUrl`) to obtain the **same source** model id + baseURL + key as subagents.
- Send `ASCI_SCORING_MODEL` / `ASCI_SCORING_BASE_URL` / `ASCI_SCORING_API_KEY` through existing `getConfigEnvForChildren` / mcp.json env injection.
- **Dev/prod judging models unchanged** (dev=flash, prod=pro; both work with deterministic dispatch).

<a id="45-删除改写scorer-子-agent-与-plan-协议"></a>

### 4.5 Remove/Rewrite Scorer Subagent and PLAN Protocol

- **Delete** `sub-agents/scorer.md` (decided, §7 O2).
- **Scenario `system-prompt.md:211`**: stop emitting 3 `parallel:true` scorer steps; after searcher/citation-explorer, main calls `mcp__paper-search__score_window` **once**. Remove “Parallel scorer shards,” “main Agent owns the parallel-group dispatch,” and scorer handoff descriptions (`research_question` etc. become tool inputs).
- **Retain** parallel-group mechanism in `agent-prompt-builder.ts:575` (O3: lit-review still uses `parallel:true`, `lit-review/.../system-prompt.md:44,91`); replace outdated “lit-search runs its V2 scorer shards” example with generic/lit-review example.
- Main `allowedTools`: **verified unchanged**—lit-search uses default mode; `resolveMasterAllowedTools` returns `undefined`, SDK allows all by default, as for `present_search_plan`.

<a id="5-验收对齐-issue-745-ac"></a>

## 5. Acceptance (Issue #745 AC)

| # | AC | How satisfied |
|---|-----|--------------|
| 1 | N≥2 shards start in one batch, all before any returns | `asyncio.gather` deterministically initiates all model calls, no dispatch/wait serial pattern |
| 2 | Both flash/pro, independent of model compliance | Python owns concurrency; model judges content only |
| 3 | Barrier: one failure does not prevent others | `asyncio.gather(return_exceptions=True)`, record `failed_shards` |
| 4 | No accidental parallelization/regression of sequential steps | Only scorer changes; retrieve/searcher/other PLAN steps untouched |
| 5 | Decidable verification + tests | Below |
| 6 | (Option b guard-specific, N/A) | No guard used |

**Tests**:

- Python (`score_window` / `judge_candidates`, mocked HTTP): ① concurrent batches merge/persist ② one raises, others complete, counted in `failed_shards` ③ empty window no model/error ④ clamp missing/out-of-range values ⑤ reused `apply_scoring` writes correct score, retaining #689 concurrent-write tests.
- Decidable verification (replacing JSONL dispatch-timestamp grouping): assert all N `judge_candidates` calls start before any returns, with mock timing/call order.
- Bun contracts: no parallel scorer PLAN steps, main tool allowlist includes `score_window`, `sub-agents/scorer.md` deleted.
- `bun run typecheck` / `bun test` + Python pass; affected package patch increments.

<a id="6-架构决策与-689-关系"></a>

## 6. Architecture Decision and #689 Relationship

<a id="61-架构决策判分落-python架构-bvs-落-node架构-a"></a>

### 6.1 Python (Architecture B) vs Node (Architecture A)

| | Architecture A (Node service) | Architecture B (Python, selected) |
|---|---|---|
| Judging runtime | Node main (`streamSSE`+`AnthropicAdapter`) | Python paper-search (`asyncio.gather`+`httpx`) |
| Window/shards/score writes | **New Node→Python MCP client** required | Already Python, **zero glue** reuse |
| Key | Stays in main | Existing env injection, like source keys |
| New costs | Node↔Python glue + turn_id/path coordination | Python model-calling capability (existing `requests`, new async `httpx`) |

**Choose B**: scoring logic is already entirely Python; most cohesive, no cross-process glue. A's reuse of Python tools requires an absent main-process MCP client (O1 evidence), inferior. Python gains LLM calling for the first time, but HTTP infrastructure exists, nonstreaming judging is simple, and key injection is established.

<a id="62-与-689-关系扩范围"></a>

### 6.2 #689 Relationship (Expanded Scope)

#745 originally excludes “scorer shard count (fixed 3), deliberate #689 design.” **Count stays 3 concurrent batches, but scorer dispatch changes from subagents to Python-internal concurrency and `sub-agents/scorer.md` is deleted**; this **scope expansion** is user-confirmed:

- **Retain #689** §4.1 `select_scoring_window`/`get_scoring_shard`, §4.2 `apply_scoring` concurrent-write lock unchanged.
- **Supersede #689** §4.3 scorer subagent and §4.4 PLAN parallel dispatch, the #745 root cause.
- State supersession in PR and add a pointer in `parallel-scorer-shards-spec.md`.

<a id="7-开放问题"></a>

## 7. Open Questions

- ~~**O1**: how does scoring service call Python tools?~~ **Verified 2026-06-29**: no direct main→paper-search MCP channel; switch to B, Python judging without cross-process calls (§6.1).
- ~~**O2**: delete scorer.md or keep fallback?~~ **Decided: delete** (§1.3).
- ~~**O3**: other consumers of parallel-group protocol?~~ **Verified 2026-06-29: yes, lit-review still uses `parallel:true` (`system-prompt.md:44,91`). Retain protocol; remove only lit-search scorer usage and update stale prompt-builder example.**
- **O4**: deliver #775 scorer progress (`已打分 X/Y`, “Scored X/Y”) here or retain only `score_window` return fields and separate #775? Prefer separate, preserving scope. Under B, progress returns only with the whole `score_window` tool (no intermediate subagent events); per-batch updates require an additional `score_window` push channel under #775.
- ~~**O5**: Python model auth headers/body?~~ **Verified 2026-06-29: nonstreaming Anthropic Messages API (Anthropic-compatible)**. Deepseek uses compatible endpoint (`deepseek-profile.ts` comments + `defaultProbeModel` Claude id + empty `extraHeaders`); subagent wire (`buildSdkEnv`) = `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN` (`Authorization: Bearer`). Judge uses httpx `POST {baseURL}/v1/messages`, body `{model, system, messages, max_tokens, stream:false}`, mirroring `AnthropicAdapter` without SSE. prod=`deepseek-v4-pro`, dev=`deepseek-v4-flash`.

<a id="8-实施顺序tdd"></a>

## 8. Implementation Order (TDD)

1. **Verify O5**: production `deepseek-pro` messages wire (endpoint/headers/body), align with `packages/core/providers/profiles`.
2. **Judge** (`paper_scoring_judge.py`): Python mocked-HTTP tests first → implement `judge_candidates` + §4.3 rubric.
3. **`score_window`**: concurrency/barrier/empty-window tests first → implement with `select_scoring_window`/apply_scoring reuse.
4. **Channel injection** (§4.4): orchestrator resolution + paper-search env.
5. **Orchestration changes** (§4.5): scenario PLAN + delete scorer.md + prompt-builder cleanup + allowlist.
6. **Contracts + full dev validation**, once each for flash/pro, confirming AC#1/#2.
