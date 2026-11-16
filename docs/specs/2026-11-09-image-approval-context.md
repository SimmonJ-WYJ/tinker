<a id="自然图片编辑与批准后续作修复"></a>

# Natural Image Editing and Post-Approval Continuation Fix

Status: Implementation and local validation complete; integrated main `915d3ae` without conflicts, revalidated, and delivered a Draft PR. Branch `fix/image-edit-approval-context`.

<a id="目标与边界"></a>

## Goals and Boundaries

The request “take a look, add this girl, all three people together” (English translation) should be recognized as image editing in this turn when the host has verified a selected/uploaded image. After explicit approval of a valid image call, task semantics may support an explicit “generate again” request in the next turn, but approved parameters, extra files, quantities, and call identities must not carry over. Missing context, discussion/analysis/questions, negation, and nonvisual actions involving code/databases/group chats still ask conservatively; cross-conversation references and calls after cancellation remain rejected.

Change only Electron image hosting and shared authorization. Preserve sensitive-tool approval, plan mode, and execution guards. Relative to main, this round leaves Rust, README/CLAUDE, real user JSONL, and the running installation package unchanged. Delivery only pushes the fix branch and creates a Draft PR: no main merge, auto-merge, publication, packaging, or paid image generation. Preserve the 4 GiB disk stop threshold.

<a id="已复核根因"></a>

## Reviewed Root Causes

1. `requestsImage` encodes visual editing as a single fixed-word-order regex, and its request prefix omits the polite lead-in translated as “take a look.” Even with a valid selected/uploaded image, action-before-object expressions are misclassified; avoid special-casing entire sentences.
2. `ImageRequestAuthorization.isImageTask()` always returns automatic from construction. Manual approve changes only the exact parameter set, leaving subsequent factories false; the sidecar writes false only once at consumption, so restart cannot restore it either.

<a id="实现计划本线程串行执行"></a>

## Implementation Plan (Executed Sequentially in This Thread)

<a id="1-自然编辑边界"></a>

### 1. Natural Editing Boundaries

Files: `packages/shared/src/agent/image-request-authorization.ts` and tests; separate `image-edit-intent.ts` if needed.

- [x] First write red tests for the original sentence and synonymous action-first, Chinese disposal constructions, pronouns, and multiple people in one frame, restricted to real context.
- [x] Recognize combinations of visual actions and objects, stripping polite lead-ins; block discussion/negation/nonvisual destinations first. Preserve removal of authorization from attachments/quotes/code.
- [x] Regress local image constraints, people counts versus output counts, extra files, selected-image identity, cross-conversation cases, and cancellation. Explicitly requesting two outputs permits only two calls; three people does not permit three images.

Run: `bun test packages/shared/src/agent/image-request-authorization.test.ts`. New authorization cases must first fail as ask, then pass; existing safety cases must not regress.

<a id="2-批准语义持久化及消费顺序"></a>

### 2. Approval Semantics, Persistence, and Consumption Order

Files: shared authorization object; `image-turn-journal.ts`, `image-turn-factory.ts`, and tests; actual `image-approval-context.test.ts`, `image-generation-handler.fixture.ts`.

- [x] First reproduce isImageTask false after approve, live continuation ask, and restart restoration ask.
- [x] A valid explicit approval establishes image-task semantics one way for this object; late approvals after cancellation do not change state.
- [x] On semantic confirmation, the host only appends `{kind:'image-task-confirmed',id}`, without parameters, files, prompts, counts, or approval tokens. Confirmation updates the original consumption record without reordering; unknown IDs/corrupt records restore conservatively.
- [x] The factory reads the previous authorization object's task semantics only when creating a genuinely newly consumed turn; the new object recalculates limits and file scope.
- [x] Validate normal/live/restart, queued-but-unconsumed inputs, real now/next consumption, cancellation/late approval, confirmation of old turns not overriding newer ordinary tasks, corrupt journals, and write failures.
- [x] Close the loop using real PermissionService hook/canUseTool/ExecutionGuard and a fake network handler; verify no duplicate approval cards while extra files/dangerous terminals/plan mode remain blocked.

Run: related authorization, factory/controller/journal, permission-flow, execution-guard, and handler tests. Observe red tests before implementation.

<a id="3-验证与交付"></a>

### 3. Validation and Delivery

- [x] Repository-wide typecheck / Bun tests / lint and Electron build; no DMG or Cargo cache contention.
- [x] Independent read-only review and fixes for confirmed issues; verify data/authorization scope does not expand, zero Rust differences, and no real user information.
- [x] `git diff --check`, normal version/commit hooks, local Conventional Commit. Record root causes, tests, SHA, and unrun items in `docs/reports/2026-11-09-image-approval-validation.md`.

- [x] Merge latest main, retain Rust mainline changes, and rerun all checks.
Delivery flow: Push the validated fix branch, create a Draft PR, verify remote head and CI, and post review follow-up. The PR and delivery message govern remote status.

<a id="设计判断"></a>

## Design Judgment

What carries over is the user-confirmed task category, not permission. The new confirmation event belongs to the host consumption sidecar; historical user text or model output cannot create it. Valid older consumption records remain readable; older readers encountering new confirmations conservatively lose continuation context rather than expanding permission. Lost approval facts from old versions cannot be backfilled or inferred. This round need not read or repair real conversations where the user already generated images successfully.

<a id="升级恢复"></a>

## Upgrade Recovery

Recompute old false consumption records only in actual consumption order. A selected/uploaded image on that input can supply visual-edit evidence; without contemporaneous evidence, remove the current reference set to avoid inferring old edits from files that appeared later. Unknown ordinary inputs at any intermediate gap block inheritance, checked with prefix counts; unknown queued and trailing ordinary inputs still block recovery. Old records are not rewritten.

Old conversations retaining only generic text and false records with lost approval facts cannot recover from model self-report; the user must explicitly request an image again or confirm a valid call. Extra files, quantities, and invalid sources still require confirmation or rejection under existing boundaries. Review-found misclassifications involving withdrawal, full destinations, consumption gaps, and multiple-person nonvisual activities received red tests and fixes.
