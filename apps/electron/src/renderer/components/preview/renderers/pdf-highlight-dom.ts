/**
 * PDF textLayer 高亮的 DOM 子区间包裹逻辑（精确到字形，不染整行）。
 *
 * 背景：pdfjs `TextLayerBuilder` 为每个 text item 生成一个透明 `<span>`，而一个 item 常常
 * 就是一整个视觉行。早期实现"命中即给整个 span 加 class"会把部分行的 quote 点亮整行。
 *
 * 解法：把命中的**子串**字符单独用内层 span 包起来，背景只覆盖这段字形。内层 span 以普通
 * inline 流排布在父 span（position:absolute + transform 缩放）内部，背景框随字形（含 scaleX
 * 拉伸）精确贴合。click/hover/跳转都靠内层 span 上的 data-note-id 与事件委托。
 *
 * 与 PdfRenderer 解耦：本文件只依赖 DOM，不依赖 pdf.js / React，纯逻辑 + 易单测。
 */

/** 我们注入的内层高亮 span 的专属 marker class：cleanup 只按它 unwrap，绝不误删 pdfjs 自身节点。 */
export const PDF_HL_INNER_CLASS = 'pdf-hl-inner'

/**
 * 单个 text item（= 一个 textLayer span）内待高亮的**局部**字符子区间。
 *
 * 高亮按字形精确：不再给整个 span 加 class，而是把 [start, end) 这段子串用内层 span 包起来，
 * 背景只覆盖匹配到的字符，不染整行。
 */
export interface SpanSubRange {
  start: number      // item 文本内的局部起点（含）
  end: number        // exclusive
  cls: string[]      // 视觉 class：['note-quote-highlight'] | ['pdf-search-match'(, 'pdf-search-current')]
  noteId?: string    // 仅 quote 高亮带；click/hover/跳转都靠它
}

/**
 * 游标遍历 itemsStr，把命中区间 [rangeStart, rangeEnd)（pageText 坐标）落到各 item 的
 * **局部**子区间，推进共享 out map（按 span 下标聚合）。
 *
 * sepLen 由调用方传入，对齐各自的 pageText 拼接约定：
 *   - quote：joinPdfItems 单空格 join → sepLen=1
 *   - search：items.join('') 无分隔 → sepLen=0（两条路径各自自洽，不要强行统一）
 *
 * 局部区间：localStart = max(0, rangeStart - cursor)，localEnd = min(itemLen, rangeEnd - cursor)；
 * 空 item / 零长区间 / 落在 item 间合成分隔符里的命中 → localEnd<=localStart，跳过。
 */
export function collectSpanSubRanges(
  itemsStr: ReadonlyArray<string>,
  rangeStart: number,
  rangeEnd: number,
  sepLen: number,
  styling: { cls: string[]; noteId?: string },
  out: Map<number, SpanSubRange[]>,
): void {
  let cursor = 0
  for (let i = 0; i < itemsStr.length; i++) {
    const itemLen = itemsStr[i]!.length
    const itemEnd = cursor + itemLen
    // 区间相交：[cursor, itemEnd) 与 [rangeStart, rangeEnd) 有交集
    if (itemEnd > rangeStart && cursor < rangeEnd) {
      const localStart = Math.max(0, rangeStart - cursor)
      const localEnd = Math.min(itemLen, rangeEnd - cursor)
      if (localEnd > localStart) {
        const sub: SpanSubRange = { start: localStart, end: localEnd, cls: styling.cls, noteId: styling.noteId }
        const list = out.get(i)
        if (list) list.push(sub)
        else out.set(i, [sub])
      }
    }
    cursor = itemEnd + sepLen
  }
}

/**
 * 把单个 span 的若干局部子区间包成内层高亮 span（按字形精确）。
 *
 * - 先合并重叠子区间（union class、按"后写覆盖"取 noteId）成不相交覆盖，避免 surroundContents
 *   跨已包内层 span 边界而抛错
 * - 再**按 start 降序**逐个 surroundContents：从右往左包，文本节点切分后左侧偏移仍有效
 * - 内层 span 带 PDF_HL_INNER_CLASS marker + 视觉 class + 可选 data-note-id
 * - 整个调用 try/catch 兜底：失败则该子区间不包（绝不退回整 span class）
 *
 * 只在 span 第一个 #text 节点内取 Range，不会切到 pdfjs 给 hasEOL item 追加的 <br>。
 */
export function wrapSpanSubRanges(span: HTMLElement, subRanges: SpanSubRange[]): void {
  const textNode = span.firstChild
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return
  const textLen = textNode.textContent?.length ?? 0
  if (textLen === 0) return
  const dedupe = (cls: string[]): string[] => Array.from(new Set(cls))
  // 合并重叠区间为不相交覆盖（按 start 升序扫一遍）
  const sorted = [...subRanges].sort((a, b) => a.start - b.start)
  const merged: SpanSubRange[] = []
  for (const r of sorted) {
    const start = Math.max(0, r.start)
    const end = Math.min(textLen, r.end)
    if (end <= start) continue
    const last = merged[merged.length - 1]
    if (last && start <= last.end) {
      // 重叠：合并区间、并集 class、后写覆盖 noteId
      last.end = Math.max(last.end, end)
      last.cls = dedupe([...last.cls, ...r.cls])
      if (r.noteId) last.noteId = r.noteId
    } else {
      merged.push({ start, end, cls: dedupe(r.cls), noteId: r.noteId })
    }
  }
  // 从右往左包，避免 surroundContents 切分文本节点后左侧子区间偏移失效
  for (let k = merged.length - 1; k >= 0; k--) {
    const { start, end, cls, noteId } = merged[k]!
    try {
      const range = document.createRange()
      range.setStart(textNode, start)
      range.setEnd(textNode, end)
      const inner = document.createElement('span')
      inner.classList.add(PDF_HL_INNER_CLASS, ...cls)
      if (noteId) inner.dataset.noteId = noteId
      range.surroundContents(inner)
    } catch {
      // surroundContents 在边界异常时抛错：跳过该段（不退回整 span 高亮，保持精确语义）
    }
  }
}

/**
 * 清理上一轮注入的内层高亮 span：把内层 span 的子节点提回父节点、删除 span、normalize 合并
 * 相邻 #text。幂等；只按 PDF_HL_INNER_CLASS 选中，绝不触碰 pdfjs 自身的 <br>（Element，
 * normalize 不动它）。
 */
export function clearInjectedHighlights(layerDiv: HTMLElement): void {
  const inner = layerDiv.querySelectorAll<HTMLElement>(`span.${PDF_HL_INNER_CLASS}`)
  for (const el of inner) {
    const parent = el.parentNode
    if (!parent) continue
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
    if (parent instanceof Element) parent.normalize()
  }
}
