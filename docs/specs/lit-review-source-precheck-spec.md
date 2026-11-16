> Historical research specification: preserves old designs and data semantics, not requirements for current new features or restored runtime wiring. Active research capabilities are retiring in batches under the [retirement specification](./2026-11-10-research-retirement.md); execution records determine actual completion and unaccepted scope.

<a id="lit-review-源可用性预检-&#45;全-abstract-快路径-spec"></a>

# lit-review Source Availability Precheck + All-Abstract Fast Path Spec

> **Status**: draft · awaiting review
> **Related milestone**: 0.3.x
> **Domain language sources of truth**:
> - Reading-budget allocator: `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-triager.md`
> - Orchestration (Turn-2 PLAN): `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`
> - Final artifact (abstract-only fallback): `apps/electron/default-skills/literature-review-result/SKILL.md` (§Input Contract / §Error Handling)
> - Wiki parse-state source: `apps/electron/resources/zotero-mcp/tools/wiki-lookup.ts` (`inIndex` / `parseStatus` / `mdPath` / `articlePath` / `txtPath` / `abstract`) + `~/.asci/zotero/wiki/index.json`
> **Preceding specs**: `lit-review-pipeline-decomposition-spec.md` (reader as sole reader), `lit-review-turn2-orchestration-robustness-spec.md` (L1/L2/L3 compaction defenses), `lit-review-finalize-fast-path-spec.md` (deterministic finalization gate)

---

<a id="1-背景问题不在写在没先看有没有源"></a>

## 1. Background: Missing Source Checks Before Writing

After users select a direction, review Turn-2 **directly plans reader fan-out**, with **no upfront check for readable full text (parsed Zotero PDF wiki sources)**. Each reader independently discovers source availability late through `zotero_wiki_lookup`, N times, after deciding to dispatch N readers.

<a id="11-真实失败2026-06-30-trace"></a>

### 1.1 Actual Failure (2026-06-30 Trace)
A review run over **lit-search results** (`openalex` source, `doi` but no `zoteroKey`, absent from Zotero, no wiki source):

| Symptom | Root cause |
|------|------|
| All 22+ papers `abstract-only`; reader fan-out becomes abstract rearrangement into evidence JSON | Entire input has no sources but pipeline still forces fan-out |
| Main Agent manually builds 10 abstract-filled reader prompts → main-loop growth → **compaction** | **No all-unsourced → write directly from abstracts branch**, forcing improvisation |
| Compaction loses orchestration state → **stops without review** | Same: pipeline lacks a path for this scenario |

<a id="12-两条根因本-spec-只解其一"></a>

### 1.2 Two Causes; This Spec Addresses One
- **(A) Routing / DIY**: master never enters lit-review scenario (treats search results as an EvidenceSet and improvises). **Routing fallback issue, outside this spec** (separate routing-guard).
- **(B) Missing source precheck + all-abstract fast path**: even correctly routed, all-unsourced sets lack a clean path. **This spec addresses (B).**

<a id="13-已确认的产品决策"></a>

### 1.3 Confirmed Product Decision
**Search-only papers not in Zotero (search abstracts only) must still produce reviews**; an abstract-based overview review is a **first-class mode**, not merely a fallback.

---

<a id="2-目标-&#45;非目标"></a>

## 2. Goals / Non-Goals

**Goals**
1. After direction selection and before reader planning, **one deterministic precheck** of papersInScope source availability (readable / abstract / none).
2. **No readable sources (allUnreadable) → skip all reader fan-out**; dispatch body-writer directly using `papers[].abstract` through the skill's existing abstract-only path. **Zero readers, zero main-loop growth.**
3. **Partially readable** → readers only for readable subset; unreadable papers use abstracts without readers.
4. Correctly populate `papers[].abstract` for search-only papers.

**Non-goals**
- No routing / DIY fix (cause A, separate work).
- No reader / skimmer / fact-checker internal changes.
- No abstract-only fallback implementation changes (already exists but unreachable).
- No Turn-2 external retrieval (the no-corpus-expansion rule remains).

---

<a id="3-设计"></a>

## 3. Design

<a id="31-把预检并进-evidence-triager并提升为永远先跑的-turn-2-入口步"></a>

### 3.1 Merge Precheck into `evidence-triager` as the Always-First Turn-2 Entry

Rationale: triager already decides how each paper is read before readers; source availability and deepRead versus light are the same kind of decision. Scenario planning cannot call tools (`system-prompt.md` L14), so dispatched sub-Agents must precheck. Add no agents, consistent with simplification.

Changes:
- **Remove gate**: current `when: "papersInScope.length > 10"` → **always run**. Every size needs precheck; semantic reading budgets still apply only to large readable subsets (small sets all deepRead).
- **Redefine responsibility**: triager = **source availability precheck + reading-budget allocation**, checking first, allocating only among readable papers.

<a id="32-确定性-parse-statuszotero_wiki_lookup_batch-已实现pr-1"></a>

### 3.2 Deterministic Parse Status: `zotero_wiki_lookup_batch` (✅ Implemented, PR-1)

Current triager has only `papers_semantic_search`: **semantic retrieval cannot determine PDF-source availability** (unindexed papers all zeroHit, confused with sources that have no matching hits; the current blind spot).

Add a **batch wiki lookup tool** (deterministic, reads the same `~/.asci/zotero/wiki/index.json`, **loads index only once**).

**Reuse `zotero_wiki_lookup` core, not `zotero_get_collection_items`.** The latter uses Zotero Web API, returns metadata abstracts, never reads the wiki index, and is collection-based (cannot express arbitrary subsets or non-Zotero search results): three mismatches. `wiki-lookup.ts` extracts shared `resolveOne(idx, input)` for both single `handleWikiLookup` and batch `handleWikiLookupBatch` → **`results[i]` matches single lookup field for field**.

```
mcp__zotero__zotero_wiki_lookup_batch({
  items: [{ zoteroKey?, doi?, title?, authors?, year? }],   // 1..N；单篇=长度 1
  page?: number,      // 1-based，默认 1
  pageSize?: number   // 默认 50，上限 500
})
  → { results: WikiLookupResult[],   // 与该页 items 切片逐一对齐
      page, pageSize, total, hasMore, indexAvailable }
```

- **Generality (user request)**: single lookup = `items` length 1; batch = multiple; `page`/`pageSize` pagination + `total`/`hasMore` for loops. `WikiLookupResult` is the single-result structure (`found` / `inIndex` / `parseStatus` / `mdPath` / `articlePath` / `txtPath` / `abstract` / `reason` …).
- **Readable decision**: use `result.found` directly (`found:true ⇔ parseStatus==='completed' 且有可读路径`, meaning completed with a readable path). Triager classifies readable / abstract (`!found && abstract` available) / none.
- **Registration**: pure MCP server tool in `resources/zotero-mcp/server.ts` (tools list + dispatch switch), **no four-layer IPC** (SDK-launched stdio MCP server, not renderer IPC). Add tool name to `evidence-triager`'s `tools`.
- **Later migration (user proposal, outside this PR)**: after stabilization, gradually replace other single `zotero_wiki_lookup` calls with `..._batch` (`items:[one]`) to reduce repeated index loading; field-identical results make this mechanical.

<a id="33-triager-输出-schema-增量"></a>

### 3.3 Incremental Triager Output Schema

Extend existing `{ scopeNote, deepRead, light, zeroHit, perChapterTopHits }` with:

```jsonc
{
  "sourceAvailability": {
    "readable":   ["<attachmentKey|N>", ...],   // found=true，有可读全文源 → 进 reader
    "unreadable": ["<...>", ...]                 // 其余（parse pending/failed / 不在索引 / 无源）→ 不进 reader
  },
  "allUnreadable": true,                          // readable 为空 → 触发快路径
  "deepRead": [...],   // 仅在 readable 子集内分配（不可读的不进来）
  "light":    [...]    // 同上
}
```

- Allocate `deepRead` / `light` **only within `readable`**; no readers for `unreadable`.
- `allUnreadable === (readable.length === 0)`; when true, triager **does no semantic search**.
- `readable` = batch lookup `found:true` (deterministic, independent of semantics).
- Leave **abstract-only vs metadata-only** subdivision of `unreadable` to the skill (§8 Per-Paper Decisions already checks `papers[].abstract`); triager does not need abstracts, keeping input compact.
- If semantic tools are unavailable (keyword-only) or all degraded, precheck still runs (parse status is independent); only `deepRead/light` falls back to all readable deepRead.

<a id="34-scenario-turn-2-分叉核心"></a>

### 3.4 Scenario Turn-2 Branching (Core)

Move triager to **always-run first step** of Turn-2, then choose one plan from its output:

**Branch 1 — `allUnreadable: true` (the emphasized search-only scenario)**
PLAN **contains no reader / skimmer steps**; `terminal_subagent = body-writer`, and input `papers[]` **must include `abstract`**. Body-writer invokes the skill's **existing** abstract-only fallback (`SKILL.md`: no rows + abstracts → write from `papers[].abstract`, §8 all abstract-only / metadata-only). Make the final evidence-depth notice (already wired in package 2) maximally prominent.

**Branch 2 — readable papers exist**
- Reader fan-out **only for `readable`** (triager.deepRead); skimmer handles the readable light tail as before.
- **No readers** for `abstract` / `none`; pass them directly to body-writer `papers[]` as abstract-only (with abstracts).
- Other orchestration (escalation reader, body-writer, fact-checker) remains unchanged.

> Both branches **retain triager**, so `lit-review-terminal-skill-guard` arm signals (reader/triager/skimmer dispatch) remain valid in both; the fast path does not disarm pending review generation.

<a id="35-纯检索-abstract-的灌入点确定性线程透传禁止-re-fetch"></a>

### 3.5 Search-Only Abstract Injection (Deterministic: **Thread Passthrough, Never Refetch**)

Abstracts for `none`/`abstract` papers must reach `papers[].abstract` **only from already-held data**, never fetched again:
- **Owned / Zotero-found papers**: use the `abstract` field already returned by triager's `zotero_wiki_lookup_batch`.
- **Search-only papers (outside workspace)**: absent from `workspace_papers_list` → **scenario passes abstracts verbatim from search results (EvidenceSet / `search_papers` hits / each `report-data.json` paper's `abstract`) at Turn-1→Turn-2 into `papersInScope.{abstract?}`, through to body-writer `papers[].abstract`**. This is branch 1's sole evidence source.
- **Hard ban: no bulk abstract filling through `get_paper_meta`**. `paper-meta-cap-hook` caps `get_paper_meta` at **3 calls/turn** (single-paper cross-pack gap-fill only); N>3 silently fills just 3 papers, leaving others empty.
  > **Confirmed in an actual 2026-07-01 allUnreadable run**: for 8 search-only papers, the main Agent improvised 8 `get_paper_meta` calls → cap allowed only 3 → just 1 usable abstract, producing a review from 1 real abstract + 7 metadata-only papers. The Agent's “openalex 503” explanation was wrong; **the deterministic cause was the 3/turn cap**. This section's fix is thread passthrough without refetching.
- Papers without abstracts → metadata-only (§8 listing), **no fetch loop**.

<a id="36-与现有组件的衔接不改它们"></a>

### 3.6 Existing Component Integration (Unchanged)
- **Skill**: abstract-only fallback exists (`SKILL.md` §Input Contract: empty/absent AND no .context cache → use papers[].abstract; plus §Error Handling). This spec **makes it reachable**.
- **Three guards**: structure-lint / factcheck / terminal-skill unchanged; fast path still creates `reviews/*.html`, dispatches fact-checker, and arms terminal-skill-guard via triager.
- **Reader**: none in branch 1; readable only in branch 2; internal reader fallback remains redundant protection.

---

<a id="4-影响面与改动清单"></a>

## 4. Impact and Change Inventory

| File | Change | Priority |
|------|------|------|
| ✅ `apps/electron/resources/zotero-mcp/tools/wiki-lookup.ts` (extract `resolveOne` + add `handleWikiLookupBatch` / `wikiLookupBatchToolDefinition`) + `server.ts` registration + `wiki-lookup-batch.test.ts` | §3.2 batch tool (**PR-1 complete**) | P0 |
| ✅ `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-triager.md` | §3.1 always run + §3.2 batch parse status + §3.3 readable/unreadable + allUnreadable schema (**PR-2 complete**) | P0 |
| ✅ `apps/electron/default-capability-packs/lit-review/manifest.json` | Add `zotero_wiki_lookup_batch` to evidence-triager `tools`, rewrite description; pack `version` → 0.2.16 (**PR-2**) | P0 |
| ✅ `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md` | §3.4 Turn-2 allUnreadable branch + ungate triager + §3.5 abstracts + comprehensive-section alignment + new hard rule (**PR-2**) | P0 |

i18n: builtin English prompts / tool descriptions only, no i18n keys; triager/scenario prompt changes **must remain English** (CLAUDE.md §2; CJK fails the loader hard gate, see prompt-slim lessons).

---

<a id="5-验证"></a>

## 5. Validation

- **Unit tests**: `zotero_wiki_lookup_batch` returns correct `hasReadableSource` for completed / pending / not-in-index / doi-only; triager schema contains `sourceAvailability` + `allUnreadable`.
- **Loading**: `default-capability-packs-load` passes (triager tools / schema changes).
- **Actual runs (manual, not self-verifiable headlessly)**:
  1. **All unsourced** (search-only set) → **0 readers**, direct body-writer abstract-only review, §8 labels all papers, evidence-depth notice, **no compaction or hang**.
  2. **Mixed** (parsed owned + search papers) → readers only for readable; abstract papers appear in §1–§6 (abstract `<q>`) or §8, with compliant citation structure.
  3. **All readable** → same existing behavior, no regression.
- `bun run typecheck` / `bun test` pass.

---

<a id="6-排期-&#45;拆-pr"></a>

## 6. Scheduling / PR Split

1. ✅ **PR-1 (tool)**: `zotero_wiki_lookup_batch` + unit tests. **Complete** (shared `resolveOne`, single/batch/pagination, 29 tests and typecheck pass). Independent, mergeable first.
2. ✅ **PR-2 (orchestration)**: ungate triager + parse status (`..._batch`, readable = `found`) + new schema; Turn-2 branch + abstract injection. **Complete** (46 pack loading/contract tests + typecheck pass). Depends on PR-1. **Actual-run regression still manual** (§5).

---

<a id="7-风险与回退"></a>

## 7. Risks and Rollback

- **Missing abstracts**: branch 1 without `papers[].abstract` → all `none` → skill stops with “lack readable material.” **Mitigation**: hard injection requirement in §3.5 + actual-run case 1.
- **False readable**: permissive `hasReadableSource` dispatches readers without sources → their own fallback prevents fatal failure but wastes a reader. Strictly use `parseStatus==='completed' && 有路径` (completed and path exists).
- **Fallback**: missing/erroring batch tool → triager skips precheck, `allUnreadable=false`, reverting to current all-paper reader fan-out without breaking existing paths.
- **Out-of-scope routing/DIY**: master improvisation bypassing the pipeline is not blocked; needs separate routing-guard (detect consecutive manual readers without lit-review PLAN → force routing).
