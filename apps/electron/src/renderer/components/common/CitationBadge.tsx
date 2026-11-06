/**
 * 综述 [N] 引用角标 + 文档内跳转 + 富 tooltip
 *
 * 职责：
 *   1. 渲染：黄底圆角 [N] 角标，hover tooltip 显示
 *      - title（粗体）+ authors · year · venue（淡）— 来自 §7 References，由
 *        CitationReferencesContext 注入
 *      - <quote> 原文段落（来自 href 解码）
 *      - 都没有时退化为只显示编号（极罕见）
 *   2. 跳转：click → 在 badge 所在的 `[data-asci-citations-root]` 容器内查找
 *      `[data-asci-ref-n="N"]` 元素 → smooth scroll 到该处 + 持续高亮 + 浮动"返回"按钮
 *      （高亮和按钮的生命周期由 IntersectionObserver 控制，目标离开视区或预览卸载时一同清除）
 *
 * 跳转逻辑不依赖工作区论文 / atom —— 完全靠 DOM 自给自足。
 * 渲染上下文（MarkdownRenderer / MessageResponse）只需要：
 *   - 外层容器加 `data-asci-citations-root` 属性
 *   - §7 References 的 `[N] xxx` 段落加 `data-asci-ref-n="N"` 属性
 *
 * 颜色走 inline style 而非 Tailwind 类，规避两种已知坑：
 *   1. Vite + Tailwind JIT 对新增文件偶发漏扫
 *   2. @tailwindcss/typography 的 `prose` 样式对后代元素的 !important 覆盖
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/hooks/useT.ts'
import { i18n } from '@/lib/i18n.ts'
import type { ReferenceMeta } from '@/lib/citation-references.ts'

interface CitationBadgeProps {
  n: number
  quote: string
  /**
   * 可选：click 行为劫持回调。
   * 提供时不再走默认的"滚动到 §7 + 浮动返回按钮"流程，而是把控制权交给上层。
   * 综述视图（ReviewHtmlRenderer）注入此回调以触发 EvidenceTraceCard 在 <p> 后挂载。
   *
   * 入参：
   *   - n：refNumber
   *   - quote：本 cite 的 verbatim 引文
   *   - badgeEl：被点击的 span 元素，上层可 closest('p') 定位最近段落
   */
  onTraceClick?: (n: number, quote: string, badgeEl: Element) => void
}

const EMPTY_REFS: ReadonlyMap<number, ReferenceMeta> = new Map()

export const CitationReferencesContext = React.createContext<ReadonlyMap<number, ReferenceMeta>>(EMPTY_REFS)

/**
 * 对话流溯源点击处理器（#448）。
 * 提供时，badge 在**默认（保留 tooltip）模式**下点击不再滚到 §7，而是交给此 handler
 * （对话流注入 → 解析论文 → 右栏打开 PDF 高亮）。handler 内部失败时自行回退到
 * [[jumpToReferenceN]]（已导出）。综述视图走 onTraceClick prop，不经此 context。
 */
export interface CitationTraceHandlerArgs {
  n: number
  quote: string
  /** 第 N 条 §7 引用的元数据（含 doi，用于解析到具体 PDF）；可能缺失 */
  meta: ReferenceMeta | undefined
  /** 被点击的 badge 元素，供 handler 失败回退 jumpToReferenceN 用 */
  badgeEl: Element
}
export type CitationTraceHandler = (args: CitationTraceHandlerArgs) => void
export const CitationTraceContext = React.createContext<CitationTraceHandler | null>(null)

const BADGE_BASE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  verticalAlign: 'baseline',
  margin: '0 2px',
  padding: '0 6px',
  borderRadius: '6px',
  // 中性 chip 语义：随主题响应的语义 token（hsl 形式，规避 prose !important + Tailwind JIT 漏扫）
  backgroundColor: 'hsl(var(--muted-foreground) / 0.15)',
  color: 'hsl(var(--foreground) / 0.85)',
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: '16px',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background-color 0.15s ease',
}
const BADGE_HOVER_BG = 'hsl(var(--muted-foreground) / 0.2)'

/** 找到 el 所在的最近一个可滚动祖先（overflow-y auto/scroll），找不到则用 documentElement */
function findScrollContainer(el: Element): HTMLElement {
  let curr: HTMLElement | null = el as HTMLElement
  while (curr && curr !== document.body) {
    const style = getComputedStyle(curr)
    if (/(auto|scroll)/.test(style.overflowY)) return curr
    curr = curr.parentElement
  }
  return document.documentElement
}

/**
 * 浮动"返回阅读处"按钮的全局单例状态。
 * 高亮 + 按钮的生命周期：
 *   1. 目标条目离开 scrollContainer 可视区 → 启动 10s 倒计时
 *   2. 倒计时期间目标重新进入视区（用户主动滚回） → 取消倒计时，保持高亮 + 按钮
 *   3. 倒计时到期仍未回来 → 自动清除
 *   4. 期间任何 [N] 点击（同/异 target） → 取消倒计时 + 重新观测（armed 重置）
 *   5. 点击按钮 → 立即滚回原位 + 清除
 *   6. 预览容器卸载（关闭预览） → 立即清除
 *
 * 用 module-level state + 直接 DOM 操作（非 React/jotai）：本质上是 transient 浮层。
 */
interface ReturnButtonState {
  el: HTMLButtonElement
  scrollContainer: HTMLElement
  highlightedRef: HTMLElement
  observer: IntersectionObserver
  containerCheckTimer: number
  originalScrollTop: number
  /** 离开视区后的销毁倒计时句柄；目标在视区内或尚未首次进入时为 null */
  decayTimer: number | null
}
let returnButton: ReturnButtonState | null = null

/** 离开视区后保留高亮 + 按钮的时长 */
const RETURN_DECAY_MS = 10_000

const RETURN_BTN_STYLE: Record<string, string> = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  zIndex: '9999',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '8px 14px',
  borderRadius: '8px',
  // 中性 chip 语义：与行内角标同源的语义 token，随主题响应
  backgroundColor: 'hsl(var(--muted-foreground) / 0.15)',
  color: 'hsl(var(--foreground) / 0.85)',
  fontSize: '14px',
  fontWeight: '500',
  fontFamily: 'inherit',
  border: '1px solid hsl(var(--border))',
  boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
  cursor: 'pointer',
  transition: 'opacity 200ms ease, transform 200ms ease, background-color 150ms ease',
  opacity: '0',
  transform: 'translateY(8px)',
  outline: 'none',
}

/** 给 §7 条目段落打上持续高亮（直到 destroyReturnButton 才清除） */
function applyPersistentHighlight(el: HTMLElement): void {
  el.style.borderRadius = '4px'
  el.style.transition = 'box-shadow 220ms ease, background-color 220ms ease'
  // 在下一帧设置高亮，触发 transition 渐入
  requestAnimationFrame(() => {
    el.style.boxShadow =
      '0 0 0 3px hsl(var(--search-hit-fg)), 0 0 0 8px hsl(var(--search-hit-fg) / 0.40)'
    el.style.backgroundColor = 'hsl(var(--search-hit-bg))'
  })
}

function clearHighlight(el: HTMLElement): void {
  // 让 transition 把高亮渐出（200ms 后再彻底擦干净 inline 样式，避免遗留 transition）
  el.style.boxShadow = ''
  el.style.backgroundColor = ''
  setTimeout(() => {
    el.style.borderRadius = ''
    el.style.transition = ''
  }, 250)
}

function destroyReturnButton(animateOut = true): void {
  if (!returnButton) return
  const { el, highlightedRef, observer, containerCheckTimer, decayTimer } = returnButton
  observer.disconnect()
  clearInterval(containerCheckTimer)
  if (decayTimer != null) clearTimeout(decayTimer)
  if (highlightedRef.isConnected) clearHighlight(highlightedRef)
  returnButton = null
  if (animateOut) {
    el.style.opacity = '0'
    el.style.transform = 'translateY(8px)'
    setTimeout(() => el.remove(), 250)
  } else {
    el.remove()
  }
}

/**
 * 监听目标元素与 scrollContainer 的相交，驱动 10s 延迟销毁。
 *
 * armed：observe(target) 时浏览器会立刻派发一次"当前相交状态"通知。
 *   用户点 [N] 跳转的目标几乎总是初始不在视区（这正是要 scroll 过去的原因），
 *   这一首发的 isIntersecting=false 会立即误启动倒计时。
 *   因此只有在目标"首次进入视区"之后，才允许"再次离开"启动倒计时。
 *
 * 任何 [N] 点击（同/异 target）都会 disconnect 旧 observer + 新建一个，armed 自然重置。
 */
function observeTargetVisibility(scrollContainer: HTMLElement, target: HTMLElement): IntersectionObserver {
  let armed = false
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          armed = true
          // 用户主动滚回视区 → 取消倒计时，保留高亮 + 按钮
          if (returnButton && returnButton.decayTimer != null) {
            clearTimeout(returnButton.decayTimer)
            returnButton.decayTimer = null
          }
        } else if (armed) {
          // 目标曾入视区，现已离开 → 启动 10s 倒计时（已有则不重启）
          if (returnButton && returnButton.decayTimer == null) {
            returnButton.decayTimer = window.setTimeout(() => {
              destroyReturnButton(true)
            }, RETURN_DECAY_MS)
          }
        }
      }
    },
    { root: scrollContainer, threshold: 0 },
  )
  observer.observe(target)
  return observer
}

/**
 * 显示/刷新"返回阅读处"按钮 + 持续高亮。
 * 同一阅读会话只记录第一次跳转前的位置（"返回首跳之前"），多次点击 [N] 不会丢失最初的阅读位置。
 */
function ensureReturnButton(
  scrollContainer: HTMLElement,
  originalScrollTop: number,
  target: HTMLElement,
  n: number,
): void {
  // 已有按钮：保留 originalScrollTop（首跳之前的原位），其余按"重新计时"语义重置
  if (returnButton) {
    // 1) 取消可能正在跑的销毁倒计时
    if (returnButton.decayTimer != null) {
      clearTimeout(returnButton.decayTimer)
      returnButton.decayTimer = null
    }
    // 2) target 变化时切换高亮
    if (returnButton.highlightedRef !== target) {
      clearHighlight(returnButton.highlightedRef)
      applyPersistentHighlight(target)
      returnButton.highlightedRef = target
    }
    // 3) 不论 target 是否变化都 disconnect + 重新 observe，让 armed 闭包重置
    //    （否则 scrollIntoView 期间目标尚未到位，旧 observer 会误判为"已 armed 离开"再次启动倒计时）
    returnButton.observer.disconnect()
    returnButton.observer = observeTargetVisibility(scrollContainer, target)
    returnButton.el.textContent = i18n.t('citation.returnButton.label', { ns: 'conversation', n })
    return
  }

  applyPersistentHighlight(target)

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = i18n.t('citation.returnButton.label', { ns: 'conversation', n })
  btn.setAttribute('aria-label', i18n.t('citation.returnButton.ariaLabel', { ns: 'conversation' }))
  Object.assign(btn.style, RETURN_BTN_STYLE)

  btn.addEventListener('mouseenter', () => { btn.style.backgroundColor = BADGE_HOVER_BG })
  btn.addEventListener('mouseleave', () => { btn.style.backgroundColor = RETURN_BTN_STYLE.backgroundColor! })

  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    scrollContainer.scrollTo({ top: originalScrollTop, behavior: 'smooth' })
    destroyReturnButton(true)
  })

  document.body.appendChild(btn)
  requestAnimationFrame(() => {
    btn.style.opacity = '1'
    btn.style.transform = 'translateY(0)'
  })

  // 预览容器被卸载（关闭预览）时按钮也要消失
  const containerCheckTimer = window.setInterval(() => {
    if (!scrollContainer.isConnected) destroyReturnButton(false)
  }, 1000)

  const observer = observeTargetVisibility(scrollContainer, target)

  returnButton = {
    el: btn,
    scrollContainer,
    highlightedRef: target,
    observer,
    containerCheckTimer,
    originalScrollTop,
    decayTimer: null,
  }
}

/** 在 badge 所在的 citations-root 容器内滚动到 §7 [N] + 持续高亮 + 浮动返回按钮 */
export function jumpToReferenceN(badgeEl: Element, n: number): void {
  const root = badgeEl.closest('[data-asci-citations-root]')
  if (!root) {
    toast.info(i18n.t('citation.jumpFailed.noContext', { ns: 'conversation', n }))
    return
  }
  const target = root.querySelector(`[data-asci-ref-n="${n}"]`) as HTMLElement | null
  if (!target) {
    toast.info(i18n.t('citation.jumpFailed.notFoundTitle', { ns: 'conversation', n }), {
      description: i18n.t('citation.jumpFailed.notFoundDescription', { ns: 'conversation' }),
      duration: 3000,
    })
    return
  }

  const scrollContainer = findScrollContainer(root)
  const originalScrollTop = scrollContainer.scrollTop

  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  ensureReturnButton(scrollContainer, originalScrollTop, target, n)
}

export function CitationBadge({ n, quote, onTraceClick }: CitationBadgeProps): React.ReactElement {
  const { t } = useT('conversation')
  const [hover, setHover] = React.useState(false)
  const refs = React.useContext(CitationReferencesContext)
  const traceHandler = React.useContext(CitationTraceContext)
  const meta = refs.get(n)
  const style: React.CSSProperties = {
    ...BADGE_BASE,
    backgroundColor: hover ? BADGE_HOVER_BG : BADGE_BASE.backgroundColor,
  }

  // 点击优先级：onTraceClick prop（综述）> CitationTraceContext（对话流溯源）> 默认 §7 跳转
  const handleActivate = React.useCallback((badgeEl: Element) => {
    if (onTraceClick) {
      onTraceClick(n, quote, badgeEl)
      return
    }
    if (traceHandler) {
      traceHandler({ n, quote, meta, badgeEl })
      return
    }
    jumpToReferenceN(badgeEl, n)
  }, [n, quote, onTraceClick, traceHandler, meta])

  const handleClick = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    handleActivate(e.currentTarget as Element)
  }, [handleActivate])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      handleActivate(e.currentTarget as Element)
    }
  }, [handleActivate])

  // trace 模式（onTraceClick 提供）：完全去掉 Tooltip 包装，click 走 EvidenceTraceCard。
  // markdown 场景（无 onTraceClick）：保留原 hover Tooltip + click 跳 §7 行为。
  const badge = (
    <span
      style={style}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={t('citation.badge.ariaLabel', { n })}
    >
      [{n}]
    </span>
  )
  if (onTraceClick) return badge

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="max-w-[480px] p-0 bg-popover/95 text-popover-foreground shadow-xl shadow-black/10 border border-border"
      >
        {meta ? <ReferenceHeader meta={meta} /> : null}
        {quote ? (
          <>
            <div
              className="px-3 pt-2 pb-1 text-sm font-medium uppercase tracking-wide"
              style={{ color: 'hsl(var(--warning))' }}
            >
              {t('citation.tooltip.quoteLabel')}
            </div>
            <div className="px-3 pb-2 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap break-words">
              {quote}
            </div>
          </>
        ) : null}
        <div className="px-3 pb-2 text-sm text-muted-foreground/70">
          {traceHandler ? t('citation.tooltip.clickToOpenSource') : t('citation.tooltip.clickToJump')}
        </div>
        {!meta && !quote ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">[{n}]</div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

function ReferenceHeader({ meta }: { meta: ReferenceMeta }): React.ReactElement {
  // title 缺失时用 raw 兜底；authors/year/venue 都缺则不渲染副标题行
  const title = meta.title ?? meta.raw
  const subParts = [meta.authors, meta.year, meta.venue].filter((s): s is string => Boolean(s && s.trim()))
  const subtitle = subParts.join(' · ')
  return (
    <div className="px-3 pt-3 pb-2 border-b border-border">
      <div className="text-sm font-semibold text-foreground leading-snug break-words">
        [{meta.n}] {title}
      </div>
      {subtitle ? (
        <div className="mt-1 text-sm text-muted-foreground leading-snug break-words">
          {subtitle}
        </div>
      ) : null}
    </div>
  )
}
