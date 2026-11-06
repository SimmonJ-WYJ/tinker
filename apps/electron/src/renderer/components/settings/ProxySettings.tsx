/**
 * ProxySettings - 代理配置页
 *
 * 全局代理配置，支持系统代理自动检测和手动配置。
 * 所有 AI API 请求（Agent）都会使用这里的代理配置。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Globe, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsInput,
  SettingsRadioGroup,
} from './primitives'
import { proxyConfigAtom, loadProxyConfigAtom, updateProxyConfigAtom } from '@/atoms/proxy-atoms'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import type { ProxyMode } from '@asci/shared'

export function ProxySettings(): React.ReactElement {
  const { t } = useT('settings')
  const [config, setConfig] = useAtom(proxyConfigAtom)
  const loadProxyConfig = useSetAtom(loadProxyConfigAtom)
  const updateProxyConfig = useSetAtom(updateProxyConfigAtom)

  const [detecting, setDetecting] = React.useState(false)
  const [detectResult, setDetectResult] = React.useState<{ success: boolean; message: string } | null>(null)

  // 初始化加载配置
  React.useEffect(() => {
    loadProxyConfig()
  }, [loadProxyConfig])

  if (!config) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 size={24} className="animate-spin" />
        <span className="ml-2">{t('proxy.loading')}</span>
      </div>
    )
  }

  /** 更新代理配置（本地状态 + 持久化） */
  const handleUpdate = async (updates: Partial<typeof config>): Promise<void> => {
    const updated = { ...config, ...updates }
    setConfig(updated)
    try {
      await updateProxyConfig(updated)
    } catch (error) {
      console.error('[代理设置] 更新失败:', error)
    }
  }

  /** 检测系统代理 */
  const handleDetectSystemProxy = async (): Promise<void> => {
    setDetecting(true)
    setDetectResult(null)

    try {
      const result = await window.electronAPI.detectSystemProxy()
      setDetectResult({
        success: result.success,
        message: result.success
          ? t('proxy.system.detected', { url: result.proxyUrl })
          : result.message,
      })
    } catch {
      setDetectResult({
        success: false,
        message: t('proxy.system.detectFailed'),
      })
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 代理开关 */}
      <SettingsSection
        title={t('proxy.section.title')}
        description={t('proxy.section.description')}
      >
        <SettingsCard>
          <SettingsToggle
            label={t('proxy.enableLabel')}
            description={t('proxy.enableDescription')}
            checked={config.enabled}
            onCheckedChange={(enabled) => handleUpdate({ enabled })}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 代理模式选择（仅在启用时显示） */}
      {config.enabled && (
        <SettingsSection title={t('proxy.modeSection')}>
          <SettingsCard>
            <SettingsRadioGroup<ProxyMode>
              value={config.mode}
              onValueChange={(mode) => handleUpdate({ mode })}
              options={[
                {
                  value: 'system',
                  icon: <Globe size={16} />,
                  label: t('proxy.system.title'),
                  description: t('proxy.system.description'),
                  children: (
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleDetectSystemProxy}
                        disabled={detecting}
                        className="h-auto gap-1.5 p-0 text-xs text-primary hover:bg-transparent hover:text-primary/80 [&_svg]:size-3"
                      >
                        {detecting ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        <span>{t('proxy.system.detect')}</span>
                      </Button>
                      {detectResult && (
                        <div
                          className={cn(
                            'flex items-center gap-1.5 text-xs mt-2',
                            detectResult.success ? 'text-success' : 'text-muted-foreground'
                          )}
                        >
                          {detectResult.success ? (
                            <CheckCircle2 size={12} />
                          ) : (
                            <XCircle size={12} />
                          )}
                          <span>{detectResult.message}</span>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  value: 'manual',
                  label: t('proxy.manual.title'),
                  description: t('proxy.manual.description'),
                  children: (
                    <SettingsInput
                      label=""
                      value={config.manualUrl}
                      onChange={(value) => handleUpdate({ manualUrl: value })}
                      placeholder={t('proxy.manual.placeholder')}
                      description={t('proxy.manual.format')}
                    />
                  ),
                },
              ]}
            />
          </SettingsCard>
        </SettingsSection>
      )}
    </div>
  )
}
