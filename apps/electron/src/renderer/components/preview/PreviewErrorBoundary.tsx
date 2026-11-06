/**
 * 单个 renderer 崩溃时不连累整个面板
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RotateCcw, ExternalLink } from 'lucide-react'
import { useT } from '@/hooks/useT'

interface PreviewErrorBoundaryProps {
  filePath?: string
  children: React.ReactNode
}

interface InnerProps extends PreviewErrorBoundaryProps {
  /** 通过函数包装注入 i18n 文本，class 组件内不能直接用 hook */
  i18n: {
    failed: string
    unknown: string
    retry: string
    openExternal: string
  }
}

interface State {
  error: Error | null
}

class PreviewErrorBoundaryInner extends React.Component<InnerProps, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[PreviewErrorBoundary] 渲染器崩溃:', error, info)
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
  }

  private handleOpenExternal = (): void => {
    if (this.props.filePath) {
      window.electronAPI.previewFile(this.props.filePath).catch(console.error)
    }
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      const { i18n } = this.props
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
          <AlertTriangle className="size-6 text-warning" />
          <div className="text-xs text-foreground font-medium">{i18n.failed}</div>
          <div className="text-sm text-muted-foreground max-w-[240px] break-words">
            {this.state.error.message || i18n.unknown}
          </div>
          <div className="flex gap-2 mt-1">
            <Button size="sm" variant="outline" onClick={this.handleRetry}>
              <RotateCcw className="size-3 mr-1" />
              {i18n.retry}
            </Button>
            {this.props.filePath && (
              <Button size="sm" variant="outline" onClick={this.handleOpenExternal}>
                <ExternalLink className="size-3 mr-1" />
                {i18n.openExternal}
              </Button>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/** 函数式包装：负责通过 hooks 取 i18n 文案，再注入到 class 错误边界 */
export function PreviewErrorBoundary(props: PreviewErrorBoundaryProps): React.ReactElement {
  const { t } = useT('errors')
  const i18n = {
    failed: t('preview.failed'),
    unknown: t('preview.unknown'),
    retry: t('preview.retry'),
    openExternal: t('preview.openExternal'),
  }
  return <PreviewErrorBoundaryInner {...props} i18n={i18n} />
}
