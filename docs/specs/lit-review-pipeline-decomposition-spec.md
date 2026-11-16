> Historical research specification: preserves old design/data semantics and does not require new features or restored runtime wiring. Proactive research features are being wound down in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records govern completed and unaccepted scope.

<a id="综述链路能力拆解改造-speclit-review-pipeline-decomposition"></a>

# Literature Review Pipeline Decomposition Spec

> **Status**: draft · awaiting review
> **Related issue**: TBD (recommend tracking with an issue)
> **Related PR**: TBD
> **Domain language source of truth**: §11 here; `CONTEXT.md` becomes authoritative after terminology lands in `CONTEXT.md`
> **Affected packages**: `apps/electron/default-capability-packs/lit-review`, `apps/electron/default-skills/literature-review-result`, `apps/electron/src/main/lib/agent-prompt-builder.ts`

---

<a id="1-背景与问题"></a>

## 1. Background and Problems

<a id="11-现状链路turn-2"></a>

### 1.1 Current Chain (Turn 2)

After the user chooses a direction in ChoiceCard, the `lit-review` scenario Agent emits Turn 2 PLAN:

```
steps:        [ reader × N  (parallel, optional) ]
terminal_skill: literature-review-result
optional_followups: [ fact-checker ]
```

Main-Agent protocol (`agent-prompt-builder.ts` PLAN dispatch §step 4): **finish all `steps` before invoking `terminal_skill`**.

<a id="12-观察到的问题real-trace综述-3m58s-仍未出正文"></a>

### 1.2 Observed Problems (Real Trace: No Body After 3m58s)

| Symptom | Root cause |
|------|------|
| Reader uses `Read webfetch-…pdf` during close reading, downloading PDF from network | Reader tools are `Read/Glob/Grep/Bash/WebFetch`, **without wiki tools or `zotero_wiki_lookup`**, leaving WebFetch as the only full-text path |
| Same papers read twice | Reader fan-out reads PDFs, then `literature-review-result` Step 3 reads again through wiki (`papers_read_*`) |
| Slow chain, heavy main context | `Skill` runs reading **within main-Agent context**, consuming tokens and risking auto-compaction (acknowledged in skill Step 3 comments) |
| Worse source quality | Raw WebFetch PDFs are worse/more failure-prone than parsed structured wiki `.article.md` / `.txt` with `# OUTLINE` + `<p id>` anchors |

**Core problem**: reading is duplicated in reader and skill, and reader uses the wrong source.

<a id="13-设计决策已与-owner-确认"></a>

### 1.3 Design Decisions (Confirmed with Owner)

1. **Move all reading to reader**: add wiki tools, remove WebFetch, make reader the sole reader; skill no longer reads.
2. **Merge skill and synthesizer into one body-writer**: keep `literature-review-result` as sole body producer (terminal_skill), **retire `synthesizer` SubAgent**, and replace paper-set inputs with reader evidence rows.

---

<a id="2-目标与非目标"></a>

## 2. Goals and Non-goals

<a id="21-目标"></a>

### 2.1 Goals

- **Single reading source**: read once across the full review chain, only from structured wiki, with no WebFetch PDF downloads.
- **Separate reading/writing**: reader (isolated sandbox, haiku, parallel) reads and emits evidence; body-writer synthesizes without reading.
- **Lighter main context**: main sees compact evidence rows, not entire paper texts.
- **Consolidated roles**: one body producer (skill); remove duplicate synthesizer definition.
- Preserve behavior: `<cite data-ref="N"><q>…</q></cite>` contract, §1–§8 structure, fact-checker final review, persistence hooks.

<a id="22-非目标"></a>

### 2.2 Non-goals

- No Turn 1 direction proposal / `present_directions` ChoiceCard changes.
- No review persistence changes (`persistReviewsFromSessionCwd` / cwd scanner).
- No lit-search / EvidenceSet curation changes.
- No PDF parsing added (still handled by wiki async queue).
- No HTML-fragment rendering changes (DOMPurify + KaTeX + citation postprocessing).

---

<a id="3-现状能力盘点"></a>

## 3. Current Capability Inventory

<a id="31-literature-review-result-skill-的四步能力"></a>

### 3.1 Four Steps in `literature-review-result`

| Step | Capability | Tools |
|----|------|-----------|
| Step 1 | Intake & numbering (papers[] → fixed 1-based N) | — (pure logic) |
| Step 1.5 | Wiki resolution: identity → `mdPath/txtPath/articlePath/abstract` | `zotero_wiki_lookup` |
| Step 2 | Reading plan: bucket by fields (md-read / abstract-only / metadata-only) | — (pure logic) |
| Step 3 | Per-paper deep reading (outline-first) | `papers_read_outline` / `papers_read_article_section` / `Read(mdPath)` |
| Step 4 | Synthesize §1–§8 HTML + citation/quote/consistency checks + persistence; targeted citation checks | `papers_search_keywords` / `papers_read_context` / `Write` / `workspace_papers_list` |

<a id="32-现状-subagent"></a>

### 3.2 Current SubAgents

| SubAgent | Tools | Model | Current responsibility |
|----------|------|------|--------|
| review-proposer | Read/Glob/Grep | sonnet | 3 directions in Turn 1 |
| reader | Read/Glob/Grep/Bash/**WebFetch** | haiku | Per-paper reading (**currently WebFetch PDF**) |
| synthesizer | Read/Glob/Grep/Bash/Write/Edit/get_paper_meta | sonnet | Body fallback (**to retire**) |
| fact-checker | Read/Glob/Grep/Bash/WebFetch | haiku | Final citation review |

---

<a id="4-目标架构"></a>

## 4. Target Architecture

<a id="41-能力拆解映射skill-四步-&#45;新链路落点"></a>

### 4.1 Decomposition Map (Skill's Four Steps → New Locations)

| Original capability | New location | Explanation |
|---------------|-----------|------|
| Step 1 Intake & numbering | **Retain in body-writer (skill)** | N is citation truth and must be controlled by the final `<cite data-ref>` writer |
| Step 1.5 Wiki resolution | **Delegate to each reader for its paper** | Give `zotero_wiki_lookup`; parallel/self-contained; do not dispatch readers for abstract-only/no-source papers |
| Step 2 Reading plan/buckets | **Split**: assignment buckets in scenario PLAN / reader fallback; §8 summary in body-writer | Reader reports full / abstract-only / insufficient; body-writer aggregates §8 |
| Step 3 Deep reading | **Move wholly into reader** | Outline-first `papers_read_outline/section` (+ `Read(mdPath)` fallback), producing evidence |
| Step 4 Synthesis + citations + persistence | **Retain in body-writer (skill)** | Replace papers[] with evidence rows; retain `papers_search_keywords`/`papers_read_context` for targeted citations and `Write` |

<a id="42-角色重定义"></a>

### 4.2 Redefined Roles

**Reader (new)** — sole reader
- Tools: `zotero_wiki_lookup` + `papers_read_outline` + `papers_read_article_section` + `papers_search_keywords` + `papers_read_context` + `Read` (wiki `.md/.article.md/.txt` only).
- **Remove `WebFetch` / `Bash`**, preventing PDF downloads and improvised I/O.
- Input: one paper identity (`{ N, title, zoteroKey|doi }`) + direction blueprint excerpt.
- Behavior: resolve paths (`zotero_wiki_lookup`) → outline-first reading → multiple evidence rows covering method/result/limitation/key-number.
- Fallback (retain reader.md tiers, replace PDF with wiki): full → abstract-only → insufficient; report bucket.
- Model: haiku, parallel fan-out.

**Body-writer (= `literature-review-result` skill, absorbing synthesizer)** — sole body producer
- Tools: `workspace_papers_list` + `papers_search_keywords` + `papers_read_context` + `Write`.
- **Remove full-paper reading via `zotero_wiki_lookup` / `papers_read_outline` / `papers_read_article_section` / `Read(mdPath)`**, delegated to reader. Retain `papers_search_keywords` + `papers_read_context` only for byte-precise quote location/completion using reader locators.
- Input: `{ chosenDirection/blueprint, papers[](identity+N), evidenceRows[] }`.
- Behavior: Intake numbering → consume evidence → §1–§8 HTML (`<cite data-ref="N"><q>…</q></cite>`) → consistency checks → `Write` to `reviews/{ts}-{slug}.html`.
- Model: sonnet.

**Fact-checker** — unchanged (final traceability check for §1–§6 citations).

**Synthesizer** — **retired**: remove from manifest `subAgents`, delete prompt; body-writer absorbs synthesis of multiple reading outputs.

<a id="43-新-turn-2-数据流"></a>

### 4.3 New Turn 2 Data Flow

```
User chooses direction (present_directions → choice)
   │
 ① scenario Agent (Turn 2 planning) emits PLAN:
      steps: [ reader × N  (parallel, deep-readable papers only) ]
      terminal_skill: literature-review-result   ← input becomes { blueprint, papers[], evidenceRows[] }
      optional_followups: [ fact-checker ]
   │
 ② Main dispatches readers in parallel (one per paper)
      reader: zotero_wiki_lookup(self-resolve) → outline-first wiki reading → evidence rows[] (verbatim quote+locator+bucket)
      └ No wiki → abstract-only / insufficient, report bucket, never download PDF
   │
 ③ Main gathers all reader evidence → invokes literature-review-result
      skill: number → §1–§8 HTML from evidence (quote from rows; papers_search_keywords/read_context fills if needed)
             → consistency checks → Write reviews/{ts}-{slug}.html
   │
 ④ fact-checker final citation review
   │
 ⑤ Main one-sentence closure → run completes → persistence hook unchanged
```

---

<a id="5-交接契约evidence-row-&#45;cite-data-refnq"></a>

## 5. Handoff Contract: Evidence Row → `<cite data-ref="N"><q>`

The crucial decomposition contract: reader emits evidence rows; body-writer fills `<cite><q>` from them.

<a id="51-source_id-&#45;n-映射"></a>

### 5.1 source_id → N Mapping

- Dispatch prompt must include paper **1-based N** + identity; reader evidence `source_id` is paper `zoteroKey` (or `doi`).
- Body-writer holds papers[] (N + identity), looks up N via `source_id == zoteroKey/doi`, and writes `<cite data-ref="N">`.
- **Never reorder N**, preserving the skill's hard rule.

<a id="52-quote-长度语言连续性契约对齐关键缺口"></a>

### 5.2 Align Quote Length / Language / Continuity (Critical Gap)

Two current rules conflict and must align:

| Dimension | Evidence-row `QUOTE_RULE` (current) | Skill `<q>` (current) | **Unified (this spec)** |
|------|----------------------------------|--------------------|----------------------|
| Length | ≤25 words / ≤80 CJK | ≤240 CJK | Reader quote expanded to **≤240 CJK / ≤120 words**, matching `<q>` |
| Continuity | Unconstrained | **Single continuous span, no `…` bridging** | Reader also requires **single continuous span**, no `…`/trailing ellipsis |
| Language | Unconstrained | **Preserve source language, no translation** | Reader **preserves source language** (English paper→English quote) |
| Locator | Required (page/section/figure/line) | — | Still required; body-writer uses it to drive precise `papers_search_keywords` location |

> **Approved change**: add a **lit-review-specific quote rule** in `agent-prompt-builder.ts` (e.g. `{{evidenceSchema:read,litreview}}` placeholder / parameter), effective only for reviews: **≤240 CJK, continuous span, source language**, matching skill `<q>`. **Do not relax global `QUOTE_RULE`**, isolating impact from searcher/fact-checker/other consumers. Reader `quote` can directly fill body-writer `<q>` without another trim.

<a id="53-bucket-&#45;8-决策字段"></a>

### 5.3 Bucket / §8 Decisions

Reader reports per-paper bucket ∈ `{ deep-read | abstract-only | insufficient }` + brief reason (e.g. `outline-first via article` / `wiki parse not finished` / `not in wiki index`). Body-writer aggregates §8 Per-Paper Decisions using existing three-bucket wording.

<a id="54-多候选-quote-缓解-quote-claim-对齐"></a>

### 5.4 Multiple Quote Candidates Improve Quote–Claim Alignment

Reader does not know final narrative, so **emit multiple evidence rows per paper** (method/result/limitation/key-number) as a quote pool. For outside-pool quotes, body-writer uses `papers_search_keywords` + `papers_read_context` at reader locators for byte-level completion, without rereading whole papers.

---

<a id="6-改造点清单按文件"></a>

## 6. Changes by File

| File | Change |
|------|------|
| `default-capability-packs/lit-review/sub-agents/reader.md` | Wiki outline-first reading; replace PDF with wiki in fallback tiers; align quotes to §5.2; add bucket reporting |
| `default-capability-packs/lit-review/manifest.json` | Reader `tools` → `[zotero_wiki_lookup, papers_read_outline, papers_read_article_section, papers_search_keywords, papers_read_context, Read]` (remove WebFetch/Bash/Glob/Grep as needed); **remove synthesizer**; version bump |
| `default-capability-packs/lit-review/sub-agents/synthesizer.md` | **Delete** |
| `default-capability-packs/lit-review/scenario/system-prompt.md` | Turn 2 PLAN: reader fan-out only for deep-readable papers + mandatory N; terminal_skill `input` includes `evidenceRows[]`; remove synthesizer fallback, including R4/fallback wording |
| `default-skills/literature-review-result/SKILL.md` | Input evidence rows + paper identities; remove/replace full-paper Step 1.5/Step 2/Step 3 with evidence consumption; remove whole-reading tools, retain search_keywords/read_context/Write; `<q>` from evidence rows; version bump |
| `apps/electron/src/main/lib/agent-prompt-builder.ts` | `QUOTE_RULE` supports review rule per §5.2 (recommend b: lit-review-specific); update `agent-prompt-builder.test.ts` |

> ⚠ Built-in prompts are all English (CLAUDE.md §2); only built-in Agent/Skill prompts change, **no user-facing UI copy** or i18n keys. Historical convention: `agent-prompt-builder.ts` comments were to use Chinese.

---

<a id="7-兼容性与回退"></a>

## 7. Compatibility and Fallbacks

| Scenario | Behavior |
|------|------|
| Wiki parsing incomplete | Reader degrades to abstract-only from dispatch abstract; no PDF downloads; body-writer takes abstract-only path and marks limited evidence depth in §1 |
| Paper absent from wiki index | Reader reports insufficient; body-writer lists metadata-only in §7/§8, without §1–§6 citations |
| Skill unavailable (missing terminal_skill) | Synthesizer retired, **no fallback**: main **explicitly errors and asks retry**, without silent degradation (decision #2) |
| User @ local PDF | Existing behavior: §7 only, no parsing |
| Ad-hoc review (user @ several Zotero papers) | Still reader fan-out first → skill synthesis; skill no longer reads itself |

---

<a id="8-风险与缓解"></a>

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|------|
| **Weaker quote–claim alignment**, reader reads before knowing narrative | §5.4 multiple evidence candidates + body-writer byte-level completion + fact-checker final review |
| **Inconsistent quote lengths** cause `<q>` truncation/location failure | §5.2 ≤240 CJK + continuous span + source language; isolate through lit-review-specific rule |
| **N mapping mismatch** (source_id↔N) | Mandatory N in dispatch; body-writer uses papers[] as N truth, independent of reader numbering |
| **Reader concurrency** overwhelms MCP/wiki | Existing fan-out concurrency limit; one `zotero_wiki_lookup` per paper |
| **Synthesizer retirement** loses fallback | §7 explicit error/retry instead of silent degradation |
| Behavior regressions (citations/structure/persistence) | Compare same EvidenceSet before/after and fact-checker verified/flagged counts |

---

<a id="9-实施步骤建议分-pr"></a>

## 9. Implementation Steps (Suggested PRs)

1. **PR-1 Contracts** ✅: add lit-review quote rule in `agent-prompt-builder.ts` (`{{evidenceSchema:read,litreview}}`, ≤240 CJK + continuous span + source language + bucket); tests. Electron `0.1.382→0.1.383-rc.1`.
2. **PR-2 Reader** ✅: `reader.md` wiki sources + litreview quote rules + buckets; `manifest.json` reader removes WebFetch, adds `zotero_wiki_lookup`+`papers-rg`. Pack `0.2.2→0.2.3`, electron `→0.1.384-rc.1`. ⚠ Actual `bun run dev` run needed to confirm no `webfetch-*.pdf`.
3. **PR-3 Body-writer consolidation** ✅: `SKILL.md` input `papers[]+evidenceRows[]`, Workflow 4→3 steps (remove Step 1.5/2/3 reading), slim tools (remove outline/section reads + Read + zotero_wiki_lookup, retain search_keywords/read_context/workspace_papers_list/Write), skill `0.20.2→0.21.0`; `scenario/system-prompt.md` Turn 2 PLAN includes `evidenceRows[]` + reader N + removes synthesizer fallback (error/retry); remove `synthesizer` (manifest + `synthesizer.md`), pack `0.2.3→0.2.4`.
   - **Necessary related changes beyond original §6**: `synthesizer` exists only in lit-review (`buildBuiltinAgents` returns `{}`, no independent built-in); leaving it in master "My Team" would dispatch a nonexistent SubAgent. Update `agent-prompt-builder.ts` Section 5 (4-person→3 + skill body-writer), `STATUS_FLOW` return edge to skill, and `agent-prompt-builder.test.ts` / `default-capability-packs-load.test.ts` (4→3 workers). Electron `→0.1.385-rc.1`.
   - **Untouched**: `REVIEW_SOURCE_CAPABILITY='asci-core-synthesizer'` (stable persistence identity; changing breaks historical reviews); `paper-meta-cap-hook.ts` (get_paper_meta guard, lazy/harmless after retirement, possibly used by lit-search); historical comments in review-artifact-parser / persistence / litreview-ipc.
4. **PR-3.5 Prohibit supplemental retrieval during reviews** ✅ (trace-exposed overreach): main dispatched `lit-search` (searcher + relevance-scorer) in Turn 2, violating R2. R2 only constrained the scenario Agent, not main's cross-pack routing. Two-part fix:
   - Add **No retrieval during a review (hard rule)** to `agent-prompt-builder.ts` review-writing intent: prohibit rerouting lit-search/searcher/retrieve/search_* during review; use existing papers and mark limited scope, or ask user—never silently fold retrieval into review turns.
   - Add `do_not` to `scenario/system-prompt.md` Turn 2 PLAN + direct "Hard rule for the executing (main) Agent" (main reads PLAN, stronger than scenario-local R2).
   - Add regression tests asserting hard-rule tokens. Pack `0.2.4→0.2.5`, electron `→0.1.386-rc.1`.
5. **PR-4 Regression validation**: compare quality + latency (remove double reading, significantly reduce Turn 2 wall clock, no lit-search/searcher in Turn 2).

Each PR increments corresponding package patch (manifest pack version, skill version, electron package version).

---

<a id="10-验收done-when"></a>

## 10. Acceptance (Done When)

- [ ] Turn 2 trace **no longer contains** `Read webfetch-*.pdf`; reader uses wiki only.
- [ ] Same paper **read once** (reader, not skill).
- [ ] Body-writer lacks full-paper reading tools; reader lacks WebFetch.
- [ ] `synthesizer` removed from manifest/filesystem, without remaining chain references.
- [ ] `<cite data-ref="N"><q>…</q></cite>`, §1–§8 structure, §7/§8, and consistency checks preserved; fact-checker still performs final review.
- [ ] `bun run typecheck` + `bun test` (including `agent-prompt-builder.test.ts`) pass.
- [ ] Same EvidenceSet before/after: citation traceability maintained and Turn 2 faster.
- [ ] Affected versions incremented; `simplify` review completed.

---

<a id="11-领域语言拟落-contextmd"></a>

## 11. Domain Language (Proposed for `CONTEXT.md`)

| Term | Definition |
|------|------|
| **Body-writer** | Sole review body (§1–§8 HTML fragment) producer, the `literature-review-result` skill; absorbs synthesizer, synthesizes without reading |
| **Evidence row (read state)** | Reader-produced structured evidence: `{ claim, source_id, locator, quote, confidence, status:read, bucket }`, reader→body-writer handoff unit |
| **deep-read / abstract-only / insufficient** | Three per-paper reader buckets determining §1–§6 citation eligibility and §8 decisions |
| **Structured wiki source** | Async wiki outputs `.article.md` (LLM-enhanced) / `.txt` (structured parse), with `# OUTLINE` + `<p id="pS_P">` anchors; sole permitted review-reading source |

---

<a id="12-决议记录已与-owner-确认"></a>

## 12. Decision Record (Confirmed with Owner)

| # | Decision | Location |
|---|------|------|
| 1 | **Quotes**: reader `quote` follows skill `<q>`: **≤240 CJK + continuous span + source language**; implement **lit-review-specific placeholder**, without relaxing global `QUOTE_RULE` | §5.2 |
| 2 | **After synthesizer retirement**: no fallback; **error/retry**, no silent degradation | §7 |
| 3 | **Reader tools**: **retain `Read`** only for anchorless raw `mdPath` fallback; main path `papers_read_*` | §4.2 / §6 |
| 4 | **Deep-readable buckets**: **PLAN coarse filter (known review-proposer blueprint) + reader fallback** | §4.3 / §5.3 |
