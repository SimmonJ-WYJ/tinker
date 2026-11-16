> Historical research specification: preserves earlier designs and data semantics; it does not require new features or restoration of runtime wiring. Active research features are being retired in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records define actual completion and unaccepted scope.

<a id="lit-review-fact-checker-入协议-&#45;terminal_skill-之后核查槽-设计规格"></a>

# lit-review fact-checker Protocol Integration + Post-`terminal_skill` Verification Slot Design Specification

- Status: draft (pending review)
- Related issue: [#517](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/517) (guichuanqing: fact-checker never dispatched, structurally unreachable)
- Related PR: (to be created)
- Domain language source of truth: `CONTEXT.md` (PLAN / terminal_skill / SubAgent dispatch protocol); execution protocol source: `apps/electron/src/main/lib/agent-prompt-builder.ts`

<a id="context为什么做"></a>

## Context (Why)

After lit-review generates a review, spec §5.4 + scenario `stop_conditions` both claim `fact-checker` checks every section (verified/unsupported/contradicted/unchecked), the final defense against hallucination. Yet measurements show **fact-checker is never dispatched** (issue #517: dispatch=0 across 55 real local sessions, including full pipeline session `b1602034`).

<a id="根因已对照代码核验"></a>

### Root Causes (Verified Against Code)

1. **fact-checker is only in `optional_followups`, not `steps`**: lit-review Turn-2 PLAN [`system-prompt.md:102-104`](https://github.com/SimmonJ-WYJ/tinker/blob/4ca339592668581c1dc36abc9097fc9bf0aa1650/apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md) puts it in `optional_followups`; actual dispatched `steps` contain only `evidence-triager / reader / evidence-skimmer`.
2. **Execution protocol never consumes `optional_followups` or `stop_conditions`**: main Agent PLAN protocol [`agent-prompt-builder.ts:565-583`](../../apps/electron/src/main/lib/agent-prompt-builder.ts) has 7 `steps`, originally `parse → confirm 门 → steps（含 when）→ 等待/并行 → terminal_skill → closing_action → summary` (parse → confirmation gate → steps including conditions → wait/parallel → terminal skill → closing action → summary). No step reads `optional_followups` or the stop-condition field. Thus dispatch=0 for **any model**: structurally unreachable, unlike lit-search's model deviation where a step exists but some models omit it.
3. **Deeper structural gap: no post-terminal_skill action slot**: moving fact-checker into `steps` is insufficient because all steps (step 3) run **before** `terminal_skill` (step 5), while checking requires the **written review body**. It would run without content. In `steps → terminal_skill → summary`, only summary follows terminal_skill, leaving no reliable location. This resembles FINDING-20260610-001 “all readers insufficient → terminal_skill never triggers.”
4. **Contradictory/misleading behavior**: `stop_conditions` claims “fact-checker has run on each chapter at least once” without enforcement; closing summary [`system-prompt.md:120`](https://github.com/SimmonJ-WYJ/tinker/blob/4ca339592668581c1dc36abc9097fc9bf0aa1650/apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md) includes `Fact-check status: <verified count> / <flagged count>`. With no checker run, placeholders **leak unchanged** to users, implying verification without a skipped signal.
5. **Existing guard does not cover it**: #590 [`plan-terminal-skill-guard.ts:37-38`](../../apps/electron/src/main/lib/plan-terminal-skill-guard.ts) explicitly limits itself to general-query lit-search PLANs, excluding lit-review; it forces only `lit-search-report` skill calls.

<a id="目标-&#45;非目标"></a>

## Goals / Non-goals

**Goals**
- G1 Add a **post-terminal_skill verification slot** to PLAN, making validation after deliverable creation a first-class protocol step.
- G2 Move `fact-checker` from `optional_followups` into this slot with **claim-level dispatch signals** + deliverable location (review HTML + `.context` evidence cache), enabling actual dispatch, checking, and summary population.
- G3 Fix summary placeholder leakage: derive status from actual checker output; emit **explicit signals** when not run/checked, never `<...>`.

**Non-goals**
- No automatic review rewrite after rejection (block-on-red only **presents** must-fix / disputed lists in summary; automatic revision follows separately).
- Do not solve FINDING-20260610-001 (terminal_skill skipped when all insufficient): related but independent.
- No fact-checker audit algorithm / evidence schema changes, only **dispatch integration** and **output population**.

<a id="设计方案"></a>

## Design

Two layers, matching issue priority: structural reachability first, runtime guarantees next.

<a id="layer-1结构性-&#45;本-spec-核心核查槽-&#45;fact-checker-入协议"></a>

### Layer 1 (Structural, Core of This Spec): Verification Slot + Protocol Integration

<a id="11-新增-plan-顶层字段-post_terminal_steps通用非-lit-review-专属"></a>

#### 1.1 New Top-Level PLAN Field `post_terminal_steps` (General, Not lit-review-Specific)

Semantics: ordered post-verification subagents run **after `terminal_skill` produces its deliverable and before summary**. Same shape as `steps` (`{ subagent_type, input, model?, when? }`), with later execution timing. The preserved example's input placeholder refers to §1.3's dispatch contract.

```jsonc
"post_terminal_steps": [
  { "subagent_type": "fact-checker",
    "input": "<见 1.3 的派发契约>",
    "model": "haiku" }
]
```

<a id="12-执行协议消费agent-prompt-builderts-plan-dispatch-protocol"></a>

#### 1.2 Execution Protocol Consumption (`agent-prompt-builder.ts` PLAN Dispatch Protocol)

**Insert a step** between existing step 5 (terminal_skill) and step 7 (summary), in English prose consistent with the protocol:

> **Post-terminal verification steps (`post_terminal_steps`).** If the PLAN carries a top-level `post_terminal_steps` array, then **after the `terminal_skill` has produced its deliverable** (and only if it actually ran — skip when terminal_skill was conditionally skipped or never produced an artifact), dispatch each entry **in order** via `Task(subagent_type=…, prompt=…)`, same `when`-predicate and recommended-sub-agents cross-check as `steps`. These run on the *produced* artifact (e.g. verifying the review HTML the terminal_skill just wrote), which is why they cannot live in `steps` (those run before the deliverable exists). Collect their tool_results — the summary step consumes them. A PLAN without `post_terminal_steps` behaves exactly as before.

Add to summary (currently step 7): **if `post_terminal_steps` includes a verifier, derive verification status from its tool_result** (§1.4).

> Execution is prompt-driven: orchestrator LLM reads PLAN JSON + protocol prose. Layer 1 changes `agent-prompt-builder.ts` prose and emits this field from lit-review's PLAN template. No hard PLAN schema/types need changes: PLAN is free JSON in agent text; `plan-terminal-skill-guard` parses only its own subset.

<a id="13-lit-review-plan-模板改动lit-reviewscenariosystem-promptmd"></a>

#### 1.3 lit-review PLAN Template (`lit-review/scenario/system-prompt.md`)

- **Move fact-checker from `optional_followups` to `post_terminal_steps`** (remove `optional_followups` or retain genuinely optional items).
- fact-checker `input` must include all of:
  1. **Claim-level / per-section dispatch signal**: fact-checker.md:52 says “Without the explicit dispatcher signal, do NOT emit the claim-level JSON”; summary `verified/flagged` counts depend on that JSON. Explicitly request “per-section claim-level check, emit the claims[] JSON.”
  2. **Deliverable location**: review HTML path written by terminal_skill (`reviews/*.html`, from its tool_result).
  3. **Evidence channel**: `.context/*.evidence.json` (checker Glob+Read, matching fact-checker.md:13).
- Optional `when`: terminal_skill produced output; skip without output, avoiding empty checks.
- **Update `stop_conditions`**: replace the unenforced fact-checker claim with wording consistent with `post_terminal_steps`, or remove it to avoid another false mandatory-run claim.

<a id="14-修掉-summary-占位符泄漏system-promptmd-turn-2-closing-turn"></a>

#### 1.4 Fix Summary Placeholder Leakage (`system-prompt.md` Turn-2 Closing Turn)

- Replace `Fact-check status: <verified count> / <flagged count>` with actual derivation from checker claims[] JSON: verified = status==='verified', flagged = unsupported+contradicted; unchecked separately.
- **Checker not run / no claims[] JSON** (skipped, timeout, fallback): summary must show an **explicit signal**, e.g. “⚠ This review has not been fact-checked” / “Fact-check skipped”; **never** preserve literal `<...>` placeholders.
- If checker reports `rejected`/`contradicted`, append a brief must-fix / disputed table exposing red-flagged claims, without automatic rewriting.

<a id="15-fact-checkermd按需微调"></a>

#### 1.5 fact-checker.md (Adjust Only If Needed)

PLAN `input` supplies dispatch signal and location; claim-level mode (§4.5) is already ready, so **normally no change**. Only if review requires subagent-side contract reinforcement, add that dispatch supplies review HTML + claim-level signal.

<a id="layer-2运行时保证-&#45;推荐随同落地否则仍是模型走偏风险"></a>

### Layer 2 (Runtime Guarantee, Recommended Alongside Layer 1 to Address Model Deviation)

Layer 1 makes the checker **reachable**, but prompt-driven dispatch can still be skipped under context pressure, as with lit-search. Code guards are required to **guarantee** execution:

- **Extend / replicate `plan-terminal-skill-guard` for lit-review**: observe lit-review terminal_skill (`literature-review-result`) calls + Task dispatch. At `Stop`, if a review was produced but **no fact-checker Task was seen**, return `decision: 'block'` + additionalContext forcing immediate checker dispatch, with traceable logs. Same safety net as #590's lit-search-report guard.
- Scope to `lit-review`; prevent Stop loops with a forced flag.
- Make this **step two in the same PR**: Layer 1 protocol first, Layer 2 hard guarantee immediately after. If reviewers split it, Layer 1 can go first with explicit residual risk that it may still yield zero dispatches.

<a id="数据流改后"></a>

## Data Flow (After Changes)

The diagram shows Turn-2 preparation steps → review HTML creation → new `post_terminal_steps` checker slot reading HTML + evidence cache with claim-level output → derived summary or explicit unchecked signal; Layer 2 forces missing dispatch at Stop.

```
Turn 2 PLAN: steps[evidence-triager? / reader* / evidence-skimmer?]
           → terminal_skill: literature-review-result  → write reviews/*.html
           → post_terminal_steps[fact-checker]  ← New slot: read reviews/*.html + .context/*.evidence.json
                                                  ← claim-level signal → emit claims[] JSON
           → summary: derive Fact-check status from claims[] (explicitly unchecked if not run)
   [Layer 2] Stop guard: terminal_skill output but no checker dispatch → force dispatch
```

<a id="影响面-&#45;版本号"></a>

## Impact and Versions

| Package / file | Change | Layer |
|---|---|---|
| `apps/electron/src/main/lib/agent-prompt-builder.ts` | PLAN prose: consume `post_terminal_steps` + derive summary verification status | L1 |
| `default-capability-packs/lit-review/scenario/system-prompt.md` | Move checker to new slot with signal/path/evidence; fix summary placeholders; update `stop_conditions` | L1 |
| `default-capability-packs/lit-review/sub-agents/fact-checker.md` | Adjust only if needed (default unchanged) | L1 |
| `default-capability-packs/lit-review/manifest.json` | Prompt changes → version `0.2.x → 0.2.(x+1)` | L1 |
| `apps/electron/src/main/lib/plan-terminal-skill-guard.ts` (or new `lit-review-factcheck-guard.ts`) + `run-orchestrator-query.ts` assembly | Runtime checker safety net | L2 |
| `apps/electron/package.json` | patch+1 (once at PR opening) | — |

> Built-in prompts are always English by convention. Historical policy at the time of this spec used Chinese for this spec / PR description.

<a id="测试"></a>

## Tests

- `agent-prompt-builder.test.ts`: assert `post_terminal_steps` consumption semantics in prose, following terminal_skill/closing_action assertions.
- `default-capability-packs-load.test.ts`: lit-review still loads (manifest version + prompt placeholders intact).
- (L2) Guard tests: terminal_skill called + no checker Task → Stop blocks + injects; checker present → no trigger; other packs unaffected; follow existing guard test structure.
- Real-device acceptance: run a real review (including 21-paper scale like b1602034), confirm ① checker dispatched ② real summary `Fact-check status` ③ unchecked path explicitly signals rather than `<...>`.

<a id="验收对齐-issue-517"></a>

## Acceptance (Issue #517)

- [ ] AC1 Checker no longer structurally unreachable: protocol consumes `post_terminal_steps` and lit-review PLAN places it there.
- [ ] AC2 Real review run has checker dispatch > 0 and claim-level claims[] JSON.
- [ ] AC3 Summary `Fact-check status` derives from actual output; explicit notice if not run, no leaked placeholders.
- [ ] (L2) AC4 Runtime guard forces missing checker after output and logs it, scoped to lit-review.
- [ ] AC5 Affected manifest / package.json versions incremented; `typecheck` + `bun test` pass.

<a id="风险-&#45;缓解"></a>

## Risks and Mitigation

- **R-1 Layer 1 alone can still be skipped** (reachability ≠ guaranteed execution): strongly recommend same-PR Layer 2; if phased, disclose risk in PR.
- **R-2 Ordering confusion with `closing_action`**: closing_action handles Turn-1 multi-stage ChoiceCard handoff without terminal_skill; `post_terminal_steps` follows Turn-2 terminal_skill. State disjoint trigger conditions explicitly.
- **R-3 Checker runs without deliverable**: dual gating through `when` + actual terminal_skill output requirement.
- **R-4 Guard affects other packs**: pack-scoped resolver (only `lit-review`) + existing forced loop prevention, reusing #590's verified structure.

<a id="待评审决策点"></a>

## Decisions for Review

1. **Layer 2 in same PR?** Preferred, since zero-dispatch risk otherwise remains. Acceptable?
2. **`post_terminal_steps` naming / generality**: generic for any pack or lit-review-only? Prefer generic for similar post-output needs such as FINDING-001.
3. **Block-on-red handling**: summary only presents must-fix/disputed, with no rewrite. Sufficient? Automatic revision is a larger feature best handled separately.

---

<a id="附录668-跟进-&#45;layer-2-guard-武装信号对齐-679-重构"></a>

## Appendix: #668 Follow-up—Align Layer 2 Guard Arming with #679 Refactoring

- Related issue: [#668](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/668) (checker 0/45 retest, same root-cause class as #517)
- Related PR: (to be created)

**Background**: Layer 2 guard (`lit-review-factcheck-guard.ts`, landed for #517 in `3f128dfa`) originally armed “review produced” on the **main-layer `literature-review-result` terminal_skill call**. Main Agent then wrote the body directly through that skill, making it visible in the main query hook.

**Drift**: #679 (`c3d362e3`) moved body generation into isolated **`body-writer` subagent context**, where it calls the `literature-review-result` skill; system-prompt changed `terminal_skill` to `terminal_subagent: body-writer`, but the guard **was not updated**. It now arms indirectly from a subagent-internal skill call. SDK still triggers main-query PostToolUse for internal tools (with `agent_id`; guard does not filter it), so it still works, but the signal is fragile and misaligned with architecture.

**Hardening (#668)**: make **body-writer dispatch** (main-layer `Task`, necessarily visible and naturally pack-scoped) the **primary** arming signal; retain internal `literature-review-result` calls as **redundancy**. Either arms (`bodyWriterDispatched || reviewSkillInvoked`). Align force reasons/logs with `terminal_subagent`. Add #679 regressions: body-writer alone blocks, body-writer + checker passes, internal skill with `agent_id` still arms, other workers do not arm.

**Remaining / related**: `lit-review-structure-lint-guard`, observing `Write(reviews/*.html)`, likewise depends on subagent tool events bubbling up. Its trigger is `Write` path, not skill name, and SDK confirms internal `Write` PostToolUse visibility, so it still functions. Unchanged here; record the shared dependency for later review.
