# Tab Strip Unification Spec

Status: implementing
Related issue: N/A
Related PR: N/A
Domain language sources of truth: `CONTEXT.md`, `docs/specs/right-panel-tab-bar-chrome-spec.md`, `docs/specs/workspace-scoped-tabs-spec.md`

<a id="背景"></a>

## Background

The main conversation header and right-panel header previously both used tabs, but their information architectures differ. The main header currently shows only the current session and shares global session navigation with the left session list; the right panel shows contextual tabs within the current session (session files, search papers, paper/file details, etc.), which have clear value within the local workspace.

<a id="目标"></a>

## Goals

1. Use a Codex-style single-line header above the main conversation, showing only the current session title and a more-actions entry, without a session-type icon or close button. This reduces duplication with the left session list and avoids presenting one item as a tab.
2. Continue showing multiple contextual tabs at the top of the right panel, preserving the accumulated file/paper-detail model.
3. Reuse the same basic primitives for the main title bar and right-panel tabs, unifying icons, close buttons, and text truncation; only the right-side multi-item menu keeps the active tab-chip appearance.

<a id="非目标"></a>

## Non-goals

1. Do not change tab-state storage structures.
2. Do not remove multi-session state; change only the main header's visual presentation.
3. Do not change dynamic right-panel tab open/close semantics.

<a id="行为"></a>

## Behavior

- The main header selects the active tab from visible tabs in the current workspace; if the active tab is hidden, fall back to the first visible tab.
- The main header no longer displays other session tabs horizontally or uses rounded/floating tab chips; it is a single-line header with the current session title on the left and more actions beside it. Session switching continues through the left session list.
- Clicking more actions in the main header opens a menu containing at least rename-current-session and open-session-folder actions.
- The main content no longer renders a second session-title row, avoiding duplicate titles.
- The right panel still displays all right panel tabs for the current session.
- Right-panel tab chips share style generators such as `tabStripChipClassNames()`; the main header uses `currentConversationStripClassNames()` for the Codex-style single-line title entry.

<a id="验证"></a>

## Validation

- Unit tests cover main-header tab selection.
- Unit tests cover active/inactive classes for right-panel tab chips and verify that the main-header flat strip lacks active tab-chip classes.
- Run `bun run typecheck`.
- Run `bun test`.
- Visually inspect the main header and right-panel tabs through `bun run dev` or `bun run electron:start`.
