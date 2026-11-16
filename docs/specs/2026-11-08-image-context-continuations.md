<a id="图片任务中的自然续作授权"></a>

# Authorization for Natural Continuations in Image Tasks

Status: Implementation and local validation complete, awaiting coordinated serial integration. Baseline fbde681 (0.1.611). Related to UX-20261107-01; retains the approved image workflow fix scope.

<a id="复现与根因"></a>

## Reproduction and Root Cause

The Chinese phrase meaning "generate again" was split by prefix handling into a phrase meaning "generate the next time," and the recognizer required an image noun in the current message. The request (English translation) "Add this girl beside it and change her swimsuit" did not match existing selected-image transformation terms. The host provided only the set of reference assets, without the semantics of the previous consumed image task, so the same omission recurred in the hook, canUseTool, and execution guard.

<a id="行为与实现"></a>

## Behavior and Implementation

- Explicit image generation retains existing rules. Regeneration that omits an image noun is allowed only when the previous valid user turn was an image task.
- Editing with an explicit visual subject is allowed when there is a current image selection, an actual current upload, or a previous image task and reference images in the session. Historical images alone do not authorize it.
- Discussion, negation, quotations, code, and other sensitive actions do not constitute image generation requests. Switching to another task clears the image task context.
- The host factory reconstructs semantics from actual top-level SDK user records preceding the current input, ignoring synthetic/tool_result/replay records. Queued records carry an internal _imageQueued marker. Only actual turn records (UUID, task category, queued or not) written to the attachment directory's .image-consumed-turns.jsonl after consumption participate in later query restoration; the sidecar contains no messages, images, or credentials. Restoration follows actual consumption order. Unknown queues or truncated records block inheritance of older tasks; subsequent new ordinary input can establish a new boundary. Historical records from older versions without queue markers cannot retrospectively establish consumption status. Queue context updates only on actual consumption and never reads future queued messages.
- Only task semantics are inherited, not earlier approvals, image counts, ledgers, or call IDs. Queuing with next does not cancel an in-flight request; after a now interruption, the old call remains invalid and the new turn obtains limited authorization again.
- No changes to UI, existing session and image formats, OAuth, installed versions, other tool approvals, or Rust/Tauri. Validation uses synthetic data and fake networking, without paid image generation calls.

Historical files are scanned once and then folded by intent alone; each attachment is validated only once per scan. If the sidecar is missing, truncated, or unreadable, messages marked queued whose consumption cannot be confirmed provide no authorization.

<a id="验证与回滚"></a>

## Validation and Rollback

First add failing tests for natural continuations and visual edits, then integrate synthetic tests for the host factory and actual MCP handler; regress discussion/negation, counts, cross-session references, queue next/now/failure, and cancellation. Finally run lint, repository-wide typecheck, all Bun tests, Electron build, and independent review. Reverting this commit restores the old recognition behavior; no user data migration. Publish as a separate branch and draft PR, without merging into main.

See the [validation record](../reports/2026-11-08-image-context-validation.md) for final evidence and unverified boundaries.
