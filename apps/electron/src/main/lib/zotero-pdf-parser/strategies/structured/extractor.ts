/**
 * structured 策略 · 第 1 步：layout-aware 文本抽取
 *
 * 端到端：pdfPath → Page[]，每页含一组按"阅读顺序"排好的 line 记录。
 * 关键算法（移植自 opensci/test/pdf-parse）：
 *   1. 用 y 坐标把 text item 聚成 row（容忍正负 0.5x 字号的上下标抖动）。
 *   2. 对全页 row 找最大 x-gap，向中央 25-75% 区域投票得到 gutter x（无超过 30% 票数即视为单栏）。
 *   3. 按 gutter x 把跨栏 row 切成左右两个 segment。
 *   4. 走"左 buffer / 右 buffer + full-width flush"算法把 segment 排成阅读顺序。
 *   5. 学习每列的主导行间距 + 第一行缩进 lookahead，标注段落起点。
 */

import { readFileSync } from 'node:fs'
import { getPdfjs } from './pdfjs-loader'

// ====== 算法常量（与源项目一致） ======

const BOLD_RE = /bold|black|heavy|semibold|demibold/i
const FULL_WIDTH_FRAC = 0.6 // span > 60% of page → full-width row
const MIN_GUTTER_PT = 8 // anything narrower can't be a column gutter
const GUTTER_BIN_PT = 10 // resolution of gutter-x histogram
const GUTTER_VOTE_FRAC = 0.3 // need ≥30% of rows voting for the same gutter
const INDENT_THRESH = 4 // pt; first-line indent threshold
const PARAGRAPH_GAP_FACTOR = 1.4 // gap > 1.4 × dominant line spacing → new paragraph

// ====== 数据结构 ======

interface RawItem {
  str: string
  /** PDF 用户空间坐标：原点左下 */
  x: number
  y: number
  width: number
  size: number
  fontName: string
}

interface Row {
  y: number
  items: RawItem[]
}

interface Segment extends Row {}

/** 解析完成后导出的每一行（一个 segment 对应一行）；后续 classifier 直接消费 */
export interface StructuredLine {
  text: string
  y: number
  x: number
  xEnd: number
  size: number
  bold: boolean
  column: 'left' | 'right' | 'full'
  startsParagraph: boolean
}

export interface StructuredPage {
  page: number
  lines: StructuredLine[]
  pageWidth: number
}

export interface ExtractMeta {
  numPages: number
}

// ====== 工具函数 ======

function fontSizeOf(transform: number[] | undefined): number {
  const t = transform ?? [1, 0, 0, 1, 0, 0]
  return Math.round(Math.hypot(t[1] ?? 0, t[3] ?? 0) * 10) / 10
}

function isBoldFontName(name: string): boolean {
  return BOLD_RE.test(name)
}

/**
 * 优先用 pdfjs 报告的 item.width（精确）。fallback 时按 CJK / 非 CJK 估算宽度。
 */
function itemWidth(it: RawItem): number {
  if (it.width > 0) return it.width
  const cjk = (it.str.match(/[一-鿿　-〿＀-￯]/g) ?? []).length
  const other = it.str.length - cjk
  return cjk * it.size + other * it.size * 0.5
}

// ====== 1. 行聚类 ======

function groupItemsByY(items: RawItem[]): Row[] {
  if (!items.length) return []
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const rows: Row[] = []
  let current: Row | null = null
  for (const it of sorted) {
    if (!current) {
      current = { y: it.y, items: [it] }
      continue
    }
    // 容忍度取"当前行字号"与"新 item 字号"的 0.5 倍中较大者，处理上下标
    const tol = Math.max(2, Math.max(current.items[0]!.size, it.size) * 0.5)
    if (Math.abs(it.y - current.y) <= tol) {
      current.items.push(it)
    } else {
      rows.push(current)
      current = { y: it.y, items: [it] }
    }
  }
  if (current) rows.push(current)
  return rows
}

// ====== 2. gutter 投票 ======

interface RowGap {
  gap: number
  centerX: number
}

function rowMaxGap(row: Row): RowGap | null {
  if (row.items.length < 2) return null
  const sorted = [...row.items].sort((a, b) => a.x - b.x)
  let best: RowGap = { gap: 0, centerX: 0 }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    const gap = cur.x - (prev.x + itemWidth(prev))
    if (gap > best.gap) {
      best = { gap, centerX: (prev.x + itemWidth(prev) + cur.x) / 2 }
    }
  }
  return best.gap > 0 ? best : null
}

function detectGutterX(rows: Row[], pageWidth: number): number | null {
  const votes = new Map<number, number>()
  let totalVoters = 0
  for (const row of rows) {
    const m = rowMaxGap(row)
    if (!m || m.gap < MIN_GUTTER_PT) continue
    // gutter 通常落在页面中部，剔除掉贴边距的"最大 gap"
    if (m.centerX < pageWidth * 0.25 || m.centerX > pageWidth * 0.75) continue
    const bin = Math.round(m.centerX / GUTTER_BIN_PT) * GUTTER_BIN_PT
    votes.set(bin, (votes.get(bin) ?? 0) + 1)
    totalVoters++
  }
  if (totalVoters < 4) return null
  let bestBin: number | null = null
  let bestCount = 0
  for (const [bin, c] of votes) {
    if (c > bestCount) {
      bestCount = c
      bestBin = bin
    }
  }
  if (bestBin !== null && bestCount >= totalVoters * GUTTER_VOTE_FRAC) return bestBin
  return null
}

// ====== 3. 按 gutter 切 row ======

function splitRowAtX(row: Row, gutterX: number | null): Row[] {
  if (gutterX === null || row.items.length < 2) return [row]
  const sorted = [...row.items].sort((a, b) => a.x - b.x)

  // 只在 row 内"真实有空白带跨越 gutterX"时才切左右。
  //
  // 背景：detectGutterX 用整页投票出 gutterX，但论文封面的作者行 / 邮箱 / 单位
  // 这类单栏宽行会横跨 gutterX（字符连续无空白带），如果一刀切到左右两半，
  // orderSegments flush 时会把右半丢到很靠后的位置，破坏阅读顺序。
  //
  // 真正的双栏 body 行：左列末尾 item 结束位置 ≤ gutterX，右列首 item 起始 ≥ gutterX，
  // 且 gap ≥ MIN_GUTTER_PT。不满足时视为单栏宽行，保留为一个 row。
  let splitIdx = -1
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    const prevEnd = prev.x + itemWidth(prev)
    if (prevEnd <= gutterX && cur.x >= gutterX) {
      const gap = cur.x - prevEnd
      if (gap >= MIN_GUTTER_PT) {
        splitIdx = i
        break
      }
    }
  }
  if (splitIdx < 0) return [row]

  const left = sorted.slice(0, splitIdx)
  const right = sorted.slice(splitIdx)
  return [
    { y: row.y, items: left },
    { y: row.y, items: right },
  ]
}

// ====== 4. segment → line + 阅读顺序 ======

interface DraftLine {
  text: string
  y: number
  x: number
  xEnd: number
  size: number
  bold: boolean
  column?: 'left' | 'right' | 'full'
}

function buildLine(segment: Segment): DraftLine {
  const items = segment.items
  let text = ''
  let prev: RawItem | null = null
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + itemWidth(prev))
      const needSpace = gap > prev.size * 0.3 && !/\s$/.test(text) && !/^\s/.test(it.str)
      if (needSpace) text += ' '
    }
    text += it.str
    prev = it
  }
  const xStart = items[0]!.x
  const last = items[items.length - 1]!
  const xEnd = last.x + itemWidth(last)
  const maxSize = items.reduce((m, it) => (it.size > m ? it.size : m), items[0]!.size)
  const allBold = items.every((it) => isBoldFontName(it.fontName))
  return {
    // 仅 trim 行首尾空白；行内多空格保留（PDF 里有意义的对齐 / 公式空格不被压平）
    text: text.trim(),
    y: segment.y,
    x: xStart,
    xEnd,
    size: maxSize,
    bold: allBold,
  }
}

function orderSegments(
  segments: Segment[],
  pageWidth: number,
  gutterX: number | null,
): DraftLine[] {
  const lines = segments
    .map(buildLine)
    .filter((l) => l.text)
    .sort((a, b) => b.y - a.y)

  // 单栏页（detectGutterX 投票失败 → null）：直接按 y 顺序输出，不做 buffer
  //
  // 之前不管单栏双栏一律按 midline 塞 left/right buffer，在 arXiv 封面这类
  // "标题宽 + 作者窄 + 'Abstract' 窄 + 摘要中等宽 + '1 Introduction' 窄"
  // 的混合布局上会把窄行全塞进 buffer，遇到下一个全宽行才 flush，破坏 y 顺序。
  // 现在单栏走直通：所有 line 标 column='full'，annotateParagraphs 走 gap/indent 启发式
  if (gutterX === null) {
    for (const ln of lines) ln.column = 'full'
    return lines
  }

  // 双栏：以 gutterX（而非 midline）切左右，full-width 行 flush 顺序保证 "左列 → 右列"
  const out: DraftLine[] = []
  let leftBuf: DraftLine[] = []
  let rightBuf: DraftLine[] = []

  const flush = () => {
    out.push(...leftBuf, ...rightBuf)
    leftBuf = []
    rightBuf = []
  }

  for (const ln of lines) {
    const width = ln.xEnd - ln.x
    const center = (ln.x + ln.xEnd) / 2
    const fullWidth = width > pageWidth * FULL_WIDTH_FRAC
    // 横跨 gutterX 的 row（未被 splitRowAtX 拆开 → 没有真实 gutter 空白带）也按 full 处理：
    // 论文封面作者行 / 邮箱 / 单位是典型场景，它们字符连续地横跨页面中线，不应被丢进左右 buffer
    const crossesGutter = ln.x < gutterX && ln.xEnd > gutterX
    if (fullWidth || crossesGutter) {
      flush()
      ln.column = 'full'
      out.push(ln)
    } else if (center < gutterX) {
      ln.column = 'left'
      leftBuf.push(ln)
    } else {
      ln.column = 'right'
      rightBuf.push(ln)
    }
  }
  flush()
  return out
}

// ====== 5. 段落起点标注 ======

/**
 * 学习每列内"段内行间距"的众数，用于把更大的 gap 识别为段落分隔。
 * 比固定使用 fontSize * 1.2 更稳健，能适配不同字号 / 排版。
 */
function detectColumnSpacing(lines: DraftLine[]): Record<string, number> {
  const buckets: Record<string, Map<number, number>> = {}
  for (let i = 1; i < lines.length; i++) {
    const cur = lines[i]!
    const prev = lines[i - 1]!
    if (cur.column !== prev.column) continue
    const gap = prev.y - cur.y
    if (gap <= 0 || gap > 100) continue
    const key = Math.round(gap)
    const col = cur.column ?? 'full'
    if (!buckets[col]) buckets[col] = new Map()
    buckets[col].set(key, (buckets[col].get(key) ?? 0) + 1)
  }
  const modes: Record<string, number> = {}
  for (const [col, m] of Object.entries(buckets)) {
    let best = 0
    let mode = 0
    for (const [g, c] of m) {
      if (c > best) {
        best = c
        mode = g
      }
    }
    modes[col] = mode
  }
  return modes
}

/**
 * 段落起点 = 列切换 / gap 显著 / 缩进（lookahead 同列下一行 x）。
 * lookahead 比 lookback 更可靠：当前行如果是首行缩进，则下一行回到列左边缘。
 */
function annotateParagraphs(lines: DraftLine[]): StructuredLine[] {
  if (!lines.length) return []
  const spacing = detectColumnSpacing(lines)

  // 预索引：next-same-column line for each position
  const nextInCol = new Array<number>(lines.length).fill(-1)
  for (let i = lines.length - 2; i >= 0; i--) {
    if (lines[i + 1]!.column === lines[i]!.column) {
      nextInCol[i] = i + 1
    } else {
      let j = i + 1
      while (j < lines.length && lines[j]!.column !== lines[i]!.column) j++
      nextInCol[i] = j < lines.length ? j : -1
    }
  }

  const out: StructuredLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!
    let starts = false
    if (i === 0) {
      starts = true
    } else {
      const prev = lines[i - 1]!
      if (cur.column !== prev.column) {
        starts = true
      } else {
        const nextIdx = nextInCol[i]!
        const indented = nextIdx >= 0 && cur.x > lines[nextIdx]!.x + INDENT_THRESH
        const gap = prev.y - cur.y
        const baseline = spacing[cur.column ?? 'full'] ?? prev.size * 1.2
        const bigGap = gap > baseline * PARAGRAPH_GAP_FACTOR
        starts = indented || bigGap
      }
    }
    out.push({
      text: cur.text,
      y: cur.y,
      x: cur.x,
      xEnd: cur.xEnd,
      size: cur.size,
      bold: cur.bold,
      column: cur.column ?? 'full',
      startsParagraph: starts,
    })
  }
  return out
}

// ====== 主入口 ======

interface PdfjsTextItem {
  str?: string
  transform?: number[]
  width?: number
  fontName?: string
}

interface PdfjsTextContent {
  items: Array<PdfjsTextItem | { type?: string }>
}

interface PdfjsViewport {
  width: number
  height: number
}

interface PdfjsPage {
  getViewport(opts: { scale: number }): PdfjsViewport
  getTextContent(opts: { includeMarkedContent: boolean }): Promise<PdfjsTextContent>
}

interface PdfjsDocument {
  numPages: number
  getPage(n: number): Promise<PdfjsPage>
  cleanup(): Promise<void>
  destroy(): Promise<void>
}

export async function extract(
  pdfPath: string,
  { debug = false }: { debug?: boolean } = {},
): Promise<{ pages: StructuredPage[]; meta: ExtractMeta }> {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(readFileSync(pdfPath))
  // 主进程不配置 GlobalWorkerOptions.workerSrc / worker —— pdfjs 5.x 会自动落到
  // fake worker（动态 import pdf.worker.mjs，纯文本抽取不需要 OffscreenCanvas
  // 等浏览器特性，跑在当前线程足够）。pdfjs 5.x 已移除 disableWorker 选项。
  // isEvalSupported: false 增强安全（不让 PDF 内嵌脚本通过 eval 执行）
  const doc = (await pdfjs.getDocument({
    data,
    isEvalSupported: false,
  }).promise) as unknown as PdfjsDocument

  const pages: StructuredPage[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent({ includeMarkedContent: false })

    const items: RawItem[] = []
    for (const raw of content.items) {
      const it = raw as PdfjsTextItem
      if (!it.str || !it.str.length) continue
      // 跳过旋转文本（侧边水印、装订位文字）；transform[1]/[2] 非零意味着 rotation
      const t = it.transform ?? []
      if (Math.abs(t[1] ?? 0) > 0.01 || Math.abs(t[2] ?? 0) > 0.01) continue
      items.push({
        str: it.str,
        x: t[4] ?? 0,
        y: t[5] ?? 0,
        width: it.width ?? 0,
        size: fontSizeOf(t),
        fontName: it.fontName ?? '',
      })
    }

    const rows = groupItemsByY(items)
    const gutterX = detectGutterX(rows, viewport.width)
    const segments = rows.flatMap((r) => splitRowAtX(r, gutterX))
    const draft = orderSegments(segments, viewport.width, gutterX)
    const lines = annotateParagraphs(draft)

    if (debug) {
      const cnt: Record<string, number> = {}
      for (const l of lines) cnt[l.column] = (cnt[l.column] ?? 0) + 1
      console.error(
        `[structured] page ${i}: width=${viewport.width.toFixed(0)} ` +
          `gutterX=${gutterX === null ? 'none (1 col)' : gutterX.toFixed(0)} ` +
          `lines=${lines.length} (left=${cnt.left ?? 0}, right=${cnt.right ?? 0}, full=${cnt.full ?? 0})`,
      )
    }

    pages.push({ page: i, lines, pageWidth: viewport.width })
  }

  const numPages = doc.numPages
  await doc.cleanup()
  await doc.destroy()
  return { pages, meta: { numPages } }
}
