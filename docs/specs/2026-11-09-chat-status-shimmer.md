<a id="聊天思考与生成文字流光"></a>

# Chat Thinking and Generation Text Shimmer

Status: Implementation, red/green regression, final automated checks, real-browser acceptance, and independent review complete. Baseline main `842c89e`.

<a id="已确认设计"></a>

## Confirmed Design

Remove the standalone sphere in chat; waiting rows reuse the static ConversationSymbol, with motion limited to actual primary status text to the right of the Logo. Preserve image generation secondary text, expansion controls, historical responses, and real tool statuses. A CSS text gradient sweeps approximately once every 2.6s without movement, pulsing, or invented progress. Use shared RunningStatusText without duplicating accessible text or introducing timers or dependencies.

Options compared: A single CSS text gradient is reusable and preserves native text, so it is selected for this round. Duplicated text layers increase layout and screen-reader duplication risks. Canvas is unsuitable for this text-level status adjustment.

<a id="范围与约束"></a>

## Scope and Constraints

- AgentMessages waiting/running rows use the existing static Logo.
- SDK process titles, image generation titles, and current thinking/execution titles share running text; highlights appear only in actual active states.
- Chat scroll navigation removes the sphere and uses existing up/down arrows, preserving navigation to latest position/reading position and button text.
- The context usage badge is outside this chat thinking row change; preserve its compaction hint functionality.
- Support Chinese/English, light/dark themes, reduced motion, and forced colors. Fall back to ordinary text when gradients are unsupported.
- Leave Rust, SDK/tool authorization, data models, real conversations, and installation packages unchanged. No publication or main merge this round.

<a id="实施与验证"></a>

## Implementation and Validation

- [x] Add failing behavior tests for existing AgentMessages / SDKMessageRenderer / ImageGenerationStatus / current thinking titles and scroll navigation.
- [x] Implement a shared text component and scoped CSS, replacing spheres and pulses in running rows while preserving static text and control semantics.
- [x] Regress start, thinking-to-generation, completion, cancellation, and failure; ensure no duplicate primary statuses or lingering highlights.
- [x] Check Chinese/English, light/dark themes, narrow windows, stationary text, actual highlight motion, and reduced-motion/forced-colors in a real browser.
- [x] Run relevant tests, full Bun suite, typecheck, lint, and Electron build; independently review and save local commits and acceptance reports.

Running-state boundaries: Read only the existing queuedMessageUuidsAtom; optimistic queuing does not count as consumption. Limit the current tail turn using accepted user input and compact_boundary/compacting; older turns remain static. Body-only output preserves the original trailing status without duplicating the Logo. Regressions cover empty/whitespace first-token text and host stop/failure arriving before streaming updates.
