<a id="右栏标签栏-chrome-化-&#45;设计规格"></a>

# Chrome-style right-panel tab bar — Design specification

- Status: Implemented (PR pending)
- Related branch: `feat/chrome-style-tab-bar`
- Domain-language source of truth: this file + `apps/electron/src/renderer/atoms/right-panel-tabs.ts`
- Replaces: “Closed-tab history / History entry” in PR #550 (merged); this design replaces it with open-tab search

<a id="目标"></a>

## Goal

Align the right-panel tab bar with Chrome browser tab behavior: persistent accumulation, adaptive widths, horizontal scrolling, tab search, and fine-grained closing.

<a id="行为规格"></a>

## Behavior specification

1. **Accumulate**: All opened tabs persist without automatic cleanup until manually closed.
   - Paper details **get independent tabs by paper identity** (reversing #444 single-slot reuse): `tabIdOfTarget` for paper/paper-entry
     returns `paper:<key>`, with key from `recordKey(record)` / `entry.key` (both DOI-first, sharing the same source logic).
     A search record and library entry for the same paper converge on one tab (kind changes accordingly); different papers accumulate independently.
   - file-preview remains independent by path.
2. **Default tabs persist and cannot close**: `session-files` / `session-papers` always lead, have no × button, and cannot close
   (the session files panel must persist; with no closed-tab history, closing it would leave no way to restore it), but scroll horizontally with other tabs rather than being pinned.
3. **Adaptive width**: Tabs use `flex:1 1 auto` + `min-w 56px / max-w 180px`; when numerous, they shrink proportionally; at very narrow widths only
   the icon + truncated title remain, with the full name in a hover tooltip.
4. **Overflow scrolling**: Scroll horizontally beyond the visible width (`overflow-x-auto` + `scrollbar-none`); show ‹ › arrows at either end as needed;
   on active-tab changes, `scrollIntoView` scrolls it into view. Tabs no longer hide in a dropdown.
5. **Tab search/list**: A right-side 🔍 popover lists all open tabs, filters by title, and activates and scrolls to a selected tab.
6. **Closing methods**:
   - Individual × on each non-default tab (and middle-click to close).
   - Right-click a tab → context menu: `关闭` / `关闭其他` / `关闭右侧标签` (Close / Close others / Close tabs to the right; all skip default tabs).
   - **No** top-level one-click “Close all” action.

<a id="数据模型right-panel-tabsts"></a>

## Data model (right-panel-tabs.ts)

- `SessionTabsState = { tabs, activeId }` (remove #550's `closedTabs` history stack).
- Pure functions: `upsertTab` / `closeTab` (no-op for default tabs) / `closeOtherTabs(keepId)` / `closeTabsToRight(id)`;
  the latter two preserve default tabs. `isDefaultTabId(id)` is exposed to the UI to determine closability.
- Remove: `closeAllTabs`, `PAPER_PREVIEW_TAB_ID`, `closedTabs`/`CLOSED_TABS_LIMIT`.

## i18n（en+zh）

Add `rightPanel.tabSearch.{trigger,placeholder,empty}`, `rightPanel.context.{close,closeOthers,closeRight}`,
`rightPanel.scrollLeft`, `rightPanel.scrollRight`; remove `rightPanel.{closeTab,closeAll,restoreTab}`.

<a id="测试"></a>

## Tests

`right-panel-tabs.test.ts` covers: independent papers by key / record↔entry convergence, unclosable default tabs,
`closeOtherTabs` / `closeTabsToRight` preserving default tabs, and accumulation semantics.
