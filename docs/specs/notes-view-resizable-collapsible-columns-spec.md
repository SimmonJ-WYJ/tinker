<a id="证据集视图-可拖拽改宽-&#45;预览栏可收起"></a>

# Evidence-set view: resizable columns + collapsible preview

> Status: Design approved, implementation pending
> Related issue: (none, local iteration)
> Related PR: (to be added)
> Domain-language source of truth: `CONTEXT.md`

<a id="背景与问题"></a>

## Background and problem

The evidence-set view (`NotesView`) currently has a fixed three-column layout:

- List column `w-[380px]` (all evidence sets)
- Detail column `w-[520px]` (evidence-set details)
- Preview column `flex-1` (PDF / HTML / conversation preview)

Two experience problems:

1. **The rightmost preview cannot collapse**: Even when unnecessary, it always occupies the right half of the screen, squeezing detail-reading space.
2. **Column widths are hardcoded and cannot be dragged manually**: Different content (long paper titles, wide PDFs) needs different width allocations.

<a id="目标"></a>

## Goals

1. Add a close button at the top of the preview to collapse it entirely; the detail column takes the freed space. Clicking any evidence entry (paper / review) reopens preview.
2. Both “list | detail” and “detail | preview” dividers support drag resizing.
3. Remember widths and preview collapse state in localStorage and restore on next entry.

Non-goals:

- Do not change the leftmost global app navigation (part of app-shell, shared across pages, outside this change).
- Do not introduce a third-party draggable-panel library (inconsistent with existing custom drag patterns and the constraint to compare new dependencies rather than add them by default).

<a id="方案轻量自定义可拖拽栏"></a>

## Approach: lightweight custom resizable columns

Reuse the existing drag + `atomWithStorage` persistence pattern (see `atoms/side-panel-layout.ts` and its `sidePanelRatioAtom`). No new dependencies; changes concentrate in `NotesView`, one new layout atom file, and one new `ColumnResizer` component.

<a id="组件-&#45;单元"></a>

### Components / units

**1. `atoms/notes-layout.ts` (new)** — Evidence-set view layout state persisted by `atomWithStorage`:

| atom | key | Default | clamp |
|------|-----|------|-------|
| `notesListWidthAtom` | `asci.notesView.listWidth` | 380 | 280–600 |
| `notesDetailWidthAtom` | `asci.notesView.detailWidth` | 520 | 360–760 |
| `notesPreviewCollapsedAtom` | `asci.notesView.previewCollapsed` | false | — |

Also export clamp constants (`NOTES_LIST_MIN/MAX`, `NOTES_DETAIL_MIN/MAX`) for shared use by resizers and unit tests.

**2. `components/library/ColumnResizer.tsx` (new)** — General-purpose column drag handle.

- props：`{ width: number; min: number; max: number; onResize: (next: number) => void }`
- Render a 4px vertical handle; use `cursor-col-resize` on hover/active and semantic colors (e.g. `bg-border` / hover `bg-primary/40`); **hardcoded Tailwind palette colors are forbidden**.
- Interaction: `onPointerDown` records `startX` and `startWidth` and calls `setPointerCapture`; `onPointerMove` computes `next = clamp(startWidth + (e.clientX - startX), min, max)` and calls `onResize`; `onPointerUp` releases capture. Add `select-none` to `document.body` during dragging to prevent text selection.
- Extract pure function `clampWidth(value, min, max)` for unit testing.

**3. `components/library/NotesView.tsx` (layout changes, [NotesView.tsx:216](../../apps/electron/src/renderer/components/library/NotesView.tsx#L216))**

- List: `w-[380px]` → `style={{ width: listWidth }}` + `shrink-0`.
- Insert `<ColumnResizer>` after the list, bound to `notesListWidthAtom`.
- Detail: `w-[520px]` → `style={{ width: detailWidth }}` + `shrink-0` when preview is open; use `flex-1` when collapsed (taking the right-side space).
- After detail, insert `<ColumnResizer>` bound to `notesDetailWidthAtom` only when preview is **not collapsed**.
- Preview `<main flex-1>`: Render only when **not collapsed**. Add a small title bar + close button (`PanelRightClose` or `X` icon); click → `setNotesPreviewCollapsed(true)`.

**4. Reopening coordination** — At every evidence-entry handler triggering `setPreviewMode(...)` (`onSelectPaperRef` / `onSelectReview` / `onSelectConversation`), set `setNotesPreviewCollapsed(false)` along with `previewMode`, ensuring clicking an entry reopens a collapsed preview.

### i18n

The preview close button's `aria-label` / tooltip uses `useT('library')`; add matching en + zh keys (e.g. `notes.view.preview.collapse` = “Collapse preview” in Chinese / “Collapse preview” in English). Guard with `key-parity` tests.

<a id="数据流"></a>

### Data flow

```
User drags divider → ColumnResizer.onPointerMove → clampWidth → Set width atom (localStorage)
                                                              → NotesView rerenders, updates aside width
User clicks close → set notesPreviewCollapsed=true → Hide preview + detail flex-1
User clicks evidence → set previewMode + set notesPreviewCollapsed=false → Render preview again
```

<a id="错误处理-&#45;边界"></a>

### Error handling / boundaries

- Always constrain widths with `clampWidth`; clamp malformed localStorage values after reading (both when the resizer sets values and when rendering uses them).
- Do not render `EvidenceItemPreviewPane` when preview is collapsed (its own ErrorBoundary is unaffected).
- Fullscreen PDF overlay (`NotesViewPdfOverlay`) is orthogonal and unchanged.

<a id="测试"></a>

### Tests

- `clampWidth` pure-function unit tests: below min, above max, and within bounds (native Bun test).
- Drag feel, collapse/reopen coordination, and cross-session persistence: verify manually in `bun run dev` (explicitly report portions that cannot be automated).

<a id="版本"></a>

### Version

`@asci/electron` patch +1。

<a id="受影响文件清单"></a>

## Affected file inventory

- Add: `apps/electron/src/renderer/atoms/notes-layout.ts`
- Add: `apps/electron/src/renderer/components/library/ColumnResizer.tsx` (+ matching `.test.ts` for clamp)
- Modify: `apps/electron/src/renderer/components/library/NotesView.tsx`
- Modify: `apps/electron/src/renderer/locales/{en,zh}/library/core.json` (preview.collapse key)
- Modify: `apps/electron/package.json` (version bump)
