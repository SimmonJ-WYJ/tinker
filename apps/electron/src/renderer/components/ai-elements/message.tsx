/**
 * AI Elements - 消息组件原语
 *
 * 简化迁移自 asci-frontend 的 ai-elements/message.tsx，
 * 保留核心消息展示组件，适配 Electron + Jotai 架构。
 *
 * 包含：
 * - Message — 根容器，`from` 属性区分 user/assistant
 * - MessageHeader — 头像 + 模型名
 * - MessageContent — 内容区域
 * - MessageActions — 操作按钮容器
 * - MessageAction — 单个操作按钮（可选 Tooltip）
 * - MessageResponse — react-markdown 渲染
 * - UserMessageContent — 长文本自动折叠
 * - MessageLoading — 3 个弹跳点加载动画
 * - MessageStopped — "已停止生成" 状态标记
 * - StreamingIndicator — 流式呼吸脉冲点
 */

import * as React from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { ChevronDown, ChevronUp, Paperclip, FileText, Sparkles, Server, Download, BookOpen, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { LoadingIndicator } from '@/components/ui/loading-indicator'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { CodeBlock, MermaidBlock } from '@asci/ui'
import { FilePathChip, isAbsoluteFilePath, isRelativeFilePath } from './file-path-chip'
import { INLINE_CHIP_STYLE, INLINE_LABEL_CLASS } from './inline-label-style.ts'
import { ArtifactCard } from '@/components/agent/ArtifactCard'
import { extractArtifactReference, resolveAgainstCwd } from '@/lib/deliverable-path'
import { DoiChip } from './doi-chip'
import { parseDoiExact, findDois, doiFromUrl, DOI_PROBE_RE } from '@/lib/doi.ts'
import { transformQuoteCitations, parseCitationHref } from '@/lib/citation-transform'
import {
  CitationBadge,
  CitationReferencesContext,
  CitationTraceContext,
  jumpToReferenceN,
  type CitationTraceHandler,
} from '@/components/common/CitationBadge'
import { parseReferences } from '@/lib/citation-references.ts'
import { useOpenEvidenceInRightPanel } from '@/hooks/useOpenEvidenceInRightPanel.ts'
import { useOpenDoiInRightPanel } from '@/hooks/useOpenDoiInRightPanel.ts'
import { useT } from '@/hooks/useT'
import type { HTMLAttributes, ComponentProps, ReactNode } from 'react'
import type { FileAttachment } from '@asci/shared'

// ===== Message 根容器 =====

type MessageRole = 'user' | 'assistant' | 'system'

interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  /** 消息发送者角色 */
  from: MessageRole
}

/** 消息根容器，user 自动右对齐 */
export function Message({ className, from, ...props }: MessageProps): React.ReactElement {
  return (
    <div
      className={cn(
        'group flex w-full flex-col gap-0.5 rounded-[10px] px-2.5 py-2.5',
        from === 'user' ? 'is-user' : 'is-assistant',
        className
      )}
      {...props}
    />
  )
}

// ===== MessageHeader 头像 + 模型名 =====

interface MessageHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** 模型名称 */
  model?: string
  /** 头像元素 */
  logo?: ReactNode
  /** 消息时间戳 */
  time?: string
}

/** 消息头部（user 时自动隐藏） */
export function MessageHeader({
  model,
  logo,
  time,
  className,
  children,
  ...props
}: MessageHeaderProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 mb-2.5',
        'group-[.is-user]:hidden',
        className
      )}
      {...props}
    >
      {logo && (
        <div className="flex size-[35px] shrink-0 items-center justify-center overflow-hidden rounded-[25%]">
          {logo}
        </div>
      )}
      <div className="flex flex-col justify-between h-[35px]">
        {model && <span className="text-sm font-semibold text-foreground/60 leading-none">{model}</span>}
        {time && <span className="text-sm text-foreground/[0.38] leading-none">{time}</span>}
      </div>
      {children}
    </div>
  )
}

// ===== MessageContent 内容区域 =====

type MessageContentProps = HTMLAttributes<HTMLDivElement>

/**
 * 消息内容区域
 * - user 消息：右对齐气泡（items-end），气泡自带背景色
 * - assistant 消息：占满对话区宽度（w-full）
 */
export function MessageContent({
  children,
  className,
  ...props
}: MessageContentProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex max-w-full min-w-0 flex-col gap-2 overflow-hidden',
        'group-[.is-user]:text-foreground group-[.is-user]:items-end',
        'group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ===== MessageActions 操作按钮容器 =====

type MessageActionsProps = ComponentProps<'div'>

/** 操作按钮容器（复制、时间等），默认隐藏，hover 消息时淡入显示 */
export function MessageActions({
  className,
  children,
  ...props
}: MessageActionsProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 text-muted-foreground',
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 motion-reduce:transition-none',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// ===== MessageAction 单个操作按钮 =====

interface MessageActionProps extends ComponentProps<typeof Button> {
  /** 悬停提示文字 */
  tooltip?: string
  /** 无障碍标签 */
  label?: string
}

/** 单个操作按钮（含可选 Tooltip 包装） */
export function MessageAction({
  tooltip,
  children,
  label,
  variant = 'ghost',
  size = 'icon-sm',
  ...props
}: MessageActionProps): React.ReactElement {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  )

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return button
}

// ===== MessageResponse Markdown 渲染 =====

// ----- mdast 节点类型（remark 自定义插件用） -----

interface MdastTextNode {
  type: 'text'
  value: string
}

interface MdastLinkNode {
  type: 'link'
  url: string
  children: MdastNode[]
}

interface MdastBreakNode {
  type: 'break'
}

interface MdastGenericNode {
  type: string
  children?: MdastNode[]
  value?: string
}

type MdastNode = MdastTextNode | MdastLinkNode | MdastBreakNode | MdastGenericNode

interface MdastParent {
  type: string
  children: MdastNode[]
}

// ----- mdast 工具函数 -----

/** 递归遍历 mdast text 节点（自动跳过 code / inlineCode 子树） */
function walkMdastText(
  node: MdastParent,
  visitor: (node: MdastTextNode, index: number, parent: MdastParent) => number | void
): void {
  if (!node.children) return
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!
    if (child.type === 'text') {
      const result = visitor(child as MdastTextNode, i, node)
      if (typeof result === 'number') i = result - 1
    } else if (child.type !== 'code' && child.type !== 'inlineCode') {
      const asParent = child as MdastParent
      if (asParent.children) walkMdastText(asParent, visitor)
    }
  }
}

// ----- MentionChip 组件 -----

type MentionType = 'file' | 'skill' | 'mcp' | 'zotero-item' | 'zotero-col'

const MENTION_STYLES: Record<MentionType, { icon: typeof FileText; className: string }> = {
  file: { icon: FileText, className: 'bg-primary/10 text-primary' },
  skill: { icon: Sparkles, className: 'bg-[hsl(270_60%_60%/0.15)] text-[hsl(270_60%_50%)]' },
  mcp: { icon: Server, className: 'bg-[hsl(160_60%_45%/0.15)] text-[hsl(160_60%_35%)]' },
  'zotero-item': { icon: BookOpen, className: 'bg-[hsl(38_92%_50%/0.18)] text-[hsl(28_80%_34%)]' },
  'zotero-col': { icon: Folder, className: 'bg-[hsl(38_92%_50%/0.12)] text-[hsl(28_70%_30%)]' },
}

function MentionChip({ type, value }: { type: MentionType; value: string }): React.ReactElement {
  const style = MENTION_STYLES[type]
  const Icon = style.icon
  const display = (() => {
    if (type === 'file') return value.split('/').pop() || value
    if (type === 'zotero-item' || type === 'zotero-col') {
      // 序列化格式：KEY|urlEncoded(label)；react-markdown 会把 | 再编码为 %7C，
      // 所以先整体解码一次再按 | 切分。老消息可能只有 KEY，无 | 则回退显示 KEY。
      let decoded = value
      try { decoded = decodeURIComponent(value) } catch { /* keep raw */ }
      const pipeIdx = decoded.indexOf('|')
      if (pipeIdx > 0) return decoded.slice(pipeIdx + 1)
      return decoded
    }
    return value
  })()
  const titleAttr = (() => {
    if (type === 'file') return value
    if (type === 'zotero-item' || type === 'zotero-col') {
      // 悬停显示 KEY（方便调试）
      let decoded = value
      try { decoded = decodeURIComponent(value) } catch { /* keep raw */ }
      const pipeIdx = decoded.indexOf('|')
      return pipeIdx > 0 ? decoded.slice(0, pipeIdx) : decoded
    }
    return undefined
  })()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-[1px] text-sm font-medium whitespace-nowrap align-baseline',
        style.className
      )}
      title={titleAttr}
    >
      <Icon className="size-3 inline shrink-0" />
      {display}
    </span>
  )
}

// ----- UnverifiedMarker：未核验定量数据标记（#448） -----

/**
 * AI 按 prompt 契约对"无来源的定量数据"追加 `(unverified)`，remarkUnverified 把它转成本标记。
 * 用 warning 语义 token（警告但非错误），提示该数据未绑定来源、不可作为确定事实。
 */
function UnverifiedMarker(): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <span
      className="inline-flex items-center rounded px-1 py-[1px] text-sm font-medium align-baseline bg-warning/15 text-warning whitespace-nowrap"
      title={t('citation.unverified.tooltip')}
    >
      {t('citation.unverified.label')}
    </span>
  )
}

// ----- remarkMentions：将 @file: /skill: #mcp: 转为 mention:// link 节点 -----

const MENTION_PATTERN = /@file:(\S+)|\/skill:(\S+)|#mcp:(\S+)|@zotero-item:(\S+)|@zotero-col:(\S+)/g

/** 匹配 AI 输出的 `(unverified)` 字面量（大小写不敏感、容忍内部空白） */
const UNVERIFIED_PATTERN = /\(\s*unverified\s*\)/gi

/** 把正文里的 `(unverified)` 字面量转成 `unverified://` link 节点，交 MarkdownLink 渲染为标记 */
export function remarkUnverified() {
  return (tree: MdastParent) => {
    walkMdastText(tree, (node, index, parent) => {
      const text = node.value
      UNVERIFIED_PATTERN.lastIndex = 0
      if (!UNVERIFIED_PATTERN.test(text)) return
      UNVERIFIED_PATTERN.lastIndex = 0

      const parts: MdastNode[] = []
      let lastIdx = 0
      let m: RegExpExecArray | null
      while ((m = UNVERIFIED_PATTERN.exec(text)) !== null) {
        if (m.index > lastIdx) parts.push({ type: 'text', value: text.slice(lastIdx, m.index) })
        parts.push({ type: 'link', url: 'unverified://', children: [{ type: 'text', value: m[0] }] })
        lastIdx = m.index + m[0].length
      }
      if (lastIdx < text.length) parts.push({ type: 'text', value: text.slice(lastIdx) })

      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}

export function remarkMentions() {
  return (tree: MdastParent) => {
    walkMdastText(tree, (node, index, parent) => {
      const text = node.value
      MENTION_PATTERN.lastIndex = 0
      if (!MENTION_PATTERN.test(text)) return
      MENTION_PATTERN.lastIndex = 0

      const parts: MdastNode[] = []
      let lastIdx = 0
      let m: RegExpExecArray | null

      while ((m = MENTION_PATTERN.exec(text)) !== null) {
        if (m.index > lastIdx) {
          parts.push({ type: 'text', value: text.slice(lastIdx, m.index) })
        }
        const mType: MentionType =
          m[1] ? 'file'
          : m[2] ? 'skill'
          : m[3] ? 'mcp'
          : m[4] ? 'zotero-item'
          : 'zotero-col'
        const mValue = m[1] || m[2] || m[3] || m[4] || m[5]
        parts.push({
          type: 'link',
          url: `mention://${mType}/${mValue}`,
          children: [{ type: 'text', value: m[0] }],
        })
        lastIdx = m.index + m[0].length
      }

      if (lastIdx < text.length) {
        parts.push({ type: 'text', value: text.slice(lastIdx) })
      }

      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}

// ----- remarkDois：将裸文本 / `doi:` 前缀 DOI 转为 doi:// link 节点 -----
// （行内 code 由 MarkdownInlineCode 接管、doi.org 链接由 MarkdownLink 接管，
//   此插件只负责 C/D 裸文本形态；spec: docs/specs/doi-paper-jump-spec.md §5.4）

export function remarkDois() {
  return (tree: MdastParent) => {
    walkMdastText(tree, (node, index, parent) => {
      // 链接内文本不处理：doi.org 链接走 MarkdownLink 分支，其他链接文本保持原样
      if (parent.type === 'link') return
      const hits = findDois(node.value)
      if (hits.length === 0) return

      const text = node.value
      const parts: MdastNode[] = []
      let lastIdx = 0
      for (const h of hits) {
        if (h.index > lastIdx) parts.push({ type: 'text', value: text.slice(lastIdx, h.index) })
        parts.push({
          type: 'link',
          url: `doi://${h.doi}`,
          children: [{ type: 'text', value: text.slice(h.index, h.index + h.length) }],
        })
        lastIdx = h.index + h.length
      }
      if (lastIdx < text.length) parts.push({ type: 'text', value: text.slice(lastIdx) })

      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}

// ----- remarkPreserveBreaks：在 text 节点中将 \n 转为 break 节点（跳过代码块） -----

export function remarkPreserveBreaks() {
  return (tree: MdastParent) => {
    walkMdastText(tree, (node, index, parent) => {
      const text = node.value
      if (!text.includes('\n')) return

      const lines = text.split('\n')
      const parts: MdastNode[] = []

      for (let i = 0; i < lines.length; i++) {
        if (i > 0) parts.push({ type: 'break' })
        if (lines[i]) parts.push({ type: 'text', value: lines[i] })
      }

      parent.children.splice(index, 1, ...parts)
      return index + parts.length
    })
  }
}

/** remark 插件函数签名 */
export type RemarkPluginFn = () => (tree: MdastParent) => void

export interface MessageResponseProps {
  /** Markdown 内容 */
  children: string
  className?: string
  /** 基础目录路径，用于解析相对文件路径（如 Agent 会话工作目录） */
  basePath?: string
  /** 额外的 remark 插件（追加到内置 remarkGfm + remarkMath 之后） */
  remarkPlugins?: RemarkPluginFn[]
}

/** 稳定引用的插件数组，避免 react-markdown 每帧重建插件管线 */
const REMARK_PLUGINS = [remarkGfm, remarkMath]

/** 探针：消息是否含 `(unverified)` 字面量；命中才挂 remarkUnverified，避免对每条消息空跑 mdast 遍历 */
const UNVERIFIED_PROBE = /\(\s*unverified\s*\)/i
const REHYPE_PLUGINS = [rehypeKatex]

/** 允许 mention:// 与 doi:// 协议通过 URL 清洗（react-markdown 默认只放行 http/https） */
function mentionUrlTransform(url: string): string {
  if (url.startsWith('mention://') || url.startsWith('doi://')) return url
  return defaultUrlTransform(url)
}

// ===== Memo'd Markdown 子组件（稳定引用，避免 react-markdown 每帧重建组件映射） =====

/** mention:// URL 匹配 */
const MENTION_URL_RE = /^mention:\/\/(file|skill|mcp|zotero-item|zotero-col)\/(.+)$/

/** remark-rehype 的 normalizeUri 可能对 url 做百分号编码；解码失败时原样返回 */
function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 把 children 抽成纯字符串（用于从 react-markdown 的 `a` children 里
 * 还原 `[1]` 这类纯文本，给 parseCitationHref 用）
 */
function childrenToText(node: React.ReactNode): string | undefined {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) {
    if (node.length > 0 && typeof node[0] === 'string') return node[0] as string
    const joined = node.map((c) => (typeof c === 'string' ? c : '')).join('')
    return joined || undefined
  }
  return undefined
}

/** 外部链接 / mention chip / 综述引用角标 渲染器 */
const MarkdownLink = React.memo(function MarkdownLink({
  href,
  children: linkChildren,
  ...linkProps
}: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  // 综述引用 #asci-cite-... → 渲染为 CitationBadge（badge 自己处理 click 跳转）
  const linkText = childrenToText(linkChildren)
  const citation = parseCitationHref(href, linkText)
  if (citation) {
    return <CitationBadge n={citation.n} quote={citation.quote} />
  }

  // unverified:// → 渲染为「未核验」标记（#448）
  if (href === 'unverified://') {
    return <UnverifiedMarker />
  }

  // mention:// 协议 → 渲染为 MentionChip
  if (href) {
    const mentionMatch = MENTION_URL_RE.exec(href)
    if (mentionMatch) {
      return <MentionChip type={mentionMatch[1] as MentionType} value={mentionMatch[2] ?? ''} />
    }
  }

  // doi:// 协议（remarkDois 产物）→ DOI 芯片；统一展示 DOI 本体（剥掉原文 `doi:` 装饰前缀）
  if (href?.startsWith('doi://')) {
    const doi = safeDecodeUri(href.slice('doi://'.length))
    return <DoiChip doi={doi} />
  }

  // doi.org 外链 → DOI 芯片（点击跳右栏详情而非浏览器；linkText 可能是论文标题，保留展示）
  if (href) {
    const doiFromHref = doiFromUrl(href)
    if (doiFromHref) {
      const label = linkText && linkText !== href ? linkText : doiFromHref
      return <DoiChip doi={doiFromHref} label={label} />
    }
  }

  return (
    <a
      {...linkProps}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          window.electronAPI.openExternal(href)
        }
      }}
      title={href}
    >
      {linkChildren}
    </a>
  )
})

/** 段落渲染器：识别 §7 References 形如 `[N] Authors. Title...` 的开头，给段落打 data-asci-ref-n */
function extractRefNumber(node: React.ReactNode): string | null {
  let firstText = ''
  if (typeof node === 'string') firstText = node
  else if (Array.isArray(node) && typeof node[0] === 'string') firstText = node[0]
  else if (Array.isArray(node)) {
    for (const c of node) {
      if (typeof c === 'string') { firstText = c; break }
    }
  }
  const m = /^\s*\[(\d+)\]\s+/.exec(firstText)
  return m ? m[1]! : null
}

const MarkdownParagraph = React.memo(function MarkdownParagraph({
  children,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>): React.ReactElement {
  const refN = extractRefNumber(children)
  if (refN) {
    return <p data-asci-ref-n={refN} {...rest}>{children}</p>
  }
  return <p {...rest}>{children}</p>
})

/**
 * 列表项渲染器：与 MarkdownParagraph 对称。
 *
 * SKILL.md（literature-review-result）允许 §7 References 以 `- [N] Authors. *Title*. ...`
 * 列表形式输出。react-markdown 会把它渲染为 `<ul><li>[N] ...</li></ul>`（tight list），
 * 此时只有 <li> 持有首字符 `[N]`，<p> 路径拿不到。CitationBadge 在 querySelector
 * `[data-asci-ref-n="N"]` 时不会命中 <li>，触发 "not found in §7" 的 toast。
 * 这里给所有满足前缀模式的 <li> 加上 data-asci-ref-n，使列表式 References 也可跳转。
 *
 * loose list（条目间有空行）会被 react-markdown 包成 `<li><p>...</p></li>`，由
 * MarkdownParagraph 处理；tight / loose 双路径均有覆盖。
 */
const MarkdownListItem = React.memo(function MarkdownListItem({
  children,
  ...rest
}: React.LiHTMLAttributes<HTMLLIElement>): React.ReactElement {
  const refN = extractRefNumber(children)
  if (refN) {
    return <li data-asci-ref-n={refN} {...rest}>{children}</li>
  }
  return <li {...rest}>{children}</li>
})

/** 递归提取纯文本（children 可能是字符串数组） */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

interface DeliverableTableRow {
  path: string
  title: string
  description?: string
}

function elementChildren(node: React.ReactElement): React.ReactNode {
  return (node.props as { children?: React.ReactNode }).children
}

function directElements(node: React.ReactNode, type: string): React.ReactElement[] {
  return React.Children.toArray(node).filter(
    (child): child is React.ReactElement => React.isValidElement(child) && child.type === type,
  )
}

function parseDeliverableTableRows(children: React.ReactNode, basePath?: string): DeliverableTableRow[] | null {
  const thead = directElements(children, 'thead')[0]
  const tbody = directElements(children, 'tbody')[0]
  if (!thead || !tbody) return null

  const headerRow = directElements(elementChildren(thead), 'tr')[0]
  if (!headerRow) return null
  const headers = directElements(elementChildren(headerRow), 'th').map((cell) => extractText(elementChildren(cell)).trim())
  const fileIndex = headers.findIndex((header) => header === '文件' || /^file$/i.test(header))
  const descriptionIndex = headers.findIndex((header) => header === '说明' || /^description$/i.test(header))
  if (fileIndex < 0) return null

  const rows: DeliverableTableRow[] = []
  for (const row of directElements(elementChildren(tbody), 'tr')) {
    const cells = directElements(elementChildren(row), 'td')
    const fileCell = cells[fileIndex]
    if (!fileCell) continue
    const rawPath = extractText(elementChildren(fileCell)).trim()
    if (!rawPath || !rawPath.includes('.')) continue
    const fullPath = basePath ? resolveAgainstCwd(rawPath, basePath) : rawPath
    const title = rawPath.split('/').pop() ?? rawPath
    const descriptionCell = descriptionIndex >= 0 ? cells[descriptionIndex] : undefined
    const description = descriptionCell ? extractText(elementChildren(descriptionCell)).trim() : undefined
    rows.push({ path: fullPath, title, description: description || undefined })
  }

  return rows.length > 0 ? rows : null
}

function hasDeliverableTableMarkdown(markdown: string): boolean {
  const lines = markdown.split('\n')
  return lines.some((line, index) => {
    if (!line.includes('|') || !line.includes('文件')) return false
    const next = lines[index + 1] ?? ''
    return line.includes('说明') && /^\s*\|?\s*:?-{3,}/.test(next)
  })
}

const MarkdownTable = React.memo(function MarkdownTable({
  children,
  basePath,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement> & { basePath?: string }): React.ReactElement {
  const deliverables = parseDeliverableTableRows(children, basePath)
  if (deliverables) {
    return (
      <div className="not-prose my-3 space-y-2">
        {deliverables.map((row) => (
          <ArtifactCard
            key={row.path}
            path={row.path}
            displayTitle={row.title}
            description={row.description}
            className="mt-0"
          />
        ))}
      </div>
    )
  }
  return (
    <div className="not-prose my-3 overflow-x-auto rounded-xl border border-border/60 bg-card/70">
      <table
        {...rest}
        className={cn(
          'w-full min-w-[42rem] border-collapse text-[14px]',
          '[&_th]:border-b [&_th]:border-border/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground/90',
          '[&_td]:border-t [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_td]:leading-[1.7]',
          '[&_th:first-child]:w-36 [&_th:first-child]:min-w-36 [&_td:first-child]:w-36 [&_td:first-child]:min-w-36 [&_td:first-child]:whitespace-nowrap [&_td:first-child]:font-medium [&_td:first-child]:text-foreground/90',
          rest.className,
        )}
      >
        {children}
      </table>
    </div>
  )
})

/** 代码块 / Mermaid 渲染器
 *
 * 通过 useT('common') 把 copy/copied/zoomIn/zoomOut/resetZoom 文案注入到
 * @asci/ui 的 CodeBlock / MermaidBlock。共享 UI 包不依赖 i18n，由业务侧透传文案。
 */
function MarkdownPre({
  children: preChildren,
}: { children?: React.ReactNode }): React.ReactElement {
  const { t } = useT('common')
  const codeLabels = React.useMemo(() => ({
    copyLabel: t('copy'),
    copiedLabel: t('copied'),
  }), [t])
  const mermaidLabels = React.useMemo(() => ({
    ...codeLabels,
    zoomInLabel: t('zoomIn'),
    zoomOutLabel: t('zoomOut'),
    resetZoomLabel: t('resetZoom'),
  }), [codeLabels, t])

  const codeChild = React.Children.toArray(preChildren).find(
    (child): child is React.ReactElement =>
      React.isValidElement(child) && (child as React.ReactElement).type === 'code'
  ) as React.ReactElement | undefined

  if (codeChild) {
    const codeProps = codeChild.props as { className?: string; children?: React.ReactNode }
    if (codeProps.className?.includes('language-mermaid')) {
      const mermaidCode = extractText(codeProps.children).replace(/\n$/, '')
      return <MermaidBlock code={mermaidCode} {...mermaidLabels} />
    }
  }

  return <CodeBlock {...codeLabels}>{preChildren}</CodeBlock>
}

/** 行内代码 / 文件路径渲染器 */
const MarkdownInlineCode = React.memo(function MarkdownInlineCode({
  children: codeChildren,
  className: codeClassName,
  basePath,
  ...codeProps
}: React.HTMLAttributes<HTMLElement> & { basePath?: string }): React.ReactElement {
  if (codeClassName) {
    return <code className={codeClassName} {...codeProps}>{codeChildren}</code>
  }

  const text = typeof codeChildren === 'string' ? codeChildren : ''

  if (text) {
    if (isAbsoluteFilePath(text)) {
      return <FilePathChip filePath={text.trim()} />
    }
    if (basePath && isRelativeFilePath(text)) {
      return <FilePathChip filePath={text.trim()} basePath={basePath} />
    }
    // 整串恰为一个 DOI（可带 doi:/doi.org 前缀）→ DOI 芯片；含杂质的 code 不误染
    const doi = parseDoiExact(text)
    if (doi) {
      return <DoiChip doi={doi} />
    }
  }

  return (
    <code
      className={INLINE_LABEL_CLASS}
      {...codeProps}
      style={{ ...codeProps.style, ...INLINE_CHIP_STYLE }}
    >
      {codeChildren}
    </code>
  )
})

type MarkdownHeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

interface MarkdownHeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  tag: MarkdownHeadingTag
}

const MarkdownHeading = React.memo(function MarkdownHeading({
  tag: Tag,
  children,
  ...headingProps
}: MarkdownHeadingProps): React.ReactElement {
  const text = extractText(children).trim()
  const shouldAppendColon = text.length > 0 && !/[：:]\s*$/.test(text)
  return (
    <Tag {...headingProps}>
      {children}
      {shouldAppendColon ? '：' : null}
    </Tag>
  )
})

const MarkdownH1 = React.memo(function MarkdownH1(props: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <MarkdownHeading tag="h1" {...props} />
})

const MarkdownH2 = React.memo(function MarkdownH2(props: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <MarkdownHeading tag="h2" {...props} />
})

const MarkdownH3 = React.memo(function MarkdownH3(props: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <MarkdownHeading tag="h3" {...props} />
})

const MarkdownH4 = React.memo(function MarkdownH4(props: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <MarkdownHeading tag="h4" {...props} />
})

const MarkdownH5 = React.memo(function MarkdownH5(props: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <MarkdownHeading tag="h5" {...props} />
})

const MarkdownH6 = React.memo(function MarkdownH6(props: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return <MarkdownHeading tag="h6" {...props} />
})

/**
 * 探针：消息是否同时含 `[N]` 与 `<quote>` 邻近（综述引用规范形式）
 * - 命中才跑 transform，避免误伤网页抓取等含 `<quote>` 但非引用的内容
 * - 与 `transformQuoteCitations` Pass 1/2 的正则保持包含关系（前者宽松，后者严格）
 */
const QUOTE_PROBE_RE = /\[\d+\]\s*<quote>|<\/quote>\s*\[\d+\]/

/**
 * 探针：消息是否有 References 章节 + 至少一个 `[N]`（#448）。
 * 命中时即便没有 `[N]<quote>` 内联引用，也把裸 `[N]` 渲染成可点角标 → 点击在右栏打开来源
 * （有 quote 才额外高亮；没有就只打开）。对话流主 Agent 常用「裸 [N] + 末尾 References」格式。
 */
const REFERENCES_PROBE_RE = /^#{1,6}\s+§?\s*\d*\.?\s*References?\b/im

/** 使用 react-markdown 渲染 assistant 消息内容，代码块使用 Shiki 语法高亮 */
export const MessageResponse = React.memo(
  function MessageResponse({ children, className, basePath, remarkPlugins }: MessageResponseProps): React.ReactElement {
    // 合并内置 + 外部 remark 插件（保持引用稳定）；remarkUnverified / remarkDois 仅在探针命中时挂载
    const hasUnverified = UNVERIFIED_PROBE.test(children)
    const hasDois = DOI_PROBE_RE.test(children)
    const mergedRemarkPlugins = React.useMemo(() => {
      const extra: RemarkPluginFn[] = []
      if (hasUnverified) extra.push(remarkUnverified)
      if (hasDois) extra.push(remarkDois)
      if (remarkPlugins) extra.push(...remarkPlugins)
      return extra.length > 0 ? [...REMARK_PLUGINS, ...extra] : REMARK_PLUGINS
    }, [hasUnverified, hasDois, remarkPlugins])

    // 引用预处理：[N]<quote>X</quote> → [[N]](#asci-cite-…)，裸 [N] → 弱角标。
    // 探针式短路：含 [N]<quote> 内联引用，或「有 References 章节 + 出现 [N]」时才跑 transform。
    const hasCitations =
      QUOTE_PROBE_RE.test(children) ||
      (REFERENCES_PROBE_RE.test(children) && /\[\d+\]/.test(children))
    const transformed = React.useMemo(
      () => (hasCitations ? transformQuoteCitations(children) : children),
      [hasCitations, children],
    )

    // #448 对话流溯源：解析 §7 References（含 doi）喂给 CitationBadge tooltip + 点击溯源
    const citationRefs = React.useMemo(
      () => (hasCitations ? parseReferences(children) : undefined),
      [hasCitations, children],
    )
    const openEvidence = useOpenEvidenceInRightPanel()
    const openDoi = useOpenDoiInRightPanel()
    // 点击对话流 Claim：用 §7 的 doi 解析论文 → 右栏打开 PDF 并高亮 quote；
    // 无本地 PDF（不在 Zotero / 无附件）→ 用同一 doi 兜底打开摘要卡片（永不死路、不弹 toast）；
    // 连 doi 都没有 → 回退到原"滚动到 §7"行为。
    const handleCitationTrace = React.useCallback<CitationTraceHandler>(
      ({ n, quote, meta, badgeEl }) => {
        const doi = meta?.doi
        if (!doi) {
          jumpToReferenceN(badgeEl, n)
          return
        }
        void openEvidence({ identifier: { doi }, quote, traceId: `conv:${n}:${quote.slice(0, 24)}` })
          .then((res) => {
            if (res.ok) return
            // PDF 不可用：兜底打开摘要卡片（useOpenDoiInRightPanel 三层兜底，含外链）。
            void openDoi(doi)
          })
          .catch(() => jumpToReferenceN(badgeEl, n))
      },
      [openEvidence, openDoi],
    )

    // 产物卡片：消息引用了「AI 产物文件」（cwd 内任意深度，含 searches/ 等子目录）时，
    // 在正文末尾渲染一张独立卡片（Codex 风）。不分场景；仅当有 basePath（会话 cwd）才检测。
    const deliverablePath = React.useMemo(
      () => (basePath && !hasDeliverableTableMarkdown(children) ? extractArtifactReference(children, basePath) : null),
      [children, basePath],
    )

    // 稳定引用的 components 对象，避免 react-markdown 每帧重建组件映射
    const components = React.useMemo(() => ({
      a: MarkdownLink,
      p: MarkdownParagraph,
      li: MarkdownListItem,
      pre: MarkdownPre,
      h1: MarkdownH1,
      h2: MarkdownH2,
      h3: MarkdownH3,
      h4: MarkdownH4,
      h5: MarkdownH5,
      h6: MarkdownH6,
      table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
        <MarkdownTable {...props} basePath={basePath} />
      ),
      code: (props: React.HTMLAttributes<HTMLElement>) => (
        <MarkdownInlineCode {...props} basePath={basePath} />
      ),
    }), [basePath])

    const rendered = (
      <div
        // 文档内引用跳转的查询根 —— 命中时 [N] click 在此容器内 querySelector('[data-asci-ref-n]')
        // 没有 citations 的消息不加，避免 query 时把无关消息也包括进来
        {...(hasCitations ? { 'data-asci-citations-root': true } : {})}
        className={cn(
          'prose dark:prose-invert max-w-none text-[14px] text-foreground/85',
          'prose-p:my-2 prose-p:leading-[1.7] prose-ul:my-3 prose-ol:my-3 prose-li:my-1.5 prose-li:leading-[1.7] prose-pre:my-0 prose-headings:mt-6 prose-headings:mb-2 prose-headings:text-[14px] prose-headings:font-medium prose-headings:leading-[1.6] prose-headings:text-foreground/90 prose-hr:hidden',
          '[&_li::marker]:text-foreground/70',
          '[&_.code-block-wrapper+.code-block-wrapper]:mt-4',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          className
        )}
      >
        <Markdown
          remarkPlugins={mergedRemarkPlugins}
          rehypePlugins={REHYPE_PLUGINS}
          urlTransform={mentionUrlTransform}
          components={components}
        >
          {transformed}
        </Markdown>
        {deliverablePath && <ArtifactCard path={deliverablePath} />}
      </div>
    )

    // 无引用：直接返回，零 context 开销。有引用：注入 §7 元数据 + 对话流溯源点击处理器。
    if (!hasCitations || !citationRefs) return rendered
    return (
      <CitationReferencesContext.Provider value={citationRefs}>
        <CitationTraceContext.Provider value={handleCitationTrace}>
          {rendered}
        </CitationTraceContext.Provider>
      </CitationReferencesContext.Provider>
    )
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.basePath === nextProps.basePath &&
    prevProps.remarkPlugins === nextProps.remarkPlugins
)

// ===== UserMessageContent 可折叠用户消息 =====

/** 折叠行数阈值 */
const COLLAPSE_LINE_THRESHOLD = 4

/** 用户消息专用 remark 插件（mention chip + 保留换行） */
const USER_REMARK_PLUGINS: RemarkPluginFn[] = [remarkMentions, remarkPreserveBreaks]

interface UserMessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children: string
}

/**
 * 用户消息内容组件
 * - 超过 4 行时默认折叠
 * - 点击展开/收起，带渐变遮罩
 */
export const UserMessageContent = React.memo(
  function UserMessageContent({ children, className, ...props }: UserMessageContentProps): React.ReactElement {
    const { t } = useT('conversation')
    const { scrollRef, stopScroll } = useStickToBottomContext()
    const [isExpanded, setIsExpanded] = React.useState(false)
    const [shouldCollapse, setShouldCollapse] = React.useState(false)
    const contentRef = React.useRef<HTMLDivElement>(null)
    const rootRef = React.useRef<HTMLDivElement>(null)
    // 展开/收起前记录本气泡相对滚动容器的顶部位置，布局后复原 —— 避免视口跳动
    const anchorRef = React.useRef<{ scrollTop: number; offsetTop: number } | null>(null)

    // 检测内容是否超过阈值行数。
    // 行高取自渲染出的首个子元素（prose <p>，带 leading-[1.6]），
    // 而非外层 wrapper（无显式 line-height，computed 可能为 'normal'）。
    // line-clamp 不影响 scrollHeight，故折叠态下该检测仍读到完整内容高度。
    React.useEffect(() => {
      if (!contentRef.current) return

      const element = contentRef.current
      const lineSource = (element.firstElementChild as HTMLElement | null) ?? element
      const lineHeight = parseFloat(getComputedStyle(lineSource).lineHeight)
      if (!Number.isFinite(lineHeight)) return
      const maxHeight = lineHeight * COLLAPSE_LINE_THRESHOLD

      // scrollHeight 超过最大高度 + 容差时折叠
      setShouldCollapse(element.scrollHeight > maxHeight + 10)
    }, [children])

    const toggleExpand = React.useCallback(() => {
      const scroller = scrollRef.current
      const root = rootRef.current
      if (scroller && root) {
        // 记录气泡顶部相对滚动容器视口的位置
        const offsetTop = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        anchorRef.current = { scrollTop: scroller.scrollTop, offsetTop }
      }
      setIsExpanded((prev) => !prev)
    }, [scrollRef])

    // 布局后复原锚点：让气泡顶部停在切换前的同一视口位置，并中断 stick-to-bottom 的弹簧滚动
    React.useLayoutEffect(() => {
      const anchor = anchorRef.current
      const scroller = scrollRef.current
      const root = rootRef.current
      if (!anchor || !scroller || !root) return
      anchorRef.current = null
      const newOffsetTop = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      scroller.scrollTop = anchor.scrollTop + (newOffsetTop - anchor.offsetTop)
      stopScroll()
    }, [isExpanded, scrollRef, stopScroll])

    return (
      <div ref={rootRef} className={cn('relative inline-block max-w-full rounded-[10px] bg-primary/10 px-3.5 py-2.5', className)} {...props}>
        <div
          ref={contentRef}
          className={cn(
            '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            // 折叠时用 line-clamp 精确裁到 4 整行（纯 CSS，不会腰斩到半行）
            shouldCollapse && !isExpanded && 'line-clamp-4'
          )}
        >
          <MessageResponse className="prose-p:my-0.5 prose-headings:my-1.5" remarkPlugins={USER_REMARK_PLUGINS}>{children}</MessageResponse>
        </div>
        {shouldCollapse && (
          <Button
            type="button"
            variant="subtle"
            size="inline"
            onClick={toggleExpand}
            className="gap-1 text-xs text-foreground/40 hover:text-foreground/70 mt-2"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="!size-3" />
                <span>{t('message.collapse')}</span>
              </>
            ) : (
              <>
                <ChevronDown className="!size-3" />
                <span>{t('message.expandAll')}</span>
              </>
            )}
          </Button>
        )}
      </div>
    )
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
)

// ===== MessageLoading 加载动画 =====

type MessageLoadingProps = HTMLAttributes<HTMLDivElement> & { startedAt?: number }

/** 等待首个 chunk 的加载动画 */
export function MessageLoading({ className, startedAt, ...props }: MessageLoadingProps): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <div className={cn('mt-0', className)} {...props}>
      <LoadingIndicator
        label={t('message.thinking')}
        size="sm"
        showElapsed={startedAt || true}
        className="text-muted-foreground/60"
      />
    </div>
  )
}

// ===== MessageStopped 已停止生成 =====

type MessageStoppedProps = HTMLAttributes<HTMLDivElement>

/** "已停止生成" 状态标记 */
export function MessageStopped({ className, ...props }: MessageStoppedProps): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <div
      className={cn('flex items-center gap-1.5 text-sm text-muted-foreground mt-2', className)}
      {...props}
    >
      <span className="size-2 rounded-full bg-muted-foreground/40" />
      <span>{t('message.stopped')}</span>
    </div>
  )
}

// ===== MessageAttachments 消息附件展示 =====

interface MessageAttachmentsProps extends HTMLAttributes<HTMLDivElement> {
  /** 附件列表 */
  attachments: FileAttachment[]
}

/** 消息附件容器 */
export function MessageAttachments({
  attachments,
  className,
  ...props
}: MessageAttachmentsProps): React.ReactElement {
  const imageAttachments = attachments.filter((att) => att.mediaType.startsWith('image/'))
  const fileAttachments = attachments.filter((att) => !att.mediaType.startsWith('image/'))
  const isSingleImage = imageAttachments.length === 1 && fileAttachments.length === 0

  return (
    <div className={cn('flex flex-col gap-2 mb-2', className)} {...props}>
      {/* 图片附件 */}
      {imageAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {imageAttachments.map((att) => (
            <MessageAttachmentImage key={att.id} attachment={att} isSingle={isSingleImage} />
          ))}
        </div>
      )}
      {/* 文件附件 */}
      {fileAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileAttachments.map((att) => (
            <MessageAttachmentFile key={att.id} attachment={att} />
          ))}
        </div>
      )}
    </div>
  )
}

// ===== MessageAttachmentImage 图片附件展示 =====

interface MessageAttachmentImageProps {
  attachment: FileAttachment
  /** 是否为唯一附件（单图模式） */
  isSingle?: boolean
}

/** 图片附件展示（单图: max 500px，多图: 280px 方块），点击可预览大图 */
function MessageAttachmentImage({ attachment, isSingle = false }: MessageAttachmentImageProps): React.ReactElement {
  const { t } = useT('conversation')
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI
      .readAttachment(attachment.localPath)
      .then((base64) => {
        setImageSrc(`data:${attachment.mediaType};base64,${base64}`)
      })
      .catch((error) => {
        console.error('[MessageAttachmentImage] 读取附件失败:', error)
      })
  }, [attachment.localPath, attachment.mediaType])

  /** 保存图片到本地 */
  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(attachment.localPath, attachment.filename)
  }, [attachment.localPath, attachment.filename])

  if (!imageSrc) {
    return (
      <div className={cn(
        'rounded-lg bg-muted/30 animate-pulse shrink-0',
        isSingle ? 'w-[280px] h-[200px]' : 'size-[280px]'
      )} />
    )
  }

  const imgElement = isSingle ? (
    <img
      src={imageSrc}
      alt={attachment.filename}
      className="max-w-[500px] max-h-[min(500px,50vh)] rounded-lg object-contain cursor-pointer"
      onClick={() => setLightboxOpen(true)}
    />
  ) : (
    <img
      src={imageSrc}
      alt={attachment.filename}
      className="size-[280px] rounded-lg object-cover shrink-0 cursor-pointer"
      onClick={() => setLightboxOpen(true)}
    />
  )

  return (
    <div className="relative group inline-block">
      {imgElement}
      <Button
        type="button"
        variant="overlay"
        onClick={handleSave}
        className="absolute bottom-2 right-2 h-auto p-1.5 backdrop-blur-none opacity-0 group-hover:opacity-100 transition-opacity"
        title={t('message.saveImage')}
      >
        <Download className="size-4" />
      </Button>
      <ImageLightbox
        src={imageSrc}
        alt={attachment.filename}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onSave={handleSave}
      />
    </div>
  )
}

// ===== MessageAttachmentFile 文件附件展示 =====

interface MessageAttachmentFileProps {
  attachment: FileAttachment
}

/** 文件附件展示（标签样式，teal 色调） */
function MessageAttachmentFile({ attachment }: MessageAttachmentFileProps): React.ReactElement {
  /** 截断文件名 */
  const displayName = attachment.filename.length > 20
    ? attachment.filename.slice(0, 17) + '...'
    : attachment.filename

  return (
    <div className="flex items-center gap-2 rounded-lg bg-[#37a5aa]/10 border border-[#37a5aa]/20 px-3 py-1.5 text-sm text-[#37a5aa] shrink-0">
      <Paperclip className="size-4" />
      <span>{displayName}</span>
    </div>
  )
}

// ===== StreamingIndicator 流式呼吸脉冲点 =====

type StreamingIndicatorProps = HTMLAttributes<HTMLSpanElement>

/** 流式生成中的呼吸脉冲点指示器 */
export function StreamingIndicator({ className, ...props }: StreamingIndicatorProps): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full bg-primary/60 animate-pulse ml-1 align-middle',
        className
      )}
      {...props}
    />
  )
}

// ===== 导出带文本选择功能的组件 =====
export { SelectableMessageResponse } from './selectable-message-response'
