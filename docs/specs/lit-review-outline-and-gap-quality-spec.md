> Historical research specification: preserves old design/data semantics and does not require new features or restored runtime wiring. Proactive research features are being wound down in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records govern completed and unaccepted scope.

<a id="综述大纲质量提升-&#45;独立研究空白识别-设计规格"></a>

# Better Review Outlines + Independent Research-Gap Identification Design Specification

- Status: draft (awaiting review)
- Related issue: [#441](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/441)
- Related PR: (to be created)
- Domain language source of truth: `CONTEXT.md` (EvidenceSet / review direction / evidence row / reading bucket)
- Locked decisions (confirmed with user): ① research gaps use **minimal changes** (no new subagent; strengthen three existing locations); ② outline hierarchy uses **prompt-only changes** (no `LitReviewDirection` type / `present_directions` IPC / renderer changes)

---

<a id="context为什么做"></a>

## Context (Why)

From "0601 Test Feedback Summary," item 19 (Xuwu · OPTIMIZATION):

> English translation: Automatically generated outlines are poor, and literature reviews lack independent research gaps, reducing their credibility.

Two independent quality weaknesses:

1. **Outline quality**: generated outlines are **flat lists**, loosely structured with unclear hierarchy—no thematic grouping or logical progression.
2. **Research gaps**: reviews lack an **independent, evidence-based** research gaps / open problems section; it is either folded into conclusions or generic, undermining academic credibility.

<a id="现状管线改前"></a>

### Current Pipeline (Before Changes)

Review writing is a two-stage `lit-review` capability-pack workflow:

```
Turn 1  review-proposer ──► 3 candidate directions (title / thesis / outlinePreview=6 flat chapter titles / papersInScope)
            │                    └─► present_directions ChoiceCard (user chooses)
Turn 2  reader fan-out (single-paper deep reading, verbatim evidence rows including gap signals)
            └─► literature-review-result skill (§1–§8 HTML body-writer, no paper reading)
                    └─► fact-checker audit
```

<a id="两个短板的根因"></a>

### Root Causes

**Outline (review-proposer.md)**: current prompt enforces a **generic fixed skeleton**—

```
1. Background / context   2. Key studies / evidence   3. Methods / approaches
4. Results / outcomes     5. Limitations / open questions   6. Conclusions / future directions
```

This template groups by **section type** (background/method/results), independent of actual papers' **thematic clusters**, naturally producing flat lists: each chapter lists papers one after another, without thematic grouping or progressive argument. `outlinePreview` is only 6 flat heading strings and carries no hierarchy.

**Research gaps (literature-review-result/SKILL.md §5)**: §5 Gaps is currently **conditional** ("Only omit §5 entirely when the evidence genuinely contains no gap signal" / "do not fold it away"); in practice it often merges into §6 or becomes vague assertions. Causes:

- **No upstream planning**: review-proposer directions do not treat research gaps as first-class; §5 relies on skill improvisation, competes with §1–§4 in one generation, and is compressed.
- **Unstructured evidence**: readers are told "Always capture gap signals," but gap rows are neither explicitly labeled nor mandatory; on-the-fly mining by the skill has unstable recall.
- **Insufficient §5 constraints**: no required classification, cross-paper synthesis, or per-item `<cite>` traceability.

---

<a id="目标-&#45;非目标"></a>

## Goals / Non-goals

**Goals**

- G1 Generated outlines have **clear logic and hierarchy**: thematic grouping + progression, rather than flat Background/Methods/Results.
- G2 Reviews include an **independent** research gaps / open problems section; each conclusion **traces to read evidence rows**, without unsupported generalities.
- G3 Limit changes to built-in English prompts + versions, with zero model/IPC/renderer changes.

**Non-goals**

- No `LitReviewDirection` type, four-layer `present_directions` IPC, or `LitReviewDirectionsCard` rendering changes (decision ②).
- No new subagents (decision ①); no evidence-row schema changes (`{{evidenceSchema:read,litreview}}` fields unchanged).
- Preserve Turn 2's no-retrieval rule and readers' single-paper/no-cross-paper-synthesis boundary.
- No configurable review templates / multiple templates (outside this issue).

---

<a id="设计方案纯-prompt三处改-&#45;版本号"></a>

## Design (Prompts Only, Three Locations + Versions)

Hierarchy and progression apply at **two aligned levels**:

- **Outline (review-proposer)**: change direction `outlinePreview` from type-based to **theme + progression + dedicated gaps chapter**; besides `thesis`, use **structured blueprint text** (not a new field; in review-proposer dispatch response / scenario Turn-2 passthrough) describing chapter intent + relevant papers + gap dimensions.
- **Body (literature-review-result skill)**: §2–§4 use `<h2>` themes + `<h3>` subthemes for hierarchy and cross-paper synthesis instead of paper lists; §5 becomes **mandatory, structured, individually sourced**, and independent.

<a id="改动点-1-&#45;review-proposermd大纲主题分组-&#45;递进-&#45;规划-gap"></a>

### Change 1 — `review-proposer.md` (Outline: Themes + Progression + Gap Planning)

> File: `apps/electron/default-capability-packs/lit-review/sub-agents/review-proposer.md`

1. **Replace the generic skeleton in the entire Outline quality requirement section**. New English constraints require 6 `outlinePreview` chapters in **funnel-like thematic progression**, rather than section types:
   - Chapter 1: **frame** the field/problem (landscape / core question), not generic Background.
   - Middle 3: **thematic chapters clustered from actual read papers** (mechanisms / method families / applications / controversies), titles conveying each theme's argumentative role and ordered logically (surface→depth / consensus→disagreement / method→effect); **prohibit** pure type titles such as Methods / Results.
   - Chapter 5: **dedicated research gaps / open problems chapter**—make gaps first-class in Turn 1 planning, not an afterthought. Title must explicitly signal gaps / open problems.
   - Chapter 6: **Outlook / Conclusions**.
2. **Add Blueprint requirement**: ask review-proposer for **structured outline intent** beyond existing direction JSON fields. Existing `outlinePreview` cannot express hierarchy (decision ② forbids type extension), so emit a fenced `text` block **outside** JSON titled `## OUTLINE BLUEPRINT (dir <key>)` (only for scenario-to-skill passthrough in Turn 2, not ChoiceCard/types): one chapter per line `章号. 标题 — intent: <一句话本章论证意图>; papers: <N,N,N>; subthemes: <子主题A / 子主题B>` (chapter number/title, one-sentence argument intent, papers, subthemes); add `gap-dimensions: <方法/实证/理论/矛盾/未来工作 中适用的几项>` (applicable method/empirical/theory/contradiction/future-work dimensions) for gaps.
   - **Tradeoff**: decision ② prohibits data-model changes, so blueprint is a prompt-text contract rather than IPC field. Scenario Turn-2 PLAN's `terminal_skill.input` already says "chosen direction (title + thesis + 6-chapter outline / **blueprint**)"; materialize the existing passthrough slot with this text block, without changing system-prompt PLAN shape.
3. **Update Prohibited behaviors**: strengthen "Mixing the 6-chapter skeleton verbatim into all 3 directions" to failure for type-based Background/Methods/Results skeletons; add failure for missing a dedicated gaps chapter.
4. Retain exactly 3 directions, exactly 6 chapters, diversity requirement, papersInScope selection, no retrieval/fabrication.

<a id="改动点-2-&#45;readermd证据gap-信号强制-&#45;可识别"></a>

### Change 2 — `reader.md` (Evidence: Mandatory Recognizable Gap Signals)

> File: `apps/electron/default-capability-packs/lit-review/sub-agents/reader.md`

Existing line 122 says "Always capture gap signals when present." Strengthen to **mandatory and recognizable**, using `claim` text conventions without schema changes:

1. Upgrade "when present": **any source limitation / future work / open problem / untested assumption / contradiction with another paper must get its own row** (one verbatim `quote` + locator), never merged into positive method-effectiveness rows.
2. **Recognition convention**: gap-row `claim` begins with fixed English prefix `[gap:<kind>] …`, `<kind>` ∈ `limitation | future-work | open-problem | assumption | contradiction`. Body-writer can reliably retrieve §5 gap rows through plain text matching, without new fields.
3. `readMode: light` escalation already requires "a Discussion/Limitations/Conclusion section when the unmet need is a §5 gap signal"; retain and add: if skimmer escalated this paper for gaps, light mode must produce at least 1 `[gap:*]` row.

> Note: `evidence-skimmer.md` also handles gaps while reading tail papers, but this minimal change **strengthens reader only**; skimmer naturally follows `[gap:*]` through shared reader evidence rules, without separate prompt changes. If review requires guaranteed tail-paper gap recall, add one skimmer sentence (optional).

<a id="改动点-3-&#45;literature-review-resultskillmd正文层次化-24-&#45;强制结构化-5"></a>

### Change 3 — `literature-review-result/SKILL.md` (Hierarchical §2–§4 + Mandatory Structured §5)

> File: `apps/electron/default-skills/literature-review-result/SKILL.md`

**(a) Outline hierarchy (§2–§4)** — strengthen writing constraints in Section content:

- §2–§4 thematic chapters **must use `<h3>` subthemes from blueprint**, each synthesizing **across papers** (comparison/corroboration/disagreement); **prohibit** one-paragraph-per-paper summaries (reinforce existing "do not summarize one paper at a time" as a hard §2–§4 check).
- Chapters need **progressive transition sentences** reflecting the blueprint's argument; when blueprint text is supplied, §2–§4 `<h2>` titles/order **follow it**, never reverting to type-based skeletons.

**(b) Independent research gaps (§5)** — change conditional §5 to **mandatory by default + structured + individually sourced**:

1. **Mandatory**: §5 appears by default as an **independent** `<section id="s5">`; `<h2>` explicitly signals gaps (e.g. Chinese equivalent of "§5 Research Gaps and Open Problems" / "§5 Gaps & Open Problems"). **Never** merge into §6 or rename as an ordinary theme. Omit only if evidence truly has **zero** `[gap:*]` signals and no limitations/disagreements/future work; explicitly state "No significant open problems identified" in §6.
2. **Structured**: organize §5 by blueprint `gap-dimensions` using `<h3>`, covering applicable **methodological / empirical (missing data·baselines·datasets) / theoretical-conceptual gaps / cross-paper contradictions / author-stated future work**. **Synthesize** multiple papers per dimension (several report X, while Y counters), not paper by paper.
3. **Per-item sourcing**: every §5 gap requires at least one `<cite data-ref="N"><q>…</q></cite>`; `<q>` comes from verbatim reader `[gap:*]` evidence quotes (authors' original limitation/future-work statements), preventing unsupported generalities.
4. **Evidence path**: in "Evidence rows live in `.context/`," add: after reading `.context/*.evidence.json`, **first collect rows whose `claim` starts `[gap:*]` as §5 material**; §5 `<q>` must come from them (or narrowed `papers_read_context` at their locator), never fabricated.

**(c) Consistency Check** — strengthen existing item 11, "§5 Gaps present":

- §5 is an independent `<section id="s5">`, `<h2>` signals gaps, **not merged into §6**;
- Every §5 gap has `<cite><q>`, and `<q>` comes from `[gap:*]` evidence;
- No one-paragraph-per-paper §2–§4 lists (spot-check each `<h3>` synthesizes ≥2 papers or explicitly states a unique single-paper finding).
- Any failure → fix in place → recheck.

**(d) Positioning / Workflow Step 3** — mention new §5 gaps and §2–§4 hierarchy constraints in the Step 3 summary so the model reads them before writing.

<a id="改动点-4-&#45;scenariosystem-promptmd透传-blueprint最小改"></a>

### Change 4 — `scenario/system-prompt.md` (Minimal Blueprint Passthrough)

> File: `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`

`terminal_skill.input` already includes "title + thesis + 6-chapter outline / **blueprint**." Add only: Turn-2 Planning turn passes review-proposer's `## OUTLINE BLUEPRINT` text **unchanged** into `terminal_skill.input` (with reader gap conventions), without rewriting/translating. In `comprehensive`, scenario-created blueprints likewise use thematic progression + dedicated gaps + gap-dimensions. Other PLAN structure stays unchanged.

---

<a id="数据流改后"></a>

## Data Flow (After Changes)

```
Turn 1  review-proposer ─► 3-direction JSON (outlinePreview thematic progression + gaps)
                          + one ## OUTLINE BLUEPRINT text block per direction (intent/papers/subthemes/gap-dimensions)
            └─► present_directions (ChoiceCard still flat title/thesis/outlinePreview, zero UI change)
Turn 2  reader fan-out ─► evidence (mandatory separate gap rows, claim [gap:*] prefix) → .context/*.evidence.json
            └─► literature-review-result skill
                   · §2–§4: h3 groups from blueprint subthemes + cross-paper synthesis (hierarchy/progression)
                   · §5: independent, gap-dimensions grouping, each <cite><q> traces to [gap:*]
                   └─► fact-checker audit (including §5 citation provenance)
```

No type / IPC / renderer changes anywhere; blueprint and gap conventions use prompt-text contracts + existing `.context` cache.

---

<a id="影响面-&#45;版本号"></a>

## Impact and Versions

| Package / File | Change | Version |
|---|---|---|
| `default-capability-packs/lit-review/manifest.json` | review-proposer / reader / system-prompt changes belong to this pack | `0.2.9 → 0.2.10` |
| `default-skills/literature-review-result/SKILL.md` | Hierarchical §2–§4 + mandatory structured/sourced §5 + consistency checks | `version: 0.21.5 → 0.21.6` |
| `apps/electron/package.json` | All files under apps/electron (one patch+1 when opening PR) | patch+1 per CLAUDE.md |

> Historical language note: pack prompts are English (built-in convention); this spec and PR descriptions were originally Chinese.

---

<a id="验收对齐-issue-acceptance-criteria"></a>

## Acceptance (Aligned with Issue Criteria)

- [ ] AC1 Outline: generated outline has thematic grouping + progression (review-proposer thematic skeleton + skill §2–§4 h3 subthemes/transitions), not flat listing.
- [ ] AC2 Gaps: independent `<section id="s5">`, grouped by dimension, each with `<cite><q>` and `<q>` from reader `[gap:*]` rows (traceable, not vague).
- [ ] AC3 Changed synthesizer-chain prompts (review-proposer / reader / skill / system-prompt) remain English.
- [ ] AC4 Compare a real review task before/after: clearer hierarchy + independent traceable gaps (`bun run dev` actual run, screenshot comparison).
- [ ] AC5 `manifest.json` / `SKILL.md` / `package.json` versions incremented; `bun run typecheck` + `bun test` (pack loading / key-parity) pass.

<a id="风险-&#45;缓解"></a>

## Risks and Mitigations

- **R-1 Prompt-only hierarchy is fragile** (occasional flat output): skill Consistency Check hard-gates §2–§4 paper-list spot-checks and independent/sourced §5; review-proposer prohibits type-based skeletons, enforcing both ends.
- **R-2 `[gap:*]` contaminates `claim`**: machine-readable prefix stays out of HTML because body-writer uses `quote`, not `claim`; fact-checker validates `<q>`↔source and is unaffected.
- **R-3 Pack loading validation**: reader.md / review-proposer.md contain `{{evidenceSchema:read,litreview}}` / `{{redLines:*}}` placeholders—leave them untouched and edit prose only; `default-capability-packs-load.test.ts` should still pass; rerun to confirm.
- **R-4 Scenario drops blueprint text**: system-prompt explicitly passes it unchanged into terminal_skill.input; skill remains backward-compatible without blueprint (self-organize §2–§5 from evidence), but follows blueprint when present.

<a id="待评审决策点"></a>

## Review Decisions

1. **Is §5 nearly non-omittable?** Default mandatory, omitted only with zero gap signals. Accept writing "No significant open problems identified" in §6 for rare truly gap-free reviews instead of empty §5? (This spec favors yes.)
2. **Also require `[gap:*]` in `evidence-skimmer.md`?** (Tail-paper gap recall.) Optional here; default naturally compatible through shared reader evidence rules. Add one sentence if review demands a guarantee.
