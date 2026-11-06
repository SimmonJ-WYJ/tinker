/**
 * 环境检测卡片组件
 *
 * 显示单个环境项（Node.js 或 Git）的检测结果
 */

import { CheckCircle2, XCircle, AlertCircle, Loader2, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

type CheckStatus = 'checking' | 'success' | 'warning' | 'error'

interface EnvironmentCheckCardProps {
  /** 环境项名称（如 "Node.js"、"Git"） */
  name: string
  /** 检测状态 */
  status: CheckStatus
  /** 版本号 */
  version?: string
  /** 要求说明 */
  requirement: string
  /** 下载链接 */
  downloadUrl: string
  /** 状态描述 */
  statusText?: string
}

/**
 * 环境检测卡片
 */
export function EnvironmentCheckCard({
  name,
  status,
  version,
  requirement,
  downloadUrl,
  statusText,
}: EnvironmentCheckCardProps) {
  const { t } = useT('chrome')
  const handleDownload = () => {
    window.electronAPI.openExternal(downloadUrl)
  }

  // 状态图标和颜色
  const StatusIcon = {
    checking: Loader2,
    success: CheckCircle2,
    warning: AlertCircle,
    error: XCircle,
  }[status]

  const iconColor = {
    checking: 'text-muted-foreground',
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-destructive',
  }[status]

  const statusTextDefault = {
    checking: t('envCheck.checking'),
    success: version ? t('envCheck.installedWithVersion', { version }) : t('envCheck.installed'),
    warning: version ? t('envCheck.warnWithVersion', { version }) : t('envCheck.warn'),
    error: t('envCheck.error'),
  }[status]

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      {/* 状态图标 */}
      <div className="flex-shrink-0">
        <StatusIcon
          className={`h-4 w-4 ${iconColor} ${status === 'checking' ? 'animate-spin' : ''}`}
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 space-y-1.5">
        {/* 名称和状态 */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="text-sm font-medium">{name}</h4>
            <p className="text-xs text-muted-foreground">{statusText || statusTextDefault}</p>
          </div>
        </div>

        {/* 要求说明 */}
        <p className="text-sm text-muted-foreground">{requirement}</p>

        {/* 下载按钮（仅在未安装或警告时显示） */}
        {(status === 'error' || status === 'warning') && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="mt-1.5 h-7 text-xs"
          >
            <ExternalLink className="mr-1.5 h-3 w-3" />
            {t('envCheck.download', { name })}
          </Button>
        )}
      </div>
    </div>
  )
}
