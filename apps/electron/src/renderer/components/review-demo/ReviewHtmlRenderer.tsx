/**
 * Review HTML Fragment 渲染器（v0.19.0+ literature-review-result skill 产物专用）
 *
 * 与 markdown 综述 (`[N]<quote>X</quote>` 经 react-markdown 走 CitationBadge) 视觉/交互**对齐**：
 *   - <cite data-ref="N"><q>X</q></cite> 渲染成同一套黄色 [N] 角标
 *   - hover Tooltip：§7 References 元数据（title / authors · year · venue）+ <q> 原文
 *   - click：滚到 `<li id="ref-N">` + 持续高亮 + 浮动「返回阅读处」按钮
 *
 * 实现：复用 CitationBadge 这一份"组件 + 全局副作用"，HTML 路径不重写一遍样式 / Tooltip /
 * 跳转逻辑。挂载方式是 React Portal：
 *
 *   1. **Sanitize**：DOMPurify 严格白名单（cite / q / section / data-* / 等）。
 *   2. **imperatively setInnerHTML**：用 ref + useLayoutEffect，避免 React diff 与
 *      下方的 DOM 改写打架。
 *   3. **解析 §7 References**：parseReferencesFromHtml 抽 <ol class="refs">；适配成
 *      CitationReferencesContext 期望的 markdown ReferenceMeta shape（n / title /
 *      authors / venue / year），喂给 Tooltip。
 *   4. **打跳转锚点**：给 §7 每个 `<li id="ref-N" data-ref="N">` 补 `data-asci-ref-n="N"`
 *      属性 —— CitationBadge.jumpToReferenceN 复用此选择器。
 *   5. **替换 <cite> 为 mount slot**：`<cite data-ref="N"><q>X</q></cite>` →
 *      `<span data-asci-cite-mount>`，记 (slot, n, quote) 一组放进 React state。
 *   6. **createPortal**：把 <CitationBadge n quote> 渲染到每个 slot；外层容器加
 *      `data-asci-citations-root` 让 jump 逻辑在本预览作用域内查找。
 *   7. **KaTeX auto-render**：在 cite 替换之后跑（slots 内是 React 控制的，KaTeX 不会
 *      触碰；body 里的 `\(...\)` / `\[...\]` 会被替换为 KaTeX HTML）。
 *
 * 与老的 markdown 注引层（citation-references.ts / citation-transform.ts）**并存**：
 * 老 .md review 走 MarkdownRenderer + 字符串改写；新 .html review 走本组件 + Portal。
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify'

import { toast } from 'sonner'

import {
  CitationBadge,
  CitationReferencesContext,
} from '@/components/common/CitationBadge.tsx'
import { DoiChip } from '@/components/ai-elements/doi-chip'
import { findDois, doiFromUrl, DOI_PROBE_RE } from '@/lib/doi.ts'
import { useT } from '@/hooks/useT.ts'
import { useOpenEvidenceInLibrary } from '@/hooks/useOpenEvidenceInLibrary.ts'
import type { ReferenceMeta as MarkdownReferenceMeta } from '@/lib/citation-references.ts'
import {
  parseReferencesFromHtml,
  type ReferenceMeta as HtmlReferenceMeta,
} from '@/lib/review-html-citations.ts'

import { AddReviewNoteDialog } from './AddReviewNoteDialog.tsx'
import { EvidenceTraceCard } from './EvidenceTraceCard.tsx'

import type { Anchor, ObjectId } from '@asci/shared'

// DOMPurify 白名单：skill HTML fragment contract（SKILL.md "Output Format"）+
// KaTeX auto-render 注入的常见属性。
const SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    'article',
    'header',
    'section',
    'h1',
    'h2',
    'h3',
    'h4',
    'p',
    'ul',
    'ol',
    'li',
    'cite',
    'q',
    'em',
    'i',
    'b',
    'strong',
    'code',
    'pre',
    'blockquote',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'figure',
    'figcaption',
    'br',
    'hr',
    'a',
    'span',
  ],
  ALLOWED_ATTR: [
    'class',
    'id',
    'data-ref',
    'data-paper-id',
    'data-doi',
    'data-zotero-key',
    'data-version',
    'href',
    'title',
    'lang',
    'dir',
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|#|\/)/i,
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload', 'onmouseover'],
  RETURN_DOM: false,
  RETURN_DOM_FRAGMENT: false,
  KEEP_CONTENT: true,
}

/** 导出 sanitize 函数供单测使用（不必拉起整个 React 组件） */
export function sanitizeReviewHtml(raw: string): string {
  return DOMPurify.sanitize(raw, SANITIZE_CONFIG) as unknown as string
}

/**
 * 找到 el 最近的可滚动祖先（overflow 在 y 方向是 auto/scroll，且实际有溢出）。
 * scrollIntoView 在 nested flex + overflow-auto 容器中偶尔不动；直接操作 scrollTop
 * 更可靠。
 */
function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur)
    const overflowY = style.overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight) {
      return cur
    }
    cur = cur.parentElement
  }
  return null
}

const EMPTY_REFS: ReadonlyMap<number, MarkdownReferenceMeta> = new Map()
const EMPTY_HTML_REFS: ReadonlyMap<number, HtmlReferenceMeta> = new Map()

/**
 * §8 Per-Paper Decisions 默认折叠（issue #538，B 计划）。
 *
 * 该板块是 body-writer 按 SKILL.md 模板手写进 fragment 的普通 `<section id="s8" class="decisions">`
 * （`<h2>` + 一份每篇 paper 取舍决策的 `<ul>`），对多数读者价值低、占底部视觉空间。这里在
 * innerHTML 注入后就地改写成"默认折叠 + 点标题展开/收起"——新旧综述统一生效，不动产出 prompt。
 *
 * 命令式 DOM（与本文件 cite/DOI 改写一致）：把 `<h2>` 之后的兄弟节点搬进可折叠 body 容器，
 * 标题内嵌一个 `<button>` 承载交互（`<h2>` 保留 heading 语义，屏幕阅读器仍能按标题导航到 §8），
 * 默认折叠。每次 `[html]` 变更会重建 innerHTML，监听器随旧 DOM 一并销毁，无需显式清理。
 */
function setupDecisionsCollapsible(
  root: HTMLElement,
  labels: { expand: string; collapse: string },
): void {
  const section = root.querySelector<HTMLElement>('section#s8, section.decisions')
  if (!section) return
  const heading = section.querySelector<HTMLElement>(':scope > h2')
  if (!heading) return

  // 把 §8 标题之后的所有兄弟节点搬进折叠 body 容器
  const body = document.createElement('div')
  body.setAttribute('data-asci-decisions-body', '')
  let sib = heading.nextSibling
  while (sib) {
    const next = sib.nextSibling
    body.appendChild(sib)
    sib = next
  }
  if (!body.firstChild) return // §8 只有标题没内容 → 不折叠
  heading.after(body)

  section.setAttribute('data-asci-decisions-collapsible', '')

  // chevron 跟随文字色（currentColor），不引入硬编码调色板；折叠态指向右、展开旋转 90°
  const chevron = document.createElement('span')
  chevron.setAttribute('aria-hidden', 'true')
  chevron.textContent = '▸'
  chevron.style.marginInlineEnd = '0.4em'
  chevron.style.fontSize = '0.8em'
  chevron.style.transition = 'transform 0.15s ease'

  // 交互控件用嵌套 <button>：h2 保留 heading 语义。button 由本组件 createElement，
  // 不经过 sanitize（DOMPurify 只剥 LLM fragment 里的 button），故安全。重置原生外观，
  // 把 chevron + 原标题文本收进来，整行可点。
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('data-asci-decisions-toggle', '')
  while (heading.firstChild) button.appendChild(heading.firstChild)
  button.insertBefore(chevron, button.firstChild)
  heading.appendChild(button)
  Object.assign(button.style, {
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: '0',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
  } satisfies Partial<CSSStyleDeclaration>)

  const apply = (expanded: boolean): void => {
    body.hidden = !expanded
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    button.setAttribute('aria-label', expanded ? labels.collapse : labels.expand)
    chevron.style.transform = expanded ? 'rotate(90deg)' : 'rotate(0deg)'
  }
  apply(false) // 默认折叠

  const toggle = (): void => apply(body.hidden)
  button.addEventListener('click', toggle)
}

/**
 * Evidence trace 卡片的"源可打开性"探测态（issue #462 方式 A：点击前就地提示）。
 *   - 'checking'：探测中（卡片刚打开）
 *   - 'openable'：Zotero 有可打开的 PDF → 正常显示跳转按钮
 *   - 'removed'：无可打开 PDF（条目已删 / 论文未入库 / 无 PDF 附件）→ 显示"源已移除"禁用态
 *   - 'unknown'：无法判定（Zotero 没在跑等）→ 不误报，保持按钮可点（点了再走原 toast/降级）
 */
type SourceOpenState = 'checking' | 'openable' | 'removed' | 'unknown'

/**
 * 探测某条引用在 Zotero 中是否有可打开的 PDF。仅对"当前打开的那张卡片"调用，非批量。
 *
 * 冷热级联：
 *   1. resolveZoteroKey（纯本地 SQLite/jsonl/snapshot，不打网络）解析不到 key → 'removed'
 *   2. 有 key → getItem 核实条目：404='removed'，Zotero 故障='unknown'
 *   3. 条目在 → getAttachmentPath 核实 PDF 附件：有='openable'，无='removed'，异常='unknown'
 */
async function probeSourceOpenable(identifier: {
  zoteroKey?: string | null
  doi?: string | null
  paperId?: string | null
}): Promise<Exclude<SourceOpenState, 'checking'>> {
  try {
    const r = await window.electronAPI.papers.resolveZoteroKey({
      zoteroKey: identifier.zoteroKey ?? null,
      doi: identifier.doi ?? null,
      paperId: identifier.paperId ?? null,
    })
    if (r.status !== 'resolved') return 'removed'
    const item = await window.electronAPI.zotero.library.getItem({ itemKey: r.zoteroKey })
    if (item.status === 'deleted') return 'removed'
    if (item.status === 'error') return 'unknown'
    const att = await window.electronAPI.zotero.library.getAttachmentPath({ itemKey: r.zoteroKey })
    return att.found ? 'openable' : 'removed'
  } catch {
    // 任何异常（IPC 不可用 / Zotero 抖动）→ 不误报"源已移除"，保持可点
    return 'unknown'
  }
}

/** Portal mount slot：一个 <cite data-ref="N"><q>X</q></cite> 被替换成的占位 span */
interface CiteSlot {
  /** DOM 中的占位元素（CitationBadge 通过 createPortal 渲染进来） */
  el: HTMLElement
  n: number
  quote: string
  /** 本 cite 所在 <p> 的稳定标识；用于把 trace 卡片定位到正确的 <p> 后 */
  paragraphKey: string
}

/** Evidence trace 挂载 slot：每个含 cite 的 <p> 末尾追加一个占位 div */
interface TraceSlot {
  /** DOM 中的占位元素（活跃 cite 命中此 paragraphKey 时通过 portal 渲染卡片） */
  el: HTMLElement
  paragraphKey: string
}

/** DOI chip 挂载 slot：doi.org <a> 或裸文本 DOI 被替换成的占位 span（spec: doi-paper-jump §5.5） */
interface DoiSlot {
  el: HTMLElement
  doi: string
  /** doi.org 链接的可读文本（可能是论文标题）；裸文本 DOI 无 label */
  label?: string
}

/** 当前激活的 trace 状态（同时最多一个卡片可见） */
interface ActiveCite {
  paragraphKey: string
  n: number
  quote: string
  /** 段内 cite 序号（0-based），用于卡片头的位置标识 */
  citeIndex: number
  /** paragraphKey 中冒号前后部分（"sectionId:paragraphIndex"） —— 给 Anchor 用 */
  sectionId: string | null
  paragraphIndex: number | null
}

export interface ReviewHtmlRendererProps {
  /** 原始 HTML fragment（来自 reviews.body_path 文件内容） */
  html: string
  /** 容器额外 className */
  className?: string
  /**
   * 当前综述的 DB id —— 由 ReviewHtmlPreviewRenderer 经 IPC reviews.resolveByBodyPath 反查注入。
   *
   * 提供时：EvidenceTraceCard 上的 "+ Add note here" 按钮启用，点击调
   * `notes.createFromReviewHighlight` IPC 持久化 note + evidence_set + ref。
   *
   * 不提供时：按钮 disabled（如打开了未入库的孤立 HTML 文件）。
   */
  reviewId?: ObjectId
  /**
   * 外部指定的初始激活 anchor —— 主要给"证据集详情 → 点击 member review 卡片"
   * 这条入口用：用 anchor.locationData 找到对应 cite slot，自动滚到位 + 激活
   * EvidenceTraceCard。slots 重建后只触发一次；用户手动点其它 cite / 关掉卡片
   * 后不会被这条 effect 再次覆写。
   *
   * 当 locationData 缺失或 (sectionId, paragraphIndex) 找不到对应 paragraph 时
   * 静默 no-op（保留打开但不滚动的兜底行为）。
   */
  initialActiveAnchor?: Anchor
  /**
   * 选择序号 —— 每次"点击证据条目"自增。即使 initialActiveAnchor 对象引用没变
   * （证据集详情里反复点同一条目时 anchor 是同一引用、组件也不重挂载），nonce 变化
   * 也会强制重新激活 + 重新滚动。不传则只在 (anchor, slots) 变化时触发。
   */
  activeAnchorNonce?: number
}

export function ReviewHtmlRenderer({
  html,
  className,
  reviewId,
  initialActiveAnchor,
  activeAnchorNonce,
}: ReviewHtmlRendererProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [slots, setSlots] = React.useState<CiteSlot[]>([])
  const [traceSlots, setTraceSlots] = React.useState<TraceSlot[]>([])
  const [doiSlots, setDoiSlots] = React.useState<DoiSlot[]>([])
  const [refsMap, setRefsMap] =
    React.useState<ReadonlyMap<number, MarkdownReferenceMeta>>(EMPTY_REFS)
  /** 完整 §7 元数据（含 doi/zoteroKey/paperId），构建 trace 卡片用 */
  const [htmlRefsMap, setHtmlRefsMap] = React.useState<ReadonlyMap<number, HtmlReferenceMeta>>(
    EMPTY_HTML_REFS,
  )
  const [activeCite, setActiveCite] = React.useState<ActiveCite | null>(null)
  // issue #462 方式 A：当前打开的 trace 卡片对应源的可打开性（点击前探测）
  const [sourceOpenState, setSourceOpenState] = React.useState<SourceOpenState>('checking')
  const { t } = useT('library')
  const openInLibrary = useOpenEvidenceInLibrary()

  // §8 折叠控件的 aria-label（issue #538）。放进 ref：layoutEffect 读 ref.current 即可，
  // 不必把整段 innerHTML 重建挂到语言变化上；语言切换时由下方轻量 effect 单独刷新 aria-label。
  const decisionLabels = React.useMemo(
    () => ({ expand: t('reviewDemo.decisions.expand'), collapse: t('reviewDemo.decisions.collapse') }),
    [t],
  )
  const decisionLabelsRef = React.useRef(decisionLabels)
  decisionLabelsRef.current = decisionLabels

  // 卡片打开（activeCite 变化）→ 探测该引用源是否有可打开的 PDF（issue #462 方式 A）。
  // 仅探测当前这一张卡片，非批量；cancelled 防止快速切换时旧结果覆盖。
  React.useEffect(() => {
    if (!activeCite) {
      setSourceOpenState('checking')
      return
    }
    const meta = htmlRefsMap.get(activeCite.n)
    const identifier = meta
      ? { zoteroKey: meta.zoteroKey, doi: meta.doi, paperId: meta.paperId }
      : {}
    let cancelled = false
    setSourceOpenState('checking')
    void probeSourceOpenable(identifier).then((state) => {
      if (!cancelled) setSourceOpenState(state)
    })
    return () => {
      cancelled = true
    }
  }, [activeCite, htmlRefsMap])

  // 1) sanitize + 同步 DOM 改写（建 slot / 标 jump 锚点 / 抽 References）
  React.useLayoutEffect(() => {
    const root = containerRef.current
    if (!root) return

    root.innerHTML = sanitizeReviewHtml(html)
    root.setAttribute('data-asci-citations-root', '1')

    // 抽 §7 References 并适配到 markdown ReferenceMeta shape（CitationBadge 用）
    const htmlRefs = parseReferencesFromHtml(root)
    const adapted = new Map<number, MarkdownReferenceMeta>()
    for (const [n, meta] of htmlRefs) {
      adapted.set(n, {
        n,
        raw: meta.raw,
        title: meta.title || undefined,
        authors: meta.authors || undefined,
        venue: meta.venue || undefined,
        year: meta.year || undefined,
      })
      // 给 §7 <li> 补 data-asci-ref-n，让 CitationBadge.jumpToReferenceN 找得到目标
      const li = root.querySelector(
        `li[id="ref-${n}"], li[data-ref="${n}"]`,
      ) as HTMLElement | null
      if (li) li.setAttribute('data-asci-ref-n', String(n))
    }
    setRefsMap(adapted)
    setHtmlRefsMap(htmlRefs)

    // 给每个含 <cite> 的 <p> 生成稳定 paragraphKey，并把 cite 替换成 mount slot
    // paragraphKey 规则：sectionId + '|' + p 在 section 内的 index；
    //   - 没 sectionId 的 <p>（罕见）用 '__nosec__|globalIdx'
    //   - 同段多个 cite 共享同一 paragraphKey；citeIndex 在卡片层做位置区分
    const collected: CiteSlot[] = []
    const traces: TraceSlot[] = []
    let globalParaIdx = 0
    const sections = Array.from(root.querySelectorAll<HTMLElement>('section'))
    // 顶层"游离 <p>"也要覆盖（极少见，HTML fragment 兼容）
    const sectionPLists: Array<{ sectionId: string; pList: HTMLElement[] }> = sections.map(
      (sec) => ({
        sectionId: sec.getAttribute('id') ?? '',
        pList: Array.from(sec.querySelectorAll<HTMLElement>(':scope > p, :scope > div > p')),
      }),
    )
    // 兜底：把不在任何 section 内的 <p> 收一遍
    const looseP = Array.from(root.querySelectorAll<HTMLElement>('p')).filter(
      (p) => !p.closest('section'),
    )
    if (looseP.length > 0) sectionPLists.push({ sectionId: '', pList: looseP })

    for (const { sectionId, pList } of sectionPLists) {
      pList.forEach((p, pIdxInSection) => {
        const cites = Array.from(p.querySelectorAll<HTMLElement>('cite[data-ref]'))
        if (cites.length === 0) {
          globalParaIdx++
          return
        }
        const paragraphKey = sectionId
          ? `${sectionId}|${pIdxInSection}`
          : `__nosec__|${globalParaIdx}`
        cites.forEach((cite) => {
          const n = Number.parseInt(cite.getAttribute('data-ref') ?? '', 10)
          if (!Number.isInteger(n)) return
          const q = cite.querySelector('q')
          const quote = (q?.textContent ?? '').trim()
          const slot = document.createElement('span')
          slot.setAttribute('data-asci-cite-mount', '')
          cite.replaceWith(slot)
          collected.push({ el: slot, n, quote, paragraphKey })
        })
        // <p> 后追加 trace slot（占位 div，portal 在需要时挂入卡片）
        const traceSlot = document.createElement('div')
        traceSlot.setAttribute('data-asci-evidence-trace-slot', '')
        traceSlot.setAttribute('data-asci-p-key', paragraphKey)
        p.after(traceSlot)
        traces.push({ el: traceSlot, paragraphKey })
        globalParaIdx++
      })
    }
    setSlots(collected)
    setTraceSlots(traces)

    // DOI 装饰（spec: doi-paper-jump §5.5）—— 在 cite 替换之后、KaTeX 之前：
    //   a) doi.org <a> → chip slot（否则 will-navigate 兜底会把点击甩到外部浏览器）
    //   b) 裸文本 DOI（检索报告 §3 表格 DOI 列等）→ 切分文本节点插 chip slot
    const doiCollected: DoiSlot[] = []
    for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const href = a.getAttribute('href') ?? ''
      const doi = doiFromUrl(href)
      if (!doi) continue
      const text = (a.textContent ?? '').trim()
      const slot = document.createElement('span')
      slot.setAttribute('data-asci-doi-mount', '')
      a.replaceWith(slot)
      // 链接文本若是论文标题等可读内容则保留展示；裸 URL 文本退化为显示 DOI 本体
      doiCollected.push({ el: slot, doi, label: text && text !== href ? text : undefined })
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parentEl = node.parentElement
        if (!parentEl) return NodeFilter.FILTER_REJECT
        // 链接内文本（非 doi.org 链接保持原样）与代码块不装饰
        if (parentEl.closest('a, pre')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const textNodes: Text[] = []
    let tNode: Node | null
    while ((tNode = walker.nextNode())) textNodes.push(tNode as Text)
    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? ''
      if (!DOI_PROBE_RE.test(value)) continue
      const hits = findDois(value)
      if (hits.length === 0) continue
      const frag = document.createDocumentFragment()
      let lastIdx = 0
      for (const h of hits) {
        if (h.index > lastIdx) {
          frag.appendChild(document.createTextNode(value.slice(lastIdx, h.index)))
        }
        const slot = document.createElement('span')
        slot.setAttribute('data-asci-doi-mount', '')
        frag.appendChild(slot)
        doiCollected.push({ el: slot, doi: h.doi })
        lastIdx = h.index + h.length
      }
      if (lastIdx < value.length) {
        frag.appendChild(document.createTextNode(value.slice(lastIdx)))
      }
      textNode.replaceWith(frag)
    }
    setDoiSlots(doiCollected)

    // §8 Per-Paper Decisions 默认折叠（issue #538，B 计划）
    setupDecisionsCollapsible(root, decisionLabelsRef.current)

    setActiveCite(null) // html 变更 → 清掉旧 active
  }, [html])

  // 1.5) 语言切换时刷新 §8 折叠控件的 aria-label（不重建 innerHTML；首次构建已由
  // setupDecisionsCollapsible 设好，故只依赖 decisionLabels，不挂 slots 避免每次重建冗余重刷）
  React.useEffect(() => {
    const toggle = containerRef.current?.querySelector<HTMLElement>(
      '[data-asci-decisions-toggle]',
    )
    if (!toggle) return
    const expanded = toggle.getAttribute('aria-expanded') === 'true'
    toggle.setAttribute('aria-label', expanded ? decisionLabels.collapse : decisionLabels.expand)
  }, [decisionLabels])

  // 2) KaTeX auto-render：放在 cite 替换之后；slot 内是 React 控制的，KaTeX 不会触碰
  React.useEffect(() => {
    const root = containerRef.current
    if (!root) return
    let cancelled = false
    void (async () => {
      try {
        const { default: renderMathInElement } = await import(
          'katex/contrib/auto-render'
        )
        if (cancelled) return
        renderMathInElement(root, {
          delimiters: [
            { left: '\\[', right: '\\]', display: true },
            { left: '$$', right: '$$', display: true },
            { left: '\\(', right: '\\)', display: false },
          ],
          throwOnError: false,
        })
      } catch (err) {
        console.warn('[review-html] KaTeX auto-render 失败:', err)
      }
    })()
    return () => {
      cancelled = true
    }
    // slots / doiSlots 重建意味着 root.innerHTML 已被覆写；变化时也跑一遍 KaTeX
  }, [html, slots, doiSlots])

  // 3) 卡片外区域点击 / Esc 关闭活跃 trace
  React.useEffect(() => {
    if (!activeCite) return
    const root = containerRef.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target) return
      // 卡片本体内点击 / cite 角标点击都不关
      if (target.closest('[data-asci-evidence-trace-card]')) return
      if (target.closest('[data-asci-cite-mount]')) return
      setActiveCite(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveCite(null)
    }
    root.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [activeCite])

  // cite 点击劫持：注入给 CitationBadge.onTraceClick
  const handleTraceClick = React.useCallback(
    (n: number, quote: string, badgeEl: Element) => {
      // 从 badge 反查它所属的 slot（拿 paragraphKey），并算段内 cite 序号
      const slotEl = badgeEl.closest('[data-asci-cite-mount]') as HTMLElement | null
      const slot = slotEl ? slots.find((s) => s.el === slotEl) : null
      if (!slot) return
      // 段内 citeIndex：同 paragraphKey 的 slots 按数组顺序就是 DOM 顺序
      const sameP = slots.filter((s) => s.paragraphKey === slot.paragraphKey)
      const citeIndex = sameP.indexOf(slot)
      // 把 paragraphKey 反解成 anchor 字段：`${sectionId}|${pIdxInSection}`
      // 或 `__nosec__|${globalParaIdx}`（无 section 时 sectionId=null）
      const [rawSection, rawParaIdx] = slot.paragraphKey.split('|', 2)
      const sectionId =
        rawSection && rawSection !== '__nosec__' ? rawSection : null
      const paragraphIndex = rawParaIdx != null ? Number.parseInt(rawParaIdx, 10) : null
      // 再点同一 cite → toggle off
      setActiveCite((prev) =>
        prev && prev.paragraphKey === slot.paragraphKey && prev.n === n && prev.citeIndex === citeIndex
          ? null
          : {
              paragraphKey: slot.paragraphKey,
              n,
              quote,
              citeIndex,
              sectionId,
              paragraphIndex: Number.isInteger(paragraphIndex) ? paragraphIndex : null,
            },
      )
    },
    [slots],
  )

  // 外部 anchor → 自动激活对应 cite：等 slots 重建完，找匹配 paragraphKey/citeIndex
  // 的 slot，setActiveCite。
  //
  // 去重键 = (anchor 引用, slots 引用, nonce) 三元组：
  //   - 三者都没变（用户手动关掉卡片，依赖未变）→ 跳过，不强制重开。
  //   - slots 重建（html 改变 / 组件重挂载）或 nonce 自增（再次点击同一条目）→ 重做。
  // nonce 解决"反复点同一条目时 anchor 同引用 + 组件不重挂载 → 不重新触发"的问题。
  const lastAppliedRef = React.useRef<{
    anchor: Anchor
    slots: CiteSlot[]
    nonce: number | undefined
  } | null>(null)
  React.useEffect(() => {
    if (!initialActiveAnchor || slots.length === 0) return
    const last = lastAppliedRef.current
    if (
      last &&
      last.anchor === initialActiveAnchor &&
      last.slots === slots &&
      last.nonce === activeAnchorNonce
    ) {
      return
    }
    const loc = initialActiveAnchor.locationData
    if (!loc || loc.kind !== 'html') return
    const { sectionId, paragraphIndex, citeIndex } = loc
    if (sectionId == null || paragraphIndex == null) return
    const targetKey = `${sectionId}|${paragraphIndex}`
    const candidates = slots.filter((s) => s.paragraphKey === targetKey)
    if (candidates.length === 0) return
    const idxInPara =
      citeIndex != null && citeIndex >= 0 && citeIndex < candidates.length ? citeIndex : 0
    const slot = candidates[idxInPara]
    if (!slot) return
    lastAppliedRef.current = { anchor: initialActiveAnchor, slots, nonce: activeAnchorNonce }
    setActiveCite({
      paragraphKey: slot.paragraphKey,
      n: slot.n,
      quote: slot.quote,
      citeIndex: idxInPara,
      sectionId,
      paragraphIndex,
    })
  }, [initialActiveAnchor, slots, traceSlots, activeAnchorNonce])

  // activeCite → 滚动到对应段落。
  //
  // 关键：target 在滚动时**现场从 slots 派生**（按 activeCite.paragraphKey/citeIndex
  // 查 DOM 节点），而不是用一次性 ref 暂存。原先用 pendingScrollTargetRef 一次性消费，
  // 在 StrictMode 双调用 / 多次重渲染下会被第一次跑置空，后续运行拿到 null → 偶发不滚。
  // 现在每次 effect 运行都能独立从当前 slots 解析出 target → 幂等可靠。
  // 依赖加 activeAnchorNonce：同一 activeCite 但用户再次点击时也重跑一次滚动。
  React.useEffect(() => {
    if (!activeCite) return
    const cands = slots.filter((s) => s.paragraphKey === activeCite.paragraphKey)
    const slot =
      activeCite.citeIndex >= 0 && activeCite.citeIndex < cands.length
        ? cands[activeCite.citeIndex]
        : cands[0]
    const target = (slot?.el.closest('p') ?? slot?.el) as HTMLElement | undefined
    if (!target) return

    let cancelled = false
    let rafId = 0
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    // 直接操作可滚动祖先的 scrollTop —— 比 scrollIntoView 更可控（nested flex 里
    // scrollIntoView 有时算不准）。让 target 顶部对齐容器顶部 1/3 处。
    const scrollOnce = (container: HTMLElement): void => {
      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const desiredOffsetFromTop = container.clientHeight / 3
      const currentOffsetInContainer =
        targetRect.top - containerRect.top + container.scrollTop
      const newScrollTop = Math.max(0, currentOffsetInContainer - desiredOffsetFromTop)
      container.scrollTo({ top: newScrollTop, behavior: 'smooth' })
    }

    // 逐帧轮询：综述 HTML 刚 mount 时 KaTeX / cite·trace portal / 字体都还没排版完，
    // 容器可能还没溢出（scrollHeight <= clientHeight）→ findScrollableAncestor 返回 null。
    // 每帧重试，直到容器可滚动再算坐标；超帧上限仍找不到才退回 scrollIntoView 兜底。
    const MAX_FRAMES = 60 // ~1s @60fps
    let frames = 0
    const poll = (): void => {
      if (cancelled) return
      const container = findScrollableAncestor(target)
      if (container) {
        scrollOnce(container)
        // 排版回流校正：KaTeX / 字体可能在首次滚动后才改变 target 上方高度 → 漂移。
        timeoutId = setTimeout(() => {
          if (cancelled) return
          const c2 = findScrollableAncestor(target)
          if (c2) scrollOnce(c2)
        }, 450)
        return
      }
      frames++
      if (frames < MAX_FRAMES) {
        rafId = requestAnimationFrame(poll)
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    rafId = requestAnimationFrame(poll)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [activeCite, slots, activeAnchorNonce])

  // Add note here 入口：把当前 activeCite 转成 sourceAnchor，打开 AddReviewNoteDialog
  const [addNoteOpen, setAddNoteOpen] = React.useState(false)
  const handleAddNote = React.useCallback(() => {
    if (!reviewId || !activeCite) return
    setAddNoteOpen(true)
  }, [reviewId, activeCite])

  /** 把当前 activeCite 组装成 Anchor（type='html'）传给 dialog */
  const sourceAnchorForActive: Anchor | null = React.useMemo(() => {
    if (!activeCite) return null
    return {
      type: 'html',
      snapshotText: activeCite.quote,
      locationData: {
        kind: 'html',
        sectionId: activeCite.sectionId ?? undefined,
        paragraphIndex:
          activeCite.paragraphIndex != null ? activeCite.paragraphIndex : undefined,
        citeIndex: activeCite.citeIndex,
      },
    }
  }, [activeCite])

  // 点击"Open full context in Paper" → 走 useOpenEvidenceInLibrary hook
  const handleOpenInLibrary = React.useCallback(
    async (active: ActiveCite, meta: HtmlReferenceMeta | undefined) => {
      const identifier = meta
        ? { zoteroKey: meta.zoteroKey, doi: meta.doi, paperId: meta.paperId }
        : {}
      const traceId = `${active.paragraphKey}#${active.n}#${active.citeIndex}`
      const result = await openInLibrary({ identifier, quote: active.quote, traceId })
      if (result.ok) return
      // 三种失败状态：用准确文案，避免"论文未入库"误导
      const titleForToast =
        meta?.title ?? (result.reason === 'no-zotero-key' ? result.paperTitle : null)
      const headline = `[${active.n}] ${titleForToast ?? ''}`.trim()
      if (result.reason === 'no-identifier') {
        toast.error(t('reviewDemo.openInLibrary.noIdentifierTitle'), {
          description: t('reviewDemo.openInLibrary.noIdentifierDescription'),
        })
      } else if (result.reason === 'paper-not-found') {
        toast.error(t('reviewDemo.openInLibrary.notFoundTitle'), {
          description: t('reviewDemo.openInLibrary.notFoundDescription', { headline }),
        })
      } else {
        toast.info(t('reviewDemo.openInLibrary.notLinkedTitle'), {
          description: t('reviewDemo.openInLibrary.notLinkedDescription', { headline }),
        })
      }
    },
    [openInLibrary, t],
  )

  return (
    <CitationReferencesContext.Provider value={refsMap}>
      <div ref={containerRef} className={className} />
      {slots.map((s, i) =>
        // 用 (slot.el) 节点本身作 portal target；key 包含 n 以稳定标识
        createPortal(
          <CitationBadge n={s.n} quote={s.quote} onTraceClick={handleTraceClick} />,
          s.el,
          `asci-cite-${i}-${s.n}`,
        ),
      )}
      {/* DOI chip：doi.org 链接 / 裸文本 DOI 的占位 slot（点击跳右栏文献详情） */}
      {doiSlots.map((s, i) =>
        createPortal(<DoiChip doi={s.doi} label={s.label} />, s.el, `asci-doi-${i}-${s.doi}`),
      )}
      {/* 活跃 trace 卡片：只在命中 paragraphKey 的那个 slot 内 portal */}
      {activeCite
        ? traceSlots
            .filter((ts) => ts.paragraphKey === activeCite.paragraphKey)
            .map((ts) => {
              const meta = htmlRefsMap.get(activeCite.n)
              const paperLabel = buildPaperLabel(meta, activeCite.n)
              const paperMetaSub = buildPaperMetaSub(meta)
              return createPortal(
                <EvidenceTraceCard
                  paper={{
                    label: paperLabel,
                    title: meta?.title || undefined,
                    meta: paperMetaSub,
                  }}
                  quote={activeCite.quote}
                  onOpenInLibrary={() => {
                    void handleOpenInLibrary(activeCite, meta)
                  }}
                  // issue #462 方式 A：探测到无可打开 PDF → 卡片显示"源已移除"并禁用跳转
                  sourceRemoved={sourceOpenState === 'removed'}
                  // 仅当上层提供了 reviewId 才启用 + Add note here；否则按钮 disabled
                  onAddNote={reviewId ? handleAddNote : undefined}
                  onClose={() => setActiveCite(null)}
                />,
                ts.el,
                `asci-trace-${ts.paragraphKey}`,
              )
            })
        : null}
      {/* Add note here dialog —— 提交后调真实 IPC 持久化 */}
      {reviewId && activeCite && sourceAnchorForActive ? (
        <AddReviewNoteDialog
          open={addNoteOpen}
          reviewId={reviewId}
          quote={activeCite.quote}
          sourceAnchor={sourceAnchorForActive}
          onOpenChange={setAddNoteOpen}
          onSuccess={() => setActiveCite(null)}
        />
      ) : null}
    </CitationReferencesContext.Provider>
  )
}

/** 组合 paper 显示标签：authors · year → "Vaswani et al. 2017"；fallback 到 [N] */
function buildPaperLabel(meta: HtmlReferenceMeta | undefined, n: number): string {
  if (!meta) return `[${n}]`
  const firstAuthor = (meta.authors || '').split(/[,\s]+/).filter(Boolean)[0]
  const tail = firstAuthor ? `${firstAuthor}${meta.authors.includes(',') ? ' et al.' : ''}` : ''
  if (tail && meta.year) return `${tail} ${meta.year}`
  if (tail) return tail
  if (meta.title) return meta.title
  return `[${n}]`
}

/** 组合 paper 副标题：venue · doi（任一可空） */
function buildPaperMetaSub(meta: HtmlReferenceMeta | undefined): string | undefined {
  if (!meta) return undefined
  const parts: string[] = []
  if (meta.venue) parts.push(meta.venue)
  if (meta.doi) parts.push(meta.doi)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
