import * as React from 'react'
import { useT } from '@/hooks/useT'
import type { PreviewRendererProps } from '../preview-registry'

/** Serve generated HTML from an isolated loopback origin. srcDoc inherits the
 * app CSP, which blocks generated inline scripts even with allow-scripts.
 * The frame remains opaque (no allow-same-origin) and has no app preload. */
const HTML_SANDBOX = 'allow-scripts'


export default function HtmlRenderer({ path, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [html, setHtml] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI
      .previewOpenHtml(path)
      .then((res) => {
        if (!cancelled) setHtml(res)
      })
      .catch((err) =>
        onError(err instanceof Error ? err : new Error(t('html.loadFailed'))),
      )
    return () => {
      cancelled = true
    }
  }, [path, onError, t])

  if (html === null) {
    return (
      <div className="p-4 text-xs text-muted-foreground">
        {t('markdown.loading')}
      </div>
    )
  }

  return (
    <iframe
      src={html}
      sandbox={HTML_SANDBOX}
      className="h-full w-full border-0 bg-white"
      title={path.split('/').pop()}
    />
  )
}
