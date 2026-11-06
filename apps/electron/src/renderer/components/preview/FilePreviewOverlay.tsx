/**
 * FilePreviewOverlay —— 独立的「应用内文件全屏预览」覆盖层（#709）
 *
 * 复用 InlinePreview 的放大 Dialog 形态 + 同一套 resolveRenderer 渲染器子树（综述 HTML /
 * ln 等），但**不依赖会话右面板 atom**——可在独立视图（如 Evidence Sets / NotesView）里
 * 直接打开一个文件路径的富预览。
 *
 * 与 InlinePreview 放大 Dialog 的差异：仅受控于一个 target（path/ext/size），无 tab/兄弟导航。
 */
import * as React from 'react'
import { ExternalLink, FolderSearch } from 'lucide-react'
import { useT } from '@/hooks/useT'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { resolveRenderer } from './preview-registry'
import { PreviewErrorBoundary } from './PreviewErrorBoundary'
import { EmptyPreview } from './EmptyPreview'

export interface FilePreviewTarget {
  path: string
  /** 扩展名（小写，无点）；决定走哪个 renderer */
  ext: string
  /** 文件字节数（renderer / EmptyPreview "过大" 判定用）；未知传 0 */
  size: number
}

/** 把 renderer 的 async onError 桥接到 ErrorBoundary（复刻 InlinePreview.RendererHost） */
function RendererHost({
  path,
  size,
  Renderer,
}: {
  path: string
  size: number
  Renderer: React.FC<{ path: string; size: number; onError: (err: Error) => void }>
}): React.ReactElement {
  const [error, setError] = React.useState<Error | null>(null)
  React.useEffect(() => { setError(null) }, [path])
  if (error) throw error
  return <Renderer path={path} size={size} onError={setError} />
}

export function FilePreviewOverlay({
  target,
  onClose,
}: {
  target: FilePreviewTarget | null
  onClose: () => void
}): React.ReactElement {
  const { t: tPreview } = useT('preview')
  const { t: tCommon } = useT('common')

  const renderer = target
    ? resolveRenderer({ kind: 'file', path: target.path, ext: target.ext, size: target.size })
    : null
  const fileName = target ? (target.path.split('/').pop() ?? target.path) : ''

  return (
    <Dialog open={target != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="max-w-none w-[90vw] h-[88vh] p-0 gap-0 flex flex-col overflow-hidden"
        aria-describedby={undefined}
      >
        {target && (
          <>
            <div className="flex items-center gap-2 h-12 pl-6 pr-12 bg-muted/30 border-b border-border flex-shrink-0">
              <span className="text-xs font-medium text-foreground truncate flex-1" title={fileName}>
                {fileName}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 [&_svg]:size-3.5"
                onClick={() => { window.electronAPI.openFile(target.path).catch(console.error) }}
              >
                <ExternalLink />
                {tPreview('actions.openWithDefaultApp')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 [&_svg]:size-3.5"
                onClick={() => { window.electronAPI.showInFolder(target.path).catch(console.error) }}
              >
                <FolderSearch />
                {tPreview('actions.revealInFinder')}
              </Button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col [&>div>div]:!p-12">
              {renderer ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PreviewErrorBoundary key={target.path} filePath={target.path}>
                    <React.Suspense
                      fallback={<div className="p-4 text-xs text-muted-foreground">{tCommon('loading')}</div>}
                    >
                      <RendererHost path={target.path} size={target.size} Renderer={renderer.Component} />
                    </React.Suspense>
                  </PreviewErrorBoundary>
                </div>
              ) : (
                <EmptyPreview
                  variant={target.size > 0 ? 'too-large' : 'unsupported'}
                  filePath={target.path}
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
