<a id="配置占位与-loading-可见度验收"></a>

# Configuration Placeholder and Loading Visibility Acceptance

This report covers the first round, f04afa7; subsequent user refinements and the final light-theme approach are recorded in the [Codex-style shimmer refinement record](./2026-11-09-codex-shimmer-placeholder-refinement.md).

<a id="版本和范围"></a>

## Version and Scope

- Read-only inspection confirmed that the running process came from `/Volumes/Tinker 0.1.615-arm64/Tinker.app`, whose package records main `d94a3f06ee9ea0bba2d017248a4e948e7a87dfad`.
- Tinker.app was absent from both common Applications paths; a desktop DMG or execution from a mounted image cannot be considered a completed installation.
- Continued using the clean isolated workspace `/tmp/tinker-chat-status-shimmer-20261109`, local branch `fix/config-placeholder-loading-contrast`, baseline main d94a3f0.
- Changed only Electron configuration forms, localization, and running-text CSS/tokens; no real credentials, data, image authorization, or Rust changes.
- The parent task viewed the original user screenshot; this task received and saved no original image containing a Key. Reproduction used only fake fixture values.

<a id="诊断与改动"></a>

## Diagnosis and Changes

- Actual baseline form placeholders were rgb(115,115,115), input rgb(10,10,10), already differing in gray level. Bare URL examples, unexplained empty values, and prompting connection testing first caused confusion.
- Base URL placeholders became a Chinese "for example: https://api.example.com" and "e.g. https://api.example.com"; neither is ever used as the value.
- Empty values gained explanatory text linked through aria-describedby; actual endpoint previews remain after entry. When Name/Key are complete but URL is empty, the top prompt asks for the URL first.
- Other configuration fields already had "for example" or input-action hints; retain their readable gray levels without globally fading Input or disabled controls.
- The previous narrow shimmer used .72→1 alpha of the local foreground; the workbench foreground override made its variation weaker.
- Added running-text-base/sheen semantic tokens for both themes, widened the shimmer, changed background size 240%→200% and period 2.6s→2.4s. Light theme uses dark text with a light sweep; dark theme uses secondary text with a bright sweep.
- Preserved Logo, text geometry, subtitle, expand button, actual state semantics, and reduced-motion/forced-colors fallbacks.
- Independent review found insufficient contrast on a light-gray surface; reduced the light theme's brightest endpoint from 45.1% to 42% to preserve readability.

<a id="证据与结果"></a>

## Evidence and Results

| Check | Result |
| --- | --- |
| Related baseline | 6 pass, 0 fail |
| New regression red tests | Both en/zh failed on bare URL placeholders, matching the missing behavior |
| New regression and related green tests | 8 pass, 0 fail, 74 assertions |
| Final repository suite | 3459 pass, 4 existing skip, 0 fail, 3463 tests / 384 files |
| Typecheck | All 6 workspaces exited 0 |
| Lint / Electron build | Both exited 0 |
| Independent review | Readability boundary corrected; no remaining blockers |
| Browser state regression | 62 checks, errors=[], covering both languages/themes, narrow windows, start/stop, reduced motion, and forced colors |
| Form and motion visuals | 7 checks, errors=[], passed empty/filled/cleared values, button states, previews, and static geometry |
| FlowRow and muted surfaces | 4 checks; light minimum 4.75:1, dark minimum 5.47:1 |

On ordinary chat surfaces, the gradient endpoint red-channel difference changed from 59.36→84 in light mode and 55.72→97 in dark mode; positions differed across five time samples while text bounds stayed fixed. Minimum endpoint contrast on ordinary chat surfaces was 5.19:1 and 5.82:1 respectively. These are calculations for the actual tested surfaces, not a visual guarantee for every user's display.

The first repository run hit sandbox localhost/subprocess restrictions, failing 15 existing network/runtime cases. No tests were bypassed; rerunning the entire suite with normally authorized permissions passed. Previous typecheck and lint also passed, and the final code passed checks again.

<a id="本机视觉证据与界限"></a>

## Local Visual Evidence and Limits

- `/tmp/tinker-ux-contrast-qa-20261109/result.json`: 62 state checks
- In the same directory, `form-motion-result.json`, `capsule-result.json`: forms, motion, and actual-background contrast
- Actually viewed `form-zh-light.png`, `form-en-dark.png`, `form-narrow.png`, and `after-{light,dark}-{time}.png` in the same directory
- Temporary ux-qa.html/tsx were removed from the renderer directory; fixtures and synthetic screenshots remain only in /tmp, with none committed to production or uploaded to Library
- This was local-code acceptance and does not mean the current 0.1.615 or DMG was updated. No push, merge, repackaging, or installation occurred.
- No real accounts, real models/paid image generation, native Electron manual interaction, or manual screen-reader acceptance were used.
