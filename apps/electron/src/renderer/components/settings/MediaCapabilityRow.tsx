/** 通用媒体开关：独立保存兼容设置字段，下载仅由用户开启 ASR 触发。 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge.tsx'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { asrWeightsStatusAtom, asrWeightsDownloadAtom, asrWeightsCancelAtom, asrWeightsRefreshAtom } from '@/atoms/asr-weights'
import { SettingsModuleRow } from './primitives'
import { formatBytes } from '@/lib/format-bytes'
import { useT } from '@/hooks/useT'

interface MediaCapabilityRowProps {
  kind: 'ocr' | 'asr'
  label: string
  description: string
  disabled?: boolean
  refreshVersion?: string
  onSettingsChanged?: () => Promise<void>
}

export function MediaCapabilityRow({ kind, label, description, disabled = false, onSettingsChanged, refreshVersion }: MediaCapabilityRowProps): React.ReactElement {
  const { t } = useT('settings')
  // 默认值：ocr=true（已打包），asr=false（要下载）—— 与 main 端 buildBuiltinResolverInputFromEnv 一致
  const settingsKey = kind === 'ocr' ? 'zoteroOcrEnabled' : 'zoteroAsrEnabled'
  const pillText = kind === 'ocr' ? t('zotero.ocr.pill') : t('zotero.asr.pill')
  const fallback = kind === 'ocr'
  const [intent, setIntent] = React.useState<boolean | null>(null) // null = 还没拉到 settings
  const [busy, setBusy] = React.useState(false)
  // ASR 专属：用户已点 ON 但模型还在下载，视觉上 Switch 显 ON+disabled，下载完才落盘 settings
  const [pendingEnable, setPendingEnable] = React.useState(false)
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)
  const asrStatus = useAtomValue(asrWeightsStatusAtom)
  const triggerAsrDownload = useSetAtom(asrWeightsDownloadAtom)
  const triggerAsrCancel = useSetAtom(asrWeightsCancelAtom)
  const refreshAsrStatus = useSetAtom(asrWeightsRefreshAtom)

  React.useEffect(() => {
    void window.electronAPI.getSettings().then((s) => {
      const value = s[settingsKey]
      setIntent(typeof value === 'boolean' ? value : fallback)
    })
  }, [settingsKey, fallback, refreshVersion])

  // ASR 行 mount 时拉一次状态（订阅由 AsrWeightsInitializer 全局挂载）
  React.useEffect(() => {
    if (kind === 'asr') void refreshAsrStatus()
  }, [kind, refreshAsrStatus])

  // 用户点过"开启 ASR"但模型在下载：等 status 转 ready → 写 settings.zoteroAsrEnabled=true
  React.useEffect(() => {
    if (kind !== 'asr' || !pendingEnable) return
    if (asrStatus?.state === 'ready') {
      void (async () => {
        await window.electronAPI.updateSettings({ [settingsKey]: true })
        setIntent(true)
        await onSettingsChanged?.()
        bumpCapabilitiesVersion((v) => v + 1)
        setPendingEnable(false)
        toast.success(t('zotero.asrToast.ready'))
      })()
    } else if (asrStatus?.state === 'error' || asrStatus?.state === 'missing') {
      // 下载失败或被取消：清掉等待，Switch 回到 OFF
      setPendingEnable(false)
    }
  }, [pendingEnable, asrStatus?.state, settingsKey, bumpCapabilitiesVersion, kind, onSettingsChanged, t])

  const persist = async (value: boolean): Promise<void> => {
    setBusy(true)
    try {
      await window.electronAPI.updateSettings({ [settingsKey]: value })
      setIntent(value)
      await onSettingsChanged?.()
      bumpCapabilitiesVersion((v) => v + 1)
    } finally {
      setBusy(false)
    }
  }

  const handleChange = async (next: boolean): Promise<void> => {
    if (kind !== 'asr') {
      await persist(next)
      return
    }
    // ASR：开启时需要先确定下载完成才能落盘
    if (!next) {
      setPendingEnable(false)
      await persist(false)
      return
    }
    // 用户点 ON：模型已就绪 → 直接生效；否则触发下载并进入 pending
    if (asrStatus?.state === 'ready') {
      await persist(true)
      return
    }
    setPendingEnable(true)
    void triggerAsrDownload()
    toast.info(t('zotero.asrToast.downloading'), { description: t('zotero.asrToast.downloadingDesc') })
  }

  // ASR 进度计算
  const asrLoading =
    kind === 'asr' &&
    (asrStatus?.state === 'downloading' ||
      asrStatus?.state === 'extracting' ||
      asrStatus?.state === 'verifying')
  const asrError = kind === 'asr' && asrStatus?.state === 'error'
  const progress = kind === 'asr' ? asrStatus?.progress : undefined
  const percent = progress?.bytesTotal
    ? Math.min(99, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
    : 0

  // Switch 显示状态：pending 时视觉上 ON（用户期望的最终状态）；否则反映 intent
  const switchChecked = pendingEnable ? true : (intent ?? fallback)
  const switchDisabled = disabled || busy || intent === null || asrLoading || pendingEnable

  // 用 div 包整行（含可选进度条 / error），让外层 SettingsCard 把整个行视为单一子元素，
  // 避免 Fragment 被 React.Children.toArray 拍平后在行内部被分隔线拆开
  return (
    <div>
      <SettingsModuleRow
        title={label}
        description={description}
        pill={<Badge variant="soft" className="h-6 leading-[1]">{pillText}</Badge>}
        action={
          <Switch
            aria-label={label}
            checked={switchChecked}
            onCheckedChange={handleChange}
            disabled={switchDisabled}
          />
        }
      />
      {asrLoading && progress && (
        <div className="space-y-1.5 px-4 pb-3">
          <div className="h-1.5 rounded bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {progress.phase === 'download' ? t('zotero.asrProgress.phase.download') : t('zotero.asrProgress.phase.extract')} · {formatBytes(progress.bytesDone)} / {formatBytes(progress.bytesTotal)}
              {percent > 0 && ` · ${percent}%`}
              {progress.etaSeconds !== undefined && progress.phase === 'download' && progress.etaSeconds > 0 && ` · ${t('zotero.asrProgress.remaining', { eta: formatEta(progress.etaSeconds, t) })}`}
            </span>
            <Button
              type="button"
              variant="link"
              size="inline"
              className="text-xs text-destructive hover:underline"
              onClick={() => { void triggerAsrCancel() }}
            >
              {t('zotero.asrProgress.cancel')}
            </Button>
          </div>
        </div>
      )}
      {asrError && asrStatus?.error && (
        <div className="px-4 pb-3 text-xs text-destructive">{t('zotero.asrProgress.downloadFailed', { error: asrStatus.error })}</div>
      )}
    </div>
  )
}

/** 走 i18n 化的 ETA 格式器；t 通过参数注入避免顶层 Hook */
function formatEta(seconds: number, t: ReturnType<typeof useT<'settings'>>['t']): string {
  if (seconds < 60) return t('zotero.asrProgress.etaSeconds', { count: seconds })
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return t('zotero.asrProgress.etaCompound', { minutes: m, seconds: s })
}
