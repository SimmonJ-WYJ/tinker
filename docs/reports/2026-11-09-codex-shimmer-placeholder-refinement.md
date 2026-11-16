<a id="用户复调浅色占位与-codex-式扫光"></a>

# User Refinement: Lighter Placeholders and Codex-Style Shimmer

This round continues on local branch fix/config-placeholder-loading-contrast from f04afa7. The user explicitly requested lighter placeholders and a running-state base text color and lighting modeled on Codex, then requested a further adjustment limited to lighter examples inside fields.

<a id="最终改动"></a>

## Final Changes

- New channel-form.css targets only input::placeholder and empty Base URL descriptions in model configuration.
- Light-theme placeholders changed from #737373 through #999999 to #B4B4B4; helper text is #8F8F8F. Dark-theme placeholders are #858585; helper text is #999999.
- Real input, labels, and required-field feedback retain their colors; URL example prefixes, empty-value gating, and actual endpoint previews retain the previous commit's behavior.
- Running text uses light #5D5D5D and dark #CDCDCD at 55% opacity, with a narrow white highlight at 75%, replacing the persistently dark primary title appearance.
- .6s initial wait, 1s sweep, 48 steps, and a 4s cycle; the base text remains visible otherwise. CSS background clipping uses a single text copy without duplicating accessible text or adding JS timers.
- reduced-motion and forced-colors restore ordinary text; configuration placeholders use system GrayText in forced-colors.

<a id="参考与边界"></a>

## References and Boundaries

Read-only inspection of local `/Applications/ChatGPT.app/Contents/Resources/app.asar` covered Codex CadencedLoadingShimmer styles and timing: 55% base color, 75% highlight, half-text-width gradient, 600ms initial wait, 1s/48 steps sweep, and 4s scheduling. Source CSS/JS remains in /tmp for comparison and is not committed to the project. No chats, authentication, screenshot Keys, or other personal data were read.

GPT uses different placeholder tokens in different input contexts. This round uses #B4B4B4 for the user's requested light-gray appearance, without claiming all GPT forms share this color. Tinker's font, font size, and layout remain; Codex visibility scheduling was not copied.

The user's choice this round overrides the previous visual target of “at least 4.5:1 at all shimmer endpoints” (English translation). Contrast figures in the old report describe f04afa7 only, not this lighter visual design.

<a id="验证"></a>

## Validation

- Final repository-wide result: 3459 pass, 4 existing skip, 0 fail; 3463 tests / 384 files.
- Typecheck: 6 workspaces passed; lint and Electron build passed.
- The first parallel full-repository run hit an existing runtime-provisioner test's 5s timeout. Runtime code was unchanged; the complete rerun passed after concurrency ended.
- Real-browser checks covered placeholder, helper, and actual input colors in light/dark themes, Chinese/English, 390px, stop/restart, reduced motion, and forced colors.
- Time sampling verified the .6s wait, 1s sweep, idle interval, and reset; text ranges stayed fixed and single-copy title accessibility semantics remained.
- Floating-point sampling at exact cycle boundaries initially failed; sampling 10ms after the boundary passed. Dark input checks passed after waiting for the existing 300ms theme transition, with no production-code bypass.
- `/tmp/tinker-ux-contrast-qa-20261109/preview-v3-result.json` is the final preview verification; native model requests: 0.
- Temporary preview entry points did not enter the production commit; the independent static preview remains at `/tmp/tinker-ux-view-20261109`, served locally at 127.0.0.1:5204.

After confirming the preview, the user authorized uploading to GitHub. This round only pushes an independent branch and creates a Draft PR; it does not merge, install, or replace the desktop DMG. The current 0.1.615 installation will not automatically update; the source version is 0.1.616, maintained by commit hooks.

Synthetic screenshots for PR review: [Light](./assets/2026-11-09-provider-shimmer-light.png), [Dark](./assets/2026-11-09-provider-shimmer-dark.png). Both contain only simulated forms and chat statuses, without user screenshots, real conversations, or client configuration.
