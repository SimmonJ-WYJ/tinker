<a id="聊天输入框占位与光标对齐"></a>

# Chat Composer Placeholder and Caret Alignment

Status: Screenshots reviewed; browser red/green regression, boundary acceptance, aggregate checks, and independent review complete. Baseline main `3787f34`.

Goal: Align rotating hints with the actual start of edited text and change the chat input font size from 16px to 14px, preserving the outer frame, colors, toolbar, and send logic.

<a id="原因与方案"></a>

## Cause and Approach

- `conversation-flow.css` sets chat editor padding to 0 and font size to 16px.
- Rotating hints in `rich-text-input.tsx` still use absolute positioning at 15px/9px and separate 14px/normal typography.
- Unify padding, font size, and line height for the editor and rotating hints through component CSS variables.
- `workspace-home.css` and `conversation-flow.css` only set variables, preserving each context's external layout and minimum height.
- Preserve existing suffix transitions; the prefix and suffix share a line box, removing inline-block layout that introduces an extra baseline.

<a id="执行与验收"></a>

## Implementation and Acceptance

- [x] Mount the real RichTextInput and production CSS in an independent browser fixture; record coordinate differences between hints and actual text ranges before the fix.
- [x] Make minimal changes to the three files above; assert identical starting positions and baselines using actual DOM Ranges and hint text ranges.
- [x] Recheck empty, focused, blurred, typing and clearing, single/multiline, Chinese/English, IME events, zoom, attachments, scrolling, and send/stop states.
- [x] Check that homepage static hints and ordinary rich text inputs do not regress through the shared component.
- [x] Run relevant input/conversion/mention tests, repository-wide typecheck, lint, Bun tests, and Electron build.
- [x] Independently review and save local commits and acceptance records; leave Rust, README/CLAUDE, and user data unchanged.

Browser fixtures, synthetic attachments, and local screenshots are acceptance evidence only; they must not become production entry points or uploaded screenshot attachments. This round does not replace an installation package, install, publish, or automatically merge.
