import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { PreviewRendererProps } from '../preview-registry'
import { transformQuoteCitations, parseCitationHref } from '@/lib/citation-transform'
import { parseReferences } from '@/lib/citation-references.ts'
import { CitationBadge, CitationReferencesContext } from '@/components/common/CitationBadge'
import { useT } from '@/hooks/useT'

/**
 * Markdown 文件预览
 * - react-markdown + remark-gfm + remark-math + rehype-katex
 * - 复用 @tailwindcss/typography 的 prose 样式
 * - 最大 2MB（由 registry 的 maxSize 控制）
 * - 综述引用 F27（文档内跳转）：
 *   · 正文 [N]<quote>X</quote> → CitationBadge：hover 显示原文，click 跳到 §7
 *   · §7 中以 [N] 开头的 <p> 段落自动加 `data-asci-ref-n="N"`，作为跳转锚点
 *   · 外层容器加 `data-asci-citations-root` 限定查询范围（避免多文档冲突）
 */

const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

/** 抽取段落 children 文本前缀，识别 `[N] ` 形式的参考文献条目 */
function extractRefNumber(children: React.ReactNode): string | null {
  let firstText = ''
  if (typeof children === 'string') firstText = children
  else if (Array.isArray(children) && typeof children[0] === 'string') firstText = children[0]
  else if (Array.isArray(children)) {
    for (const c of children) {
      if (typeof c === 'string') { firstText = c; break }
    }
  }
  const m = /^\s*\[(\d+)\]\s+/.exec(firstText)
  return m ? m[1]! : null
}

const MARKDOWN_COMPONENTS = {
  a({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children?: React.ReactNode }) {
    const linkText = typeof children === 'string'
      ? children
      : Array.isArray(children) && typeof children[0] === 'string'
        ? (children[0] as string)
        : undefined
    const citation = parseCitationHref(href, linkText)
    if (citation) {
      return <CitationBadge n={citation.n} quote={citation.quote} />
    }
    return <a href={href} {...rest}>{children}</a>
  },
  p({ children, ...rest }: React.HTMLAttributes<HTMLParagraphElement> & { children?: React.ReactNode }) {
    const refN = extractRefNumber(children)
    if (refN) {
      return <p data-asci-ref-n={refN} {...rest}>{children}</p>
    }
    return <p {...rest}>{children}</p>
  },
  // §7 References 推荐写法允许 `- [N] Authors. *Title*. ...` 列表形式（SKILL.md 第 533 行）。
  // react-markdown 会把它渲染成 <ul><li>，跳转锚点 data-asci-ref-n 必须同时支持 <li>，否则
  // CitationBadge.jumpToReferenceN 在 querySelector('[data-asci-ref-n="N"]') 时拿不到 <li>，
  // 用户点击 [N] 就会触发 "not found in §7 References" 的 toast。
  li({ children, ...rest }: React.LiHTMLAttributes<HTMLLIElement> & { children?: React.ReactNode }) {
    const refN = extractRefNumber(children)
    if (refN) {
      return <li data-asci-ref-n={refN} {...rest}>{children}</li>
    }
    return <li {...rest}>{children}</li>
  },
}

export default function MarkdownRenderer({ path, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [content, setContent] = React.useState<string | null>(null)
  const [truncated, setTruncated] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI
      .previewReadText(path, 2 * 1024 * 1024)
      .then((res) => {
        if (cancelled) return
        setContent(res.content)
        setTruncated(res.truncated)
      })
      .catch((err) => onError(err instanceof Error ? err : new Error(String(err))))
    return () => { cancelled = true }
  }, [path, onError])

  const { transformed, references } = React.useMemo(() => {
    if (content === null) return { transformed: null, references: new Map() }
    return {
      transformed: transformQuoteCitations(content),
      references: parseReferences(content),
    }
  }, [content])

  if (transformed === null) {
    return <div className="p-4 text-xs text-muted-foreground">{t('markdown.loading')}</div>
  }

  return (
    <div
      data-asci-citations-root
      className="h-full overflow-auto prose prose-sm dark:prose-invert max-w-none p-4 scrollbar-thin"
    >
      {truncated && (
        <div className="not-prose px-3 py-1 mb-3 text-sm text-warning bg-warning/10 border border-warning/30 rounded">
          {t('markdown.truncated')}
        </div>
      )}
      <CitationReferencesContext.Provider value={references}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {transformed}
        </ReactMarkdown>
      </CitationReferencesContext.Provider>
    </div>
  )
}
