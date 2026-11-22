/**
 * AI Elements - TipTap 富文本输入组件
 *
 * 独立受控组件，不依赖 PromptInput Provider。
 *
 * 功能：
 * - StarterKit + Placeholder + Underline + Link + CodeBlockLowlight
 * - 可选 Mention 扩展（@ 引用文件、/ 触发 Skill、# 触发 MCP）
 * - htmlToMarkdown 转换
 * - IME composition 处理
 * - Enter 提交 / Shift+Enter 换行
 * - 代码块内 Enter 换行例外
 * - 自动扩高
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { useAtom, useStore } from 'jotai'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import './rich-text-input-layout.css'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Mention from '@tiptap/extension-mention'
import { PastedBlock, decodePastedText } from './pasted-block-extension.tsx'
import { classifyPaste } from './paste-classify.ts'
import { PluginKey } from '@tiptap/pm/state'
import { common, createLowlight } from 'lowlight'
import { ChevronsDownUp, ChevronsUpDown, X, FileText, BookOpen, Folder, Layers } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { searchMessageTargetAtom } from '@/atoms/search-atoms'
import { pendingQuoteAtom } from '@/atoms/text-selection-atoms'
import { createAtMentionSuggestion } from '@/components/agent/at-mention-suggestion'
import type { AtMentionStatus } from '@/components/agent/AtMentionPanel'
import type { MentionKind } from '@asci/shared'
import { createSkillMentionSuggestion, createMcpMentionSuggestion } from '@/components/agent/mention-suggestions'

// 创建 lowlight 实例，使用常见语言
const lowlight = createLowlight(common)

/**
 * 根据键盘修饰键与发送模式判定：是否发送、是否打断重定向。
 * 打断手势 = 发送手势 + ⌥(Option/Alt)；两种 sendWithCmdEnter 模式统一。
 */
export function resolveSendIntent(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  cmdEnterMode: boolean,
): { isSend: boolean; interrupt: boolean } {
  const hasCmd = e.metaKey || e.ctrlKey
  const hasShift = e.shiftKey
  const isSend = cmdEnterMode ? hasCmd : (!hasShift && !hasCmd)
  return { isSend, interrupt: isSend && e.altKey }
}

// ===== HTML → Markdown 转换 =====

/** 将 TipTap 输出的 HTML 转换为 Markdown 格式 */
export function htmlToMarkdown(html: string): string {
  if (!html || html === '<p></p>') return ''

  const div = document.createElement('div')
  div.innerHTML = html

  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || ''
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ''
    }

    const el = node as HTMLElement

    // PastedBlock：data-pasted-text 承载完整原文，发送时原位还原（解码）
    if (el.hasAttribute('data-pasted-text')) {
      return decodePastedText(el.getAttribute('data-pasted-text') || '')
    }

    const tagName = el.tagName.toLowerCase()
    const children = Array.from(el.childNodes).map(processNode).join('')

    switch (tagName) {
      case 'p':
        return children + '\n'
      case 'br':
        return '\n'
      case 'strong':
      case 'b':
        return `**${children}**`
      case 'em':
      case 'i':
        return `*${children}*`
      case 'u':
        return `<u>${children}</u>`
      case 's':
      case 'strike':
      case 'del':
        return `~~${children}~~`
      case 'code':
        // 检查是否在 pre 内（代码块）
        if (el.parentElement?.tagName.toLowerCase() === 'pre') {
          return children
        }
        return `\`${children}\``
      case 'pre': {
        // 代码块 - 获取语言类型
        const codeEl = el.querySelector('code')
        const langClass = codeEl?.className || ''
        const langMatch = langClass.match(/language-(\w+)/)
        const lang = langMatch ? langMatch[1] : ''
        const codeContent = codeEl ? processNode(codeEl) : children
        return `\`\`\`${lang}\n${codeContent}\n\`\`\`\n`
      }
      case 'a': {
        const href = el.getAttribute('href') || ''
        return `[${children}](${href})`
      }
      case 'ul':
        return Array.from(el.children)
          .map((li) => `- ${processNode(li).trim()}`)
          .join('\n') + '\n'
      case 'ol':
        return Array.from(el.children)
          .map((li, i) => `${i + 1}. ${processNode(li).trim()}`)
          .join('\n') + '\n'
      case 'li':
        return children
      case 'blockquote':
        return children
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n') + '\n'
      case 'h1': return `# ${children}\n`
      case 'h2': return `## ${children}\n`
      case 'h3': return `### ${children}\n`
      case 'h4': return `#### ${children}\n`
      case 'h5': return `##### ${children}\n`
      case 'h6': return `###### ${children}\n`
      case 'hr': return '---\n'
      case 'span': {
        // Mention 节点：根据 data-mention-suggestion-char 和 data-mention-kind 区分类型
        const dataType = el.getAttribute('data-type')
        const dataId = el.getAttribute('data-id') || ''
        const suggestionChar = el.getAttribute('data-mention-suggestion-char') || '@'
        const kind = el.getAttribute('data-mention-kind') || 'file'
        if (dataType === 'mention') {
          if (suggestionChar === '/') return `/skill:${dataId}`
          if (suggestionChar === '#') return `#mcp:${dataId}`
          if (kind === 'zotero-item') {
            const label = el.getAttribute('data-label') ?? ''
            return label ? `@zotero-item:${dataId}|${encodeURIComponent(label)}` : `@zotero-item:${dataId}`
          }
          if (kind === 'zotero-col') {
            const label = el.getAttribute('data-label') ?? ''
            return label ? `@zotero-col:${dataId}|${encodeURIComponent(label)}` : `@zotero-col:${dataId}`
          }
          return `@file:${dataId}`
        }
        return children
      }
      default: return children
    }
  }

  return processNode(div).trim()
}

// ===== Markdown mention token → chip HTML 还原 =====
// 无 HTML 草稿时从 Markdown 兜底恢复输入框：把序列化的 mention token 还原为 chip <span>，
// 让 TipTap 解析为 Mention 节点；产出的结构与 Mention.renderHTML 完全一致，
// 可被 htmlToMarkdown 原样反序列化回 token（round-trip 不变）。

/** 转义 HTML 特殊字符，避免注入 chip 属性/文本时破坏结构或 XSS */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

interface ParsedMentionToken { char: '@' | '/' | '#'; kind: MentionKind; id: string; label: string }

// 与 message.tsx MENTION_PATTERN 同一套 token 语法（本地副本，避免跨模块共享 lastIndex）
const COMPOSER_MENTION_PATTERN =
  /@file:(\S+)|\/skill:(\S+)|#mcp:(\S+)|@zotero-item:(\S+)|@zotero-col:(\S+)/g

function parseMentionMatch(m: RegExpExecArray): ParsedMentionToken {
  if (m[1]) return { char: '@', kind: 'file', id: m[1], label: m[1] }
  if (m[2]) return { char: '/', kind: 'file', id: m[2], label: m[2] }
  if (m[3]) return { char: '#', kind: 'file', id: m[3], label: m[3] }
  const raw = (m[4] ?? m[5]) as string // 正则保证 m[4]/m[5] 必有其一
  const kind: MentionKind = m[4] ? 'zotero-item' : 'zotero-col'
  // zotero token 形如 KEY 或 KEY|urlEncoded(label)；镜像 message.tsx MentionChip 解码
  const pipeIdx = raw.indexOf('|')
  if (pipeIdx > 0) {
    const id = raw.slice(0, pipeIdx)
    let label = raw.slice(pipeIdx + 1)
    try { label = decodeURIComponent(label) } catch { /* 解码失败保留原串 */ }
    return { char: '@', kind, id, label }
  }
  return { char: '@', kind, id: raw, label: raw } // 老格式无 |label，回退 id
}

/** 根据 mention 信息生成与 Mention.renderHTML 一致的 chip <span> HTML */
function mentionChipHtml({ char, kind, id, label }: ParsedMentionToken): string {
  let chipClass = 'mention-chip'
  if (char === '/') chipClass = 'skill-mention-chip'
  else if (char === '#') chipClass = 'mcp-mention-chip'
  else if (kind === 'zotero-item') chipClass = 'zotero-item-mention-chip'
  else if (kind === 'zotero-col') chipClass = 'zotero-col-mention-chip'
  const prefix = char === '@' ? '@' : ''      // 仅 @ 带前缀，与 renderHTML 一致
  const display = escapeHtml(`${prefix}${label}`)
  return `<span data-type="mention" data-id="${escapeHtml(id)}" data-label="${escapeHtml(label)}"`
    + ` data-mention-suggestion-char="${escapeHtml(char)}" data-mention-kind="${kind}"`
    + ` class="${chipClass}" title="${display}"><span class="mention-chip-label">${display}</span></span>`
}

/** 把含 mention token 的 Markdown 文本转 HTML：token→chip span，其余文本转义后保留 */
function mentionTokensToHtml(text: string): string {
  COMPOSER_MENTION_PATTERN.lastIndex = 0
  let out = '', lastIdx = 0
  let m: RegExpExecArray | null
  while ((m = COMPOSER_MENTION_PATTERN.exec(text)) !== null) {
    if (m.index > lastIdx) out += escapeHtml(text.slice(lastIdx, m.index))
    out += mentionChipHtml(parseMentionMatch(m))
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) out += escapeHtml(text.slice(lastIdx))
  return out
}

/** 含 mention token 的多段 Markdown → TipTap 可解析 HTML：
 *  按空行分段→每段 token 还原 chip、其余转义、单换行转 <br>，外层包 <p>。
 *  草稿兜底恢复与粘贴拦截共用，确保两处产出结构完全一致。 */
function markdownToEditorHtml(text: string): string {
  return text.split(/\n\n+/)
    .map(para => `<p>${mentionTokensToHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// ===== 行数计算 =====

/** 计算编辑器内容的行数 */
function countEditorLines(editor: ReturnType<typeof useEditor>): number {
  if (!editor) return 0

  const doc = editor.state.doc
  let lineCount = 0

  doc.descendants((node) => {
    if (node.type.name === 'paragraph') {
      const text = node.textContent
      if (!text) {
        lineCount += 1
      } else {
        // 粗略估算：假设每行约50个字符
        lineCount += Math.max(1, Math.ceil(text.length / 50))
      }
    } else if (node.type.name === 'codeBlock') {
      const text = node.textContent
      lineCount += (text.match(/\n/g) || []).length + 1
    } else if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
      node.descendants((child) => {
        if (child.type.name === 'listItem') {
          lineCount += 1
        }
      })
    }
  })

  return lineCount
}

// ===== 组件接口 =====

interface RichTextInputProps {
  /** 当前值（Markdown） */
  value: string
  /** 值变更回调 */
  onChange: (markdown: string) => void
  /** 提交回调（Enter 键）；interrupt=true 表示「发送键 + ⌥」打断重定向手势 */
  onSubmit: (opts?: { interrupt?: boolean }) => void
  /** 粘贴文件回调（拦截粘贴的文件） */
  onPasteFiles?: (files: File[]) => void
  /** 占位文字 */
  placeholder?: string
  /**
   * 轮播占位后缀：传入后，空态下用自定义覆盖层依次滚动展示这些后缀（介绍快捷键），
   * 而非静态 placeholder。省略则用 placeholder。
   */
  rotatingPlaceholders?: string[]
  /** 轮播占位的固定前缀（如「输入」），静止不滚动，只有后缀滚动 */
  rotatingPrefix?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 自动聚焦触发器（当此值变化时自动聚焦，通常传入对话 ID） */
  autoFocusTrigger?: string | null
  /** 是否支持手动折叠（内容较长时显示折叠按钮） */
  collapsible?: boolean
  /** 工作区根路径（启用 @ 引用文件功能时需要） */
  workspacePath?: string | null
  /** 工作区 slug（启用 / Skill 和 # MCP 功能时需要） */
  workspaceSlug?: string | null
  /** 当前 agent workspace id（启用 @ 引用证据集功能时需要，issue #449） */
  workspaceId?: string | null
  /** 附加目录路径列表（@ 引用时一并搜索） */
  attachedDirs?: string[]
  /** Zotero 启用状态（控制 @ 下拉里 Zotero Tab 可见性） */
  zoteroEnabled?: boolean
  /** Zotero 运行状态（控制 Zotero Tab body 降级态） */
  zoteroRunning?: boolean
  /** 选中 Zotero 条目时的回调（AgentView 侧负责缓存 + PDF 附挂） */
  onZoteroItemSelect?: (item: import('@asci/core/zotero').ItemSummary) => void
  /** 选中 Zotero 类目时的回调（AgentView 侧可不实现；面板已插 Chip） */
  onZoteroCollectionSelect?: (col: { key: string; name: string; path: string }) => void
  /** 启动 Zotero app（Zotero 未运行时面板内按钮） */
  onLaunchZotero?: () => void
  /** HTML 草稿值（切换会话恢复时使用，保留 mention 等富文本结构） */
  htmlValue?: string
  /** HTML 值变更回调（用于保存富文本草稿） */
  onHtmlChange?: (html: string) => void
  /** 是否使用 Cmd/Ctrl+Enter 发送（而非 Enter） */
  sendWithCmdEnter?: boolean
  /** 外部触发 @ 引用面板的信号（值变化时插入 @ 字符并聚焦编辑器） */
  mentionTriggerSignal?: number
  /** Tab 键填入内容：输入框为空 + 编辑器聚焦时，按 Tab 将此文本插入编辑器 */
  tabFillValue?: string | null
  /** Tab 填入完成后的回调（用于外部清理 suggestion 状态） */
  onTabFill?: () => void
  /** 待发送 mention 列表（@ 选中后挂在编辑器上方，不再 inline） */
  pendingMentions?: ReadonlyArray<{ kind: MentionKind; id: string; label: string }>
  /** Mention 选中回调（pendingMentions 增项） */
  onMentionAdd?: (mention: { kind: MentionKind; id: string; label: string }) => void
  /** Mention 移除回调（点 chip 上的 × 或 Backspace） */
  onMentionRemove?: (kind: MentionKind, id: string) => void
  className?: string
}

/**
 * 富文本输入组件
 * - 基于 TipTap 的 WYSIWYG 编辑器
 * - 支持 Markdown 快捷输入
 * - 无工具栏，纯净输入体验
 */
export function RichTextInput({
  value,
  onChange,
  onSubmit,
  onPasteFiles,
  placeholder,
  rotatingPlaceholders,
  rotatingPrefix,
  className,
  disabled = false,
  autoFocusTrigger,
  collapsible = false,
  workspacePath,
  workspaceSlug,
  workspaceId,
  attachedDirs = [],
  zoteroEnabled = false,
  zoteroRunning = false,
  onZoteroItemSelect,
  onZoteroCollectionSelect,
  onLaunchZotero,
  htmlValue,
  onHtmlChange,
  sendWithCmdEnter = false,
  mentionTriggerSignal,
  tabFillValue,
  onTabFill,
  pendingMentions,
  onMentionAdd,
  onMentionRemove,
}: RichTextInputProps): React.ReactElement {
  const { t } = useT('conversation')
  // 轮播占位启用时，把 tiptap 内建 placeholder 置空（改由下方自定义覆盖层渲染 + 动画）
  const useRotating = !!rotatingPlaceholders && rotatingPlaceholders.length > 0
  const resolvedPlaceholder = useRotating ? '' : (placeholder ?? t('input.placeholder'))
  // ref-based placeholder lookup: Placeholder.configure 接受函数形式，
  // 每次装饰渲染回调读取最新 ref，规避 useEditor 仅初始化一次的字符串快照
  const placeholderRef = useRef(resolvedPlaceholder)
  placeholderRef.current = resolvedPlaceholder
  // 保持 onMentionAdd 引用最新（factory 是 useMemo 稳定的，通过 ref 拿最新回调）
  const onMentionAddRef = useRef(onMentionAdd)
  onMentionAddRef.current = onMentionAdd

  // 轮播占位：空态（无文本 + 无 mention chip）下才展示；定时推进索引触发滚入动画
  const isEmptyForPlaceholder =
    value.trim().length === 0 && (!pendingMentions || pendingMentions.length === 0)
  const [rotIdx, setRotIdx] = useState(0)
  useEffect(() => {
    if (!useRotating || (rotatingPlaceholders?.length ?? 0) <= 1) return
    const id = setInterval(() => setRotIdx((i) => i + 1), 3000)
    return () => clearInterval(id)
  }, [useRotating, rotatingPlaceholders?.length])
  const [isExpanded, setIsExpanded] = useState(false)
  // 手动折叠状态：用户主动折叠输入框
  const [isManuallyCollapsed, setIsManuallyCollapsed] = useState(false)

  // 监听 pendingQuote atom，插入引用到编辑器
  const store = useStore()
  const [pendingQuote, setPendingQuote] = useAtom(pendingQuoteAtom)
  // 跟踪编辑器自己设置的值，用于区分外部设置和内部更新
  const lastEditorValueRef = useRef<string>('')
  // 跟踪 IME 输入状态（中文输入法等）
  const isComposingRef = useRef(false)
  // 保持 onSubmit 引用最新
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  // 保持 onPasteFiles 引用最新
  const onPasteFilesRef = useRef(onPasteFiles)
  onPasteFilesRef.current = onPasteFiles
  // 保持 onHtmlChange 引用最新
  const onHtmlChangeRef = useRef(onHtmlChange)
  onHtmlChangeRef.current = onHtmlChange
  // 发送模式引用
  const sendWithCmdEnterRef = useRef(sendWithCmdEnter)
  sendWithCmdEnterRef.current = sendWithCmdEnter
  // Tab 填入内容与回调的最新引用
  const tabFillValueRef = useRef<string | null | undefined>(tabFillValue)
  tabFillValueRef.current = tabFillValue
  const onTabFillRef = useRef(onTabFill)
  onTabFillRef.current = onTabFill
  // Mention 活跃状态（阻止 Enter 发送消息）
  const mentionActiveRef = useRef(false)
  // Mention 弹窗中的可选项数量（0 时 Enter 不阻塞发送）
  const mentionItemCountRef = useRef(0)
  // 工作区路径引用（给 Suggestion 使用）
  const workspacePathRef = useRef<string | null>(workspacePath ?? null)
  workspacePathRef.current = workspacePath ?? null
  // 工作区 id 引用（给证据集 @ Suggestion 使用）
  const workspaceIdRef = useRef<string | null>(workspaceId ?? null)
  workspaceIdRef.current = workspaceId ?? null
  // 附加目录路径引用（给 Suggestion 使用）
  const attachedDirsRef = useRef<string[]>(attachedDirs)
  attachedDirsRef.current = attachedDirs
  // 工作区 slug 引用（给 Skill/MCP Suggestion 使用）
  const workspaceSlugRef = useRef<string | null>(workspaceSlug ?? null)
  workspaceSlugRef.current = workspaceSlug ?? null

  // Zotero 状态 getter refs（让 Suggestion 每次获取最新状态）
  const zoteroEnabledRef = useRef(zoteroEnabled)
  zoteroEnabledRef.current = zoteroEnabled
  const zoteroRunningRef = useRef(zoteroRunning)
  zoteroRunningRef.current = zoteroRunning
  const onZoteroItemSelectRef = useRef(onZoteroItemSelect)
  onZoteroItemSelectRef.current = onZoteroItemSelect
  const onZoteroCollectionSelectRef = useRef(onZoteroCollectionSelect)
  onZoteroCollectionSelectRef.current = onZoteroCollectionSelect
  const onLaunchZoteroRef = useRef(onLaunchZotero)
  onLaunchZoteroRef.current = onLaunchZotero

  // Mention PluginKey（稳定引用）：@ suggestion 的具名 PluginKey。
  // TipTap Mention 为 suggestions[] 每个条目内部创建独立 PluginKey，
  // 必须把同一个 key 同时注入工厂配置与 suggestions 条目，
  // 工厂里的 exitSuggestion(view, key) 才能命中激活插件完成关闭。
  const atMentionPluginKey = useMemo(() => new PluginKey('asci-at-mention'), [])

  // Mention Suggestion 配置（稳定引用，不随 workspacePath 变化重建）
  const mentionSuggestion = useMemo(
    () => createAtMentionSuggestion({
      workspacePathRef,
      workspaceIdRef,
      attachedDirsRef,
      mentionActiveRef,
      mentionItemCountRef,
      pluginKey: atMentionPluginKey,
      getStatus: (): AtMentionStatus => ({
        zoteroEnabled: zoteroEnabledRef.current,
        zoteroRunning: zoteroRunningRef.current,
      }),
      onItemSelect: (item) => onZoteroItemSelectRef.current?.(item),
      onCollectionSelect: (col) => onZoteroCollectionSelectRef.current?.(col),
      onLaunchZotero: () => onLaunchZoteroRef.current?.(),
      onMentionAdd: (m) => onMentionAddRef.current?.(m),
    }),
    [atMentionPluginKey],
  )

  // Skill Suggestion 配置（/ 触发）
  const skillSuggestion = useMemo(
    () => createSkillMentionSuggestion(workspaceSlugRef, mentionActiveRef, mentionItemCountRef),
    [],
  )

  // MCP Suggestion 配置（# 触发）
  const mcpSuggestion = useMemo(
    () => createMcpMentionSuggestion(workspaceSlugRef, mentionActiveRef, mentionItemCountRef),
    [],
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // 使用 CodeBlockLowlight 替代
        // TipTap v3 StarterKit 默认包含 Link 和 Underline
        // 禁用内置版本，使用下面单独配置的版本
        link: false,
        underline: false,
        // F43：拖拽走外层 dropzone（AgentView handleDrop），编辑器内不需要 drop 指示器
        dropcursor: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline',
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'rounded-md p-3 text-sm',
        },
      }),
      Placeholder.configure({
        // 函数形式：每次装饰渲染回调读取 ref，i18n 语言切换后下次重绘即生效
        placeholder: () => placeholderRef.current,
        emptyEditorClass: 'is-editor-empty',
      }),
      // Mention 扩展无条件加载：@ 引用文件 / 文献库、/ 触发 Skill、# 触发 MCP。
      // 即便没有工作区路径或 slug 也保留 popup 可弹出 ——
      // - @ 文献库不依赖工作区，正常可用
      // - @ 项目文件在 fetchItemsForLevel 已用 `if (!wsPath) return []` 兜底为空列表
      // - / # 同理，缺 workspaceSlug 时退化为空列表，不阻塞 popup 弹出
      Mention.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              mentionSuggestionChar: {
                default: '@',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-suggestion-char') || '@',
                renderHTML: (attrs: Record<string, string>) => ({
                  'data-mention-suggestion-char': attrs.mentionSuggestionChar,
                }),
              },
              kind: {
                default: 'file',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-kind') || 'file',
                renderHTML: (attrs: Record<string, string>) => ({
                  'data-mention-kind': attrs.kind,
                }),
              },
            }
          },
        }).configure({
          HTMLAttributes: {},
          renderHTML({ node, suggestion }) {
            const char = suggestion?.char ?? node.attrs.mentionSuggestionChar ?? '@'
            const label = node.attrs.label ?? node.attrs.id
            let chipClass = 'mention-chip'
            if (char === '/') chipClass = 'skill-mention-chip'
            else if (char === '#') chipClass = 'mcp-mention-chip'
            else {
              const kind = node.attrs.kind ?? 'file'
              if (kind === 'zotero-item') chipClass = 'zotero-item-mention-chip'
              else if (kind === 'zotero-col') chipClass = 'zotero-col-mention-chip'
            }
            return [
              'span',
              {
                'data-type': 'mention',
                'data-id': node.attrs.id,
                'data-label': node.attrs.label,
                'data-mention-suggestion-char': char,
                'data-mention-kind': node.attrs.kind ?? 'file',
                class: chipClass,
                title: `${char === '@' ? '@' : ''}${label}`,
              },
              ['span', { class: 'mention-chip-label' }, `${char === '@' ? '@' : ''}${label}`],
            ]
          },
          suggestions: [
            mentionSuggestion,
            skillSuggestion,
            mcpSuggestion,
          ],
        }),
      PastedBlock,
    ],
    content: value || '',
    editable: !disabled,
    editorProps: {
      attributes: {
        class: cn(
          'prose dark:prose-invert max-w-none focus:outline-none',
          'min-h-[101px] w-full',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
          '[&_pre]:rounded-md [&_pre]:p-3',
          '[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm [&_code]:text-foreground',
          '[&_pre_code]:bg-transparent [&_pre_code]:p-0'
        ),
      },
      // 监听 IME 输入状态
      handleDOMEvents: {
        compositionstart: () => {
          isComposingRef.current = true
          return false
        },
        compositionend: () => {
          isComposingRef.current = false
          return false
        },
        // #84 Windows IME 顽症兜底：失焦时 Windows 部分 IME（搜狗 / 微软拼音）
        // 不会触发 compositionend，导致 isComposingRef 永远 stuck 在 true，
        // Enter 永久被阻塞 → 用户表象"输入框被吃掉、需重启"。
        // editor 失焦时不可能继续 IME 组词，mention popup 也应一并清空。
        blur: () => {
          isComposingRef.current = false
          mentionActiveRef.current = false
          mentionItemCountRef.current = 0
          return false
        },
        // 重新聚焦时无残留组词态（focus 切换会被浏览器自动 commit composition）
        focus: () => {
          isComposingRef.current = false
          return false
        },
        copy: (_view, event) => {
          // 复制时只写纯文本，避免粘贴到外部应用时出现多余空行
          const selection = window.getSelection()
          if (!selection || selection.isCollapsed || !event.clipboardData) return false
          const range = selection.getRangeAt(0)
          const fragment = range.cloneContents()
          const tempDiv = document.createElement('div')
          tempDiv.appendChild(fragment)
          const text = htmlToMarkdown(tempDiv.innerHTML) || selection.toString()
          event.preventDefault()
          event.clipboardData.setData('text/plain', text)
          event.clipboardData.setData('text/html', '')
          return true
        },
      },
      handlePaste: (_view, event) => {
        // 1) 拦截粘贴的文件（图片等）
        const clipboardItems = event.clipboardData?.files
        if (clipboardItems && clipboardItems.length > 0 && onPasteFilesRef.current) {
          event.preventDefault()
          onPasteFilesRef.current(Array.from(clipboardItems))
          return true
        }
        // 2) 拦截含 mention token 的纯文本：复制聊天气泡/输入框得到带
        //    @file:/@zotero-item: 等序列化 token 的 markdown（copy handler 已清空 text/html），
        //    默认粘贴会显示成裸 token 长串。仅当文本确实含 token 时拦截，否则放行默认粘贴。
        const text = event.clipboardData?.getData('text/plain')
        if (text) {
          COMPOSER_MENTION_PATTERN.lastIndex = 0
          const hasToken = COMPOSER_MENTION_PATTERN.test(text)
          COMPOSER_MENTION_PATTERN.lastIndex = 0
          if (hasToken && editor) {
            const html = markdownToEditorHtml(text)
            event.preventDefault()
            editor.commands.insertContent(html) // 光标处插入，替换当前选区
            return true
          }
        }
        // 3) 超阈值长文本 → 折叠为 PASTED 卡片（仅粘贴触发；mention popup 激活时不接管）
        if (text && editor && !mentionActiveRef.current && classifyPaste(text).shouldCollapse) {
          event.preventDefault()
          editor.commands.insertPastedBlock(text)
          return true
        }
        return false
      },
      handleKeyDown: (view, event) => {
        // macOS 上 Cmd+B/S 被全局快捷键占用，用 Ctrl+B/S 作为格式化替代键
        const isMacOS = navigator.platform.startsWith('Mac')
        if (isMacOS && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          const key = event.key.toLowerCase()
          if (key === 'b') {
            event.preventDefault()
            editor?.chain().focus().toggleBold().run()
            return true
          }
          if (key === 's') {
            event.preventDefault()
            editor?.chain().focus().toggleStrike().run()
            return true
          }
        }

        // Tab 填入建议：输入为空 + 有 tabFillValue 时，将建议文本填入编辑器
        if (
          event.key === 'Tab' &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !mentionActiveRef.current
        ) {
          const fillText = tabFillValueRef.current
          const isEmpty = view.state.doc.textContent.length === 0
          if (fillText && isEmpty && editor) {
            event.preventDefault()
            editor.chain().focus().insertContent(fillText).run()
            onTabFillRef.current?.()
            return true
          }
        }

        // 发送/换行逻辑：根据 sendWithCmdEnter 模式决定行为
        if (event.key === 'Enter') {
          const cmdEnterMode = sendWithCmdEnterRef.current

          // 如果在代码块中，允许正常换行
          const { state } = view
          const { $from } = state.selection
          const parent = $from.parent
          if (parent.type.name === 'codeBlock') {
            return false // 让 TipTap 处理
          }

          // 检查是否正在输入中文（IME 组合输入）
          if (isComposingRef.current || event.isComposing) {
            return false
          }

          // Mention 列表打开且有可选项时，让 TipTap Mention 处理 Enter
          if (mentionActiveRef.current && mentionItemCountRef.current > 0) {
            return false
          }

          // 判断是发送还是换行；发送时识别 ⌥ 打断手势
          const { isSend, interrupt } = resolveSendIntent(
            { metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey },
            cmdEnterMode,
          )

          if (isSend) {
            event.preventDefault()
            onSubmitRef.current({ interrupt })
            return true
          }

          // 换行：列表内延续列表项，其他场景插入硬换行（紧凑行距）
          event.preventDefault()
          // 检查是否在列表项内（遍历祖先节点）
          let isInList = false
          let listItemNode = null
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              isInList = true
              listItemNode = $from.node(d)
              break
            }
          }
          if (isInList && editor) {
            // 空列表项再次按 Enter：退出列表，回到普通输入
            if (listItemNode && listItemNode.textContent === '') {
              editor.chain().focus().liftListItem('listItem').run()
            } else {
              editor.chain().focus().splitListItem('listItem').run()
            }
          } else if (editor) {
            editor.chain().focus().splitBlock().run()
          }
          return true
        }

        // Backspace：空列表项时退出列表
        if (event.key === 'Backspace') {
          const { state } = view
          const { $from } = state.selection
          let isInList = false
          let listItemNode = null
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              isInList = true
              listItemNode = $from.node(d)
              break
            }
          }
          if (isInList && listItemNode && listItemNode.textContent === '' && editor) {
            event.preventDefault()
            editor.chain().focus().liftListItem('listItem').run()
            return true
          }
        }

        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      if (html === '<p></p>') {
        lastEditorValueRef.current = ''
        onChange('')
        onHtmlChangeRef.current?.('')
        setIsExpanded(false)
        setIsManuallyCollapsed(false)
      } else {
        const markdown = htmlToMarkdown(html)
        lastEditorValueRef.current = markdown
        onChange(markdown)
        onHtmlChangeRef.current?.(html)

        // 检查行数，超过5行时展开输入框
        const lineCount = countEditorLines(ed)
        setIsExpanded(lineCount > 5)
      }
    },
  })

  // 同步外部 value 变化（清空时）
  useEffect(() => {
    if (editor) {
      const controllerValue = value
      // 如果值是编辑器自己设置的，跳过同步
      if (controllerValue === lastEditorValueRef.current) {
        return
      }

      if (controllerValue === '') {
        editor.commands.clearContent()
        lastEditorValueRef.current = ''
        setIsExpanded(false)
        setIsManuallyCollapsed(false)
      } else if (htmlValue) {
        // 优先使用 HTML 草稿恢复（保留 mention 等富文本节点）
        editor.commands.setContent(htmlValue)
        lastEditorValueRef.current = controllerValue
      } else {
        // 无 HTML 草稿时从 Markdown 兜底恢复：把序列化的 mention token 还原为 chip span，
        // 让 TipTap 解析为 Mention 节点，否则会以纯文本显示成 @zotero-item:KEY|... 长串
        const html = markdownToEditorHtml(controllerValue)
        editor.commands.setContent(html)
        lastEditorValueRef.current = controllerValue
      }
    }
  }, [editor, value])

  // 同步 disabled 状态
  useEffect(() => {
    if (editor) {
      editor.setEditable(!disabled)
    }
  }, [editor, disabled])

  // 处理 pendingQuote：将选中的文本作为引用插入到编辑器
  useEffect(() => {
    if (!pendingQuote || !editor) return

    // 格式化为 Markdown 引用
    const quoteText = pendingQuote.text
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n')

    // 插入到当前光标位置（而非强制末尾）
    // 如果编辑器为空或光标在开头，引用前不加换行；否则确保引用独立成段
    const { from } = editor.state.selection
    const isEmpty = editor.isEmpty
    const prefix = isEmpty || from === 0 ? '' : '\n\n'

    editor.commands.insertContent(`${prefix}${quoteText}\n\n`)
    // 光标自动停留在插入内容后，无需手动 focus('end')

    // 清除状态
    setPendingQuote(null)
  }, [pendingQuote, editor, setPendingQuote])

  // 动态更新 placeholder 文本
  // Placeholder 用函数形式注册（读 placeholderRef），i18n 切换后只需
  // 强制 ProseMirror 重跑 decorations 回调即可看到新文案
  useEffect(() => {
    if (!editor) return
    editor.view.updateState(editor.state)
  }, [editor, resolvedPlaceholder])

  // 自动聚焦：组件挂载时 + autoFocusTrigger 变化时
  useEffect(() => {
    // 显式打开原生搜索结果时，历史加载与编辑器挂载的先后顺序不固定。
    const searchOwnsFocus = (): boolean => Boolean(window.__TAURI_FORMAL__ &&
      (store.get(searchMessageTargetAtom) || document.activeElement?.hasAttribute('data-search-located')))
    if (editor && !disabled && !searchOwnsFocus()) {
      const timer = setTimeout(() => {
        if (!searchOwnsFocus()) editor.commands.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [editor, disabled, autoFocusTrigger, store])

  // #84 Windows IME 第二道兜底：Alt+Tab 切离整个 Electron 窗口时，
  // editor 自身 blur 不会触发（焦点仍在 window 内部），需要监听 window blur
  // 才能在用户切换应用回来后保证 isComposingRef 不残留 stuck=true。
  useEffect(() => {
    const handleWindowBlur = (): void => {
      isComposingRef.current = false
    }
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [])

  // 外部触发 @ 引用面板：signal 变化时插入 @ 并聚焦，TipTap Mention 扩展会自动弹出建议面板
  useEffect(() => {
    if (mentionTriggerSignal === undefined) return
    if (!editor || disabled) return
    editor.chain().focus().insertContent('@').run()
  }, [mentionTriggerSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // 是否显示折叠按钮：启用 collapsible 且内容已自动扩展
  const showCollapseToggle = collapsible && isExpanded

  return (
    <div
      className={cn(
        'rich-text-input relative w-full overflow-y-auto transition-[max-height] duration-200 ease-in-out scrollbar-thin',
        // 内容（含 chip）增加时 wrapper 随内容连续增高，直到 500px 才开始内部滚动；
        // isManuallyCollapsed 时强制压回最低高度。
        isManuallyCollapsed ? 'max-h-[101px]' : 'max-h-[500px]',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {/* @ Mention chip 行：选中后挂在编辑器上方，每加一项输入区直观增高 */}
      {pendingMentions && pendingMentions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 pb-0.5">
          {pendingMentions.map((m) => (
            <PendingMentionChip
              key={`${m.kind}:${m.id}`}
              mention={m}
              onRemove={() => onMentionRemove?.(m.kind, m.id)}
            />
          ))}
        </div>
      )}
      <EditorContent editor={editor} className="w-full" />
      {/* 轮播提示和编辑器共用排版变量，场景修改内边距时保持相同文字起点。 */}
      {useRotating && isEmptyForPlaceholder && rotatingPlaceholders && (
        <div
          aria-hidden
          className="rich-text-input__placeholder"
        >
          {rotatingPrefix && <span className="opacity-50">{rotatingPrefix}&nbsp;</span>}
          {/* 后缀裁剪容器：滚入时 translateY 超出部分被裁掉，呈现滚动感 */}
          <span className="block overflow-hidden">
            <span key={rotIdx} className="rgph-item block whitespace-nowrap">
              {rotatingPlaceholders[rotIdx % rotatingPlaceholders.length]}
            </span>
          </span>
        </div>
      )}
      {/* 折叠/展开切换按钮 — sticky 悬浮在滚动区域内 */}
      {showCollapseToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="sticky bottom-1 float-right mr-2 z-10 h-auto p-0.5 rounded hover:bg-muted/80 text-muted-foreground/50 hover:text-muted-foreground [&_svg]:!size-3.5"
              onClick={() => setIsManuallyCollapsed((prev) => !prev)}
            >
              {isManuallyCollapsed ? (
                <ChevronsUpDown className="size-3.5" />
              ) : (
                <ChevronsDownUp className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {isManuallyCollapsed ? t('input.expand') : t('input.collapse')}
          </TooltipContent>
        </Tooltip>
      )}
      <style>{`
        /* 轮播占位：新句子从下方滚入 + 淡入，静止透明度 0.5（对齐 tiptap placeholder 观感） */
        @keyframes rgph-in {
          from { opacity: 0; transform: translateY(0.7em); }
          to   { opacity: 0.5; transform: translateY(0); }
        }
        .rgph-item {
          animation: rgph-in 0.34s cubic-bezier(0.16, 1, 0.3, 1) both;
          white-space: nowrap;
        }
        @media (prefers-reduced-motion: reduce) {
          .rgph-item { animation: none; opacity: 0.5; }
        }
        .ProseMirror {
          outline: none;
          font-style: normal;
        }
        .ProseMirror p {
          font-style: normal;
          margin: 0;
        }
        .ProseMirror ul,
        .ProseMirror ol {
          margin: 0;
          padding-left: 1.5em;
        }
        .ProseMirror li {
          margin: 0;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          height: 0;
          opacity: 0.5;
          font-style: normal;
        }
        .ProseMirror::-webkit-scrollbar {
          width: 3px;
        }
        .mention-chip {
          background-color: hsl(var(--primary) / 0.1);
          color: hsl(var(--primary));
          border-radius: 6px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/%3E%3Cpath d='M14 2v4a2 2 0 0 0 2 2h4'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .skill-mention-chip {
          background-color: hsl(270 60% 60% / 0.15);
          color: hsl(270 60% 50%);
          border-radius: 6px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .skill-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .mcp-mention-chip {
          background-color: hsl(160 60% 45% / 0.15);
          color: hsl(160 60% 35%);
          border-radius: 6px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .mcp-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='8' x='2' y='2' rx='2' ry='2'/%3E%3Crect width='20' height='8' x='2' y='14' rx='2' ry='2'/%3E%3Cline x1='6' x2='6.01' y1='6' y2='6'/%3E%3Cline x1='6' x2='6.01' y1='18' y2='18'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .zotero-item-mention-chip {
          background-color: hsl(var(--muted));
          color: hsl(var(--muted-foreground));
          border-radius: 6px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .zotero-item-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        .zotero-col-mention-chip {
          background-color: hsl(var(--muted) / 0.6);
          color: hsl(var(--muted-foreground));
          border-radius: 6px;
          padding: 1px 4px 1px 2px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          vertical-align: baseline;
        }
        .zotero-col-mention-chip::before {
          content: '';
          display: inline-block;
          width: 12px;
          height: 12px;
          background-color: currentColor;
          mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z'/%3E%3C/svg%3E");
          mask-size: contain;
          mask-repeat: no-repeat;
          flex-shrink: 0;
        }
        /* 所有 mention chip 共享的长度约束：超出最大宽度 ellipsis；完整文本走 title 悬浮提示 */
        .mention-chip,
        .skill-mention-chip,
        .mcp-mention-chip,
        .zotero-item-mention-chip,
        .zotero-col-mention-chip {
          max-width: 20rem;
          overflow: hidden;
        }
        .mention-chip-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
      `}</style>
    </div>
  )
}

// ===== Pending Mention 行内 chip =====

interface PendingMentionChipProps {
  mention: { kind: MentionKind; id: string; label: string }
  onRemove: () => void
}

function PendingMentionChip({ mention, onRemove }: PendingMentionChipProps): React.ReactElement {
  const { t } = useT('conversation')
  const Icon = mention.kind === 'zotero-item'
    ? BookOpen
    : mention.kind === 'zotero-col' || mention.kind === 'dir'
      ? Folder
      : mention.kind === 'evidence-set'
        ? Layers
        : FileText
  const display = mention.kind === 'zotero-col'
    ? (mention.label.split(' / ').at(-1) ?? mention.label)
    : mention.label
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 max-w-[20rem] rounded-md',
        'bg-muted text-muted-foreground',
        'pl-1.5 pr-1 py-0.5 text-sm font-medium',
      )}
      title={mention.label}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{display}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-2xs"
        className="ml-0.5 shrink-0 rounded hover:bg-muted-foreground/15"
        onClick={onRemove}
        aria-label={t('input.removeMention')}
      >
        <X className="!size-3" />
      </Button>
    </span>
  )
}
