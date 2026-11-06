import * as React from 'react'
// 使用 legacy build —— pdfjs-dist 5.x modern build 依赖 Map.prototype.getOrInsertComputed
// 等 TC39 proposal，尚未在 Electron 的 Chromium 里落地，会抛 "is not a function"
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
// TextLayerBuilder：viewer-level 文本层封装,内置 endOfContent + selecting 类切换 +
// 全局 selectionchange 协调,正确处理"鼠标按下点作为选区锚点"。低阶 TextLayer 没有这些。
import { TextLayerBuilder } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
// TextLayer 配套样式（含 .textLayer 容器 + 透明 span 定位规则）。
// 全量 ~几十 KB，但 selector 都在 .textLayer 命名空间内，不会污染其他模块；
// 用子集拷贝维护成本高，宁可一次性引入官方。
import 'pdfjs-dist/web/pdf_viewer.css'
// 局部样式：textLayer 上的 quote 高亮规则 + 多页 slot 排版
import './PdfRenderer.css'
import { findQuoteFragmentsInPage, splitQuoteFragments } from './quote-match.ts'
import {
  type SpanSubRange,
  collectSpanSubRanges,
  wrapSpanSubRanges,
  clearInjectedHighlights,
} from './pdf-highlight-dom.ts'

/**
 * pdfjs textContent items 之间的分隔符。
 *
 * 关键点：pdfjs 的 `getTextContent().items[i].str` **不保证** item 间存在自然空白
 *   —— item 间的视觉间距由 `transform` 坐标体现，多栏布局 / 行末断字 / pdfjs 拆分粒度
 *   都会产生"两个 item 紧贴、字符串里无空格"的情况。直接 `items.join('')` 拼出来
 *   会出现 `Databasesestablished` / `OPENNew` / `crystals;these` 这种黏字现象，导致
 *   findQuoteInPage 的 normalize 即使折叠空白也无法命中 quote。
 *
 * 解法：用单空格做 items 间分隔；normalize 折叠空白时多余的空格会被自然消化。
 * 副作用：少数 ligature / 同单词被 pdfjs 拆成两 item 的情况会被插入空格（例如
 * `re-search` 被拆成 `["re-", "search"]` → `"re- search"` → normalize 吃 hyphen+空白
 * → `"research"` 仍然正确）；同单词无连字符被拆开（罕见）会被拆成两词，可能影响
 * strict 命中但通常 fingerprint 仍能命中。
 *
 * 注意：applyQuoteHighlights 的 cursor 推进逻辑必须配套 +1（除最后一个 item 外），
 * 否则 [idx, endIdx) 区间映射回 textDivs 会偏 N-1 个字符。
 */
const PDF_ITEMS_JOIN_SEP = ' '

/** PDF textContent items → pageText（带分隔符），与 applyQuoteHighlights 的 cursor 推进对齐。 */
function joinPdfItems(items: ReadonlyArray<string>): string {
  return items.join(PDF_ITEMS_JOIN_SEP)
}
import { getIsDevMode } from '@/lib/dev-mode'
import { toast } from 'sonner'
import { useSetAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search as SearchIcon, X as XIcon, ZoomIn, ZoomOut } from 'lucide-react'
import { previewFlashMessageAtom } from '@/atoms/side-panel-layout'
import { useT } from '@/hooks/useT'
import type { PreviewRendererProps } from '../preview-registry'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker

/**
 * PdfRenderer 的扩展 props（向后兼容 PreviewRendererProps：两项 optional）
 *
 * `quoteHighlights`：当前 paper 的 Note quote 列表，渲染期间在 textLayer 上刷淡黄色背景
 *   匹配规则：拼接当前页 textLayer 的 textContentItemsStr → indexOf(quote) → 命中即把
 *   覆盖区间内的 spans 全部加 .note-quote-highlight 类（参见 applyQuoteHighlights）
 *
 * `onHighlightClick`：点击高亮 span 时回调，参数是 note id；调用方据此打开 NoteDetailDialog
 */
export interface PdfRendererProps extends PreviewRendererProps {
  quoteHighlights?: ReadonlyArray<{ id: string; quote: string; content?: string; page?: number }>
  onHighlightClick?: (noteId: string) => void
  /**
   * 跨视图跳转后的待滚动 note id：扫页找到该 note 的 quote 所在页 → 切页 → 等
   * TextLayer 渲染好 → 把对应高亮 span 滚到视口中央。完成（或超时）后调
   * onScrollComplete 让上游清空 atom。
   */
  pendingScrollNoteId?: string | null
  onScrollComplete?: () => void
  /**
   * 是否展示左侧大纲（PDF 内嵌 outline / bookmarks）。
   * Open PDF 浮层展开态打开,内联紧凑态不展示,避免占用宝贵的横向空间。
   */
  showOutline?: boolean
  /**
   * 容器是否已"完全落定"——可安全按当前宽度定稿渲染画布。
   * 抽屉/浮层滑入动画期间为 false：此时虽容器已是最终宽度，但量宽/渲染与浏览器布局动画
   * 存在竞态，会出现画布先按过渡宽铺开再回缩的溢出帧。期间 PdfRenderer 把可用宽度视作 0
   * （slot 展示 loading、暂不渲染画布），待动画放完落定再量最终宽度渲染并 fit。
   * 缺省 true：内联 / 其他无入场动画的调用方不受影响。
   */
  containerSettled?: boolean
}

/**
 * 单次搜索命中：定位到某一页 textContentItems 拼接后字符串中的字符区间。
 * 页内可能多次命中,所以每条匹配独立存。渲染期按 page 分组,在 slot 的 textLayer
 * 上把覆盖的 spans 加搜索高亮类(同 applyQuoteHighlights 思路)。
 */
interface SearchMatch {
  page: number       // 1-based
  charStart: number  // 在 pageText (items.join('')) 中的起点
  charEnd: number    // exclusive
}

/**
 * 大纲节点（树形结构，按 pdfjs getOutline 输出整形而成）
 * - pageIndex: 0-based,转 1-based 后 setPageNum
 * - 解析失败的项 pageIndex=null,在 UI 中弱化（仍可展示但不可点击）
 */
interface OutlineNode {
  title: string
  pageIndex: number | null
  children: OutlineNode[]
}

// 一次同时挂载的页数窗口半径：currentPage ± WINDOW_RADIUS
// 1 = prev/cur/next 共最多 3 页；够"滚到底就看到下一页"的体感，内存占用小
const WINDOW_RADIUS = 1

/**
 * PDF 预览器（windowed 多页 + 滚动驱动）
 * - 懒加载整个 pdfjs-dist (~2.5MB gz)
 * - 同时挂载 pageNum-1 / pageNum / pageNum+1 三个 slot（堆叠在垂直滚动容器里）
 * - IntersectionObserver 监听各 slot：滚动让某页占据视口中线 → 更新 pageNum
 * - 每个 slot 自带 canvas + textLayer；划词选区、quote 高亮、跨视图跳转都按 slot 工作
 * - 工具栏：翻页（同时 scrollIntoView） + 缩放 (50% ~ 300%)
 */
export default function PdfRenderer({
  path,
  onError,
  quoteHighlights,
  onHighlightClick,
  pendingScrollNoteId,
  onScrollComplete,
  showOutline,
  containerSettled = true,
}: PdfRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = React.useState(1)
  const [zoom, setZoom] = React.useState(1.0)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const [viewportWidth, setViewportWidth] = React.useState(0)
  // 每页基础尺寸（scale=1 时 viewport）：用来给"未渲染 slot"先占好高度，避免滚动跳变
  const [pageBaseSizes, setPageBaseSizes] = React.useState<Record<number, { width: number; height: number }>>({})
  // render-derived 镜像：Step B 的 setInterval 轮询里读最新 base sizes，又不想把 pageBaseSizes
  // 塞进 effect deps（会重挂轮询）。渲染期同步赋值是安全的派生镜像。
  const pageBaseSizesRef = React.useRef(pageBaseSizes)
  pageBaseSizesRef.current = pageBaseSizes
  // PDF 内嵌大纲（书签）：null = 未加载，[] = 已尝试但 PDF 无大纲
  const [outline, setOutline] = React.useState<OutlineNode[] | null>(null)
  // 搜索:已提交的关键词、扫页后命中列表、当前激活匹配下标
  const [searchQuery, setSearchQuery] = React.useState<string>('')
  const [searchMatches, setSearchMatches] = React.useState<SearchMatch[]>([])
  const [currentMatchIdx, setCurrentMatchIdx] = React.useState<number>(0)
  const setPreviewFlashMessage = useSetAtom(previewFlashMessageAtom)
  // 跨视图跳转的"一次性"门控：记下已处理过的 pendingScrollNoteId，避免后续
  // pageNum / quoteHighlights 变化（尤其用户手动滚动触发的 pageNum 更新）让找页/
  // 滚动 effect 反复重跑，把 PDF 一直按在 note 位置不放。点新 ref（id 变）时 `!==`
  // 自然解锁再跑一次。doc 变（换 PDF）由下方 effect 重置回 null 重新武装。
  const scannedNoteIdRef = React.useRef<string | null>(null)
  const scrolledNoteIdRef = React.useRef<string | null>(null)
  // 已完成渲染的页码集合（PdfPageSlot.onRendered 上报）：Step B 据此判断滚动目标上方的
  // slot 是否已落定高度，避免懒加载未完成就滚动导致抖动。用 ref 不用 state —— 只在
  // setInterval 轮询里读，无需触发整组 slot re-render。
  const renderedPagesRef = React.useRef<Set<number>>(new Set())
  // 重新定位 nonce：展开/收起浮层（容器尺寸变）时自增，作为 Step A/B effect 的依赖，
  // 配合重置一次性门控让定位链路在新尺寸下重跑一遍。
  const [relocateNonce, setRelocateNonce] = React.useState(0)
  // note → 命中页缓存：Step A 首次扫页命中后写入；后续重定位（展开/收起换尺寸）直接读缓存
  // 切页，免去重扫整文（异步、慢、易竞态）。同一 doc 内有效，doc 变时连同门控一起清空。
  const notePageCacheRef = React.useRef<Map<string, number>>(new Map())
  // 重定位进行中锁定的目标页：定位（Step A 切页 → Step B 滚动）期间，IntersectionObserver
  // 不得把 pageNum 改离此页。收起浮层时容器重排、scrollTop 被钳到顶 → IO 会算出 page 1
  // 抢先覆盖刚切好的目标页，导致"收起后回到第 1 页"。Step B 滚动落定后清锁。null = 无锁。
  const relocateLockPageRef = React.useRef<number | null>(null)

  // 翻页并弹出 "页码 / 总页数" 浮层，同时滚动到目标 slot 顶部
  const goToPage = React.useCallback(
    (next: number, total: number): void => {
      setPageNum(next)
      setPreviewFlashMessage({ text: `${next} / ${total}` })
      // 等 React commit 后再滚（slot 已挂载）
      requestAnimationFrame(() => {
        const root = viewportRef.current
        if (!root) return
        const slot = root.querySelector<HTMLElement>(`[data-page-num="${next}"]`)
        if (slot) slot.scrollIntoView({ block: 'start' })
      })
    },
    [setPreviewFlashMessage],
  )

  // 加载文档（IPC 读二进制 → Blob URL → pdfjs.getDocument，绕开 Electron file:// 安全策略）
  React.useEffect(() => {
    let cancelled = false
    let loadedDoc: PDFDocumentProxy | null = null
    let blobUrl: string | null = null
    // 切换论文（path 变）时立即清空旧 doc → 顶层显示 "Loading PDF"，清掉旧论文画布；
    // 否则旧 doc 一直显示到新 doc 加载完，期间会出现旧画布/按旧尺寸渲染再回缩的溢出帧
    //（图：右栏切论文时 PDF 先溢出再 re-fit）。新 doc 就绪后按当前宽度一次性渲染并 fit。
    setDoc(null)
    void (async (): Promise<void> => {
      try {
        const base64 = await window.electronAPI.previewReadBinary(path)
        if (cancelled) return
        // base64 → Uint8Array
        const binaryString = atob(base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const head = Array.from(bytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
        console.log('[PdfRenderer] 读入字节:', bytes.length, '前 8 字节:', head)
        // 用 Blob URL 避免 pdfjs 5.x 直接传 Uint8Array 的潜在问题
        const blob = new Blob([bytes], { type: 'application/pdf' })
        blobUrl = URL.createObjectURL(blob)
        const d = await pdfjs.getDocument(blobUrl).promise
        if (cancelled) {
          void d.destroy().catch(() => { /* noop */ })
          return
        }
        loadedDoc = d
        setDoc(d)
        setPageNum(1)
        // 新文档加载 → 重置缩放回 fit-width 基线（zoom=1.0 = 容器宽度），
        // 避免上一篇遗留的缩放让新 PDF 一上来就不充满预览区
        setZoom(1.0)
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err : new Error(String(err)))
      }
    })()
    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      if (loadedDoc) void loadedDoc.destroy().catch(() => { /* noop */ })
    }
  }, [path, onError])

  // 跟踪预览容器宽度：PDF 的 100% 定义为"适应当前可用宽度"
  // 两条来源：
  //   1) ResizeObserver — 容器尺寸真实变化（如窗口拉伸、Open PDF 切换浮层）
  //   2) useLayoutEffect 兜底 — 首次 mount 时如果 ResizeObserver 还没派发，主动量一次
  //      （组件曾被 Suspense / display:none 包裹时，第一次 measure 可能拿到 0）
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = (): void => {
      const w = Math.max(0, el.clientWidth)
      setViewportWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // useLayoutEffect 兜底：每次 commit 后量一次 clientWidth；ResizeObserver 偶尔在
  // 父容器 className 切换（Open PDF 95vw 展开）后异步触发，这里同步再确认一次，
  // 让 Open PDF 时立刻 re-fit 不靠下一帧。
  React.useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const w = Math.max(0, el.clientWidth)
    setViewportWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev))
  })

  // 文档加载后批量预取每页 base viewport 尺寸（scale=1），用来给未渲染 slot 占位
  // 不渲染 canvas，只读 metadata，pdfjs 内部会缓存 PageProxy，后续真正渲染时复用
  React.useEffect(() => {
    if (!doc) return
    let cancelled = false
    void (async (): Promise<void> => {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return
        try {
          const page = await doc.getPage(i)
          const v = page.getViewport({ scale: 1 })
          // 增量写入：每页一就绪就更新，未渲染 slot 的占位高度逐页矫正而非一次性齐跳，
          // 既减少普通滚动时的高度抖动，也让"滚动到 note"链路能逐页判断布局是否落定。
          const size = { width: v.width, height: v.height }
          if (!cancelled) setPageBaseSizes((prev) => (prev[i] ? prev : { ...prev, [i]: size }))
        } catch {
          // 取不到尺寸就走默认占位
        }
      }
    })()
    return () => { cancelled = true }
  }, [doc])

  // Open PDF 浮层开关切换时（inline ↔ 95vw 浮层，容器尺寸变 → PDF 重新 fit + 重渲染，
  // 旧滚动位置失效）：清搜索 + 重置缩放回 fit-width。
  //   - 有待定位 note：重新武装一次性门控 → Step A（命中页已缓存，直接切页，免重扫）+
  //     Step B（等新尺寸渲染落定后把 span 滚回视口中央）。重定位用缓存页号是确定性的，
  //     不依赖"宽度 effect 何时触发 / IO 抢先把 pageNum 设回 1"这类竞态。
  //   - 无 note：回到第 1 页（打开/关闭都从头读）。
  // 跳过首次 mount(showOutline 初始值的 effect):此时 doc 还没加载,无意义且会触发
  // visiblePages effect 重挂 IO。用 ref 记录上一次值,只在真正切换时处理。
  const prevShowOutlineRef = React.useRef<boolean | undefined>(showOutline)
  React.useEffect(() => {
    if (prevShowOutlineRef.current === showOutline) return
    prevShowOutlineRef.current = showOutline
    if (!doc) return
    setSearchQuery('')
    setZoom(1.0)
    if (pendingScrollNoteId) {
      // 重新武装定位链路。renderedPagesRef 清空：各 slot 会在新宽度下重渲染重新上报，
      // 留旧 entry 会让 Step B 门控误判"已落定"在新尺寸渲染完成前抢先滚动。
      scannedNoteIdRef.current = null
      scrolledNoteIdRef.current = null
      renderedPagesRef.current = new Set()
      // 已知命中页 → 锁定 IO，避免重排期间 IO 把 pageNum 拉回 page 1。Step B 滚动落定后清锁。
      const cached = notePageCacheRef.current.get(pendingScrollNoteId)
      if (cached) relocateLockPageRef.current = cached
      setRelocateNonce((v) => v + 1) // 触发 Step A/B effect 重跑（Step A 读缓存切页）
      return
    }
    setPageNum(1)
    requestAnimationFrame(() => {
      const root = viewportRef.current
      if (root) root.scrollTo({ top: 0 })
    })
  }, [showOutline, doc, pendingScrollNoteId])

  // 文档加载后拉取大纲（书签）。pdfjs getOutline 返回树；每项的 dest 可能是
  // 字符串（命名 destination,需 getDestination 解一层）或数组（直接含 ref）。
  // ref → getPageIndex(ref) 拿 0-based 页码。失败项 pageIndex=null,UI 弱化。
  React.useEffect(() => {
    if (!doc) return
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const raw = await (doc as unknown as { getOutline: () => Promise<unknown[] | null> }).getOutline()
        if (cancelled) return
        if (!raw || raw.length === 0) {
          setOutline([])
          return
        }
        const resolved = await resolveOutline(doc, raw)
        // 很多论文 PDF 把整篇 paper title 作为唯一顶层节点,真正的章节是它的子节点。
        // 这种情况脱掉外壳,直接展示章节列表,避免侧栏第一行重复显示论文标题。
        const flattened = resolved.length === 1 && resolved[0]!.children.length > 0
          ? resolved[0]!.children
          : resolved
        if (!cancelled) setOutline(flattened)
      } catch {
        if (!cancelled) setOutline([])
      }
    })()
    return () => { cancelled = true }
  }, [doc])

  // 搜索:提交关键词后扫每一页 textContent 收集所有命中,定位到第一条
  // 重新提交(包括清空)会取消进行中的扫描
  React.useEffect(() => {
    if (!doc) return
    if (!searchQuery) {
      setSearchMatches([])
      setCurrentMatchIdx(0)
      return
    }
    let cancelled = false
    const needle = searchQuery.toLowerCase()
    void (async (): Promise<void> => {
      const out: SearchMatch[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return
        try {
          const page = await doc.getPage(i)
          const tc = await page.getTextContent()
          const pageText = tc.items.map((it) => ('str' in it ? (it as { str: string }).str : '')).join('')
          const hay = pageText.toLowerCase()
          let from = 0
          while (from < hay.length) {
            const idx = hay.indexOf(needle, from)
            if (idx < 0) break
            out.push({ page: i, charStart: idx, charEnd: idx + needle.length })
            from = idx + Math.max(1, needle.length)
          }
        } catch {
          // 单页失败不阻断整体扫描
        }
      }
      if (cancelled) return
      setSearchMatches(out)
      setCurrentMatchIdx(0)
      if (out.length > 0) {
        const first = out[0]!
        setPageNum(first.page)
        setPreviewFlashMessage({ text: `1 / ${out.length}` })
      } else {
        setPreviewFlashMessage({ text: '0 / 0' })
      }
    })()
    return () => { cancelled = true }
  }, [doc, searchQuery, setPreviewFlashMessage])

  // 切换搜索结果:更新 idx → 跳到该匹配所在页,等 slot 渲染好后 scrollIntoView 由
  // textLayer 高亮 + Step B 类似机制走;这里只负责切页 + flash
  const goToMatch = React.useCallback(
    (delta: 1 | -1): void => {
      if (searchMatches.length === 0) return
      const next = (currentMatchIdx + delta + searchMatches.length) % searchMatches.length
      setCurrentMatchIdx(next)
      const m = searchMatches[next]!
      setPageNum(m.page)
      setPreviewFlashMessage({ text: `${next + 1} / ${searchMatches.length}` })
    },
    [searchMatches, currentMatchIdx, setPreviewFlashMessage],
  )

  // 当前匹配渲染完成后滚动其首个高亮 span 到视口中央
  React.useEffect(() => {
    if (searchMatches.length === 0) return
    let elapsed = 0
    const tryScroll = (): boolean => {
      const root = viewportRef.current
      if (!root) return false
      const node = root.querySelector<HTMLElement>('.pdf-search-current')
      if (!node) return false
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return true
    }
    if (tryScroll()) return
    const interval = window.setInterval(() => {
      if (tryScroll()) { window.clearInterval(interval); return }
      elapsed += 50
      if (elapsed >= 1500) window.clearInterval(interval)
    }, 50)
    return () => window.clearInterval(interval)
  }, [currentMatchIdx, searchMatches])

  // 键盘左右箭头翻页（↑↓ 留给 InlinePreview 切换文件，避免冲突；输入控件聚焦时不响应）
  React.useEffect(() => {
    if (!doc) return
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setPageNum((p) => {
        const next = e.key === 'ArrowLeft' ? Math.max(1, p - 1) : Math.min(doc.numPages, p + 1)
        if (next !== p) {
          setPreviewFlashMessage({ text: `${next} / ${doc.numPages}` })
          // 同步滚到目标 slot
          requestAnimationFrame(() => {
            const root = viewportRef.current
            if (!root) return
            const slot = root.querySelector<HTMLElement>(`[data-page-num="${next}"]`)
            if (slot) slot.scrollIntoView({ block: 'start' })
          })
        }
        return next
      })
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [doc, setPreviewFlashMessage])

  // 计算当前可见窗口：[pageNum-WINDOW_RADIUS, pageNum+WINDOW_RADIUS]，clamp 到 [1, numPages]
  const visiblePages = React.useMemo<number[]>(() => {
    if (!doc) return []
    const lo = Math.max(1, pageNum - WINDOW_RADIUS)
    const hi = Math.min(doc.numPages, pageNum + WINDOW_RADIUS)
    const out: number[] = []
    for (let i = lo; i <= hi; i++) out.push(i)
    return out
  }, [doc, pageNum])

  // textLayer 点击命中 [data-note-id] 时的 noteId 回调,空 onHighlightClick 时静默
  const handleNoteHighlightClick = React.useCallback((noteId: string): void => {
    if (onHighlightClick) onHighlightClick(noteId)
  }, [onHighlightClick])

  // PdfPageSlot 渲染完成上报：记进 renderedPagesRef，供 Step B 判断布局稳定。
  // 必须稳定（[] deps）—— 进了 slot 重渲染 effect 的 deps，不稳会触发 canvas 重建。
  const handleSlotRendered = React.useCallback((n: number): void => {
    renderedPagesRef.current.add(n)
  }, [])

  // Hover 时浮出笔记内容 tooltip。坐标基于 viewportRef 容器，悬停时由 PageSlot
  // 把命中 span 的 viewport-相对 left/top 上报，过滤无 content 的笔记。
  const [hoveredNote, setHoveredNote] = React.useState<{
    noteId: string
    content: string
    left: number
    top: number
  } | null>(null)
  // 同一条 note 的 quote 可能被 PDF.js textLayer 拆成多个 span（如 "We present" 与
  // "AgentTrust" 中间的空白 span 不在 match 区间内），鼠标横向滑过 gap 时 mouseout 会
  // 报 null → tooltip 闪烁/重建。clear 时延迟一帧，期间收到同 noteId 的 over 直接复用。
  const clearTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleNoteHighlightHover = React.useCallback((noteId: string | null, rect: DOMRect | null): void => {
    if (!noteId || !rect) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = setTimeout(() => setHoveredNote(null), 120)
      return
    }
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    const note = quoteHighlights?.find((h) => h.id === noteId)
    const content = note?.content?.trim()
    if (!content) { setHoveredNote(null); return }
    const root = viewportRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    // 锚定高亮 span 左上角：tooltip 左边与 span 左边对齐，底边贴 span 顶边上方 6px
    // 同 noteId 复用现有 tooltip 时，保留原位置，避免在多 span 间跳来跳去
    setHoveredNote((prev) => {
      if (prev && prev.noteId === noteId) return prev
      return {
        noteId,
        content,
        left: rect.left - rootRect.left + root.scrollLeft,
        top: rect.top - rootRect.top + root.scrollTop - 6,
      }
    })
  }, [quoteHighlights])
  React.useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
  }, [])

  // 滚动驱动当前页：IntersectionObserver 监听所有可见 slot，
  // 选 intersectionRatio 最大者作为新的 pageNum（仅在差异时 set，避免抖动）
  React.useEffect(() => {
    if (!doc) return
    const root = viewportRef.current
    if (!root) return
    const ratios = new Map<number, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const n = Number((entry.target as HTMLElement).dataset.pageNum)
          if (Number.isFinite(n)) ratios.set(n, entry.intersectionRatio)
        }
        let bestPage = -1
        let bestRatio = 0
        for (const [n, r] of ratios) {
          if (r > bestRatio) {
            bestRatio = r
            bestPage = n
          }
        }
        // 重定位锁定期间忽略 IO：避免收起浮层时 scrollTop 被钳到顶算出的 page 1 覆盖目标页。
        if (relocateLockPageRef.current !== null) return
        if (bestPage > 0) {
          setPageNum((cur) => (cur === bestPage ? cur : bestPage))
        }
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    const slots = root.querySelectorAll<HTMLElement>('[data-page-num]')
    slots.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
    // visiblePages 变化时 slot DOM 会变，需要重新挂 observer
  }, [doc, visiblePages])

  // ===== 跨视图跳转的"找页 + 滚动"链路 =====
  //
  // 上游（NotesView → ItemDetailPanel）把 pendingScrollNoteId 传进来；流程分两步：
  //
  //   Step A (effect)：doc 加载完成且 pendingScrollNoteId 存在时，扫描每页 textContent
  //                   查找该 note 的 quote 字符串；命中 → setPageNum 切到那一页。
  //                   quote 字符串本身从 quoteHighlights 列表里反查（同一来源）。
  //   Step B (effect)：监听 pendingScrollNoteId / quoteHighlights；轮询 viewport 内所有
  //                   [data-note-id="..."] span（任一 slot 的 textLayer 渲染完成后会出现）
  //                   → 找到即 scrollIntoView + 调 onScrollComplete 收尾。2 秒超时后无条件
  //                   onScrollComplete，避免 atom 留存污染下次跳转。
  //
  // 两步都按 note id 做"一次性"门控（scannedNoteIdRef / scrolledNoteIdRef）：定位只在
  // **首次加载**发生，之后用户可自由滚动；点新 ref（id 变）解锁再跑一次，换 PDF（doc 变）
  // 由下方 reset effect 重置门控重新武装。
  //
  // 解耦原因：在原渲染 effect 里塞滚动逻辑会让其依赖膨胀；拆两个独立 effect 边界清晰。

  // doc 变（换 PDF）时重置一次性门控 + 已渲染页集合 + note 页缓存，让新文档能重新定位。
  React.useEffect(() => {
    scannedNoteIdRef.current = null
    scrolledNoteIdRef.current = null
    renderedPagesRef.current = new Set()
    notePageCacheRef.current = new Map()
  }, [doc])

  React.useEffect(() => {
    if (!doc || !pendingScrollNoteId) return
    // 一次性：同一 note 只扫一次页；避免 quoteHighlights 变化触发重复扫页 + 切页。
    if (scannedNoteIdRef.current === pendingScrollNoteId) return
    // 命中页缓存命中：重定位（展开/收起）时直接切到上次命中的页，免重扫整文。Step B
    // 仍会等该页 textLayer 渲染好后把 span 滚入视口。
    const cachedPage = notePageCacheRef.current.get(pendingScrollNoteId)
    if (cachedPage) {
      scannedNoteIdRef.current = pendingScrollNoteId
      relocateLockPageRef.current = cachedPage // 锁定 IO 直到 Step B 滚动落定
      setPageNum((cur) => (cur === cachedPage ? cur : cachedPage))
      return
    }
    const target = quoteHighlights?.find((h) => h.id === pendingScrollNoteId)
    if (!target || !target.quote) {
      if (!target) return // 等 quoteHighlights 加载（target 未到，不算扫过）
      scannedNoteIdRef.current = pendingScrollNoteId
      onScrollComplete?.()
      return
    }
    // target.quote 已就绪 → 本轮扫页已"开工"，标记扫过；后续 deps 变化不再重扫。
    scannedNoteIdRef.current = pendingScrollNoteId
    let cancelled = false
    // 诊断日志：一次点击只在起点打一条，包含 **quote 全文** + 拆分出来的 fragments
    // 列表（中段 `…` 桥接 quote 会拆成多段，单段 quote 数组长度=1）。
    // 用 console.info("[pdf-quote] 查找", {...}) 一条概览即可肉眼判断 quote 内容；
    // 命中/未命中各只打 1 条；textLayer 渲染期间的 per-page miss 不再喧嚣。
    const fragments = splitQuoteFragments(target.quote)
    console.info('[pdf-quote] 查找', {
      quote: target.quote,
      fragments,
      numPages: doc.numPages,
    })
    if (getIsDevMode()) {
      // 写到 window.__asciDebug.lastQuote，方便在 DevTools console 二次手动调
      // findQuoteFragmentsInPage(pageText, window.__asciDebug.lastQuote) 排查；
      // 桥接 quote 情况下也可以单独跑 splitQuoteFragments 看拆段结果
      const w = window as unknown as { __asciDebug?: { lastQuote?: string; lastTraceId?: string } }
      if (!w.__asciDebug) w.__asciDebug = {}
      w.__asciDebug.lastQuote = target.quote
      w.__asciDebug.lastTraceId = pendingScrollNoteId
    }
    void (async (): Promise<void> => {
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return
        const page = await doc.getPage(i)
        const tc = await page.getTextContent()
        const itemsStr = tc.items.map((it) => ('str' in it ? (it as { str: string }).str : ''))
        // joinPdfItems 用单空格拼 items（详见模块顶部 PDF_ITEMS_JOIN_SEP 注释）：pdfjs
        // 不保证 item 间有自然空白，多栏布局直接 join('') 会黏成 `Databasesestablished`
        // / `OPENNew` 让 indexOf 必 miss。
        const pageText = joinPdfItems(itemsStr)
        // findQuoteFragmentsInPage：综述 skill 允许 `…` 桥接非关键片段，整条 quote 在
        // PDF 里基本不存在；按桥接符拆 fragment 分段匹配，**任一 fragment 命中即翻这页**
        // （保留"首个命中页"的原行为）。无桥接时退化为单 fragment 全量匹配。
        const matches = findQuoteFragmentsInPage(pageText, target.quote)
        if (matches.length > 0) {
          if (cancelled) return
          const first = matches[0]!
          const snippetStart = Math.max(0, first.idx - 20)
          const snippetEnd = Math.min(pageText.length, first.idx + first.len + 20)
          // 命中只打一条：哪页 / 命中几段 / 各段档位 / 周边 snippet 用于肉眼对照。
          console.info('[pdf-quote] 命中', {
            page: i,
            hitCount: matches.length,
            fragmentCount: first.fragmentCount,
            tiers: matches.map((m) => m.tier),
            snippet: pageText.slice(snippetStart, snippetEnd),
          })
          notePageCacheRef.current.set(pendingScrollNoteId, i) // 缓存命中页，供重定位复用
          // 锁定 IO 到 Step B 滚动落定（与缓存命中路径一致）：1→i 切页会让 windowed slot 重挂、
          // scrollTop 被钳到顶，IntersectionObserver 会算出 page 1 把 setPageNum(i) 覆盖回去
          // （表现为"命中第 5 页但 pageNum 退回 1、Step B 滚动超时"，issue #452 复现日志即此）。
          // 锁住后 IO 在重排期间不改页，Step B doScroll 收尾时解锁。
          relocateLockPageRef.current = i
          setPageNum((cur) => (cur === i ? cur : i))
          return
        }
      }
      if (!cancelled) {
        // 全文文本匹配 miss。issue #452：复杂文本（公式等）DOM 选区 glyph 序列与 textLayer
        // getTextContent 序列本质不一致，quote-match 各档位都救不回。若 anchor 带捕获页码
        // （PDF textLayer 划词时记下的选区所在页）→ 回退翻到该页（只翻页，不画高亮框）；
        // 连页码都没有才算彻底 miss → 弹降级 toast 提示手动搜索。
        const fallbackPage = target.page
        const canFallbackToPage =
          fallbackPage !== undefined && fallbackPage >= 1 && fallbackPage <= doc.numPages
        if (canFallbackToPage) {
          console.warn('[pdf-quote] 文本未匹配 → 页码回退', {
            quote: target.quote,
            page: fallbackPage,
            numPages: doc.numPages,
          })
          notePageCacheRef.current.set(pendingScrollNoteId, fallbackPage)
          // 锁定 IO 直到 Step B 收尾：与命中路径同理，防止 1→fallbackPage 切页时 IO 把页拉回 1。
          // 文本没匹配上 → 无 [data-note-id] span 可滚，Step B 轮询找不到节点会在 2 秒超时分支
          // 解锁 + onScrollComplete（既有逻辑，见下方 timeout 分支）。页已翻对，主诉求满足。
          relocateLockPageRef.current = fallbackPage
          setPageNum((cur) => (cur === fallbackPage ? cur : fallbackPage))
          return
        }
        // 连页码都没有（综述引文 / AI 抽取 md anchor / 摘要划词）→ 彻底 miss，降级提示。
        console.warn('[pdf-quote] 未匹配且无页码可回退（彻底 miss）', {
          quote: target.quote,
          fragments,
          numPages: doc.numPages,
        })
        toast.message(t('pdf.locateFailed', { snippet: target.quote.slice(0, 20) }))
        onScrollComplete?.()
      }
    })()
    return () => { cancelled = true }
    // relocateNonce：展开/收起后门控已重置，需重跑本扫页 effect
  }, [doc, pendingScrollNoteId, quoteHighlights, onScrollComplete, relocateNonce])

  // Step B：轮询 viewport 内任意 slot 的目标 span，**布局落定后**滚入视口
  //
  // 一次性：同一 note 只滚一次。**故意不把 pageNum 放进 deps** —— 用户手动滚动会让
  // IntersectionObserver 更新 pageNum，若 pageNum 进 deps 本 effect 会重跑、把 PDF 重新
  // scrollIntoView 拽回 note 位置（"滚不动 / 一直被按住"）。点新 ref（id 变）时 `!==`
  // 解锁再滚一次；换 PDF 时由 doc effect 重置 ref 重新武装。
  //
  // 防抖动门控：span 出现 ≠ 周围 slot 高度已落定。目标页上方的 slot（懒加载的
  // canvas 高度、未渲染页从 800px 占位矫正到真实高度）若在滚动之后才落定，会把目标
  // 顶下去、scrollIntoView 落点失效 → 抖动。所以滚动前要求：
  //   1) 目标页**及其上方所有页**的 base 尺寸已知（占位高度不再齐跳）；
  //   2) 目标页与其上一页（在窗口内者）已上报渲染完成（canvas 高度已落定）。
  // 满足后再 rAF 一帧让布局 flush，最后才 scrollIntoView。轮询每 50ms 复检，自然等齐。
  React.useEffect(() => {
    if (!pendingScrollNoteId) return
    if (scrolledNoteIdRef.current === pendingScrollNoteId) return
    const noteId = pendingScrollNoteId
    let attempts = 0
    // 同一条高亮的 quote 常被 textLayer 拆成多个 span（跨行/跨 run）。取首个用于"是否
    // 出现 / 落在哪页"的判断；居中滚动则用全部 span 的合并包围盒（见 doScroll）。
    const findNode = (): HTMLElement | null => {
      const root = viewportRef.current
      if (!root) return null
      return root.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(noteId)}"]`)
    }
    const findAllNodes = (): HTMLElement[] => {
      const root = viewportRef.current
      if (!root) return []
      return Array.from(root.querySelectorAll<HTMLElement>(`[data-note-id="${CSS.escape(noteId)}"]`))
    }
    // 目标页上方布局是否已稳定（base 尺寸 + 上一页渲染完成）。
    const layoutSettled = (node: HTMLElement): boolean => {
      const slot = node.closest<HTMLElement>('[data-page-num]')
      const targetPage = slot ? Number(slot.dataset.pageNum) : NaN
      if (!Number.isFinite(targetPage)) return true // 取不到页码就别卡死，直接放行
      // 1) 目标页及上方所有页 base 尺寸已知 —— 这些页的占位高度不会再从 800px 齐跳。
      const sizes = pageBaseSizesRef.current
      for (let p = 1; p <= targetPage; p++) {
        if (!sizes[p]) return false
      }
      // 2) 目标页 + 上一页（窗口内）已渲染完成，canvas 高度已落定。下方页不影响目标偏移。
      const rendered = renderedPagesRef.current
      if (!rendered.has(targetPage)) return false
      if (targetPage > 1 && !rendered.has(targetPage - 1)) return false
      return true
    }
    // 把全部高亮 span 的合并包围盒垂直中点对齐到容器垂直正中所需的 scrollTop。
    // 比 scrollIntoView({block:'center'}) 更准——后者只居中首个 span，多行 quote 会偏到首行。
    // 返回 null 表示当前取不到节点（span 还没挂上）。
    const computeCenterTop = (root: HTMLElement): number | null => {
      const nodes = findAllNodes()
      if (nodes.length === 0) return null
      const rootRect = root.getBoundingClientRect()
      let top = Infinity
      let bottom = -Infinity
      for (const n of nodes) {
        const r = n.getBoundingClientRect()
        if (r.top < top) top = r.top
        if (r.bottom > bottom) bottom = r.bottom
      }
      const highlightCenter = (top + bottom) / 2 - rootRect.top + root.scrollTop
      const maxTop = root.scrollHeight - root.clientHeight
      return Math.max(0, Math.min(highlightCenter - root.clientHeight / 2, maxTop))
    }
    // 收敛式居中：用 instant 滚动并连滚几帧复位。展开/收起后 slot 仍在按新尺寸重渲染，
    // 单次 smooth 滚动会被后续 reflow 顶偏（图 4 那样停在偏下位置）；每帧重算 + instant
    // 跳到目标，直到高亮稳定落在容器正中（误差 < 2px）或耗尽帧预算。
    const doScroll = (): void => {
      let frames = 0
      let stableFrames = 0
      const MAX_FRAMES = 20 // ~20 帧（约 320ms）足够覆盖 collapse/expand 的重排
      const step = (): void => {
        const root = viewportRef.current
        if (!root) { relocateLockPageRef.current = null; return }
        const target = computeCenterTop(root)
        if (target !== null) {
          if (Math.abs(root.scrollTop - target) > 2) {
            root.scrollTop = target // instant：落点不被后续 reflow 拖拽出动画轨迹
            stableFrames = 0
          } else {
            stableFrames++
          }
        }
        frames++
        // 连续 2 帧已居中（reflow 停了）即提前收尾，避免无谓占用滚动 320ms。
        if (stableFrames < 2 && frames < MAX_FRAMES) {
          requestAnimationFrame(step)
        } else {
          // 收尾：解锁 IO，恢复跟踪当前页（此后用户滚动正常更新页码）。
          relocateLockPageRef.current = null
        }
      }
      requestAnimationFrame(step)
    }
    // 同步收尾 one-shot 门控 + onScrollComplete，rAF 里只做滚动，避免重复进入。
    const tryScroll = (): boolean => {
      const node = findNode()
      if (!node || !layoutSettled(node)) return false
      doScroll()
      return true
    }
    // 成功路径静默（hit 日志价值低；用户能看到 PDF 滚到位即知）。
    // 只在超时打一条 warn —— 用户看到"点了没滚动"时 console 一目了然。
    if (tryScroll()) {
      scrolledNoteIdRef.current = noteId
      onScrollComplete?.()
      return
    }
    let elapsed = 0
    const interval = window.setInterval(() => {
      attempts++
      if (tryScroll()) {
        window.clearInterval(interval)
        scrolledNoteIdRef.current = noteId
        onScrollComplete?.()
        return
      }
      elapsed += 50
      if (elapsed >= 2000) {
        window.clearInterval(interval)
        // 2 秒超时仍未满足"span 存在 + 布局落定"。可能原因：
        //   (a) textLayer 未在窗口内渲染（slot 未进入 IO 视野）
        //   (b) textLayer 渲染了但 applyQuoteHighlights miss → 没挂 data-note-id
        //   (c) 某页 base 尺寸取尺寸失败，门控永不满足
        // 区分看上一条 [pdf-quote] 日志：命中 + 这里 timeout = (a)；未匹配 = (b)。
        console.warn('[pdf-quote] 滚动到目标段超时', {
          attempts,
          pageNum,
        })
        // 兜底：span 已存在但门控没满足（如 base 尺寸缺一页）也尽力滚一次，抖动可接受。
        const node = findNode()
        if (node) doScroll()
        else relocateLockPageRef.current = null // 没节点可滚也要解锁，否则 IO 永久失效
        scrolledNoteIdRef.current = noteId
        onScrollComplete?.()
      }
    }, 50)
    return () => window.clearInterval(interval)
    // relocateNonce：展开/收起后门控已重置，需重跑本滚动 effect
  }, [pendingScrollNoteId, quoteHighlights, onScrollComplete, relocateNonce])

  if (!doc) {
    return <div className="p-4 text-xs text-muted-foreground">{t('pdf.loading')}</div>
  }

  const totalPages = doc.numPages
  // 容器未落定（抽屉滑入动画中）时按 0 处理：slot 跳过渲染并展示 loading，避免按过渡宽溢出。
  // 动画放完 containerSettled→true，此时 viewportWidth 已被 RO/layoutEffect 量到最终值，
  // 直接得到正确可用宽度，slot 一次性按最终宽度渲染并 fit。
  const availableWidth = containerSettled ? Math.max(0, viewportWidth - 24) : 0

  return (
    <div className="flex flex-col h-full overflow-hidden bg-muted/10 titlebar-no-drag">
      {/* 主体行：左 outline 侧栏（可选）+ 右滚动页面区 */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {showOutline && (
          <PdfOutlineSidebar
            outline={outline}
            currentPage={pageNum}
            onJump={(p) => goToPage(Math.max(1, Math.min(totalPages, p)), totalPages)}
            emptyLabel={t('pdf.outline.empty')}
            headingLabel={t('pdf.outline.heading')}
          />
        )}
        {/* 多页 slot 堆叠在垂直滚动容器里。IntersectionObserver root = 此容器，
            IO 选 intersectionRatio 最大者作为 pageNum；窗口随之滑动，旧页 unmount。 */}
        <div ref={viewportRef} className="relative flex-1 min-h-0 overflow-auto pdf-slot-scroll scrollbar-thin">
          {hoveredNote && (
            <div
              className="pointer-events-none absolute z-50 max-w-[320px] -translate-y-full rounded-md bg-tooltip/90 px-3 py-2 text-xs text-tooltip-foreground shadow-lg backdrop-blur whitespace-pre-wrap"
              style={{ left: hoveredNote.left, top: hoveredNote.top }}
            >
              {hoveredNote.content}
            </div>
          )}
          <div className="flex flex-col items-center gap-3 p-3">
            {visiblePages.map((n) => {
              // 把命中的搜索匹配按当前页过滤,并标记哪一条是当前活跃
              const pageMatches = searchMatches.filter((m) => m.page === n)
              const currentMatch = searchMatches[currentMatchIdx]
              const currentInPage = currentMatch && currentMatch.page === n
                ? pageMatches.findIndex((m) => m.charStart === currentMatch.charStart && m.charEnd === currentMatch.charEnd)
                : -1
              return (
                <PdfPageSlot
                  key={n}
                  doc={doc}
                  pageNum={n}
                  availableWidth={availableWidth}
                  zoom={zoom}
                  baseSize={pageBaseSizes[n]}
                  quoteHighlights={quoteHighlights}
                  searchMatches={pageMatches}
                  currentSearchIdxInPage={currentInPage}
                  onError={onError}
                  onNoteHighlightClick={handleNoteHighlightClick}
                  onNoteHighlightHover={handleNoteHighlightHover}
                  onRendered={handleSlotRendered}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* 底部工具栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background border-t border-border text-sm">
        <Button size="sm" variant="ghost" className="h-6 px-2" disabled={pageNum <= 1} onClick={() => goToPage(Math.max(1, pageNum - 1), totalPages)}>
          <ChevronLeft className="!size-3" />
        </Button>
        <PageJumpInput
          currentPage={pageNum}
          totalPages={totalPages}
          onJump={(p) => goToPage(p, totalPages)}
        />
        <Button size="sm" variant="ghost" className="h-6 px-2" disabled={pageNum >= totalPages} onClick={() => goToPage(Math.min(totalPages, pageNum + 1), totalPages)}>
          <ChevronRight className="!size-3" />
        </Button>

        <div className="flex-1" />

        {showOutline && (
          <PdfSearchBar
            query={searchQuery}
            onSubmit={setSearchQuery}
            matchCount={searchMatches.length}
            currentIdx={currentMatchIdx}
            onPrev={() => goToMatch(-1)}
            onNext={() => goToMatch(1)}
            placeholder={t('pdf.search.placeholder')}
          />
        )}

        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setZoom((s) => Math.max(0.5, s - 0.25))}>
          <ZoomOut className="!size-3" />
        </Button>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setZoom((s) => Math.min(3, s + 0.25))}>
          <ZoomIn className="!size-3" />
        </Button>
      </div>
    </div>
  )
}

/**
 * 页码跳转输入：受控本地草稿，blur / Enter 提交。Esc 取消（恢复 currentPage）。
 * 不在每次按键 setPageNum,避免半写状态触发昂贵的页面渲染。
 */
function PageJumpInput({
  currentPage,
  totalPages,
  onJump,
}: {
  currentPage: number
  totalPages: number
  onJump: (page: number) => void
}): React.ReactElement {
  const { t } = useT('preview')
  const [draft, setDraft] = React.useState<string>(String(currentPage))
  const [editing, setEditing] = React.useState(false)
  // currentPage 来自滚动 / 跳转;非编辑态下保持同步显示
  React.useEffect(() => {
    if (!editing) setDraft(String(currentPage))
  }, [currentPage, editing])
  const commit = (): void => {
    const n = parseInt(draft, 10)
    if (Number.isFinite(n)) {
      const clamped = Math.max(1, Math.min(totalPages, n))
      if (clamped !== currentPage) onJump(clamped)
      setDraft(String(clamped))
    } else {
      setDraft(String(currentPage))
    }
    setEditing(false)
  }
  return (
    <div className="inline-flex items-center gap-1 tabular-nums">
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={(e) => {
          setEditing(true)
          e.currentTarget.select()
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(String(currentPage))
            setEditing(false)
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
        className="w-10 h-6 px-1 text-center rounded-sm border border-border bg-background text-foreground text-sm tabular-nums focus:outline-none"
        aria-label={t('pdf.pageAriaLabel')}
      />
      <span className="text-muted-foreground">/ {totalPages}</span>
    </div>
  )
}

/**
 * PDF 全文搜索条:本地草稿 + Enter 提交。提交时把字符串上抛触发顶层 scan effect。
 * matchCount > 0 时展示 "i / N" + 上下导航;清空草稿提交 → 清空高亮。
 */
function PdfSearchBar({
  query,
  onSubmit,
  matchCount,
  currentIdx,
  onPrev,
  onNext,
  placeholder,
}: {
  query: string
  onSubmit: (q: string) => void
  matchCount: number
  currentIdx: number
  onPrev: () => void
  onNext: () => void
  placeholder: string
}): React.ReactElement {
  const { t } = useT('preview')
  const [draft, setDraft] = React.useState<string>(query)
  React.useEffect(() => { setDraft(query) }, [query])
  const commit = (): void => { onSubmit(draft.trim()) }
  const clear = (): void => {
    setDraft('')
    onSubmit('')
  }
  return (
    <div className="inline-flex items-center gap-1">
      <div className="relative inline-flex items-center">
        <SearchIcon className="absolute left-1.5 size-3 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey && matchCount > 0 && draft === query) onPrev()
              else if (matchCount > 0 && draft === query) onNext()
              else commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              clear()
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
          placeholder={placeholder}
          className="h-6 w-40 pl-6 pr-6 rounded-sm border border-border bg-background text-foreground text-sm focus:outline-none"
          aria-label="Search"
        />
        {draft && (
          <Button
            type="button"
            variant="ghost"
            size="icon-2xs"
            onClick={clear}
            className="absolute right-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label={t('pdf.search.clearAriaLabel')}
          >
            <XIcon className="!size-3" />
          </Button>
        )}
      </div>
      {query && matchCount > 0 && (
        <>
          <span className="tabular-nums text-muted-foreground px-1">
            {currentIdx + 1} / {matchCount}
          </span>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onPrev} disabled={matchCount === 0}>
            <ChevronUp className="!size-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onNext} disabled={matchCount === 0}>
            <ChevronDown className="!size-3" />
          </Button>
        </>
      )}
      {query && matchCount === 0 && (
        <span className="tabular-nums text-muted-foreground px-1">0 / 0</span>
      )}
    </div>
  )
}

/**
 * 单页 slot：渲染一页的 canvas + textLayer。
 *
 * 渲染流程与原 PdfRenderer 的单页 effect 相同（canvas 位图 + 透明 textLayer），
 * 拆成独立子组件后每页有自己的 ref 和 effect 生命周期，slot unmount 时自动 cleanup
 * 老的 render / TextLayer，不会泄漏。
 *
 * data-page-num：标识页码，IntersectionObserver 用它读 dataset 决定当前页。
 */
function PdfPageSlot({
  doc,
  pageNum,
  availableWidth,
  zoom,
  baseSize,
  quoteHighlights,
  searchMatches,
  currentSearchIdxInPage,
  onError,
  onNoteHighlightClick,
  onNoteHighlightHover,
  onRendered,
}: {
  doc: PDFDocumentProxy
  pageNum: number
  availableWidth: number
  zoom: number
  baseSize: { width: number; height: number } | undefined
  quoteHighlights: ReadonlyArray<{ id: string; quote: string; content?: string }> | undefined
  searchMatches: ReadonlyArray<SearchMatch>
  currentSearchIdxInPage: number  // 当前激活匹配在 pageMatches 中的位置;-1 = 当前页无激活
  onError: (err: Error) => void
  onNoteHighlightClick: (noteId: string) => void
  onNoteHighlightHover: (noteId: string | null, rect: DOMRect | null) => void
  // canvas + textLayer 渲染完成（高度已落定、data-note-id span 已挂）时上报页码，
  // 供父组件的"滚动到 note"链路判断布局是否稳定，避免懒加载未完成时滚动抖动。
  // 必须传稳定 useCallback —— 它进了重渲染 effect 的 deps，不稳会触发 canvas 重建。
  onRendered?: (pageNum: number) => void
}): React.ReactElement {
  const { t } = useT('preview')
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  // textLayer 挂载容器：内部不放 React 节点,TextLayerBuilder 自带 div 由 imperative 代码挂入
  const textLayerMountRef = React.useRef<HTMLDivElement | null>(null)
  // 高亮 effect 用:重渲染后保留的 textDivs / itemsStr / textLayer 容器引用,避免
  // quoteHighlights / searchMatches 变化也触发整个 canvas+textLayer 重建。layerDiv 供
  // clearInjectedHighlights 在内层高亮 span 上做 unwrap 清理时限定作用域。
  const textMappingRef = React.useRef<{
    textDivs: HTMLElement[]
    itemsStr: string[]
    layerDiv: HTMLElement | null
  }>({ textDivs: [], itemsStr: [], layerDiv: null })
  const [renderTick, setRenderTick] = React.useState(0) // textLayer rebuild 完成的信号,触发高亮 effect
  // 当前已绘制位图所基于的 (availableWidth, zoom)。canvas 渲染是异步的（pdfjs page.render
  // 是 promise），尺寸变化（尤其展开/收起浮层让容器宽度突变）后，新渲染完成前画布上仍是
  // **旧宽度**的位图——按旧 CSS px 显示可能超出新容器，造成"打开浮层 PDF 先溢出再回缩"。
  // 用它判断画布是否过期：过期时隐藏画布、展示 loading 占位（占位高度按新尺寸算，故无溢出），
  // 待匹配新尺寸的渲染完成再显示画布。null = 尚未首次渲染完成。
  const [renderedKey, setRenderedKey] = React.useState<string | null>(null)
  const currentKey = `${availableWidth}x${zoom}`
  const isStale = renderedKey !== currentKey

  // 重逻辑:canvas + textLayer 构建。仅依赖会影响 viewport / pdfPage 的输入。
  // quoteHighlights / searchMatches 由独立的轻 effect 处理,避免父组件 re-render
  // 触发 page.render() 并发,导致 "Cannot use the same canvas during multiple render() operations"。
  React.useEffect(() => {
    if (availableWidth <= 0) return // 容器还没量到宽度，跳过本次渲染，避免 fitWidthScale=1 退化
    const renderKey = `${availableWidth}x${zoom}` // 本轮渲染对应的尺寸键，完成后写回 renderedKey
    let cancelled = false
    type BuilderLike = {
      div: HTMLDivElement
      render: (opts: { viewport: unknown }) => Promise<void>
      cancel: () => void
    }
    let builder: BuilderLike | null = null
    let canvasRenderTask: { cancel: () => void; promise: Promise<unknown> } | null = null
    let clickHandler: ((e: MouseEvent) => void) | null = null
    let overHandler: ((e: MouseEvent) => void) | null = null
    let outHandler: ((e: MouseEvent) => void) | null = null
    const abortCtl = new AbortController()
    void doc.getPage(pageNum).then(async (page: PDFPageProxy) => {
      if (cancelled || !canvasRef.current) return
      const baseViewport = page.getViewport({ scale: 1 })
      const fitWidthScale = availableWidth / baseViewport.width
      const renderScale = fitWidthScale * zoom
      const viewport = page.getViewport({ scale: renderScale })
      const canvas = canvasRef.current
      // Retina/HiDPI 补偿：位图按 dpr 放大、CSS 尺寸保持 viewport，避免浏览器拉伸导致模糊
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const transform: [number, number, number, number, number, number] | undefined =
        dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      // 用同一个 AbortController 统一取消 canvas + textLayer。pdfjs 的 page.render
      // 不接受 AbortSignal,只能通过 RenderTask.cancel() 取消,所以这里把 signal.abort
      // 转发到 task.cancel(),保持调用方只用一个 abortCtl 即可。
      // 不取消会导致 cleanup 时新 effect 已发起第二次 render 与未完成的旧 render 共用
      // 同一 canvas → pdfjs 抛 "Cannot use the same canvas during multiple render() operations"
      canvasRenderTask = page.render({ canvasContext: ctx, viewport, canvas, transform }) as unknown as {
        cancel: () => void; promise: Promise<unknown>
      }
      const onAbort = (): void => { canvasRenderTask?.cancel() }
      abortCtl.signal.addEventListener('abort', onAbort, { once: true })
      try {
        await canvasRenderTask.promise
      } catch {
        // cancel 抛 RenderingCancelledException 正常路径,直接退出
        return
      } finally {
        abortCtl.signal.removeEventListener('abort', onAbort)
      }
      if (cancelled) return

      const mount = textLayerMountRef.current
      if (!mount) return
      mount.replaceChildren()

      // TextLayerBuilder 内部封装:自带 .textLayer div、endOfContent 占位、mousedown→selecting
      // 类切换、全局 selectionchange 协调(insertBefore endOfContent 到 anchor 旁,
      // 撑满 textLayer 尺寸 + user-select:text),正确实现"鼠标按下点作为选区锚点"。
      // 我们额外注入一个 highlighter stub 来截获 textDivs / textContentItemsStr,
      // 用于 quote / search 高亮(TextLayerBuilder 不直接暴露这两个引用)。
      const highlighterStub = {
        setTextMapping(divs: HTMLElement[], items: string[]): void {
          // 保留已写入的 layerDiv（在 mount.append 后设置）：setTextMapping 在 b.render
          // 内部被调用，整对象重赋时不能丢掉 textLayer 容器引用。
          textMappingRef.current = { textDivs: divs, itemsStr: items, layerDiv: textMappingRef.current.layerDiv }
        },
        enable(): void { /* noop */ },
        disable(): void { /* noop */ },
      }

      const b = new (TextLayerBuilder as unknown as new (opts: {
        pdfPage: PDFPageProxy
        highlighter?: unknown
        abortSignal?: AbortSignal
      }) => BuilderLike & { div: HTMLDivElement })({
        pdfPage: page,
        highlighter: highlighterStub,
        abortSignal: abortCtl.signal,
      })
      builder = b
      // 必须先挂入 DOM —— TextLayerBuilder.render 内部依赖容器接入 document 才能正确量尺寸,
      // 同时全局 selectionchange 监听过滤靠 textLayer 在 DOM 中检测
      b.div.style.setProperty('--scale-factor', `${viewport.scale}`)
      b.div.style.setProperty('--total-scale-factor', `${viewport.scale}`)
      mount.append(b.div)
      // 记录 textLayer 容器：高亮 effect 的 clearInjectedHighlights 用它限定 unwrap 作用域
      textMappingRef.current.layerDiv = b.div
      try {
        await b.render({ viewport })
      } catch {
        // cancel 抛 AbortException 是正常路径，忽略
      }
      if (cancelled) return

      // 点击委托:沿用旧逻辑,找最近的 [data-note-id] 祖先 → 回调 noteId
      const handler = (e: MouseEvent): void => {
        const t = (e.target as HTMLElement | null)?.closest('[data-note-id]') as HTMLElement | null
        if (t?.dataset.noteId) onNoteHighlightClick(t.dataset.noteId)
      }
      clickHandler = handler
      b.div.addEventListener('click', handler)

      // hover 委托：mouseover/mouseout 冒泡到 textLayer，命中 [data-note-id] 上报给父组件
      // 拿来定位浮动 tooltip。多 span 组成一条高亮时,从一个 span 滑到同一 noteId 的
      // 邻接 span 上 mouseout 仍会触发,这里在 out 时再检查 relatedTarget,避免抖动
      const over = (e: MouseEvent): void => {
        const t = (e.target as HTMLElement | null)?.closest('[data-note-id]') as HTMLElement | null
        if (t?.dataset.noteId) onNoteHighlightHover(t.dataset.noteId, t.getBoundingClientRect())
      }
      const out = (e: MouseEvent): void => {
        const from = (e.target as HTMLElement | null)?.closest('[data-note-id]') as HTMLElement | null
        const to = (e.relatedTarget as HTMLElement | null)?.closest('[data-note-id]') as HTMLElement | null
        if (!from) return
        if (to && to.dataset.noteId === from.dataset.noteId) return // 同一笔记内部移动,保留 tooltip
        onNoteHighlightHover(null, null)
      }
      overHandler = over
      outHandler = out
      b.div.addEventListener('mouseover', over)
      b.div.addEventListener('mouseout', out)

      // 通知高亮 effect:textDivs 已就绪,可以重涂 quote / search 高亮
      setRenderTick((v) => v + 1)
      // 本轮位图已对应 renderKey（当前 availableWidth+zoom）→ 标记画布不再过期，显示出来。
      if (!cancelled) setRenderedKey(renderKey)
      // 上报"本页已渲染完成"——canvas 高度已落定、textLayer span 已挂（下一帧高亮 effect
      // 会补 data-note-id）。父组件据此判断滚动目标周围布局是否稳定。cancelled 已在上面
      // 各 await 点早退，到这里必未取消，仍防御性再查一次。
      if (!cancelled) onRendered?.(pageNum)
    }).catch((err) => {
      if (!cancelled) onError(err instanceof Error ? err : new Error(String(err)))
    })
    return () => {
      cancelled = true
      abortCtl.abort() // 触发 canvasRenderTask.cancel() (经 signal.addEventListener) + TextLayerBuilder 内部清理
      if (builder) {
        if (clickHandler) {
          try { builder.div.removeEventListener('click', clickHandler) } catch { /* noop */ }
        }
        if (overHandler) {
          try { builder.div.removeEventListener('mouseover', overHandler) } catch { /* noop */ }
        }
        if (outHandler) {
          try { builder.div.removeEventListener('mouseout', outHandler) } catch { /* noop */ }
        }
        try { builder.cancel() } catch { /* noop */ }
        try { builder.div.remove() } catch { /* noop */ }
      }
      textMappingRef.current = { textDivs: [], itemsStr: [], layerDiv: null }
    }
  }, [doc, pageNum, availableWidth, zoom, onError, onNoteHighlightClick, onNoteHighlightHover, onRendered])

  // 轻 effect:textLayer 重建完成或高亮列表变化后,把 quote / search 高亮重新涂到现有 spans
  // 不重建 textLayer,只在匹配到的**子串**字符上包内层高亮 span（精确到字形,不染整行）。
  // 流程：清理旧的内层 span → 收集每个 span 的局部子区间到共享 map → 逐 span 包裹。
  React.useEffect(() => {
    const { textDivs, itemsStr, layerDiv } = textMappingRef.current
    if (!layerDiv || textDivs.length === 0) return
    // 先把上一轮注入的内层高亮 span 还原为纯文本,避免 stale 残留 + 偏移错乱
    clearInjectedHighlights(layerDiv)
    // 共享 map：quote 与 search 子区间都按 span 下标汇入,同一 span 上的重叠在包裹阶段合并
    const subRangeMap = new Map<number, SpanSubRange[]>()
    if (quoteHighlights && quoteHighlights.length > 0) {
      applyQuoteHighlights(itemsStr, quoteHighlights, subRangeMap)
    }
    if (searchMatches.length > 0) {
      applySearchHighlights(itemsStr, searchMatches, currentSearchIdxInPage, subRangeMap)
    }
    for (const [i, subs] of subRangeMap) {
      const span = textDivs[i]
      if (span) wrapSpanSubRanges(span, subs)
    }
  }, [renderTick, quoteHighlights, searchMatches, currentSearchIdxInPage])

  // 占位高度：已知 base 尺寸 → 按 fitWidth+zoom 反推渲染后高度；否则默认 800px。
  // 让未渲染 / 过期重渲染中的 slot 也占着对应高度，scroll 跳变更平滑。
  // 宽度无需占位：过期时盒子走 w-full（见下方 className），不依赖具体像素宽。
  const placeholderHeight = React.useMemo<number>(() => {
    if (availableWidth <= 0 || !baseSize) return 800
    const fitWidthScale = availableWidth / baseSize.width
    return Math.floor(baseSize.height * fitWidthScale * zoom)
  }, [baseSize, availableWidth, zoom])

  return (
    <div
      data-page-num={pageNum}
      className={cn('relative shadow-md bg-white', isStale && 'w-full')}
      // 画布过期（尺寸刚变 / 抽屉动画中、新渲染未完成）时盒子改 w-full 占满容器宽度，仅作
      // loading 占位（按新尺寸高度）：避免盒子塌成旧画布的窄宽度而闪出窄 PDF/白框
      //（图：re-fit 前先闪一下窄 PDF）。canvas 此时 hidden 退出显示。不过期时不设 width，
      // 由 canvas 自身尺寸驱动（保持原行为，页面按 fit 宽度居中）。
      style={{ minHeight: placeholderHeight }}
    >
      {/* 过期时 hidden 不显示（盒子 w-full 占位，旧窄画布不外显）；渲染落定后直接显示。 */}
      <canvas ref={canvasRef} className={cn('block', isStale && 'hidden')} />
      {/* TextLayerBuilder 自带 .textLayer div,我们提供一个 absolute inset-0 的挂载位置 */}
      <div ref={textLayerMountRef} className={cn('absolute inset-0', isStale && 'invisible')} aria-hidden={false} />
      {isStale && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {t('pdf.loading')}
        </div>
      )}
    </div>
  )
}

/**
 * 把 note.quote 字串匹配的**子串**字符收集到共享 subRangeMap（不直接改 DOM，由
 * wrapSpanSubRanges 统一包裹）。
 *
 * 算法：joinPdfItems 拼 pageText（单空格分隔）→ findQuoteFragmentsInPage 三档降级匹配 →
 * 每个命中 fragment 的 [idx, idx+len) 区间经 collectSpanSubRanges 落到各 span 的局部子区间。
 *
 * 同页多次出现：findQuoteFragmentsInPage 只返回首次（与 abstract 的 buildHighlightSpans 一致）。
 * 多 fragment（… 桥接 quote）：各段共享同一 data-note-id，Step B 滚动命中文档序第一个。
 * 未命中：静默跳过（目标页之外的页 miss 是预期；全 PDF miss 由 Step A 的诊断兜底）。
 */
function applyQuoteHighlights(
  itemsStr: string[],
  highlights: ReadonlyArray<{ id: string; quote: string }>,
  out: Map<number, SpanSubRange[]>,
): void {
  if (itemsStr.length === 0) return
  const pageText = joinPdfItems(itemsStr)
  const sepLen = PDF_ITEMS_JOIN_SEP.length
  for (const { id, quote } of highlights) {
    if (!quote) continue
    const matches = findQuoteFragmentsInPage(pageText, quote)
    for (const match of matches) {
      collectSpanSubRanges(itemsStr, match.idx, match.idx + match.len, sepLen, { cls: ['note-quote-highlight'], noteId: id }, out)
    }
  }
}

/**
 * 把搜索命中的**子串**字符收集到共享 subRangeMap：
 *   - 每条 match 的覆盖子区间标 .pdf-search-match
 *   - 当前激活那条（currentIdxInPage）额外标 .pdf-search-current（滚动 effect 选第一个滚入视口）
 *
 * search 的 pageText 用 items.join('') 无分隔拼接（见 SearchMatch 注释），故 sepLen=0，与
 * applyQuoteHighlights 的 sepLen=1 各自自洽——不要统一（会移动 search 坐标）。
 */
function applySearchHighlights(
  itemsStr: string[],
  matches: ReadonlyArray<SearchMatch>,
  currentIdxInPage: number,
  out: Map<number, SpanSubRange[]>,
): void {
  if (itemsStr.length === 0 || matches.length === 0) return
  matches.forEach((m, mi) => {
    const cls = mi === currentIdxInPage ? ['pdf-search-match', 'pdf-search-current'] : ['pdf-search-match']
    collectSpanSubRanges(itemsStr, m.charStart, m.charEnd, 0, { cls }, out)
  })
}

/**
 * 左侧大纲（书签）侧栏。仅在 Open PDF 浮层展开时挂载。
 *
 * - outline=null：拉取中，渲染骨架
 * - outline=[]：PDF 无大纲，显示 empty
 * - 否则：递归渲染嵌套列表，点击 → onJump(pageIndex+1)
 *
 * currentPage 用来高亮"当前页对应的最深一项"——简单实现：找 pageIndex<=currentPage
 * 的最后一项作为 active。深度优先按渲染顺序遍历即可。
 */
function PdfOutlineSidebar({
  outline,
  currentPage,
  onJump,
  emptyLabel,
  headingLabel,
}: {
  outline: OutlineNode[] | null
  currentPage: number
  onJump: (page: number) => void
  emptyLabel: string
  headingLabel: string
}): React.ReactElement {
  // 找当前页对应的活跃项（pageIndex+1 <= currentPage 的最大者）
  const activeKey = React.useMemo<string | null>(() => {
    if (!outline || outline.length === 0) return null
    let bestKey: string | null = null
    let bestPage = -1
    const walk = (nodes: OutlineNode[], prefix: string): void => {
      nodes.forEach((n, i) => {
        const key = `${prefix}.${i}`
        if (n.pageIndex !== null) {
          const page1 = n.pageIndex + 1
          if (page1 <= currentPage && page1 > bestPage) {
            bestPage = page1
            bestKey = key
          }
        }
        if (n.children.length > 0) walk(n.children, key)
      })
    }
    walk(outline, 'r')
    return bestKey
  }, [outline, currentPage])

  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-border bg-background">
      <div className="px-4 py-3 text-sm font-semibold text-foreground border-b border-border">
        {headingLabel}
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-2 py-2 text-sm scrollbar-thin">
        {outline === null ? (
          <div className="px-2 py-2 text-sm text-muted-foreground">…</div>
        ) : outline.length === 0 ? (
          <div className="px-2 py-2 text-sm text-muted-foreground">{emptyLabel}</div>
        ) : (
          <ul className="flex flex-col gap-px">
            <OutlineTree nodes={outline} depth={0} onJump={onJump} activeKey={activeKey} prefix="r" />
          </ul>
        )}
      </div>
    </aside>
  )
}

function OutlineTree({
  nodes,
  depth,
  onJump,
  activeKey,
  prefix,
}: {
  nodes: OutlineNode[]
  depth: number
  onJump: (page: number) => void
  activeKey: string | null
  prefix: string
}): React.ReactElement {
  return (
    <>
      {nodes.map((node, i) => {
        const key = `${prefix}.${i}`
        const active = key === activeKey
        return (
          <li key={key} className="flex flex-col">
            <Button
              type="button"
              variant="ghost"
              size="row"
              disabled={node.pageIndex === null}
              onClick={() => node.pageIndex !== null && onJump(node.pageIndex + 1)}
              className={cn(
                'block leading-snug truncate rounded-sm disabled:opacity-40 disabled:cursor-default',
                active
                  ? 'bg-accent text-foreground font-medium hover:bg-accent'
                  : 'text-foreground/80 hover:bg-accent hover:text-foreground',
              )}
              style={{ paddingLeft: 12 + depth * 12 }}
              title={node.title}
            >
              {node.title || '—'}
            </Button>
            {node.children.length > 0 && (
              <ul className="flex flex-col">
                <OutlineTree
                  nodes={node.children}
                  depth={depth + 1}
                  onJump={onJump}
                  activeKey={activeKey}
                  prefix={key}
                />
              </ul>
            )}
          </li>
        )
      })}
    </>
  )
}

/**
 * 递归解析 pdfjs getOutline 输出：
 *   - dest 为字符串 → doc.getDestination(name) 取数组 → 第一个元素是 page ref
 *   - dest 为数组 → 直接取第一项作为 page ref
 *   - page ref → doc.getPageIndex(ref) 得 0-based 页号；失败回退 null
 * 同步收集子项（item.items 递归）。
 */
async function resolveOutline(doc: PDFDocumentProxy, raw: unknown[]): Promise<OutlineNode[]> {
  const out: OutlineNode[] = []
  for (const item of raw) {
    const it = item as {
      title?: string
      dest?: string | unknown[] | null
      items?: unknown[]
    }
    let pageIndex: number | null = null
    try {
      let destArr: unknown[] | null = null
      if (typeof it.dest === 'string') {
        destArr = await (doc as unknown as { getDestination: (n: string) => Promise<unknown[] | null> }).getDestination(it.dest)
      } else if (Array.isArray(it.dest)) {
        destArr = it.dest
      }
      if (destArr && destArr.length > 0) {
        const ref = destArr[0]
        const idx = await (doc as unknown as { getPageIndex: (ref: unknown) => Promise<number> }).getPageIndex(ref)
        if (Number.isFinite(idx)) pageIndex = idx
      }
    } catch {
      // 解析失败 → 保持 pageIndex=null
    }
    const children = Array.isArray(it.items) && it.items.length > 0 ? await resolveOutline(doc, it.items) : []
    out.push({ title: (it.title ?? '').trim(), pageIndex, children })
  }
  return out
}
