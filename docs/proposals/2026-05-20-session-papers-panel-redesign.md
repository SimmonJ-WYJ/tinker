<a id="session-papers-panel-&#45;ux-重做设计"></a>

# Session Papers Panel · UX Redesign

**Date**: 2026-05-20
**Goal**: reduce complexity and redesign interactions in the right-side Session files / search-results panel
**Scope**: all `apps/electron/src/renderer/components/agent/SessionPapers*` components
**Batches**: recommend 2 PRs (structural split → UX redesign), avoiding one 800+ line PR

<a id="背景与痛点"></a>

## Background and Pain Points

Current right-side `SessionPapersPanel.tsx` (878 lines) contains Agent retrieval results. Users report three pain points:

1. **Overcomplicated dashboard**: persistent Year histogram + horizontal Source bars + five-part Relevance gradient create high density. Agent chat focuses on choosing papers, not exploring data; the dashboard does not help individual decisions.
2. **Overloaded toolbar**: checkbox / search / count badge / info / filter / sort / refresh / expand = 7 interaction units in one row, without separating frequent and rare actions.
3. **Persistent checkboxes waste space**: a 24px checkbox always appears on each card's left, although users usually are not multiselecting; it looks like a todo list rather than paper entries.

<a id="设计原则"></a>

## Design Principles

| Principle | Description |
|-----------|------|
| **P1 Lightweight by default, deepen on demand** | Keep the persistent view lean; put complex features (Overview / multiselect / Filter) behind secondary entries |
| **P2 Layer actions by frequency** | Frequent actions persistent / medium-frequency buttons / rare actions in menus |
| **P3 Progressive selection** | Checkboxes appear persistently only after explicit entry into multiselect mode |
| **P4 Match density to the task** | Retrieval results support decisions; dashboard collapsed by default |

<a id="三态布局"></a>

## Three-State Layout

<a id="默认态"></a>

### Default State

```
┌────────────────────────────────────────────────┐
│ Session files  .../default/198c65c1-3726-4d... │
├────────────────────────────────────────────────┤
│ [🔍 search...]               30  [↕ Relevance ▾] │  ← Zone 1 frequent
│ [📊 Overview] [⚙ Filter]              [⋮ More] │  ← Zone 2 medium-frequency
├────────────────────────────────────────────────┤
│ Blockchain for Tokenized Real-World Assets...  │
│   ~72 · 2025 · Damodar Bihani et al.           │
│   [Link] [Add to Zotero]                       │
├────────────────────────────────────────────────┤
│ A Taxonomy of Tokenisation Methods...          │
│   ~72 · 2025 · Nihad Aliyev                    │
└────────────────────────────────────────────────┘
```

- Zone 1 (always visible): search + total count + sort dropdown
- Zone 2 (always visible, lower visual emphasis): Overview / Filter triggers + ⋮ More menu
- Card list: **no checkboxes**

<a id="overview-popover-展开"></a>

### Overview Popover Open

Click "📊 Overview" → trigger becomes active → Popover opens below:

```
┌─ Distribution of 30 papers ────┐
│ Years                    │
│ ▂▂▃▅▄▅▆▅▃▂  (sparkline) │
│ 1970────────────2026     │
│                          │
│ Sources                  │
│ [Crossref · 15]          │
│ [OpenAlex · 15]          │
│                          │
│ Relevance                │
│ ▒▒▒▒▒▒▒▒ Low → High     │
└──────────────────────────┘
```

Simplified visualizations:
- Years: sparkline (one custom curve, not 57 histogram bars)
- Sources: chip list
- Relevance: one lo-hi gradient bar

<a id="多选态"></a>

### Multiselect State

**Explicit entry** through "⋮ More" → "☐ Bulk actions." Then:

```
┌────────────────────────────────────────────────┐
│ ■ 2 / 30 selected [Add to Zotero] [Tag] [✕]  │  ← black bulk-action bar
├────────────────────────────────────────────────┤
│ ☑ Blockchain for Tokenized Real-World Assets   │
│ ☑ A Taxonomy of Tokenisation Methods           │
│ ☐ A Study on STOs of Public Assets             │
└────────────────────────────────────────────────┘
```

- Checkboxes appear to the left of all cards
- Top black bulk-bar provides actions (Add to Zotero / Tag / Remove from session) + ✕ exit
- Exiting clears selectedKeys, hides checkboxes, and returns to default

<a id="-more菜单"></a>

### "⋮ More" Menu

| Item | Behavior |
|----|------|
| ↻ Refresh | Refetch `listSessionPapers(sessionId)` (retain existing refresh behavior) |
| ☐ Bulk actions | Toggle `multiSelectActiveAtom` |
| ⤢ Open in new window | Existing expand behavior |
| Display density · Compact/Standard | Toggle `densityAtom` (optional; may omit) |

<a id="组件结构重组后"></a>

## Component Structure (After Reorganization)

```
SessionPapersPanel.tsx              orchestrator (~200 lines)
├── <SessionPapersHeader>           path bar + count
├── <SessionPapersToolbar>          Zone 1 + Zone 2
│   ├── <SessionPapersSearchInput>
│   ├── <SessionPapersSortMenu>
│   ├── <SessionPapersStatsPopoverTrigger>
│   ├── <SessionPapersFilterPopoverTrigger>
│   └── <SessionPapersMoreMenu>
├── <SessionPapersBulkActionBar>    shown in multiselect
└── <SessionPapersList>
    └── <SessionPaperCard>          multiSelect mode controls checkbox rendering
```

<a id="文件改动地图"></a>

## File Change Map

<a id="新增6"></a>

### Add (6)

| File | Lines | Responsibility |
|------|------|------|
| `SessionPapersStatsPopover.tsx` | ~150 | Radix Popover wrapping simplified visualizations (sparkline + chips + lo-hi bar) |
| `SessionPapersBulkActionBar.tsx` | ~80 | Top black bar with selected count + bulk actions + ✕ |
| `SessionPapersMoreMenu.tsx` | ~60 | DropdownMenu: refresh / bulk / new window / density |
| `SessionPapersToolbar.tsx` | ~120 | Zone 1 + Zone 2 container, presentation only + events upward |
| `SessionPaperCard.tsx` | ~180 | Extract from Panel; props: `multiSelectActive`, `density` |
| `session-papers-ui-atoms.ts` | ~30 | New atoms: multiSelectActive / selectedKeys / density |

<a id="重构1"></a>

### Refactor (1)

| File | Current lines → target | Change |
|------|----------------|------|
| `SessionPapersPanel.tsx` | 878 → ~200 | Extract Toolbar / List / Card / BulkActionBar; read new atoms; orchestrator only |

<a id="删除1"></a>

### Delete (1)

| File | Reason |
|------|------|
| `SessionPapersStatsBar.tsx` (332 lines) | Entirely replaced by StatsPopover; retain data layer `session-papers-stats.ts` |

<a id="微动2"></a>

### Minor Changes (2)

| File | Change |
|------|------|
| `SessionPapersFilterPopover.tsx` | No logic changes; move trigger only in Toolbar |
| `locales/{zh,en}/conversation.json` | Add ~10 keys (bulk actions / N selected / density / Overview chip copy, etc.), synchronized zh+en with key-parity guard |

<a id="数据层保留不动"></a>

## Data Layer (Unchanged)

- `sessionPapersFilterFamilyAtom(sessionId)` — filter state
- `sessionPapersSortFamilyAtom(sessionId)` — sort state
- `session-papers-filter.ts` — filter/sort/deduplication logic
- `session-papers-stats.ts` — histogram / source / relevance aggregation
- `workspacePapersAtom` — workspace-level paper data

<a id="新增-atomssession-papers-ui-atomsts"></a>

## New Atoms (session-papers-ui-atoms.ts)

```ts
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

/** 多选模式是否激活，per session */
export const sessionPapersMultiSelectActiveFamilyAtom = atomFamily(
  (_sessionId: string) => atom<boolean>(false),
)

/** 已选 paper key Set，per session；多选退出时清空 */
export const sessionPapersSelectedKeysFamilyAtom = atomFamily(
  (_sessionId: string) => atom<Set<string>>(new Set()),
)

/** 显示密度 'compact' | 'normal'，全局（不分 session） */
export const sessionPapersDensityAtom = atom<'compact' | 'normal'>('normal')
```

<a id="交互细节"></a>

## Interaction Details

<a id="多选态进入退出"></a>

### Enter/Exit Multiselect

- **Enter**: "⋮" → "☐ Bulk actions" → `setMultiSelectActive(true)`
- **Exit**: bulk-bar ✕ or ESC → `setMultiSelectActive(false)` + `setSelectedKeys(new Set())`
- **On session switch**: reset multiselect automatically (session-scoped atom, false by default for new sessions)

<a id="overview-popover-触发器"></a>

### Overview Popover Trigger

- First button in Zone 2
- Default ghost style; becomes `bg-accent text-accent-foreground` while open
- Use Radix Popover; outside click / ESC closes

<a id="卡片-checkbox-隐藏-vs-显示"></a>

### Card Checkbox Visibility

- Default: `hidden` (CSS `display: none`)
- Multiselect: show checkboxes on all cards (not hover-triggered)
- This makes entering multiselect visually explicit, independent of hover-only triggers

<a id="分批合并策略"></a>

## Phased Merge Strategy

<a id="pr-1结构拆分无可见变化"></a>

### PR 1: Structural Split (No Visible Change)

- Split `SessionPapersPanel` into Toolbar / List / Card / subcomponents
- Preserve old UI and behavior completely
- Review focuses on safe movement of large code blocks
- Effort: 1.5 days

<a id="pr-2ux-重做"></a>

### PR 2: UX Redesign

- On the split structure, implement:
  - StatsBar → StatsPopover
  - MoreMenu
  - Multiselect + BulkActionBar
  - Card checkbox visibility
  - i18n
- Review focuses on correct interaction logic
- Effort: 3-4 days

<a id="工程量总计"></a>

## Total Effort

| Task | Person-days |
|------|------|
| Panel split (PR 1) | 1.5 |
| StatsPopover (including simplified visualizations) | 1 |
| Multiselect + BulkActionBar | 1 |
| MoreMenu + density | 0.5 |
| Toolbar refactor + visual polish | 0.5 |
| i18n + zh/en synchronization + key-parity | 0.5 |
| Tests + walkthrough | 0.5–1 |
| **Total** | **5–5.5 person-days** |

<a id="验证标准"></a>

## Validation Criteria

- [ ] Default: clear toolbar visual hierarchy, no list-card checkboxes
- [ ] "📊 Overview" opens Popover; click again or ESC closes
- [ ] "⚙ Filter" opens existing FilterPopover (unchanged logic)
- [ ] "⋮" opens 4-item menu; "Bulk actions" toggles multiselect
- [ ] Multiselect: all card checkboxes and top bulk-bar visible
- [ ] bulk-bar "Add to Zotero" submits in bulk (reuse existing Add to Zotero IPC)
- [ ] bulk-bar ✕ or ESC exits multiselect and clears selectedKeys
- [ ] Session switch resets multiselect automatically
- [ ] zh ↔ en: new keys display correctly in both languages
- [ ] `bun run typecheck` + `bun test` pass

<a id="不在范围"></a>

## Outside Scope

- **Bulk Tag / Remove from session**: requires new IPC; connect only existing Add to Zotero; show other bulk actions with "Coming soon" toast
- **Persistent display density**: in-memory state first, no settings-file writes
- **Command Palette (Cmd+K)**: mentioned in option C, excluded this round
- **Mobile / small-window adaptation**: outside 0.2.x
- **Actual business interfaces for bulk actions** (e.g. bulk tagging): depends on further data-layer design

<a id="out-of-scope-&#45;后续可考虑"></a>

## Out of Scope · Future Considerations

- Add filter entry in StatsPopover (click chip to filter by source)
- Shift-click range selection in multiselect mode
- Hover quick actions on card right ("+" add Note, "📌" save to ProjectFiles)
