> Historical research specification: preserves old designs and data semantics, not requirements for current new features or restored runtime wiring. Active research capabilities are being retired in batches under the [retirement specification](../2026-11-10-research-retirement.md); corresponding execution records determine actual completion and unaccepted scope.

<a id="研究空白小版-specresearch-gap-&#45;in-selection"></a>

# Research Gap · In-Selection Spec

> **Status**: draft · awaiting review · 2026-06-23
> **Related milestone**: [`docs/milestones/0.4/north-star.md`](../../milestones/0.4/north-star.md) §I (P1 Research Gaps, audit criteria GM1–GM7)
> **Related PRD**: [`docs/specs/0.4.0/0.4.0-prd.md`](./0.4.0-prd.md) Epic 1
> **Related issue**: [#708](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/708) (persistence depends on Epic2 [#709](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/709))
> **Domain language source of truth**: `CONTEXT.md` domains “Research Gaps,” “Evidence Sets and Notes,” and “Literature Corpus and Retrieval” + this spec §2
> **Related specs**: [`capability-package-spec.md`](../capability-package-spec.md) (capability-pack architecture) · [`at-mention-evidence-set-spec.md`](../at-mention-evidence-set-spec.md) (evidence-set persistence, Epic2 integration) · `evidence-set-topic-container` (ADR-007, prerequisite for multiple notes per set)
> **Interactive prototype**: [`assets/research-gap-prototype.html`](./assets/research-gap-prototype.html) (recreated with actual ASCI tokens, switchable across 4 stages)
>
> 📌 This spec is authoritative for Epic1 design + implementation planning; North Star GM1–GM7 governs goals / acceptance.

---

<a id="1-概述与定位"></a>

## 1. Overview and Positioning

**Research Gap · In-Selection**: AI extracts a **comparison table** of “who did what” from user-selected literature, marking **unfilled combinations (gaps)** and **contradictory conclusions (conflicts)**, each traceable. Users decide what is worth pursuing; results persist in evidence sets.

Three nonnegotiable principles:

1. **Augmentation rather than replacement**: AI lays out tables, points out gaps, and marks conflicts; users always judge “is this truly innovative / worth doing,” and AI never decides that (HITL).
2. **Strictly limited to “within selected literature”**: all gaps/conflicts apply only to the selected papers, with **zero** claims that nobody in the entire field/world has done it. Full-frontier version (open world) → 0.5.
3. **Minimal additions through reuse**: connect a new capability pack to the existing registry, reusing conversation flow + right-hand Tabs + literature parsing + evidence sets; **add only one table view**, not a generic renderer framework.

---

<a id="2-领域语言"></a>

## 2. Domain Language

| Term | Definition | Source |
|------|------|------|
| **Research gap** (only new term) | After arranging literature by comparable dimensions, **unfilled attribute combinations (empty cells) = research gaps**, plus AI-marked conflicting conclusions. Strictly “within the selected literature.” | CONTEXT.md (backfilled by this spec) |
| Comparison table | Plain language: a table arranging literature by comparable dimensions (papers=rows, dimensions=columns). Not a domain term. | — |
| Evidence set / evidence entry (EvidenceRef) / note | Existing terminology. **Every filled cell = one evidence entry** (traceable). | CONTEXT.md “Evidence Sets and Notes” |

> Naming: introduce only “research gap”; **do not** use “assumption / hypothesis / innovation” as system-output terms.

---

<a id="3-决策总表讨论结论一览"></a>

## 3. Decision Table (Discussion Conclusions)

| Layer | Decision | Conclusion |
|----|--------|------|
| Form | Execution and presentation | **Multiple entry points (explicit UI / chat @ material selection + natural language or explicit command) → single routing to the research-gap pack; right-hand “Research Gaps” table view** (reuse Chrome Tabs + capability-pack Manifest + at-mention stack without core changes; **no** autonomous multi-pack orchestration) |
| Form | Gap semantics | **Paper×dimension main table + AI-marked “combination gaps” and “conflicting conclusions”**; no full cross-tabulation (avoid combinatorial explosion + exceeding extraction capability) |
| Interaction P1 | Table axes | Papers=rows, AI-proposed dimensions=columns; columns support add / delete / edit |
| Interaction P2 | Gap presentation | Amber card list **+ click card→linked highlighting** of supporting paper rows/dimension columns |
| Interaction P3 | Traceability | Click cell→popover source excerpt (with attribution)→jump to close-reading anchor |
| Interaction P4 | Trust minimum | Scope badge + bottom trust notice; **underlying hard filtering of AI wording + regression tests** (required) |
| Interaction P5 | Persistence | Table=1 structured note; each selected gap/conflict=1 traceable entry (depends on Epic2 multiple notes per set) |
| Mechanism M1 | Extraction | Show the full table only after all extraction; progress uses existing Agent execution-step stream |
| Mechanism M2 | Refill after column edits | Trigger only on “Refill table” after edits, never automatically reextract |

---

<a id="4-用户流程对应原型-4-阶段"></a>

## 4. User Flow (Prototype's 4 Stages)

```
① Select literature       ② AI proposes columns       ③ Extract/fill (M1)          ④ Complete: table+gaps+conflicts       ⑤ Decide+persist (P5)
   From evidence set /        AI reviews and proposes      Execution-step stream       Paper×dimension table                 Check “worth doing” →
   library selection    →     4–6 dimensions (columns) →   “12/18 papers…”        →    + amber gap/red conflict cards   →    Save in evidence set
   (GM1)                      User adds/deletes/edits(P1)   Show full table at once     Each cell traceable (P3/GM2)           (GM6)
                                                                                         Scope badge+trust notice (P4/GM4-5)
```

---

<a id="5-详细设计"></a>

## 5. Detailed Design

<a id="51-运行形态能力包-&#45;多入口唤起-&#45;右侧表格视图"></a>

### 5.1 Runtime Form: Capability Pack + Multiple Entry Points + Right-Hand Table View

- **Add capability pack `research-gap`** (declarative Manifest, reuse existing registry, **no core-code changes**). Full naming convention: `asci.builtin.research-gap`; packId is `research-gap`, consistent with actual `lit-search`/`lit-review` practice.
- **Entry points and invocation (GM1; reuse existing selection and @-mention stack)**: decouple material selection (input literature set) from triggering; all three paths converge on the same scenario Agent:
  - **A. Explicit UI**: start from **one evidence set** (detail page → “Find research gaps”); or select papers in **library / search results** → start.
  - **B. Chat `@` material selection**: mention an evidence set or papers with `@` (reuse the at-mention stack, see [`at-mention-evidence-set-spec.md`](../at-mention-evidence-set-spec.md)) to add the literature set to context.
  - **Trigger**: after selecting materials, users may say **naturally** “find research gaps in this literature” → **the orchestrator recognizes intent and routes only to research-gap**; or name it directly through an **explicit invocation command**.
  - **Boundary**: this is only **single routing to the research-gap pack**, **excluding** Supervisor autonomous orchestration of *multiple* packs, which the North Star excludes from 0.4 (requires ADR).
- **Execution**: the scenario Agent runs in the conversation stream; execution-step groups (`ExecutionStepGroup`) show “read full text / propose columns / fill paper by paper / mark gaps and conflicts” live. Uses the user's BYOK channel.
- **Presentation**: output appears in a **new `research-gap-table` Tab** in the right panel (Chrome-style accumulation, retained until closed), supporting viewing / column editing / linked highlighting / user decisions.

<a id="52-对照表数据模型与溯源"></a>

### 5.2 Comparison-Table Data Model and Traceability

Data shape (draft; final types decided during implementation; acceptance checks only “save and reread”; located in `packages/shared/src/types/research-gap.ts`):

```ts
interface ResearchGapTable {
  id: string
  sourceSelection: PaperSelectionRef   // 圈定的文献集（证据集 id 或 paperId[]）
  columns: GapColumn[]                  // AI 提议 + 用户编辑后的维度
  rows: GapRow[]                        // 每篇论文一行
  gaps: ResearchGap[]                   // AI 标注的组合空白
  conflicts: ConflictNote[]             // AI 标注的结论冲突
  scopeLabel: string                    // "基于你选的 18 篇文献" —— 范围披露
}
interface GapColumn { id; name; origin: 'ai' | 'user' }
interface GapRow { paperId; cells: Record<columnId, GapCell> }
interface GapCell {
  value: string | null                 // null = 该篇未涉及该维度（斜纹空格）
  evidenceRef?: EvidenceRef            // 填了的格子 = 一条证据条目（溯源锚点）
}
interface ResearchGap { id; title; rationale; supportingPaperIds[]; involvedColumnIds[] }
interface ConflictNote { id; title; paperRefs: EvidenceRef[]; rationale }
```

**Traceability (P3 / GM2, reuse existing mechanisms)**: each nonempty cell's `evidenceRef` uses existing `Anchor` (`packages/shared/src/types/anchor.ts`, two-level positioning = structured `locationData` + fallback `snapshotText`). Click cell → popover previews source snapshot + attribution → “Jump to reading anchor” opens/switches to that paper's `paper-detail` tab and positions it.

<a id="53-空白判定论文维度主表-&#45;ai-标注"></a>

### 5.3 Gap Identification (Paper×Dimension Main Table + AI Annotations)

- **Main structure**: paper×dimension comparison table. Each filled cell = traceable evidence; empty cell = the paper does not address that dimension (hatching, **not equivalent** to a research gap).
- **Combination gaps (ResearchGap)**: AI selects 1–2 key dimension pairs from the completed table and marks **value combinations absent from these papers** (e.g. “ViT + from-scratch + miniImageNet not covered”). **Do not force a full cross-tab**; produce only grounded insights, avoiding combinatorial explosion and exceeding extraction capability.
- **Conflicting conclusions (ConflictNote)**: AI marks opposing conclusions across papers under similar settings (e.g. “whether pretraining helps”).
- Each gap/conflict carries `rationale` + `supportingPaperIds`/`paperRefs`, **traceable and limited to selected literature** (GM3).

<a id="54-交互细则"></a>

### 5.4 Interaction Details

| Item | Design |
|----|------|
| **Column management (P1)** | AI proposes 4–6 columns (`origin:'ai'`, dashed chips); users add/delete/edit (after edits `origin:'user'`). Hint: “More focused dimensions make combination gaps more meaningful.” |
| **Linked highlighting (P2)** | Click gap card → highlight its `supportingPaperIds` rows + `involvedColumnIds` columns; click conflict card → highlight the two conflicting paper rows + that dimension column. `ring`/background uses state colors, not focus rings (design.md §9 exception). |
| **Extraction (M1)** | User confirms columns → extract paper by paper in one pass → show only the completed table. Progress uses `ExecutionStepGroup`, “N/M papers.” |
| **Refill after edits (M2)** | Adding/deleting/editing columns reveals “Refill table”; only clicking triggers reextraction (neither automatic nor incremental; incremental → later optimization). |
| **Large-table review (GM8 experience)** | Sticky header and first column; sorting / filtering / column management (minimal implementation, no pivots). |

<a id="55-可信底线p4-&#45;gm4-&#45;gm5-&#45;产品命门"></a>

### 5.5 Trust Minimum (P4 / GM4 / GM5: Critical to the Product)

Three mandatory safeguards:

1. **Scope (visual)**: persistent top-right scope badge `基于你选的 N 篇` (“Based on your N selected papers”) + bottom notice “Valid only within these N papers; does not mean nobody worldwide has done it; you decide whether it is worth doing.”
2. **Hard wording filter (output)**: scenario Agent / Skill outputs pass a redaction-like wording filter that scans and blocks/rewrites `全领域 / 全世界 / 没人做过 / 这是创新点 / novel / 首创` (field-wide / worldwide / nobody has done it / this is an innovation / novel / first-ever) overclaims.
3. **Stop before deciding (semantic)**: AI output **ends at** “lay out table + point out gaps + mark conflicts,” **without** conclusions about what is worth doing or innovative (GM5).
4. **Regression tests**: dedicated cases scan product copy + AI output; overclaim matches fail (GM4/GM5 acceptance).

<a id="56-沉淀p5-&#45;gm6衔接-epic2"></a>

### 5.6 Persistence (P5 / GM6, Epic2 Integration)

- **Split**: whole table → **1 structured note**; each user-selected gap/conflict → **1 traceable evidence entry**, written into the target evidence set (container members aligned with Epic2).
- **Dependency**: currently “1 evidence set = 1 note”; this split requires **Epic2 multiple notes per set first** (ADR-007).
- **Fallback**: if Epic1's main flow needs validation before Epic2 is ready, temporarily use “entire analysis=1 note” (decision P5 option B), **not the final delivery form**.
- Acceptance checks only “save + complete reread + preserved order” (GM6).

<a id="57-能力包编排研发落点按-prd-d-&#45;摸排结论"></a>

### 5.7 Capability-Pack Orchestration (Engineering Locations, PRD D + Investigation)

```
Scenario Agent: research-gap (planner) — clarify selected literature, orchestrate three steps, handle column refills, uphold trust minimum
  ├─ column-proposer   Read N paper structures/abstracts → propose 4–6 comparable dimensions (columns)
  ├─ cell-extractor    Extract values + source anchors per paper/confirmed column (★critical extraction, high volume)
  └─ gap-analyzer      Mark combination gaps + conflicts in filled table, with grounds for each
Tool reuse: papers-rg MCP (papers_read_* structured full text / papers_semantic_search)
Models: user BYOK; high-volume cell-extractor may use faster model, gap-analyzer/planner reasoning model
```

---

<a id="6-复用点与扩展点摸排结论带文件路径"></a>

## 6. Reuse and Extension Points (Investigation, with Paths)

**Reuse (existing, use directly)**
| Object | File |
|------|------|
| Right-hand Chrome Tab framework | `apps/electron/src/renderer/atoms/right-panel-tabs.ts` · `components/app-shell/RightPanelTabContent.tsx` |
| Capability-pack registry (Manifest-driven, no code changes) | `apps/electron/src/main/lib/capability-pack-loader.ts` · `subagent-registry.ts` |
| Extraction corpus layer | papers-rg MCP (`papers_read_*` / `papers_semantic_search`, used by lit-review reader) |
| Traceability | `packages/shared/src/types/anchor.ts` (Anchor two-level positioning) · `objects/evidence-ref.ts` (EvidenceRef) |
| Evidence-set aggregate queries | `apps/electron/src/main/lib/objects/query-service.ts` |

**Extend (add/change)**
| Target | Location |
|------|------|
| Tab type | Add `'research-gap-table'` to `TabKind` in `right-panel-tabs.ts` |
| Tab routing + view component | Add case to `RightPanelTabContent.tsx` + new `ResearchGapTableView.tsx` |
| Capability pack | Add `apps/electron/default-capability-packs/research-gap/` (manifest + scenario/sub-agent prompts) |
| Data types | `packages/shared/src/types/research-gap.ts` |
| IPC (if persistence needed) | `researchGap:*` channels, synchronized across all four layers (shared→main→preload→renderer) |
| i18n | `research-gap` ns, add en+zh keys together |

---

<a id="7-前置-spikegm7-&#45;动工核心前必做"></a>

## 7. Prerequisite Spike (GM7 · Required Before Core Work)

**Extraction quality is critical and the industry's least mature link (only 39% accuracy for the strongest tools). Before core implementation, run:**

| Item | Measurement | Output |
|----|------|------|
| ① Extraction accuracy | Run column-proposer + cell-extractor on 15–20 real papers (actual user field), manually sample correct-cell proportion | Accuracy value |
| ② Paper-count limit | Number of papers reliably processed at once (no crash or significant accuracy loss) | Limit + batching strategy if needed |
| ③ BYOK cost/latency | Actual token cost and duration of one run with the user's key | Per-run cost/latency |
| ④ Single-route integration | Confirm existing routing to one pack supports research-gap and natural-language triggering (if currently manual pack selection, estimate one intent→pack route) | Feasibility + effort |

**Fallback if below target**: fewer papers per run → fewer dimensions → less automation. **Principle: evidence before promises; never promise unverified extraction capability.**

---

<a id="8-验收映射北极星-gm1gm7"></a>

## 8. Acceptance (North Star GM1–GM7)

| Audit | Acceptance |
|------|------|
| GM1 | Start once from each explicit entry (evidence set / selected papers); after chat @ material selection, invoke once by natural language and once by explicit command |
| GM2 | AI-proposed columns support add/delete/edit; any nonempty cell jumps to its source anchor |
| GM3 | Walkthrough shows combination gaps and conflicting conclusions, each traceable |
| GM4 | Regression scans product copy/AI output; **zero** claims that nobody field-wide/worldwide has done it |
| GM5 | Regression scans AI output; **no** user-replacing decisions such as “this is an innovation/novel” |
| GM6 | Table + selected gaps persist in an evidence set, reread complete and ordered |
| GM7 | Three spike metrics (accuracy/count/cost) quantified, **before core implementation** |

---

## 9. Out of Scope

- Research gaps · **full-frontier version** (entire-field scope) → 0.5 (depends on deep-literature corpus).
- Full dimension-value **cross-tabulation** → excluded (combinatorial explosion + beyond extraction capability).
- Automatically generating concrete research claims → excluded (table suggestions only; users decide).
- **Incremental reextraction** after column changes → later optimization (full refill this phase).
- Progressive/skeleton filling (M1 B/C) → later optimization.
- Generic pluggable renderer framework → excluded (one new table view only).

---

<a id="10-依赖与实施顺序"></a>

## 10. Dependencies and Implementation Order

```
Prerequisite: GM7 extraction spike (real papers, quantify accuracy/count/cost) ← blocks core implementation
Parallel start: pack skeleton (manifest + three sub-Agent prompts), Tab type + empty view component
After spike conclusions:
  column-proposer → cell-extractor → gap-analyzer form comparison table
  → right-hand table (column management + linked highlighting + traceability) → trust minimum → persistence (Epic2)
```

Dependencies: **persistence ⬅ Epic2 multiple notes per set (ADR-007)**; **core ⬅ GM7 spike conclusions**.

---

<a id="11-风险"></a>

## 11. Risks

| Risk | Impact | Mitigation |
|------|------|------|
| Extraction below target (SOTA only 39%) | Feature fails to deliver value | GM7 spike first; choose depth from conclusions, reduce scope if needed |
| “Gap” interpreted as “nobody worldwide has done it” | Trust collapses | §5.5 safeguards + wording regressions |
| Epic2 persistence dependency unavailable | Epic1 completion blocked | Temporarily “whole analysis=1 note,” upgrade when Epic2 is ready |
| Poor large-table review experience | Poor flagship feature experience | Sticky headers/first column + sorting/filtering; spike controls paper-count limit |

---

**Spec version**: v1 · 2026-06-23 · awaiting review
