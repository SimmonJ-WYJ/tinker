<a id="聊天输入框排版修复验收"></a>

# Chat Composer Typography Fix Acceptance

Baseline: main `3787f343c19985a85367592b69f6f5b0f07d6645`. Local branch `fix/composer-placeholder-alignment`. This report establishes only this round's code and local acceptance results; it does not indicate a new installation package was published or the user's app updated.

<a id="原因与改动"></a>

## Cause and Changes

The user's screenshot was successfully saved locally through Library and viewed. RichTextInput rotating hints retained fixed left/top offsets, font size, and line height after chat-page styles changed: the editor actually used zero padding and 16px text, while hints retained 15px/9px offsets and separate typography.

- Added `rich-text-input-layout.css` to centralize default padding, font size, and line-height variables shared by the editor and rotating hints.
- `workspace-home.css` and `conversation-flow.css` now set this same variable set per context; editor minimum heights retain their original values.
- Chat input text changes from 16px to 14px with 22px line height. Homepage and standalone inputs remain 15px/24px.
- Rotating suffixes use block line boxes to avoid inline-block's extra baseline. The fixed prefix is not animated.
- Outer frames, colors, toolbars, input/IME events, send/stop callbacks, and data models are unchanged; no IPC, Rust, or dependency changes.

<a id="实际浏览器红绿回归"></a>

## Real-Browser Red/Green Regression

An independent blank browser uses actual RichTextInput, AttachmentPreviewItem, and production CSS. All inputs and attachments are synthetic; no Agent was called.

| Metric | Before | After |
| --- | --- | --- |
| Hint X difference relative to actual text Range | 15 CSS px | 0 CSS px |
| Y difference | 9 CSS px | 0 CSS px |
| Hint/editor text font size | 14px / 16px | 14px / 14px |
| Hint/editor text line height | 21px / 22px | 22px / 22px |
| Coordinate assertion | Expected failure | Passed |

All 25 browser scenarios passed without pageerror. Coverage includes English/Chinese, 1440/390 widths, CSS zoom 80%/100%/125%, empty focus/blur, clearing after input, single/multiline, synthetic attachments, clearing after internal multiline scrolling, synthetic IME and send guards, static hints/stop button layout during generation, homepage, standalone input, rotating prefix stability, and light/dark themes. All alignment assertion errors were 0px.

<a id="自动检查与复审"></a>

## Automated Checks and Review

| Check | Result |
| --- | --- |
| Related input intents, paste classification/roundtrip | 15 pass, 0 fail, 22 assertions |
| Repository-wide Bun | 3443 pass, 4 existing skip, 0 fail, 9107 assertions |
| Typecheck | All 6 workspaces exited 0 |
| Lint | Exit 0 |
| Electron build | Exit 0; normal sign-in and Candidate configuration isolation preserved |
| Independent read-only review | No blockers in CSS overrides, all RichTextInput call sites, or behavior differences |
| Simplification check | Base typography centralized; contexts override variables only, with no extra abstractions |
| Diff check | Passed |

The 4 skips are existing packaged rg binary integration tests; no new skips or hidden failures. The first local fixture started from the wrong directory and did not load Tailwind. Coordinate red tests were recorded only after correcting the start directory; loading failures are not treated as product regression evidence.

<a id="本机证据与限制"></a>

## Local Evidence and Limitations

Logs, reproducible fixtures, and synthetic screenshots remain locally at `/tmp/tinker-composer-qa-20261109/`: `before.json`, `after.json`, `matrix-result.json`, `composer-light.png`, `composer-dark.png`, `composer-narrow.png`. Screenshots were actually viewed: text starts align with no narrow-window clipping. Temporary HTML/TSX entry points were removed from the source tree and are excluded from production builds and this commit; screenshots were not uploaded to Library.

IME acceptance uses Chromium CDP composition and DOM events, without real macOS/Windows input-method candidate windows. Zoom uses browser CSS zoom, not Electron menu zoom acceptance. Send and stop use synthetic callbacks and establish only UI input and status layout; no real model or generation requests were triggered. This round did not run production-account end-to-end tests, read real conversations, package, replace the current installation/app, or automatically merge.

GitHub UI review uses three synthetic screenshots at `docs/reports/assets/2026-11-09-composer-{light,dark,narrow}.png`. These contain only input components and simulated content, without original user chats or screenshots; they were not uploaded to Library.

Implementation commits and GitHub status are governed by the delivery message. This round does not change README/CLAUDE or the user's manual designs.
