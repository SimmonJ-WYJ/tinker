<a id="tinker-消息流与图片引用验证"></a>

# Tinker Message Flow and Image Reference Validation

This report covers `feat/message-reference-flow`, based on [Figma Conversation surface 115:604](https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/Tinker?node-id=115-604). Old node 106:178 was deleted; no pixel-level acceptance is claimed from it.

<a id="本次交付与提交关系"></a>

## Deliverables and Commit Relationships

- Baseline main: `fbde681afe228e408c73e5e6125fd72c658f1f2c`.
- Google authorization packaging fixes: `77d5f36`, `3cfc286`, preserved in full; no real client configuration, tokens, or user profiles entered the repository.
- Reference UI: `865b59ca50e4fb3acd0f219a43d04f88d4e00b06`. Uploaded images sit outside bubbles; historical reference cards inside; previews, exact-source navigation, highlighting, stack-based return, old-data/failure fallbacks, and synchronized image-generation state/input hierarchy.
- Natural image continuation fix: `c4cbab62a85d99a0b4b2fa9db0cbaab694b21d23`; integrated without conflicts through `f946135`. Original authorization packaging and reference UI are preserved. Detailed independent evidence is in the [image continuation report](2026-11-08-image-context-validation.md).
- Versions follow the repository's automatic patch rule: Electron 0.1.612, shared 0.1.143, root 0.1.41. No new installer was made, installed, or replaced; main was not merged.

<a id="最终组合分支检查"></a>

## Final Combined Branch Checks

| Check | Result |
| --- | --- |
| `bun run typecheck` | All 6 workspaces exited 0 |
| `bun test` | **3361 pass、4 skip、0 fail**；3365 tests / 378 files / 8795 assertions |
| `bun run lint` | Repository exited 0 |
| `bun run electron:build` | main, preload, renderer, resources all exited 0 |
| 8 targeted reference files | 37 pass, 0 fail; 127 assertions |
| `git diff --check` | Passed |
| Independent read-only review | No remaining blockers after soft/hard-stop and immediate-stop fixes; integration review passed |

In the initial restricted-sandbox full run, local callback/bridge listeners were prohibited, and two existing image-fallback tests exposed a visible-error-message regression. Explicit visible bilingual errors were restored, and the final full checks above were rerun in an environment allowing local loopback. Product code was not changed to bypass port restrictions.

<a id="真实浏览器验收"></a>

## Real Browser Acceptance

Used actual `AgentView`, `AgentMessages`, SDK renderer, model/reasoning menus, image viewer, and message input. Only the IPC bridge was replaced by a synthetic implementation; data/images were temporary generated fixtures, not a screenshot masquerading as a product page.

- Actual scroll navigation highlights the source; repeated clicks do not add return layers. Highlight clears after 1800ms while the return entry remains available.
- After sequential jumps to two different sources, return restores the reading anchor, relative position, and focus from each click in order; return uses the original scroll container, independent of page scrolling.
- Reference thumbnails and uploads each open full previews; Escape/close restores focus to the triggering button.
- Missing sources disable navigation; image-read/decode failures retain card/upload positions; reference cards show visible errors and thumbnails retain retry actions.
- Old references recover the actual preceding UUID after reopening through exact image ID+path; plain uploads have no reference cards; sources appearing only later remain unlocatable (regression tests cover both actual renderer and shared helper).
- Image-generation progress is collapsible; all-success, partial-failure, no-result, stop, and failure states never impersonate one another. Stop calls the existing API and changes state immediately.
- Model/reasoning menus open and support actual selection; reuse existing state without a second model configuration.
- English/Chinese, light/dark, 1440 / 768 / 390px, and reduced motion passed. No horizontal page overflow; browser runtime errors 0.
- `appendSDKMessages` actually writes JSONL; reopening in a second independent process retains original-source binding; historical prefixes, ordinary uploads, and other fields remain unchanged.
- Hard stop adds an independent host system termination fact without fabricating an SDK result. Repeated stops do not append duplicates; clearing the next-round session marker preserves old-round facts.

Temporary `reference-qa.html/.jsx` was removed from product source and excluded from production builds/Git commits. QA scripts, synthetic images, logs, and browser profile remain locally in `/tmp/tinker-reference-browser`. Evidence below contains only synthetic content, with no real user sessions or photos.

| Figma geometry target | Browser measurement |
| --- | --- |
| Content/input width 832 | 832px (column including horizontal margins 880px) |
| User reference bubble width 480 | 480px |
| Reference card 448×72 | 448×72px |
| Reference thumbnail 72×48 | 72×48px |
| Upload preview 112×148 | 112×148px |
| Input height 125 | 125px |
| Model/reasoning button minimum width 90 / 108 | 90 / 108px |
| Body color #252B30 | rgb(37, 43, 48) |

[Light English screenshot](assets/message-reference-20261108/light-en.png) · [Dark Chinese screenshot](assets/message-reference-20261108/dark-zh.png) · [390px narrow-window screenshot](assets/message-reference-20261108/narrow-390.png)

<a id="验收边界"></a>

## Acceptance Limits

- No paid image generation or real model used for end-to-end validation; the image-continuation handler uses a fake network, as detailed in its independent report.
- No real Google-account sign-in repeated; preserve previously validated packaging fixes without real OAuth configuration.
- Browser acceptance covers real components and synthetic IPC; this round ran no new installed Electron version and did not validate local signing/notarization or distribution updates.
- User photos are dynamic data, never hardcoded into the product; key desktop geometry follows Figma measurements, while font rasterization, content length, and OS differences still affect full-page pixels.
- Old hard-stop history without a termination fact cannot retrospectively prove "stopped"; show incomplete without assuming success or stop.
- Remote push and CI status must use actual remote results at delivery; local passing does not mean GitHub CI passed.

<a id="远端核对"></a>

## Remote Verification

Successfully pushed to the authorized private `SimmonJ-WYJ/tinker`, branch `feat/message-reference-flow`; remote main remained `fbde681`. The push hook reran typecheck and the full suite: **3361 pass / 4 skip / 0 fail**.

GitHub returned 0 check runs, 0 commit statuses, and 0 Actions runs for pushed `13c3d51`; source also contains no `.github/workflows`. The combined status's default `pending` does not mean a job is running. This round adds no CI configuration independently and does not call local passing GitHub CI passing. Final branch SHA and corresponding status are rechecked at delivery.
