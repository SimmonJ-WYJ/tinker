/**
 * ZoteroSettings - Zotero 文献库接入设置
 *
 * 渲染结构（自上而下）：
 * - 主控卡（SettingsCard）
 *   - ConnectionMasterRow：连接状态作为标题位，背景色随状态变化（淡红/淡黄/淡绿），
 *     就绪态主 Switch 可点；故障态副行右对齐显示动作按钮（下载/启动 Zotero/查看说明）
 *   - ZoteroSubCapabilityRow（OCR）：pl-8 缩进 + 内置 Pill
 *   - ZoteroSubCapabilityRow（ASR）：pl-8 缩进 + 需下载 1GB Pill，下载进度条
 * - 数据目录卡：可选的绝对路径覆盖
 * - PDF 同步卡：手动触发 zotero.runPdfDiff 走 trigger 层
 *
 * 状态派生：(installed, running, remoteEnabled) → ConnectionVariant，
 * 按 not-installed > not-running > no-api > ready 优先级落到 MASTER_VARIANT_CONFIG。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ExternalLink, FolderOpen, Loader2, Play, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import {
  zoteroEnabledAtom,
  zoteroPingStatusAtom,
  zoteroInstallStatusAtom,
  zoteroDataDirAtom,
  zoteroAdvancedOpenAtom,
} from '@/atoms/zotero-atoms'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { suppressCapabilityToasts } from '@/lib/capability-toast-suppress'
import { openZoteroDownload, openZoteroRemoteDocs } from '@/components/agent/zotero-ready-gate'
import { SettingsSection, SettingsCard, SettingsModuleRow } from './primitives'
import { Badge, type BadgeProps } from '@/components/ui/badge.tsx'
import { ZoteroMediaPanel } from './ZoteroMediaPanel'
import { ZoteroArticlePanel } from './ZoteroArticlePanel'
import { ZoteroEmbeddingPanel } from './ZoteroEmbeddingPanel'
import { formatBytes } from '@/lib/format-bytes'
import { useT } from '@/hooks/useT'
import {
  asrWeightsStatusAtom,
  asrWeightsDownloadAtom,
  asrWeightsCancelAtom,
  asrWeightsRefreshAtom,
} from '@/atoms/asr-weights'

type ConnectionVariant = 'not-installed' | 'not-running' | 'no-api' | 'ready'

// 连接状态 pill 的语义色子集（Badge tone 的窄化），保证 switch-case 穷尽性
// 从 BadgeProps['tone'] 派生：若 Badge 删/改某个 tone，Extract 结果收窄，用到处立即类型报错
type ConnectionTone = Extract<NonNullable<BadgeProps['tone']>, 'neutral' | 'success' | 'warning' | 'destructive'>

const VARIANT_TONE: Record<ConnectionVariant, ConnectionTone> = {
  'not-installed': 'destructive',
  'not-running': 'warning',
  'no-api': 'warning',
  'ready': 'success',
}

export function ZoteroSettings(): React.ReactElement {
  const { t } = useT('settings')
  const [enabled, setEnabled] = useAtom(zoteroEnabledAtom)
  const [pingStatus, setPingStatus] = useAtom(zoteroPingStatusAtom)
  const [installStatus, setInstallStatus] = useAtom(zoteroInstallStatusAtom)
  const [dataDir, setDataDir] = useAtom(zoteroDataDirAtom)
  const [dataDirInput, setDataDirInput] = React.useState<string>('')
  const [installPath, setInstallPathState] = React.useState<string | null>(null)
  const [installPathInput, setInstallPathInput] = React.useState<string>('')
  const [installPathSaving, setInstallPathSaving] = React.useState(false)
  const [launching, setLaunching] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const [generatingTxt, setGeneratingTxt] = React.useState(false)
  const [advancedUserOpen, setAdvancedUserOpen] = useAtom(zoteroAdvancedOpenAtom)

  React.useEffect(() => {
    setDataDirInput(dataDir ?? '')
  }, [dataDir])

  // 初始拉一次用户已配置的自定义 Zotero 安装路径（持久化在 settings 里）
  React.useEffect(() => {
    void window.electronAPI.zotero.getInstallPath().then((p) => {
      setInstallPathState(p)
      setInstallPathInput(p ?? '')
    })
  }, [])

  // 初始拉一次"高级"组用户记忆的展开状态
  React.useEffect(() => {
    void window.electronAPI.getSettings().then((s) => {
      setAdvancedUserOpen(s.zoteroAdvancedOpen ?? false)
    })
  }, [setAdvancedUserOpen])

  const refresh = React.useCallback(async (): Promise<void> => {
    const [install, ping] = await Promise.all([
      window.electronAPI.zotero.detectInstall(),
      window.electronAPI.zotero.ping(),
    ])
    setInstallStatus(install)
    setPingStatus(ping)
  }, [setInstallStatus, setPingStatus])

  /** 初始加载 + 定期刷新状态 */
  React.useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const handleDownload = openZoteroDownload
  const handleOpenDocs = openZoteroRemoteDocs

  const handleLaunch = async (): Promise<void> => {
    setLaunching(true)
    try {
      const result = await window.electronAPI.zotero.launchApp()
      if (!result.success) {
        toast.error(t('zotero.syncToast.launchFailed'), {
          description: result.message ?? t('zotero.syncToast.launchFailedDesc'),
        })
        return
      }
      // 轮询等 Zotero 连上（最多 10 秒）
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const status = await window.electronAPI.zotero.ping()
        setPingStatus(status)
        if (status.running) break
      }
    } finally {
      setLaunching(false)
    }
  }

  const handleSaveDataDir = async (): Promise<void> => {
    const trimmed = dataDirInput.trim()
    const next = trimmed.length > 0 ? trimmed : null
    await window.electronAPI.zotero.setDataDir(next)
    setDataDir(next)
  }

  /**
   * 唤起平台文件选择器选 Zotero 应用 / 可执行文件，
   * 主进程校验通过后立即写盘并刷新探测状态。
   */
  const handleBrowseInstallPath = async (): Promise<void> => {
    const picked = await window.electronAPI.zotero.browseInstallPath()
    if (!picked) return
    setInstallPathSaving(true)
    try {
      const res = await window.electronAPI.zotero.setInstallPath(picked)
      if (!res.ok) {
        toast.error(t('zotero.installPath.invalidTitle'), {
          description: t(`zotero.installPath.invalidReason.${res.reason ?? 'not-a-zotero-binary'}`),
        })
        return
      }
      const normalized = res.normalizedPath ?? picked
      setInstallPathState(normalized)
      setInstallPathInput(normalized)
      toast.success(t('zotero.installPath.savedToast'))
      await refresh()
    } finally {
      setInstallPathSaving(false)
    }
  }

  /** 用户手动粘贴路径 → 保存（主进程会先校验） */
  const handleSaveInstallPath = async (): Promise<void> => {
    const trimmed = installPathInput.trim()
    setInstallPathSaving(true)
    try {
      const res = await window.electronAPI.zotero.setInstallPath(trimmed.length > 0 ? trimmed : null)
      if (!res.ok) {
        toast.error(t('zotero.installPath.invalidTitle'), {
          description: t(`zotero.installPath.invalidReason.${res.reason ?? 'not-a-zotero-binary'}`),
        })
        return
      }
      const normalized = trimmed.length > 0 ? (res.normalizedPath ?? trimmed) : null
      setInstallPathState(normalized)
      setInstallPathInput(normalized ?? '')
      toast.success(normalized ? t('zotero.installPath.savedToast') : t('zotero.installPath.clearedToast'))
      await refresh()
    } finally {
      setInstallPathSaving(false)
    }
  }

  /** 清除自定义路径，回退到自动探测 */
  const handleClearInstallPath = async (): Promise<void> => {
    setInstallPathSaving(true)
    try {
      await window.electronAPI.zotero.setInstallPath(null)
      setInstallPathState(null)
      setInstallPathInput('')
      toast.success(t('zotero.installPath.clearedToast'))
      await refresh()
    } finally {
      setInstallPathSaving(false)
    }
  }

  const handleToggleEnabled = async (next: boolean): Promise<void> => {
    setBusy(true)
    try {
      // 一次切换会写入 zotero/ocr/asr 三个 MCP，抑制底层逐条 toast，自行展示一条聚合提示
      suppressCapabilityToasts()
      await window.electronAPI.zotero.setEnabled(next)
      setEnabled(next)
      if (next) {
        toast.success(t('zotero.syncToast.enabled'))
      } else {
        toast.info(t('zotero.syncToast.disabledNotice'))
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * 立即同步：手动触发一次 Zotero PDF diff
   *
   * 主进程内部走 trigger 层（reason='manual'），结果按 status 映射到不同 toast。
   * 这条路径绕开 60s 心跳的 mtime 节流，强制跑一次完整 diff。
   */
  const handleManualSync = async (): Promise<void> => {
    if (syncing) return
    setSyncing(true)
    try {
      const result = await window.electronAPI.zotero.runPdfDiff()
      if (result.status === 'first-baseline') {
        toast.success(t('zotero.syncToast.baseline', { count: result.total }))
      } else if (result.status === 'diff') {
        const a = result.added.length
        const m = result.modified.length
        const d = result.deleted.length
        if (a + m + d === 0) {
          toast.info(t('zotero.syncToast.noChanges'))
        } else {
          toast.success(t('zotero.syncToast.diff', { added: a, modified: m, deleted: d }))
        }
      } else if (result.status === 'skipped-zotero-offline') {
        toast.warning(t('zotero.syncToast.offline'))
      } else if (result.status === 'skipped-disabled') {
        toast.info(t('zotero.syncToast.disabled'))
      } else if (result.status === 'skipped-noop') {
        toast.info(t('zotero.syncToast.noChanges'))
      } else if (result.status === 'error') {
        toast.error(t('zotero.syncToast.syncFailed'), { description: result.message })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.syncToast.syncFailed'), { description: msg })
    } finally {
      setSyncing(false)
    }
  }

  /**
   * 手动触发 structured .txt 全量生成：和 lite worker（产 .md）完全独立
   * extractor → classifier → formatter → 富 markdown wrap → 写到 wiki/{key}.txt
   * 这是个长任务，UI 用 sonner toast 给个粗略汇总
   */
  const handleGenerateStructuredTxt = async (): Promise<void> => {
    if (generatingTxt) return
    setGeneratingTxt(true)
    try {
      const r = await window.electronAPI.zotero.generateStructuredTxtAll()
      if (r.total === 0) {
        toast.info(t('zotero.structuredTxt.toastEmpty'))
      } else if (r.failed === 0) {
        toast.success(
          t('zotero.structuredTxt.toastSuccess', {
            generated: r.generated,
            skipped: r.skipped,
          }),
        )
      } else {
        toast.warning(
          t('zotero.structuredTxt.toastPartial', {
            generated: r.generated,
            failed: r.failed,
          }),
          {
            description: r.failures
              .slice(0, 3)
              .map((f) => `${f.attachmentKey}: ${f.error}`)
              .join('\n'),
          },
        )
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.structuredTxt.toastFailed'), { description: msg })
    } finally {
      setGeneratingTxt(false)
    }
  }

  const variant: ConnectionVariant = !installStatus.installed
    ? 'not-installed'
    : !pingStatus.running
      ? 'not-running'
      : !pingStatus.remoteEnabled
        ? 'no-api'
        : 'ready'
  const canEnable = variant === 'ready'

  // 仅在「首次检测到 Zotero 连通」那一刻自动启用一次：消费一次性持久化标记。
  // 用户后续手动关掉不会被再次自动打开
  const autoEnableTriedRef = React.useRef(false)
  React.useEffect(() => {
    if (!canEnable || enabled || autoEnableTriedRef.current) return
    autoEnableTriedRef.current = true
    void (async () => {
      const settings = await window.electronAPI.getSettings()
      if (settings.zoteroAutoEnableConsumed) return
      await window.electronAPI.updateSettings({ zoteroAutoEnableConsumed: true })
      await handleToggleEnabled(true)
    })()
  }, [canEnable, enabled])

  // "高级"组自动展开条件：Zotero 未探测到 / 用户设过非空 installPath / 用户设过非空 dataDir
  // 命中任一即强制展开，覆盖用户折叠记忆，并在折叠条标题加 warning 文案
  const advancedAutoOpen =
    !installStatus.installed ||
    (installPath !== null && installPath !== '') ||
    (dataDir !== null && dataDir !== '')
  const advancedOpen = advancedAutoOpen || advancedUserOpen
  const advancedLabel = advancedAutoOpen
    ? t('zotero.advanced.labelWarning')
    : t('zotero.advanced.label')

  const handleAdvancedToggle = (e: React.SyntheticEvent<HTMLDetailsElement>): void => {
    // 自动展开条件命中时不写记忆——避免用户手动折叠后被状态翻转污染
    if (advancedAutoOpen) return
    const next = e.currentTarget.open
    setAdvancedUserOpen(next)
    void window.electronAPI.updateSettings({ zoteroAdvancedOpen: next })
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('zotero.section.title')}
        description={t('zotero.section.description')}
      >
        {/* Zotero 模块：访问能力 + 数据目录 + PDF 同步 —— 用 SettingsCard 自带分隔线分块，高级设置折进可折叠组 */}
        <SettingsCard>
          {/* 三行各自作为 SettingsCard 单一子元素，由 SettingsCard 在行之间自动插入分隔线 */}
          <ConnectionMasterRow
            variant={variant}
            enabled={enabled}
            busy={busy}
            launching={launching}
            onToggleEnabled={handleToggleEnabled}
            onDownload={handleDownload}
            onLaunch={handleLaunch}
            onOpenDocs={handleOpenDocs}
          />
          <ZoteroSubCapabilityRow
            kind="ocr"
            label={t('zotero.ocr.label')}
            description={t('zotero.ocr.description')}
            disabled={!enabled}
          />
          <ZoteroSubCapabilityRow
            kind="asr"
            label={t('zotero.asr.label')}
            description={t('zotero.asr.description')}
            disabled={!enabled}
          />

          <details
            open={advancedOpen}
            onToggle={handleAdvancedToggle}
            className="group rounded-xl bg-muted/20"
          >
            <summary
              className={cn(
                'flex cursor-pointer list-none select-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden',
                advancedAutoOpen && 'text-warning',
              )}
            >
              <span className="text-sm font-medium">{advancedLabel}</span>
              <span className="text-xs text-muted-foreground group-open:hidden">
                {t('zotero.advanced.expand')}
              </span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">
                {t('zotero.advanced.collapse')}
              </span>
            </summary>
            <div className="space-y-1 px-2 pb-2">
          <div className="rounded-xl bg-background/40">
            <SettingsModuleRow
              title={t('zotero.installPath.title')}
              description={
                installPath
                  ? t('zotero.installPath.descriptionCustom')
                  : installStatus.installed
                    ? t('zotero.installPath.descriptionAuto')
                    : t('zotero.installPath.descriptionNotFound')
              }
              action={null}
              className="py-2"
            />
            <div className="px-4 pb-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={installPathInput}
                  onChange={(e) => setInstallPathInput(e.target.value)}
                  placeholder={t('zotero.installPath.placeholder')}
                  className="flex-1 text-sm"
                  disabled={installPathSaving}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBrowseInstallPath}
                  disabled={installPathSaving}
                  title={t('zotero.installPath.browse')}
                >
                  <FolderOpen size={13} className="!size-[13px]" />
                  <span>{t('zotero.installPath.browse')}</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveInstallPath}
                  disabled={installPathSaving || (installPath ?? '') === installPathInput.trim()}
                >
                  {t('zotero.installPath.save')}
                </Button>
                {installPath && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleClearInstallPath}
                    disabled={installPathSaving}
                    title={t('zotero.installPath.clear')}
                  >
                    <X size={13} />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-background/40">
            <SettingsModuleRow
              title={t('zotero.dataDir.title')}
              description={t('zotero.dataDir.description')}
              action={null}
              className="py-2"
            />
            <div className="px-4 pb-2">
              <div className="flex items-center gap-2">
                <Input
                  value={dataDirInput}
                  onChange={(e) => setDataDirInput(e.target.value)}
                  placeholder="/Users/.../MyZoteroData"
                  className="flex-1 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveDataDir}
                  disabled={(dataDir ?? '') === dataDirInput.trim()}
                >
                  {t('zotero.dataDir.save')}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-background/40">
            <SettingsModuleRow
              title={t('zotero.pdfSync.title')}
              description={t('zotero.pdfSync.description')}
              className="py-2"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleManualSync}
                  disabled={!enabled || syncing}
                >
                  {syncing ? <Loader2 size={13} className="animate-spin !size-[13px]" /> : <RefreshCw size={13} className="!size-[13px]" />}
                  <span>{syncing ? t('zotero.pdfSync.syncing') : t('zotero.pdfSync.syncNow')}</span>
                </Button>
              }
            />
            <SettingsModuleRow
              title={t('zotero.structuredTxt.title')}
              description={t('zotero.structuredTxt.description')}
              className="py-2"
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateStructuredTxt}
                  disabled={!enabled || generatingTxt}
                >
                  {generatingTxt ? <Loader2 size={13} className="animate-spin !size-[13px]" /> : <RefreshCw size={13} className="!size-[13px]" />}
                  <span>{generatingTxt ? t('zotero.structuredTxt.generating') : t('zotero.structuredTxt.generateAll')}</span>
                </Button>
              }
            />
          </div>
            </div>
          </details>
        </SettingsCard>
      </SettingsSection>

      <ZoteroArticlePanel />

      <ZoteroEmbeddingPanel />

      <ZoteroMediaPanel />
    </div>
  )
}

// ===== Zotero 子能力开关（OCR/ASR） =====

interface ZoteroSubCapabilityRowProps {
  kind: 'ocr' | 'asr'
  label: string
  description: string
  disabled: boolean
}

function ZoteroSubCapabilityRow({ kind, label, description, disabled }: ZoteroSubCapabilityRowProps): React.ReactElement {
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
  }, [settingsKey, fallback])

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
        bumpCapabilitiesVersion((v) => v + 1)
        setPendingEnable(false)
        toast.success(t('zotero.asrToast.ready'))
      })()
    } else if (asrStatus?.state === 'error' || asrStatus?.state === 'missing') {
      // 下载失败或被取消：清掉等待，Switch 回到 OFF
      setPendingEnable(false)
    }
  }, [pendingEnable, asrStatus?.state, settingsKey, bumpCapabilitiesVersion, kind])

  const persist = async (value: boolean): Promise<void> => {
    setBusy(true)
    try {
      await window.electronAPI.updateSettings({ [settingsKey]: value })
      setIntent(value)
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

// ===== 主控行：连接状态 + 启用 Agent 访问，背景色随状态变化 =====

interface ConnectionMasterRowProps {
  variant: ConnectionVariant
  enabled: boolean
  busy: boolean
  launching: boolean
  onToggleEnabled: (next: boolean) => void
  onDownload: () => void
  onLaunch: () => void
  onOpenDocs: () => void
}

function ConnectionMasterRow({
  variant,
  enabled,
  busy,
  launching,
  onToggleEnabled,
  onDownload,
  onLaunch,
  onOpenDocs,
}: ConnectionMasterRowProps): React.ReactElement {
  const { t } = useT('settings')
  // ready 但用户关掉 Agent 访问时，pill 文案 + 颜色切到 "paused"（中性色），
  // 避免出现绿色"已连接" + toggle off 的状态矛盾
  const isPaused = variant === 'ready' && !enabled
  const pillTone: ConnectionTone = isPaused ? 'neutral' : VARIANT_TONE[variant]
  const variantLabel = (() => {
    if (isPaused) return t('zotero.status.paused')
    switch (variant) {
      case 'not-installed': return t('zotero.status.notInstalled')
      case 'not-running': return t('zotero.status.notRunning')
      case 'no-api': return t('zotero.status.noApi')
      case 'ready': return t('zotero.status.ready')
    }
  })()
  // 非 ready 状态隐藏 Switch，避免和下方 CTA 重复表达；
  // ready 时 Switch 才有意义（用户可以真正开关 Agent 访问）
  const showSwitch = variant === 'ready'

  return (
    <div className="overflow-hidden">
      <SettingsModuleRow
        title={t('zotero.master.title')}
        description={t('zotero.master.description')}
        pill={<Badge tone={pillTone} variant="soft" className="h-6 leading-[1]">{variantLabel}</Badge>}
        action={
          showSwitch ? (
            <Switch
              checked={enabled}
              onCheckedChange={onToggleEnabled}
              disabled={busy}
            />
          ) : null
        }
      />
      {variant !== 'ready' && (
        <div className="flex justify-end px-4 pb-3">
          {variant === 'not-installed' && (
            <Button size="sm" variant="outline" onClick={onDownload}>
              <ExternalLink size={13} className="!size-[13px]" />
              <span>{t('zotero.actions.downloadZotero')}</span>
            </Button>
          )}
          {variant === 'not-running' && (
            <Button size="sm" variant="outline" onClick={onLaunch} disabled={launching}>
              {launching ? <Loader2 size={13} className="animate-spin !size-[13px]" /> : <Play size={13} className="!size-[13px]" />}
              <span>{launching ? t('zotero.actions.launching') : t('zotero.actions.launchZotero')}</span>
            </Button>
          )}
          {variant === 'no-api' && (
            <Button size="sm" variant="outline" onClick={onOpenDocs}>
              <ExternalLink size={13} className="!size-[13px]" />
              <span>{t('zotero.actions.viewDocs')}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

