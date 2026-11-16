> Historical research specification: Preserves old design and data semantics; does not require new features or restoring runtime wiring. Active research features are being restricted in batches under the [retirement spec](./2026-11-10-research-retirement.md); corresponding execution records define actual completion and unaccepted scope.

<a id="lit-review-turn-2-编排健壮性-spec"></a>

# lit-review Turn-2 Orchestration Robustness Spec

> **Status**: L1+L2+L3 implemented (typecheck + guard tests passed; awaiting behavioral validation with a review of >10 papers, >8 already parsed). Threshold/deepReadCap lowered to 10/8 (see semantic-first spec).
> **Related issue**: (To be added)
> **Related PR**: (To be added, this PR)
> **Domain sources of truth**: `CONTEXT.md`, `docs/specs/lit-review-semantic-first-reader-spec.md`, `docs/specs/lit-review-reader-evidence-cache-spec.md`

<a id="1-背景与问题"></a>

## 1. Background and Problem

lit-review Turn-2 execution is **entirely prompt-driven**: The scenario Agent emits a `## REVIEW PLAN`; the master (orchestrator) reads the PLAN protocol's English prose to decide which SubAgents to dispatch, how many, and whether to invoke the terminal skill. See the "Scenario Agent PLAN dispatch protocol" in `agent-prompt-builder.ts` (§5.3/§5.4).

An actual 39-paper run (debug dump #4) dispatched `1 triager + 15 reader + 0 skimmer + 0 escalation`; finally, the master **assembled review HTML itself using Write**, bypassing the `literature-review-result` terminal skill.

<a id="11-四个叠加失效over-determined"></a>

### 1.1 Four Overlapping Failures (Over-determined)

- **A — Conditional steps expressed as `input` prose.** triager / skimmer steps in `scenario/system-prompt.md` begin "INCLUDE THIS STEP ONLY when…"; whether to execute is buried in a dispatch string rather than a structured field. The master must judge prose on the spot, making this the first logic lost under context pressure.
- **B — ≤5 escalation readers are not a step, only `step_ordering` prose.** The master must derive from prose: read skimmer `needsDeepRead[]` → sort by hit strength → take 5 → synthesize new reader dispatches. Dynamic fan-out must be "invented" from prose and can easily disappear altogether.
- **C — terminal_skill invocation competes with the master's own Write capability.** The master has `Write`. Evidence is in `.context/` and files have been read, making self-assembled HTML the easiest route. The protocol says only "invoke that Skill," with **no hard gate** against the master writing the deliverable directly.
- **D — Context compaction discards PLAN itself.** PLAN resides in an early scenario tool_result; 15 readers flood master context with evidence rows, so compaction may discard PLAN JSON by the time reading finishes. After compaction the master has only `.context` files + vague memory → improvised Write. **This is the deepest cause: PLAN is volatile and the execution window is long and heavy.**

<a id="2-重构框架脊柱-vs-尽力而为"></a>

## 2. Refactoring Framework: Backbone vs Best Effort

Divide Turn-2 steps into two categories with different levels of assurance:

- **Hard guarantees (must always happen)**: `evidence-triager` (when >10) → core `reader` fan-out → **terminal skill produces the review**.
- **Best effort (omission reduces quality without breaking the run)**: `evidence-skimmer`, ≤5 escalation `reader` instances. Escalation readers explicitly belong here: undispatched papers become low-confidence entries in terminal skill §7/§8; no separate structured fan-out DSL, which would introduce new PLAN syntax ambiguity.

<a id="3-方案本轮范围-l1l2l3"></a>

## 3. Solution (This Round: L1+L2+L3)

<a id="l1-&#45;terminal_skill-硬闸修-c-&#45;d-最坏症状"></a>

### L1 — terminal_skill Hard Gate (Fix C + D's Worst Symptom)

**Goal**: When PLAN declares `terminal_skill`, the review **must** be produced by that Skill; the master cannot Write the deliverable itself. Invoke it even if evidence was compacted away; the Skill globs `.context/` to recover it.

Implementation:
- Add a hard rule to PLAN protocol step 5 in `agent-prompt-builder.ts`: *When PLAN includes `terminal_skill`, you (master) MUST NOT write deliverable artifacts yourself (such as `reviews/*.html`). That Skill is the sole producer. Even if compaction lost inline evidenceRows, still invoke the Skill: it globs `.context/*.evidence.json` to reconstruct evidence. Never replace it with an ad-hoc prompt / direct Write.*
- Mirror this in the Turn-2 "Hard rule" paragraph of `scenario/system-prompt.md` for redundancy.
- `.context` glob recovery in `literature-review-result/SKILL.md` **already shipped in a preceding PR** (Glob `.context/*.evidence.json` when inline input is missing); this round promotes it from a "fallback" to a "regular input channel" (L2).

<a id="l2-&#45;terse-reader-回传-&#45;cache-当传输通道修-d-根因"></a>

### L2 — Terse Reader Returns + Cache as Transport (Fix D's Root Cause)

**Goal**: reader / skimmer return only **pointers**, without flooding the master with complete evidence rows. Actual rows stay in `.context/` for terminal skill globbing. Master context barely grows across 15 readers → compaction may never trigger.

Change reader / skimmer returns to terse pointers (one line per paper):

```json
{ "N": 5, "source_id": "<parentItemKey>", "bucket": "deep-read",
  "rowCount": 4, "cacheFile": ".context/<key>.evidence.json" }
```

- Write complete `rows` only into `.context/<key>.evidence.json` (reader already does so); **stop** sending them wholesale back to the master.
- Change the terminal skill input contract (`scenario/system-prompt.md` terminal_skill.input + `SKILL.md`): **glob `.context/*.evidence.json` for evidence rows by default**, making inline rows optional/omittable. The Skill maps rows to citation numbers in `papers[]` using each cache file's `source_id` + `N`.
- **Silent-loss protection**: Pointers carry `rowCount`; if a paper's cache file is absent or `rows` empty, the Skill marks it "evidence missing" in §7/§8 rather than silently skipping it.
- **Impact on fact-checker**: fact-checker can also glob `.context/` + read the final review for provenance verification, without master inline rows. Dispatch instructions must identify `.context/` + the review artifact as evidence sources.

<a id="l3-&#45;结构化-when-谓词修-a提升-skimmer-触发率"></a>

### L3 — Structured `when` Predicates (Fix A, Improve Skimmer Dispatch)

**Goal**: Move "INCLUDE ONLY when…" out of `input` prose into a step-level `when` field for mechanical evaluation rather than reading English. Reuse existing `terminal_skill.condition` (PLAN protocol step 5 already supports predicates over tool_results).

Add optional `when` to PLAN steps (dotted-path comparison, same syntax as `terminal_skill.condition`):

```json
{ "subagent_type": "evidence-triager",
  "when": "papersInScope.length > 10",
  "input": "…只放输入，不再含 INCLUDE ONLY 散文…" },
{ "subagent_type": "evidence-skimmer",
  "when": "evidence-triager.light.length > 0",
  "input": "…" }
```

The Chinese input placeholder in the preserved example means "input only, no INCLUDE ONLY prose."

Implementation:
- Add to the PLAN protocol in `agent-prompt-builder.ts`: *Steps may carry an optional `when` predicate; evaluate it against accumulated tool_results before dispatch. If false, skip the step and continue. Steps without `when` dispatch unconditionally.* This uses the same evaluation model as step 5's `terminal_skill.condition`.
- Rewrite triager / skimmer "INCLUDE ONLY when…" prose in the Turn-2 PLAN of `scenario/system-prompt.md` into `when` fields; retain only actual dispatch content in `input`.
- Keep the predicate vocabulary minimal: `<stepName|inputField>.<path> <op> <literal>`, op ∈ `> >= < <= == !=`, `.length`. Introduce no complexity beyond Boolean combinations (split into two steps or add prose if necessary).

<a id="4-暂不做后手"></a>

## 4. Deferred (Follow-up Options)

- **L4 — Persist PLAN** (save Turn-2 PLAN to `.context/_plan.json`, letting the master reread its recipe after compaction): L2 removes the source of context pressure, likely avoiding compaction; reserve L4 if L1+L2+L3 remains unstable in actual runs.
- **L5 — Code-driven pipeline** (deterministic orchestrator code for the Turn-2 sequence): The structural end state can solve A+B+C+D, but involves major architectural changes and should not be the first step.

<a id="5-落地点清单"></a>

## 5. Implementation Locations

| File | Change |
|------|------|
| `apps/electron/src/main/lib/agent-prompt-builder.ts` | PLAN protocol: terminal_skill hard gate in step 5 (master cannot write deliverables); new step `when` predicate evaluation rule |
| `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md` | Turn-2 PLAN: triager/skimmer INCLUDE-ONLY prose → `when` fields; terminal_skill.input defaults to glob `.context/`; mirror terminal_skill gate in Hard rule |
| `apps/electron/default-capability-packs/lit-review/sub-agents/reader.md` | Terse pointer return contract (rows only in cache); retain cache writing |
| `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-skimmer.md` | Same terse pointer change for `covered[]` |
| `apps/electron/default-skills/literature-review-result/SKILL.md` | Promote `.context` glob from fallback to regular input; rowCount loss protection |
| `apps/electron/default-capability-packs/lit-review/sub-agents/fact-checker.md` | Identify `.context/` + review artifact as evidence sources |
| `apps/electron/default-capability-packs/lit-review/manifest.json` | Increment patch version (when opening PR) |

<a id="6-验证"></a>

## 6. Validation

- `bun run typecheck` + `bun test` (including `default-capability-packs-load.test.ts` guard; template tokens remain intact).
- Behavioral validation requires a library for a >10-paper review, with >8 **already parsed (wiki parsed)**. Run Turn-2 and confirm:
  1. Master no longer writes HTML itself (terminal skill invoked);
  2. Readers return terse pointers; master context does not grow linearly with reader count;
  3. Skimmer dispatches when `light` is nonempty (`when` takes effect);
  4. If compaction occurs midway, the review is still reconstructed from `.context/`.

<a id="7-未决"></a>

## 7. Open Questions

- `when` predicates remain prose-evaluated by the master (no actual evaluator). Argument: A short structured `X.light.length > 0` is more mechanical and harder to miss than a sentence buried in a 200-word input: a marginal but real improvement. Escalate to L4/L5 if still unreliable.
- After terse returns, the master loses visibility into individual paper evidence quality (sees only rowCount). Acceptable: Quality judgment already belongs to terminal skill + fact-checker.
