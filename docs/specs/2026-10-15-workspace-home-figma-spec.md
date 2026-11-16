<a id="asci-首屏按确认-figma-稿落地"></a>

# ASCI Home Screen Implementation from the Approved Figma Design

Status: implemented and page-level acceptance completed
Related issue / PR: none (local changes)
Domain source of truth: docs/design.md, docs/i18n.md; existing session, project, and preview atoms
Design: https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/ASCI?node-id=47-57

<a id="实现范围"></a>

## Implementation Scope

- Reuse the current ASCI-MacOS workspace and retain existing Google sign-in and custom-model changes.
- Use the official ASCI icon, welcome heading, input area capped at 888px, and three suggestion capsules on the home screen; follow the latest design version.
- List real Projects alongside the Recent group in the sidebar; retain project creation/management, settings, evidence sets, and files; do not insert sample projects or models from the design.
- Reuse RichTextInput / ModelSelector / PermissionModeSelector and the actual send logic; suggestions only populate the input and never send automatically.
- Collapse the right panel by default; retain existing automatic artifact previews. Manual preview and the top-bar button can open it, and the panel can be closed.
- Keep en/zh in sync; use semantic theme tokens and system fonts; add no dependencies and change no IPC.

<a id="实施与验收"></a>

## Implementation and Acceptance

- [x] Write project-list and home-screen suggestion behavior tests first.
- [x] Implement page layout, navigation, and bilingual copy.
- [x] Check the empty state, real-project switching, model selection, suggestion insertion, sending after input, and right-panel toggle.
- [x] Run typecheck, related tests, ESLint, and renderer build; record repository baseline issues.
- [x] Compare against Figma at 1600×1000, check small windows and dark mode, and save actual rendered previews.

<a id="验证记录"></a>

## Validation Record

- Reading the current design confirmed a 58px hero icon and 42px main heading; the subtitle has been removed and the input moved upward. Implementation follows the current node.
- Actual component rendering at 1600×1000: input x=496, y=403.5, 888×176; Logo 58×58 at x=911, y=251; heading y=317. Uses the project's required system font.
- Browser acceptance with actual AppShell / AgentView and isolated IPC fixtures passed navigation collapse/expand, suggestions populating without sending, disabled empty input, exactly one existing IPC call after sending, model selection, and right-panel toggle; en/zh, dark mode, and 1024×768 had no horizontal overflow or page exceptions. The acceptance entry point was deleted, and test data was not written into the production UI.
- Project switching/creation, document-panel session isolation, compatible file previews, home-screen suggestions, and bilingual key sets: 26 related tests passed.
- Repository tests: 2994 passed, 2 failed. Failures were Tooltip / floating-surface corner-radius assertions in untouched code, matching the previous existing baseline.
- Retain settings, evidence sets, Zotero, and project-file entry points; the project heading opens existing project management, and the plus button on the right still creates projects.
- Typecheck, target-file ESLint, and renderer build passed; no real-model inference was run and the installed client was not repackaged or replaced.
