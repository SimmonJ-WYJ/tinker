> Historical research specification: preserves old designs and data semantics, not requirements for current new features or restored runtime wiring. Active research capabilities are retiring in batches under the [retirement specification](./2026-11-10-research-retirement.md); execution records determine actual completion and unaccepted scope.

<a id="大集合综述10-篇读取链路优化批量轻证据抽取器-&#45;reader-数封顶-设计规格"></a>

# Large-Set Reviews (>10 Papers): Batch Light-Evidence Extraction + Reader Count Cap Design

> Note: trigger threshold and deepReadCap **reduced from 20/15 to 10/8** for faster vector-store validation; escalation cap remains 5. Numbers below are updated.

- Status: draft (awaiting review; three core parameters confirmed with the user)
- Related issue: (to be created)
- Related PR: (to be created)
- Domain language source of truth: `CONTEXT.md` (reader / evidence-triager / semantic retrieval / EvidenceSet)
- Related specs: `lit-review-reader-evidence-cache-spec.md` (.context cache, orthogonal and reused),
  `lit-review-evidence-enrichment-spec.md` (coverage enrichment, orthogonal)

<a id="context为什么做"></a>

## Context (Why)

Review Turn 2 starts **one reader per paper** for large sets: 30 papers → 30 readers, 40 → 40. Each independent sub-agent
has fixed overhead (system prompt + reader.md ~2–3k tokens + tool schemas), regardless of reading depth. **At 40 papers,
reader count × overhead becomes the main cost** (~80–120k tokens for fixed prompts alone), with linear agent growth.

Existing `evidence-triager` separates large sets by per-chapter semantic relevance into `deepRead` (core) / `light` (tail), but **each tail paper still gets
a reader**, merely reading less: depth falls, reader count does not.

**Goal**: consolidate extraction for ~N–K tail papers from N–K parallel readers into **one batch extractor**, reusing triager vector-hit
anchors to read small context windows per paper and produce verbatim evidence rows; readers only for **core papers + a few with insufficient vector coverage**.
Reader count falls from **O(N)** to **O(deepReadCap + escalation cap)**, independent of total papers.

<a id="已确认的核心参数用户拍板"></a>

## Confirmed Core Parameters (User Decisions)

1. **Uniform policy**: every review with `papersInScope > 10` **uses the batch extractor** for the tail, without size tiers.
2. **`deepReadCap = 8`**: at most 8 core papers receive full readers.
3. **Escalation cap = 5**: at most 5 insufficiently covered papers get additional readers; prioritize the top 5 and retain
   batch-generated light evidence for the rest (decision 4).

<a id="触发门控"></a>

## Trigger Gates

- Enable only for **`papersInScope > 10` and search mode `vector` / `both`**.
- Keyword-only `papers-rg` → skip triager entirely → **full readers for all**, without optimization.
- `papersInScope ≤ 10` → current behavior, all readers.

<a id="关键事实已核实"></a>

## Verified Facts

| Fact | Source |
|------|------|
| Triager does not read papers; per-chapter semantic ranking outputs `deepRead[]`/`light[]`/`zeroHit[]`/`perChapterTopHits` | `evidence-triager.md` |
| Each `perChapterTopHits` entry has only `{paperId, score, snippet≤120字}` (120-character snippet), **dropping `anchorStart`** | `evidence-triager.md:32-39` |
| `papers_semantic_search` hits **already return `anchorStart`/`anchorEnd`** (paragraph `p<sec>_<para>` or byte `b<offset>`); vectorization stored anchors | Actual trace + `reader.md` semantic jumping section |
| Anchors feed read tools directly: `p<sec>_<para>`→`papers_read_article_section`, `b<offset>`→`papers_read_context` | `reader.md` |
| Snippets may truncate; **never use directly as `<q>`**; read anchor context for a continuous span | `reader.md`, SKILL `<q>` contract |
| `source_id` must be parent item key, not attachmentKey, or citation mapping breaks | Cache-spec fix |
| Reader Step 0 cache hit in `.context` skips everything | Cache spec |
| Guard tests assert lit-review sub-agent roster; update when adding agents | `default-capability-packs-load.test.ts:52` |

<a id="锁定的设计决策"></a>

## Locked Design Decisions

<a id="1-turn-2-大集合编排三层"></a>

### 1. Three-Layer Large-Set Turn-2 Orchestration

```
① evidence-triager (1, existing, add anchorStart passthrough)
     Per-chapter papers_semantic_search (paperIds locked to scope) → rank
     Output: deepRead[] (top-8), light[] (rest), perChapterTopHits (anchorStart per hit)

② Core deepRead (≤8 parallel readers)
     Full outline-first close reading (unchanged), preserving core review quality.

③ Tail light (1 new evidence-skimmer sub-agent, serial)
     Input: light papers + per-chapter hit anchors (triager perChapterTopHits)
     Per paper: papers_read_context / papers_read_article_section small windows at anchors
            → continuous verbatim span → evidence rows (source_id=parentItemKey)
     Coverage decision (decision2):
       · Sufficient → evidence rows + write .context cache
       · Insufficient / missing §5 gap signals → do not approximate; needsDeepRead[]
     Output: evidenceRows[] for covered tail papers + needsDeepRead[]

④ Escalation needsDeepRead (≤5 targeted readers)
     Only these papers get outline + uncovered target sections (targeted deep read).
     If needsDeepRead >5 → triager-hit-strength top-5; others retain batch light evidence
     (still citable, but §8 labeled "skim-only, limited coverage").
```

terminal_skill (`literature-review-result`) consumes **all** evidenceRows normally (core readers + skimmer + escalated readers).

**Agent count (40 papers, K=8)**: 1 triager + 8 readers + 1 skimmer + ≤5 escalations ≈ **≤15** (currently 41), saving ~30 reader overheads.

<a id="2-覆盖充分性判定skimmer-逐篇自检给弱模型一个清单"></a>

### 2. Coverage Sufficiency (Skimmer Per-Paper Checklist for Weaker Models)

For each light paper, skimmer requires:

- **At least 1** high-confidence verbatim evidence row read from context for every `targetChapters` chapter (its triager hits);
- 2–4 evidence rows per paper;
- **§5 gap fallback**: if `targetChapters` includes research-gap/limitations chapters (or direction emphasizes gaps), but hits lack limitation /
  future-work rows → **immediately add to needsDeepRead** (limitation sentences often miss vector top hits, the biggest semantic-first quality risk;
  do not settle for skimmer approximations).

Any unmet condition → `needsDeepRead`.

<a id="3-启用前提triager-透传-anchorstart不重新向量化"></a>

### 3. Prerequisite: Pass Through Triager `anchorStart` (No Revectorization)

- Add `anchorStart` to each `perChapterTopHits` entry, passing through values already received from `papers_semantic_search` but discarded.
- **No index/embedding changes or revectorization**: anchors already exist in the index and search returns them.
- Otherwise skimmer must repeat `papers_semantic_search` per paper, wasting queries. Retain
  `papers_semantic_search` only as a missing-anchor fallback.

<a id="4-质量护栏四条缺一不可"></a>

### 4. Four Mandatory Quality Guardrails

1. **Quote fidelity**: never use snippets as `<q>`; read anchor context for **one continuous verbatim paragraph span**.
2. **§5 gap fallback**: decision 2; escalate missing-gap papers rather than approximate.
3. **`source_id = parentItemKey`**, never attachmentKey.
4. **Cache first**: check `.context/{parentItemKey}.evidence.json` before each paper; cache hits skip reading/searching
   (highest-priority Step 0 short circuit); write skimmer light evidence back to `.context` too.

<a id="5-成本天花板与取舍诚实记录"></a>

### 5. Cost Ceiling and Tradeoffs (Honest Record)

| Layer | Limit | Parallelism |
|----|------|--------|
| Core reader | 1 outline + ~3 sections each | Parallel |
| Skimmer / paper | ≤3 small-window anchor reads (1–2KB each) | **Serial** (single agent processes ~K papers sequentially) |
| Escalated reader | Outline + uncovered sections; ≤5 | Parallel |

- **Tradeoff**: serial skimmer increases this step's wall-clock time versus parallel readers, in exchange for **far fewer tokens + capped agent count**.
  Small windows, ~25 papers × a few reads ≈ 100–150KB, fit one context.
- Frequent mistaken escalations by weak models still hit the hard ≤5 cap, avoiding mass readers.

<a id="落点文件"></a>

## File Locations

- `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-triager.md`: add `anchorStart` to each entry of the `perChapterTopHits` output
  schema (passthrough).
- **Add** `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-skimmer.md`: batch light-evidence extractor
  prompt (input contract, anchor-context reads, coverage decisions, §5 gap escalation, `source_id=parentItemKey`, cache read/write, serial processing,
  needsDeepRead output).
- `apps/electron/default-capability-packs/lit-review/manifest.json`: register `evidence-skimmer` sub-agent, tools
  `mcp__papers-rg__papers_read_context` / `papers_read_article_section` / `papers_search_keywords` /
  `papers_semantic_search` (missing-anchor fallback) + `Read` + `Write` (cache), `model: haiku`.
- `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`: change large-set Turn-2 PLAN branch:
  triager → deepRead reader fan-out (≤8, full, parallel) + 1 evidence-skimmer (tail); after skimmer returns
  `needsDeepRead`, dispatch ≤5 targeted readers; terminal_skill aggregates all evidenceRows. Pass fixed `deepReadCap` 8 and
  escalation cap 5.
- `apps/electron/default-capability-packs/lit-review/sub-agents/reader.md`: add targeted escalation reading (dispatch specifies
  selected chapters → outline + those sections); retire per-paper semantic-first light path (tail handled by skimmer).
- `apps/electron/src/main/lib/__tests__/default-capability-packs-load.test.ts`: add to lit-review roster assertion
  `evidence-skimmer` (6 → 7 agents).

<a id="分阶段"></a>

## Phases

- **Phase 1 (MVP)**: triager anchorStart passthrough + evidence-skimmer + manifest registration + large-set orchestration +
  targeted readers + guard updates. Capability-pack layer only, zero main-process / IPC / packaging changes.
- **Phase 2 (optional)**: finer skimmer relevance ranking; send Chinese sources directly to readers when semantic recall is weak.

<a id="验证"></a>

## Validation

1. `bun run typecheck` / `bun test` (new roster guard and no unresolved `{{}}` templates).
2. **Agent/token comparison (core)**: run the same 40-paper review with/without optimization; compare **reader/agent count, total
   tokens, wall-clock**. Expect agents ~41 → ~20, significantly fewer tokens, no judge-quality loss.
3. **§5 Gaps unchanged**: check tail-paper limitation/future-work enters review through gap escalation.
4. **Escalation + cap**: >5 light papers with insufficient vector coverage → only 5 extra readers, others retain skim evidence and
   §8 labels; escalated papers actually use targeted sections.
5. **Cache short circuit**: light papers with `.context` hits use cache without skimmer reads/searches.
6. **Quote fidelity**: every skimmer `<q>` is a continuous verbatim paragraph span locatable in source, not a truncated snippet.

<a id="未决"></a>

## Open Questions

1. **Serial latency**: if ~25 sequential papers excessively increase wall-clock, consider 2–3 parallel skimmer shards
   (trade some agent-count savings for latency). Measure a single skimmer first.
2. **zeroHit papers**: no-hit means vocabulary mismatch, not irrelevance; currently light → skimmer. Send directly to
   targeted readers instead? Prefer trying skimmer then escalating, using existing fallback.
3. **Score floor**: calibrate usable-hit thresholds on the real library; start with an empirical default.
