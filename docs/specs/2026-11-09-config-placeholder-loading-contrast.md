<a id="配置空值引导与运行文字可见度"></a>

# Empty Configuration Guidance and Running Text Visibility

- Status: Implementation and acceptance complete; user confirmed and authorized pushing a separate GitHub branch, without automatic merging or installation
- Baseline: main d94a3f0; the user is running the mounted Electron 0.1.615
- Scope: ChannelForm Base URL empty state and placeholder copy; RunningStatusText visual parameters

<a id="设计"></a>

## Design

- Base URL placeholders use a localized "For example:" prefix; the example is never written into value.
- When empty, display a short explanation associated with the input; restore the actual endpoint preview after entry.
- When name and Key are filled, the top notice for a missing Base URL takes priority over model and connection-test notices.
- Per the user's final confirmation, reduce only the visual prominence of configuration placeholders and empty-state explanations; light-mode placeholders use #B4B4B4, preserving actual input, labels, and disabled controls.
- Text shimmer references local Codex: 55% secondary gray text, 75% white narrow highlight band, .6s entry wait, 1s sweep, 4s cycle.
- Text and Logo stay stationary. Reduced motion and forced colors restore ordinary text. See the retuning report for final parameters and evidence.
- No authentication, storage, model authorization, or Rust changes; no user screenshots or real keys are used.

<a id="实施与验证计划"></a>

## Implementation and Validation Plan

- [x] Recheck version, workspace, and relevant test baselines.
- [x] Add Chinese/English empty-state semantics, entry/clearing, and button-gating regressions and observe failing tests.
- [x] Render current loading behavior in an actual browser; record gradient endpoints, motion, and pixels to establish visibility baseline.
- [x] Make minimal changes to ChannelForm, en/zh channels.json, and scoped running-status-text.css.
- [x] Regress empty/filled states, light/dark mode, narrow windows, reduced motion, forced colors, and animation start/stop.
- [x] Run typecheck, lint, relevant and repository-wide tests, and Electron build; remove temporary QA entries and save a local commit.

<a id="判断边界"></a>

## Assessment Boundaries

- The parent task inspected the original image, which contains authentication information; this round does not receive, save, or forward it.
- Static form acceptance cannot prove dynamic shimmer; shimmer requires actual browser time sampling and visual inspection.
- Browser validation with synthetic data does not establish actual account/model end-to-end behavior or that the current installed package was updated.
