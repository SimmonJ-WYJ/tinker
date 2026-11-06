import * as React from 'react'
import { FileText } from 'lucide-react'
import { useT } from '@/hooks/useT'
import type { PreviewRendererProps } from '../preview-registry'

/**
 * Office 文档预览（纯文本）
 * - 主进程用 officeparser / mammoth / word-extractor 提取文本
 * - 内嵌只展示纯文本；复杂排版/图片请用"另开窗口"
 */
export default function OfficeRenderer({ path, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const [text, setText] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.previewParseOffice(path)
      .then((value) => { if (!cancelled) setText(value) })
      .catch((err) => onError(err instanceof Error ? err : new Error(String(err))))
    return () => { cancelled = true }
  }, [path, onError])

  if (text === null) {
    return <div className="p-4 text-xs text-muted-foreground">{t('office.extracting')}</div>
  }

  if (text.trim().length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-6">
        <FileText className="size-8 text-muted-foreground/40" />
        <div className="text-xs text-foreground">{t('office.empty')}</div>
        <div className="text-sm text-muted-foreground">{t('office.emptyHint')}</div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4 scrollbar-thin">
      <div className="flex items-center gap-1.5 px-2 py-1 mb-3 text-sm text-muted-foreground bg-muted/30 rounded">
        <FileText className="size-2.5" />
        <span>{t('office.plaintextNotice')}</span>
      </div>
      <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-foreground/90">
        {text}
      </pre>
    </div>
  )
}
