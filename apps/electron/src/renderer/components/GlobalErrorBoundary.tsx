/**
 * 全局错误边界（issue #459）
 *
 * 包裹主窗整棵 React 树：渲染期未捕获异常此前会让整窗白屏 / 透明，
 * 这里兜底成可重载的 fallback，并显式 console.error（React 会吞掉错误，
 * 使其不触发 window.onerror；renderer Sentry 通过本边界自动捕获）。
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useT } from '@/hooks/useT'

interface GlobalErrorBoundaryProps {
  children: React.ReactNode
}

interface InnerProps extends GlobalErrorBoundaryProps {
  /** 通过函数包装注入 i18n 文本，class 组件内不能直接用 hook */
  i18n: {
    crashed: string
    reload: string
  }
}

interface State {
  error: Error | null
}

class GlobalErrorBoundaryInner extends React.Component<InnerProps, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[GlobalErrorBoundary] 渲染器崩溃:', error, info)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      const { i18n } = this.props
      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4 p-6 text-center bg-background">
          <AlertTriangle className="size-8 text-warning" />
          <div className="text-base text-foreground font-medium">{i18n.crashed}</div>
          <div className="text-sm text-muted-foreground max-w-[360px] break-words">
            {this.state.error.message}
          </div>
          <Button size="sm" variant="outline" onClick={this.handleReload} className="mt-1">
            <RotateCcw className="size-3 mr-1" />
            {i18n.reload}
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

/** 函数式包装：通过 hooks 取 i18n 文案后注入 class 错误边界 */
export function GlobalErrorBoundary(props: GlobalErrorBoundaryProps): React.ReactElement {
  const { t } = useT('errors')
  const i18n = {
    crashed: t('global.crashed'),
    reload: t('global.reload'),
  }
  return <GlobalErrorBoundaryInner {...props} i18n={i18n} />
}
