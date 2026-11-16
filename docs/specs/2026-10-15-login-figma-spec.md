<a id="asci-登录页-figma-实现"></a>

# ASCI Login Page Figma Implementation

Status: Implemented; page-level validation complete
Related issue / PR: None (local changes)
Domain sources of truth: docs/design.md, docs/i18n.md, existing Google OAuth entry point
Design: https://www.figma.com/design/qNZ4GSgKdkHK51a5x79VF8/ASCI?node-id=22-2

<a id="设计与范围"></a>

## Design and Scope

- Modify LoginPage in the current ASCI-MacOS workspace, preserving existing Google OAuth development.
- Reproduce the desktop black-and-white two-column layout: light gray brand area, AI Coding heading, and three identically sized white cards on the left; welcome, login, cancel, local-data notice, and terms on the right.
- Reuse the official AsciIcon and existing GoogleIcon; the button signs into Google and therefore uses the matching Google mark.
- Reuse Button, TitlebarDragRegion, and semantic color tokens; follow the system sans-serif font convention. Add no dependencies or global theme changes.
- Add all new copy in both en/zh; use a vertical, scrollable layout in small windows and adapt dark mode through existing semantic tokens.
- Preserve OAuth start/cancel, pending, error messages, window closing, and legal-link behavior.

<a id="实施计划"></a>

## Implementation Plan

- [x] Add login interaction regression tests covering Google startup, pending cancellation, legal links, and bilingual cards.
- [x] Update en/zh login.json; compose existing components for the page and local responsive styles.
- [x] Run login tests, bilingual key validation, repository-wide typecheck and tests, and renderer build; record pre-existing errors separately.
- [x] Render the 1440×960 target view and check narrow windows, dark mode, English and Chinese, and pending/error states.

<a id="行为验收"></a>

## Behavioral Acceptance

1. When logged out, three complete cards are visible; the third has the same dimensions as the first two and includes a subtitle.
2. Clicking Google login triggers only the existing Google provider and enters the waiting state; cancellation restores the login button.
3. Authorization failures remain retryable; legal links open through electronAPI.openExternal.
4. English and Chinese show no raw keys; controls remain reachable in smaller windows and the page has no horizontal overflow.

<a id="验证记录"></a>

## Validation Record

- Type checking: Passed across the monorepo; renderer production build passed.
- Login page and i18n key validation: 16 passed; 14 Google OAuth / bridge loopback tests passed when local listening was permitted.
- ESLint: Login component and tests passed. The user-confirmed design retains 10–12px helper copy, with a file-level exception to the minimum font size rule; global font size settings are unchanged.
- Mounted the actual LoginPage directly in a browser (temporary test entry, removed after acceptance): compared 1440×960 with Figma; checked the official ASCI mark and Google login mark, 56px buttons, 24px login icon, three 608×108 white cards, and complete subtitles. No horizontal overflow at 390px / 1024px; en/zh, dark mode, waiting/cancellation, retry after authorization failure, and legal links all passed, with no page JS exceptions.
- Repository-wide tests: 2987 passed, 3 failed. Two unchanged Tooltip / floating-surface corner-radius assertions failed, and one built-in capability package loader beforeEach/afterEach timed out; these components were not changed in this work.
- No actual Google account authorization or replacement of the installed client was performed.
