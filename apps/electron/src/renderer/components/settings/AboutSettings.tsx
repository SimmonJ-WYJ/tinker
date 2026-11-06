/**
 * AboutSettings - 关于页面
 *
 * 显示应用版本号等基本信息，以及版本检测状态。
 * 检测到新版本后引导用户去 GitHub Releases 手动下载。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { RefreshCw, Loader2, CheckCircle2, AlertCircle, Info, Terminal, ChevronDown, ChevronUp, ExternalLink, Play } from 'lucide-react'
import type { RuntimeStatus } from '@asci/shared'
import { GITHUB_RELEASES_URL, ASCI_PRIVACY_POLICY_URL, ASCI_TERMS_OF_USE_URL } from '@asci/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from './primitives'
import { updateStatusAtom, updaterAvailableAtom, checkForUpdates } from '@/atoms/updater'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { EnvironmentCheckCard } from '@/components/environment/EnvironmentCheckCard'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ReleaseNotesViewer } from './ReleaseNotesViewer'
import { VersionHistory } from './VersionHistory'
import { useT } from '@/hooks/useT'
import { debugModeAtom } from '@/lib/dev-mode'
import { cn } from '@/lib/utils'

/** 解锁 Debug 开关需连点版本号的次数 */
const DEBUG_REVEAL_CLICKS = 5
/** Debug 行淡出动画时长（ms），需与 transition duration class 一致 */
const DEBUG_FADE_OUT_MS = 200

/** 从 package.json 构建时由 Vite define 注入 */
declare const __TINKER_CANDIDATE__: boolean
declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__

interface UpdateCardProps {
  /** 是否嵌入到外层设置卡片中 */
  embedded?: boolean
}

/** 更新状态卡片 */
function UpdateCard({
  embedded = false,
}: UpdateCardProps): React.ReactElement | null {
  const { t } = useT('settings')
  const available = useAtomValue(updaterAvailableAtom)
  const status = useAtomValue(updateStatusAtom)
  const [checking, setChecking] = React.useState(false)
  const [showReleaseNotes, setShowReleaseNotes] = React.useState(false)
  const [release, setRelease] = React.useState<import('@asci/shared').GitHubRelease | null>(null)

  // updater 不可用时不渲染
  if (!available) return null

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    try {
      await checkForUpdates()
    } finally {
      // 状态由 atom 订阅自动更新，延迟重置 checking 避免按钮闪烁
      setTimeout(() => setChecking(false), 1000)
    }
  }

  const handleGoToDownload = (): void => {
    const url = release?.html_url || GITHUB_RELEASES_URL
    window.electronAPI.openExternal(url)
  }

  // 当检测到新版本时，获取完整的 release 信息
  React.useEffect(() => {
    if (status.status === 'available' && status.version && !release) {
      window.electronAPI
        .getReleaseByTag(`v${status.version}`)
        .then((r) => {
          if (r) {
            setRelease(r)
            setShowReleaseNotes(true)
          }
        })
        .catch((err) => {
          console.error('[更新] 获取 Release 信息失败:', err)
        })
    }
  }, [status.status, status.version, release])

  const isChecking = checking || status.status === 'checking'
  const hasReleaseNotes = status.releaseNotes || release?.body

  const content = (
    <>
      <SettingsRow label={t('about.softwareUpdate')}>
        <div className="flex items-center gap-3">
          {/* 状态文字 */}
          <StatusText status={status.status} version={status.version} error={status.error} />

          {/* 操作按钮 */}
          {status.status === 'available' ? (
            <Button
              size="sm"
              onClick={handleGoToDownload}
              className="h-auto gap-1.5 px-3 py-1.5 [&_svg]:size-3.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('about.goDownload')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCheck}
              disabled={isChecking}
              className="h-auto gap-1.5 px-3 py-1.5 [&_svg]:size-3.5"
            >
              {isChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t('about.checkUpdate')}
            </Button>
          )}
        </div>
      </SettingsRow>

      {/* Release Notes（新版本可用时显示） */}
      {status.status === 'available' && hasReleaseNotes && (
        <div className="px-4 pb-4 border-t">
          <Button
            variant="ghost"
            onClick={() => setShowReleaseNotes(!showReleaseNotes)}
            className="w-full h-auto flex items-center justify-between py-3 text-left rounded-none hover:bg-transparent hover:opacity-80 transition-opacity"
          >
            <span className="text-sm font-medium">{t('about.releaseNotes')}</span>
            {showReleaseNotes ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>

          {showReleaseNotes && release && (
            <div className="mt-2">
              <ReleaseNotesViewer
                release={release}
                showHeader={false}
                compact
              />
            </div>
          )}
        </div>
      )}
    </>
  )

  if (embedded) {
    return <div>{content}</div>
  }

  return (
    <SettingsCard>
      {content}
    </SettingsCard>
  )
}

/** 状态文字组件（idle/初始态不显示，避免与右侧"检查更新"按钮重复占位） */
function StatusText({ status, version, error }: {
  status: string
  version?: string
  error?: string
}): React.ReactElement | null {
  const { t } = useT('settings')
  switch (status) {
    case 'checking':
      return <span className="text-xs text-muted-foreground">{t('about.checking')}</span>
    case 'available':
      return (
        <span className="text-xs text-primary flex items-center gap-1">
          <ExternalLink className="h-3 w-3" />
          {t('about.available', { version: version ?? '' })}
        </span>
      )
    case 'not-available':
      return (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {t('about.upToDate')}
        </span>
      )
    case 'error':
      return (
        <span className="text-xs text-destructive flex items-center gap-1" title={error}>
          <AlertCircle className="h-3 w-3" />
          {t('about.checkFailed')}
        </span>
      )
    default:
      return null
  }
}

/** Shell 环境卡片（Windows 平台），默认折叠；摘要正常时仅显示标题 + ✓，异常时显示标题 + 红色异常计数 */
function ShellEnvironmentCard(): React.ReactElement | null {
  const { t } = useT('settings')
  const [runtimeStatus, setRuntimeStatus] = React.useState<RuntimeStatus | null>(null)
  const [isChecking, setIsChecking] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)

  // 初始化时加载运行时状态
  React.useEffect(() => {
    window.electronAPI.getRuntimeStatus().then((status) => {
      setRuntimeStatus(status)
    })
  }, [])

  // 提前计算 hasShell，容忍 runtimeStatus / shell 未到位（避免 early return 后再声明 hook）
  const shell = runtimeStatus?.shell
  const hasShell = Boolean(shell?.gitBash?.available || shell?.wsl?.available)

  // 自动展开：有问题时默认展开 —— 必须在 early return 之前，否则违反 Rules of Hooks
  React.useEffect(() => {
    if (runtimeStatus && !hasShell) setExpanded(true)
  }, [runtimeStatus, hasShell])

  // 重新检测
  const handleCheck = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    setIsChecking(true)
    try {
      // 触发重新初始化运行时（后续可以添加此 IPC 方法）
      const status = await window.electronAPI.getRuntimeStatus()
      setRuntimeStatus(status)
    } catch (error) {
      console.error('[Shell 环境检测] 检测失败:', error)
    } finally {
      setIsChecking(false)
    }
  }

  // 非 Windows 平台或数据未到位：不显示
  if (!runtimeStatus || !shell) {
    return null
  }

  const issueCount = (shell.gitBash?.available ? 0 : 1) + (shell.wsl?.available ? 0 : 1)

  return (
    <SettingsCard>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        className="w-full h-auto flex-col items-stretch rounded-none p-4 text-left font-normal hover:bg-foreground/[0.02]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <h3 className="text-sm font-medium truncate">{t('about.shell.title')}</h3>
            {hasShell ? (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3 w-3" />
                {t('about.shell.summaryOk')}
              </span>
            ) : (
              <Badge tone="destructive" variant="solid" className="h-4 px-1.5">
                {t('about.shell.summaryIssues', { count: issueCount })}
              </Badge>
            )}
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
        </div>
        {expanded && (
          <p className="text-xs text-muted-foreground mt-1.5">
            {t('about.shell.subtitle')}
          </p>
        )}
      </Button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t">
          {/* 重新检测按钮 */}
          <div className="flex justify-end pt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCheck}
              disabled={isChecking}
              className="h-auto gap-1.5 px-3 py-1.5 [&_svg]:size-3.5"
            >
              {isChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isChecking ? t('about.shell.checking') : t('about.shell.recheck')}
            </Button>
          </div>

          {/* Git Bash 检测卡片 */}
          <EnvironmentCheckCard
            name={t('about.shell.gitBash')}
            status={shell.gitBash?.available ? 'success' : 'error'}
            version={shell.gitBash?.version ?? undefined}
            requirement={t('about.shell.gitBashRequirement')}
            downloadUrl="https://git-scm.com/download/win"
            statusText={
              shell.gitBash?.available
                ? `${shell.gitBash.path}`
                : shell.gitBash?.error || t('about.shell.notInstalled')
            }
          />

          {/* WSL 检测卡片 */}
          <EnvironmentCheckCard
            name={t('about.shell.wsl')}
            status={shell.wsl?.available ? 'success' : 'error'}
            version={shell.wsl?.version ? `WSL ${shell.wsl.version}` : undefined}
            requirement={t('about.shell.wslRequirement')}
            downloadUrl="https://learn.microsoft.com/zh-cn/windows/wsl/install"
            statusText={
              shell.wsl?.available
                ? t('about.shell.wslDefault', {
                    name: shell.wsl.defaultDistro || t('about.shell.wslDefaultUnset'),
                    distros: shell.wsl.distros.join(', '),
                  })
                : shell.wsl?.error || t('about.shell.notInstalled')
            }
          />

          {/* 推荐环境提示 */}
          {shell.recommended && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>{t('about.shell.currentlyUsing')}</strong>
                {shell.recommended === 'git-bash' ? t('about.shell.gitBashRecommended') : t('about.shell.wsl')}
              </AlertDescription>
            </Alert>
          )}

          {/* 无可用环境警告 */}
          {!hasShell && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>{t('about.shell.noShellWarning')}</strong>
                <br />
                {t('about.shell.noShellHelp')}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </SettingsCard>
  )
}

export function AboutSettings(): React.ReactElement {
  const { t } = useT('settings')
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const [debugMode, setDebugMode] = useAtom(debugModeAtom)

  // Debug 行三阶段：hidden（未解锁）→ revealed（可见）→ fadingOut（关闭时淡出，到点回 hidden）。
  // 初始态懒读 debugMode：上次已开启则直接 revealed，无需重新连点。
  const [revealPhase, setRevealPhase] = React.useState<'hidden' | 'revealed' | 'fadingOut'>(
    debugMode ? 'revealed' : 'hidden',
  )
  const [versionClicks, setVersionClicks] = React.useState(0)

  const handleVersionClick = (): void => {
    setVersionClicks((n) => {
      const next = n + 1
      if (next >= DEBUG_REVEAL_CLICKS) setRevealPhase('revealed')
      return next
    })
  }

  const handleDebugToggle = (checked: boolean): void => {
    setDebugMode(checked) // 立即持久化，有效 dev 模式即刻翻转
    if (!checked) {
      // 关闭时淡出，动画结束后回 hidden 并复位计数（需再连点 5 次重新揭示）
      setRevealPhase('fadingOut')
      setTimeout(() => {
        setRevealPhase('hidden')
        setVersionClicks(0)
      }, DEBUG_FADE_OUT_MS)
    }
  }

  const openExternal = (url: string): void => {
    window.electronAPI.openExternal(url).catch((err) => {
      console.error('[About] 打开外链失败:', err)
    })
  }

  const handleRestartSpotlight = async (): Promise<void> => {
    try {
      await window.electronAPI.restartOnboardingSpotlight()
      // 关闭设置弹窗，让用户能看到 spotlight 覆盖层
      setSettingsOpen(false)
    } catch (err) {
      console.error('[About] 重看引导失败:', err)
      toast.error(t('about.spotlight.failed'))
    }
  }

  return (
    <SettingsSection
      title={t('about.title')}
      description={t('about.description')}
    >
      <SettingsCard>
        <SettingsRow label={t('about.version')}>
          {/* 连点版本号 5 次解锁下方 Debug 开关（easter egg，select-none 防误选文本） */}
          <span
            className="text-sm text-muted-foreground select-none"
            onClick={handleVersionClick}
          >
            {APP_VERSION}
          </span>
        </SettingsRow>

        {/* Debug 模式开关（连点版本号解锁后显示；关闭时淡出后卸载） */}
        {revealPhase !== 'hidden' && (
          <div
            className={cn(
              'transition-opacity duration-200',
              revealPhase === 'fadingOut' ? 'opacity-0' : 'opacity-100',
            )}
          >
            <SettingsToggle
              label={t('about.debug.title')}
              description={t('about.debug.description')}
              checked={debugMode}
              onCheckedChange={handleDebugToggle}
            />
          </div>
        )}

        {/* 自动更新行（updater 不可用时不渲染） */}
        {!__TINKER_CANDIDATE__ && <UpdateCard embedded />}

        {/* 版本历史 */}
        {!__TINKER_CANDIDATE__ && <VersionHistory embedded />}
      </SettingsCard>

      {/* 新手引导（独立卡片，整卡可点击） */}
      <SettingsCard divided={false}>
        <Button
          variant="ghost"
          onClick={handleRestartSpotlight}
          className="w-full h-auto flex items-center gap-3 px-4 py-3 text-left rounded-none font-normal hover:bg-foreground/[0.03] [&_svg]:size-3"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{t('about.spotlight.title')}</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {t('about.spotlight.description')}
            </div>
          </div>
          <div className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary">
            <Play className="size-3 fill-current" />
            <span>{t('about.spotlight.replay')}</span>
          </div>
        </Button>
      </SettingsCard>

      {/* 法律政策外链（隐私政策 / 服务条款）；外链走主进程白名单 openExternal */}
      <SettingsCard>
        {[
          { label: t('about.legal.privacy'), url: ASCI_PRIVACY_POLICY_URL },
          { label: t('about.legal.terms'), url: ASCI_TERMS_OF_USE_URL },
        ].map(({ label, url }) => (
          <Button
            key={url}
            variant="ghost"
            onClick={() => openExternal(url)}
            className="w-full h-auto flex items-center gap-3 px-4 py-3 text-left rounded-none font-normal hover:bg-foreground/[0.03] [&_svg]:size-3"
          >
            <span className="flex-1 min-w-0 text-sm font-medium text-foreground">{label}</span>
            <ExternalLink className="flex-shrink-0 text-muted-foreground" />
          </Button>
        ))}
      </SettingsCard>

      {/* Shell 环境卡片（仅 Windows） */}
      <ShellEnvironmentCard />
    </SettingsSection>
  )
}
