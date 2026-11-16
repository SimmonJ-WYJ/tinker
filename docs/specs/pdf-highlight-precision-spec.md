<a id="pdf-引文高亮精确化-spec按字符而非整行"></a>

# PDF Citation Highlight Precision Spec (Characters Rather Than Whole Lines)

> **Status**: Implemented · Awaiting review
> **Related PR**: (This change)
> **Domain source of truth**: `CONTEXT.md` (quote / cite / evidence-set / textLayer)
> **Key files**:
> - `apps/electron/src/renderer/components/preview/renderers/pdf-highlight-dom.ts` (new, pure DOM subrange wrapping)
> - `apps/electron/src/renderer/components/preview/renderers/PdfRenderer.tsx` (apply* refactoring + lightweight effect rewrite)
> - `apps/electron/src/renderer/components/preview/renderers/PdfRenderer.css` (`.pdf-hl-inner` rule)
> - `apps/electron/src/renderer/components/preview/renderers/pdf-highlight-dom.test.ts` (new unit tests)

---

<a id="1-问题"></a>

## 1. Problem

Clicking a cite in the evidence-set details panel navigates to the PDF and highlights the original text. When a quote covers only **part** of a line (for example, "WET files retained too much boilerplate and menu text"), the entire line "similarly to Gao et al. [29], we found that WET files retained too much boilerplate and menu text." is instead colored yellow.

**Root cause**: pdfjs `TextLayerBuilder` generates one transparent `<span>` per text item, often an entire visual line. The old `applyQuoteHighlights()` / `applySearchHighlights()` implementation walks `itemsStr[]` with a cursor; whenever an item's character range `[cursor, itemEnd)` **intersects** the hit range `[idx, endIdx)`, it adds the highlight class to the **whole** `textDivs[i]` span. Thus partial-line quotes highlight whole lines.

<a id="2-方案内层-span-包裹inner-span-wrapping"></a>

## 2. Solution: Inner-span Wrapping

Instead of adding a class to the entire span, calculate **local character subranges** for each intersecting span and use DOM `Range.surroundContents` to wrap the matching substring in an inner `<span class="pdf-hl-inner ...">`. Place the class + `data-note-id` on the inner span. It follows ordinary inline flow inside its parent (`position:absolute` + transform scaling), so the background closely fits the glyphs (including `scaleX` stretching).

Downstream behavior (delegated clicks, hover tooltip, scroll navigation) is naturally reused: it relies on `data-note-id` inside textLayer `b.div`, `closest('[data-note-id]')` event delegation / `querySelector('[data-note-id]')` scroll positioning. Carrying the attribute on the inner span suffices.

**Why not overlay rectangles**: Overlays require reworking event delegation and pointer-events management; rectangles become stale after scrolling/scaling and require recalculation, making the change larger and more fragile. The sole cost of inner spans (modifying pdfjs DOM) is offset by a clean unwrap + `normalize()` cleanup path.

<a id="21-核心模块-pdf-highlight-domts纯-dom无-pdfjsreact-依赖易单测"></a>

### 2.1 Core Module `pdf-highlight-dom.ts` (Pure DOM, No pdfjs/React Dependencies, Easy to Unit-test)

- `collectSpanSubRanges(itemsStr, rangeStart, rangeEnd, sepLen, styling, out)`: Walk itemsStr with a cursor, map the hit range to local item subranges, and aggregate into a shared `Map<spanIndex, SpanSubRange[]>`. `localStart=max(0, rangeStart-cursor)`, `localEnd=min(itemLen, rangeEnd-cursor)`; skip `localEnd<=localStart` (covers empty items / zero lengths / hits in synthetic separators).
- `wrapSpanSubRanges(span, subRanges)`: First merge overlapping subranges (union of classes, later noteId wins), then wrap inner spans individually with `surroundContents` in **descending start order** (right to left, preserving left-side offsets after text-node splitting). try/catch fallback leaves failed segments unwrapped (never falls back to whole-span highlighting).
- `clearInjectedHighlights(layerDiv)`: Select inner spans by `PDF_HL_INNER_CLASS`, move their children to the parent, remove spans, and `normalize()` adjacent `#text` nodes. Idempotent; preserves `<br>` appended by pdfjs for `hasEOL` items.

<a id="22-轻-effect-流程pdfrenderertsx"></a>

### 2.2 Lightweight Effect Flow (PdfRenderer.tsx)

Clear → collect → wrap: `clearInjectedHighlights(layerDiv)` → aggregate quote and search subranges per span into shared `subRangeMap` → `wrapSpanSubRanges` for each span. Extend `textMappingRef` with `layerDiv` to scope cleanup.

### 2.3 CSS

pdfjs `.textLayer :is(span,br)` makes **all** descendant spans `position:absolute`; add `.textLayer .pdf-hl-inner { position: static }` (two-class specificity > pdfjs single-span rule), allowing inner spans to flow inline within the parent and backgrounds to fit glyphs. Background colors reuse existing `.note-quote-highlight` / `.pdf-search-match` / `.pdf-search-current` rules (still matching inner spans); `:hover` now precisely targets substrings.

<a id="3-待跟踪-caveatquote-&#45;search-两套-join-约定不一致"></a>

## 3. Caveat to Track: Different Quote / Search Join Conventions

- Quote: `joinPdfItems` = `items.join(' ')` (single-space separator) constructs pageText; `collectSpanSubRanges` uses `sepLen=1`
- Search: `items.join('')` (no separator) constructs pageText; `collectSpanSubRanges` uses `sepLen=0`

Each path is **internally consistent**, so the helper parameterizes `sepLen` and **does not unify them**. The search path may have coordinate offsets in multicolumn layouts (items touch without natural whitespace, such as `Databasesestablished`), a pre-existing risk. Unification would move search coordinates and exceeds this highlight-precision change; **track separately**.

<a id="4-验证"></a>

## 4. Validation

- `bun run typecheck` ✅
- `bun test` (including 13 new `pdf-highlight-dom.test.ts` cases: local range math, sepLen 0/1, empty/zero-length skipping, precise wrapping without whole-line coloring, preserving `<br>`, overlap merging, wrap→clear→wrap idempotence) ✅
- Manual (rendering changes require a pass in `bun run dev`, unavailable for headless self-validation): partial-line quotes highlight only substrings; cross-span quotes; multiple fragments (`…` bridging); search match + current; overlapping quote+search on the same glyphs; precise rewrapping after zoom in/out rebuilds; working click/hover/navigation; selecting and copying across highlighted lines retains newlines.
