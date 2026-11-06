import * as React from 'react'
import { highlightCode } from '@asci/core/highlight'
import { useT } from '@/hooks/useT'
import { EmptyPreview } from '../EmptyPreview'
import type { PreviewRendererProps } from '../preview-registry'

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', scala: 'scala',
  c: 'c', cpp: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
  cs: 'csharp', php: 'php', lua: 'lua', r: 'r',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', sql: 'sql',
  css: 'css', scss: 'scss', less: 'less',
  tex: 'latex', bib: 'bibtex',
  vue: 'vue', svelte: 'svelte',
  dart: 'dart', elm: 'elm', hs: 'haskell', ml: 'ocaml',
  txt: 'text', log: 'text',
}

/**
 * 代码 / 文本文件高亮预览
 * - 通过 @asci/core highlightCode 用 Shiki 渲染为 HTML
 * - 大文件（> 500KB）只读前 500KB（由 IPC 层的 maxBytes 控制）
 */
export default function CodeRenderer({ path, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [html, setHtml] = React.useState<string>('')
  const [truncated, setTruncated] = React.useState(false)
  const [notFound, setNotFound] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const lang = EXT_TO_LANG[ext] ?? 'text'

  React.useEffect(() => {
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const res = await window.electronAPI.previewReadText(path, 500 * 1024)
        if (cancelled) return
        if (res.notFound) {
          setNotFound(true)
          return
        }
        setTruncated(res.truncated)
        const highlighted = await highlightCode({ code: res.content, language: lang })
        if (cancelled) return
        setHtml(highlighted.html)
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [path, lang, onError])

  if (loading) {
    return <div className="p-4 text-xs text-muted-foreground">{t('code.loading')}</div>
  }

  if (notFound) {
    return <EmptyPreview variant="not-found" />
  }

  return (
    <div className="h-full overflow-auto scrollbar-thin">
      {truncated && (
        <div className="px-3 py-1 text-sm text-warning bg-warning/10 border-b border-warning/30">
          {t('code.truncated')}
        </div>
      )}
      <div
        // eslint-disable-next-line asci/min-font-size -- 渲染内容（代码/正文），不受应用 UI 14px 下限约束
        className="text-[11px] leading-relaxed p-3"
        // Shiki 生成的 HTML，内容可信
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
