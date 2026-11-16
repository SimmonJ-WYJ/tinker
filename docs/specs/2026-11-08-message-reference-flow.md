<a id="对话流与引用图片来源"></a>

# Conversation Flow and Referenced Image Sources

Status: Implementation, independent review, real-browser acceptance, and final aggregate checks complete. Delivery branch feat/message-reference-flow; main is merged manually by the user. Domain language retains existing SDK message / image version / attachment terms.

<a id="基线与协作边界"></a>

## Baseline and Collaboration Boundaries

- Workspace `/tmp/tinker-message-reference-20261108`, branch `feat/message-reference-flow`.
- Starting main `fbde681`; fast-forwarded to include delivered Google packaging fixes `77d5f36`, `3cfc286`, preserving their separate commits.
- Image generation continuation is implemented in another workspace. This round does not modify `image-request-authorization.ts`, `image-turn-context.ts`, `image-turn-factory.ts`, `agent-orchestrator.ts`, or that task's tests. Image generation commit c4cbab6 was integrated sequentially after reference UI commit 865b59c, in merge f946135; Google, reference UI, and image generation fixes retain separate commits.
- The user currently runs `/Volumes/Tinker 0.1.611-arm64/Tinker.app`; this round does not install, replace, or call paid image generation.

<a id="设计真相源"></a>

## Design Source of Truth

Old node `106:178` no longer exists. The current artboard is `115:599`, message area `115:604`, on Chating page `115:597`. High-fidelity context and screenshots were read. The local user screenshot retains Library ID `libfile_26c6a0fa40b88191bb5071fb01549d99` and was actually transferred using a supported method and viewed.

- Maximum content column width 832; desktop top whitespace 64; adjacent turn spacing 40.
- Uploaded images sit outside bubbles: preview 112×148, radius 8; clicking opens the complete original.
- User bubbles: maximum width 480, padding 16, radius 14, light surface #F4F5F6.
- Embedded reference cards: 448×72, padding 12, gap 12, radius 8, light surface #FBFBFC; thumbnail 72×48.
- Body 16/24; reference text 12/18; static Logo and icons follow actual source assets; user photos are dynamic-data examples only.
- Adapt dark mode through semantic tokens; keep development IDs, internal model-call parameters, and fake progress out of the UI.

<a id="来源与持久化"></a>

## Sources and Persistence

Add optional `sourceMessageId` to sent `UserImageEditReference`, pointing to the assistant SDK UUID that produced the exact image. During saving, `appendSDKMessages` validates and fills it using existing successful image generation tool_use / tool_result in the current conversation, exact imageId, and localPath. Image IDs, filenames, original image paths, and other message content remain unchanged; do not rely on latest, fabricate provenance, or rewrite real history.

When old messages lack sourceMessageId, restore it using the same exact binding before that user message; later artifacts with the same name cannot retroactively become old reference sources. Stale/missing old UUIDs may recover only to a uniquely matching actual image source. Missing/ambiguous sources or absent stable UUIDs show an unlocatable state; images remain previewable. Uploaded attachments do not create reference cards.

The shared pure helper lives at `packages/shared/src/agent/image-reference-source.ts`; persistence only integrates the helper. UI version collection and selection carry the source UUID, with matching behavior for optimistic and historical messages. No new IPC.

<a id="导航与交互"></a>

## Navigation and Interaction

- Reference thumbnails open existing ImageLightbox; Escape/close restores focus to the trigger button.
- Source buttons map actual SDK UUIDs to currently rendered turns; temporary WeakMap group IDs are not persisted.
- Navigation first saves the reading anchor and relative position, stops automatic bottom sticking, then scrolls to and briefly highlights the source.
- Back buttons restore position and focus from a stack; consecutive jumps, multiple returns, repeated clicks, and message loading/layout changes must not send users to the wrong message.
- Switching conversations clears navigation state; reduced motion uses instant scrolling. Missing sources and image read/decode failures preserve stable cards and explicit bilingual fallbacks.
- Image generation status uses actual calls to show generating, all complete, partial failure, incomplete, stopped, or failed, preserving collapsible process details; counts do not masquerade as reasoning progress.
- Soft-interruption results and hard-stop host `asci_turn_stopped` system facts belong to the original turn; continuing the conversation does not erase historical stop state. Old history without terminal records cannot recover invented stop facts.
- Clicking stop immediately synchronizes existing running and stop atoms; retained live messages no longer appear to be generating.
- The composer retains actual attachments, model/mode, and stop logic, with dimensions and hierarchy adjusted to the current artboard.

<a id="实施顺序与验证"></a>

## Implementation Sequence and Validation

1. Write source-binding/old-ID/ambiguity/upload-distinction tests first, observe failures, then implement the helper and actual JSONL save/reopen regression.
2. Add source navigation provider, user attachment/bubble components, and reference cards, reusing viewer, buttons, and i18n.
3. Align message flow, statuses, and composer; add light/dark semantic tokens and synchronize docs/design.md.
4. Use synthetic data in a real browser/Electron to validate reopening new/old conversations, jump/highlight/back, multiple jumps, repeated clicks, preview close, missing sources, broken images, uploaded images, desktop/narrow windows, en/zh, and reduced motion. Save local evidence; do not read real conversations or call paid generation.
5. Run relevant tests, lint, repository-wide typecheck/test, and renderer/main builds. After review, push only task source code/tests/necessary documentation to the private repository. Any PR must be Draft; do not merge main, enable auto-merge, or change the current app.
