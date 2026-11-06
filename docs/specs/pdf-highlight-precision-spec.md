# PDF 引文高亮精确化 Spec（按字符而非整行）

> **状态**：已实现 · 待 review
> **关联 PR**：（本次改动）
> **领域语言事实源**：`CONTEXT.md`（quote / cite / evidence-set / textLayer）
> **关键文件**：
> - `apps/electron/src/renderer/components/preview/renderers/pdf-highlight-dom.ts`（新增，纯 DOM 子区间包裹逻辑）
> - `apps/electron/src/renderer/components/preview/renderers/PdfRenderer.tsx`（apply* 重构 + 轻 effect 改写）
> - `apps/electron/src/renderer/components/preview/renderers/PdfRenderer.css`（`.pdf-hl-inner` 规则）
> - `apps/electron/src/renderer/components/preview/renderers/pdf-highlight-dom.test.ts`（新增单测）

---

## 1. 问题

证据集详情面板点击某条 cite 会跳到 PDF 并高亮原文。当 quote 只覆盖一行中的**一部分**时（例如只想高亮 "WET files retained too much boilerplate and menu text"），实际却把整行 "similarly to Gao et al. [29], we found that WET files retained too much boilerplate and menu text." 全部染黄。

**根因**：pdfjs `TextLayerBuilder` 为每个 text item 生成一个透明 `<span>`，而一个 text item 常常就是一整个视觉行。旧实现 `applyQuoteHighlights()` / `applySearchHighlights()` 用游标遍历 `itemsStr[]`，只要某个 item 的字符区间 `[cursor, itemEnd)` 与命中区间 `[idx, endIdx)` **相交**，就给**整个** `textDivs[i]` span 加高亮 class —— 因此部分行的 quote 会点亮整行。

## 2. 方案：内层 span 包裹（inner-span wrapping）

不再给整个 span 加 class，而是对每个相交 span 计算**局部字符区间**，用 DOM `Range.surroundContents` 把匹配到的子串包进一个内层 `<span class="pdf-hl-inner ...">`，class + `data-note-id` 落在内层 span 上。内层 span 以普通 inline 流排布在父 span（`position:absolute` + transform 缩放）内部，背景框随字形（含 `scaleX` 拉伸）精确贴合。

下游行为（点击委托、hover tooltip、跳转滚动）天然复用：都靠 `data-note-id` 落在 textLayer `b.div` 内 + `closest('[data-note-id]')` 事件委托 / `querySelector('[data-note-id]')` 滚动定位，内层 span 携带该属性即可。

**为何不用 overlay 矩形方案**：overlay 需重做事件委托、管理 pointer-events、且矩形在滚动/缩放后失效需重算，改动面更大更脆；内层 span 唯一代价（改动 pdfjs DOM）已被干净的 unwrap + `normalize()` 清理路径中和。

### 2.1 核心模块 `pdf-highlight-dom.ts`（纯 DOM，无 pdfjs/React 依赖，易单测）

- `collectSpanSubRanges(itemsStr, rangeStart, rangeEnd, sepLen, styling, out)`：游标遍历 itemsStr，把命中区间映射到各 item 的局部子区间，聚合进共享 `Map<spanIndex, SpanSubRange[]>`。`localStart=max(0, rangeStart-cursor)`、`localEnd=min(itemLen, rangeEnd-cursor)`，`localEnd<=localStart` 跳过（覆盖空 item / 零长 / 落在合成分隔符里的命中）。
- `wrapSpanSubRanges(span, subRanges)`：先合并重叠子区间（并集 class、后写覆盖 noteId），再**按 start 降序** `surroundContents` 逐个包内层 span（右往左包，文本节点切分后左侧偏移仍有效）；try/catch 兜底，失败则该段不包（绝不退回整 span 高亮）。
- `clearInjectedHighlights(layerDiv)`：按 `PDF_HL_INNER_CLASS` 选中内层 span，提子节点回父节点、删 span、`normalize()` 合并相邻 `#text`。幂等、保留 pdfjs 给 `hasEOL` item 追加的 `<br>`。

### 2.2 轻 effect 流程（PdfRenderer.tsx）

清理 → 收集 → 包裹：`clearInjectedHighlights(layerDiv)` → 用共享 `subRangeMap` 让 quote 与 search 子区间按 span 汇入 → 逐 span `wrapSpanSubRanges`。`textMappingRef` 扩展出 `layerDiv` 供清理限定作用域。

### 2.3 CSS

pdfjs 的 `.textLayer :is(span,br)` 会把**所有**后代 span 设成 `position:absolute`；新增 `.textLayer .pdf-hl-inner { position: static }`（双 class 特异性 > pdfjs 单 span 规则）让内层 span 在父 span 内 inline 排布，背景贴合字形。背景色复用已有 `.note-quote-highlight` / `.pdf-search-match` / `.pdf-search-current` 规则（仍匹配内层 span），`:hover` 现在精确作用于子串。

## 3. 待跟踪 caveat：quote / search 两套 join 约定不一致

- quote：`joinPdfItems` = `items.join(' ')`（单空格分隔）建 pageText，`collectSpanSubRanges` 用 `sepLen=1`
- search：`items.join('')`（无分隔）建 pageText，`collectSpanSubRanges` 用 `sepLen=0`

两条路径各自**内部自洽**，故 helper 把 `sepLen` 参数化、**不统一**。但 search 路径在多栏布局下（items 紧贴无自然空白，如 `Databasesestablished`）可能出现坐标偏差 —— 这是早于本次改动的遗留隐患。统一会移动 search 坐标，超出本次"高亮精确化"范围，**单独跟踪**。

## 4. 验证

- `bun run typecheck` ✅
- `bun test`（含新增 `pdf-highlight-dom.test.ts` 13 例：局部区间数学、sepLen 0/1、空/零长跳过、精确包裹不染整行、保留 `<br>`、重叠合并、wrap→clear→wrap 幂等）✅
- 人工（渲染类改动需在 `bun run dev` 走一遍，无法 headless 自验）：部分行 quote 只高亮子串、跨 span quote、多 fragment（`…` 桥接）、search match + current、同字形 quote+search 重叠、缩放 in/out 重建后重新精确包裹、点击/hover/跳转正常、跨高亮行选择复制仍带换行。
