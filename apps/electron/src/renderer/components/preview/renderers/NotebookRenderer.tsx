import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { highlightCode } from '@asci/core/highlight'
import { useT } from '@/hooks/useT'
import type { PreviewRendererProps } from '../preview-registry'
import type { PreviewParseNotebookResult, NotebookCell } from '@asci/shared'

/**
 * Jupyter Notebook 预览器
 * - 主进程解析 .ipynb JSON → cells[]
 * - code cell 用 Shiki 高亮
 * - markdown cell 用 react-markdown（含 KaTeX 数学公式）
 * - 输出按纯文本展示（不渲染 HTML/图片输出以避免 XSS）
 */
export default function NotebookRenderer({ path, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [data, setData] = React.useState<PreviewParseNotebookResult | null>(null)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.previewParseNotebook(path)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((err) => onError(err instanceof Error ? err : new Error(String(err))))
    return () => { cancelled = true }
  }, [path, onError])

  if (!data) {
    return <div className="p-4 text-xs text-muted-foreground">{t('notebook.loading')}</div>
  }

  const lang = data.language ?? 'python'

  return (
    <div className="h-full overflow-auto p-3 space-y-3 scrollbar-thin">
      {data.kernelName && (
        <div className="text-sm text-muted-foreground">kernel: {data.kernelName}（{lang}）</div>
      )}
      {data.cells.map((cell, i) => (
        <CellView key={i} cell={cell} lang={lang} />
      ))}
    </div>
  )
}

function CellView({ cell, lang }: { cell: NotebookCell; lang: string }): React.ReactElement {
  if (cell.type === 'markdown') {
    return (
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {cell.source}
        </ReactMarkdown>
      </div>
    )
  }
  if (cell.type === 'code') {
    return <CodeCell source={cell.source} lang={lang} outputs={cell.outputs} />
  }
  // raw
  // eslint-disable-next-line asci/min-font-size -- 渲染内容（代码/正文），不受应用 UI 14px 下限约束
  return <pre className="text-[11px] bg-muted/30 p-2 rounded whitespace-pre-wrap">{cell.source}</pre>
}

function CodeCell({ source, lang, outputs }: { source: string; lang: string; outputs?: string }): React.ReactElement {
  const [html, setHtml] = React.useState<string>('')

  React.useEffect(() => {
    let cancelled = false
    highlightCode({ code: source, language: lang })
      .then((res) => { if (!cancelled) setHtml(res.html) })
      .catch(() => { /* 降级为原文 */ })
    return () => { cancelled = true }
  }, [source, lang])

  return (
    <div className="border border-border rounded overflow-hidden">
      <div
        // eslint-disable-next-line asci/min-font-size -- 渲染内容（代码/正文），不受应用 UI 14px 下限约束
        className="text-[11px] p-2 bg-muted/20"
        dangerouslySetInnerHTML={{ __html: html || `<pre>${escapeHtml(source)}</pre>` }}
      />
      {outputs && (
        // eslint-disable-next-line asci/min-font-size -- 渲染内容（代码/正文），不受应用 UI 14px 下限约束
        <pre className="text-[10px] p-2 border-t border-border bg-muted/10 whitespace-pre-wrap text-muted-foreground">
          {outputs}
        </pre>
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;')
}
