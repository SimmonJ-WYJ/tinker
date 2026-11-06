/**
 * DataCollectionTab - Settings → 数据采集（issues #426 #427 / ADR-011）
 *
 * 0.3 埋点合规承载位：两条**互相独立**的 consent 开关
 *  - PostHog 行为埋点（检索/综述/登录等产品事件）
 *  - Agent 自进化信号（5 类结构化信号 + 隐式反馈，独立通道）
 *
 * 默认值由主进程按地域启发式决定（GDPR 区默认关 opt-in / 非 GDPR 区默认开
 * opt-out / 无法判定按 GDPR 区），用户显式选择持久化到 settings.telemetryConsent。
 * 开关语义 = 采集入口全停：关闭后不写本地缓冲也不上报。
 * Sentry 崩溃上报恒开（严格脱敏），本页仅作说明不提供开关（PRD Epic 3）。
 */

import * as React from 'react'
import { Database, ShieldCheck, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import type { TelemetryConsentState } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { DevOnly } from '@/lib/dev-mode'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'

export function DataCollectionTab(): React.ReactElement {
  const { t } = useT('settings')
  const [consent, setConsent] = React.useState<TelemetryConsentState | null>(null)
  // dev 强制上报开关（仅 dev 可见，替代手敲 ASCI_TELEMETRY_FORCE_SEND；重启生效）
  const [devForceSend, setDevForceSend] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.telemetryGetConsentState().then((state) => {
      if (!cancelled) setConsent(state)
    })
    window.electronAPI.getSettings().then((s) => {
      // 默认开：未设置视为开启，仅显式 false 才算关闭
      if (!cancelled) setDevForceSend(s.telemetryDevForceSend !== false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleDevForceSend = async (value: boolean): Promise<void> => {
    setDevForceSend(value) // 乐观更新
    await window.electronAPI.updateSettings({ telemetryDevForceSend: value })
  }

  /** 切换一路开关：显式持久化两路当前值（另一路冻结在当前生效值，互不影响） */
  const toggleConsent = async (key: 'posthogEnabled' | 'agentEvolutionEnabled', value: boolean): Promise<void> => {
    if (!consent) return
    const next: TelemetryConsentState = { ...consent, [key]: value }
    setConsent(next) // 乐观更新
    await window.electronAPI.updateSettings({
      telemetryConsent: {
        posthogEnabled: next.posthogEnabled,
        agentEvolutionEnabled: next.agentEvolutionEnabled,
      },
    })
  }

  const regionNote =
    consent?.region === 'non-gdpr'
      ? t('dataCollection.regionDefault.nonGdpr')
      : t('dataCollection.regionDefault.gdpr')

  return (
    <div className="space-y-6">
      {/* My data —— 本地研究数据导出（DO-2，issue #419）。置于数据采集页首部。 */}
      <SettingsSection
        title={t('dataCollection.export.title')}
        description={t('dataCollection.export.description')}
      >
        <SettingsCard>
          <DataExportRow />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('dataCollection.title')}>
        <p className="text-sm text-foreground/60 leading-relaxed mb-4">
          {t('dataCollection.intro')}
        </p>

        <SettingsCard>
          <SettingsRow
            label={t('dataCollection.posthog.label')}
            description={t('dataCollection.posthog.description')}
          >
            <Switch
              checked={consent?.posthogEnabled ?? false}
              disabled={!consent}
              onCheckedChange={(checked) => void toggleConsent('posthogEnabled', checked)}
              aria-label={t('dataCollection.posthog.label')}
            />
          </SettingsRow>
          <SettingsRow
            label={t('dataCollection.agentEvolution.label')}
            description={t('dataCollection.agentEvolution.description')}
          >
            <Switch
              checked={consent?.agentEvolutionEnabled ?? false}
              disabled={!consent}
              onCheckedChange={(checked) => void toggleConsent('agentEvolutionEnabled', checked)}
              aria-label={t('dataCollection.agentEvolution.label')}
            />
          </SettingsRow>
        </SettingsCard>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-foreground/60">
          <Database size={14} className="mt-0.5 flex-shrink-0 text-foreground/40" />
          <span>{regionNote}</span>
        </div>

        <div className="mt-2 flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-foreground/60">
          <ShieldCheck size={14} className="mt-0.5 flex-shrink-0 text-foreground/40" />
          <span>{t('dataCollection.sentryNote')}</span>
        </div>

        {/* dev-only：开发环境强制真实上报开关（替代 ASCI_TELEMETRY_FORCE_SEND，重启生效）。
            打包产物剥离本块（dev-mode 基于 import.meta.env.DEV），prod 不可见。 */}
        <DevOnly>
          <SettingsCard className="mt-4">
            <SettingsRow
              label="开发环境强制上报（dev only）"
              description="dev 默认即真实上报 PostHog / Sentry（便于联调验证），等价于 ASCI_TELEMETRY_FORCE_SEND=1。关闭后 dev 下仅写本地 JSONL 不发网络。"
            >
              <Switch
                checked={devForceSend ?? false}
                disabled={devForceSend === null}
                onCheckedChange={(checked) => void toggleDevForceSend(checked)}
                aria-label="开发环境强制上报"
              />
            </SettingsRow>
          </SettingsCard>
          <div className="mt-2 flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs text-foreground/60">
            <FlaskConical size={14} className="mt-0.5 flex-shrink-0 text-foreground/40" />
            <span>PostHog 行为上报即时生效；Sentry 崩溃上报需重启（启动期初始化）。仅开发可见，打包产物剥离本开关、且本就真实上报。</span>
          </div>
        </DevOnly>
      </SettingsSection>
    </div>
  )
}

// ===== 数据导出行（DO-2，issue #419）：一键导出全部本地研究数据为 zip =====

function DataExportRow(): React.ReactElement {
  const { t } = useT('settings')
  const [exporting, setExporting] = React.useState(false)

  const handleExport = async (): Promise<void> => {
    setExporting(true)
    try {
      const result = await window.electronAPI.exportMyData()
      if (result.status === 'ok') {
        toast.success(t('dataCollection.export.success', { count: result.objectCount }))
      } else if (result.status === 'error') {
        toast.error(t('dataCollection.export.error'), { description: result.message })
      }
      // canceled：用户主动取消 Save As，静默
    } finally {
      setExporting(false)
    }
  }

  return (
    <SettingsRow
      label={t('dataCollection.export.label')}
      description={t('dataCollection.export.rowDescription')}
    >
      <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
        {exporting ? t('dataCollection.export.exporting') : t('dataCollection.export.button')}
      </Button>
    </SettingsRow>
  )
}
