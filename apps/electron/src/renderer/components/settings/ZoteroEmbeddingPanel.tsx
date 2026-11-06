/**
 * 设置 → Zotero → 语义检索（向量索引）
 *
 * 评估三档（检索模式，新会话生效，便于 A/B 对比检索价值）：
 *   - vector    仅向量：注册 papers_semantic_search
 *   - papers-rg 仅关键词：注册 papers_search_keywords（ripgrep）；向量 worker 停
 *   - both      两者都给（默认）
 * 三档都保留 papers_read_* 深读工具。
 *
 * 展示：模型下载状态/进度（本地 ONNX，首次 ~135MB）+ 索引状态摘要 + 重建入口。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { ZoteroRetrievalMode } from '@asci/shared'
import { isVectorModeEnabled } from '@asci/shared'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  zoteroEmbeddingConfigAtom,
  zoteroEmbeddingModelStatusAtom,
  zoteroEmbeddingStatusAtom,
} from '@/atoms/zotero-embedding-atoms'
import { useT } from '@/hooks/useT'
import { formatBytes } from '@/lib/format-bytes'
import { SettingsCard, SettingsRow, SettingsSection } from './primitives'

const RETRIEVAL_MODES: ZoteroRetrievalMode[] = ['vector', 'papers-rg', 'both']

export function ZoteroEmbeddingPanel(): React.ReactElement {
  const { t } = useT('settings')
  const [config, setConfig] = useAtom(zoteroEmbeddingConfigAtom)
  const [status, setStatus] = useAtom(zoteroEmbeddingStatusAtom)
  const [modelStatus, setModelStatus] = useAtom(zoteroEmbeddingModelStatusAtom)
  const [busy, setBusy] = React.useState(false)
  const [rebuilding, setRebuilding] = React.useState(false)

  // 初始化 + 订阅两路状态推送
  React.useEffect(() => {
    void (async () => {
      try {
        const [c, s, m] = await Promise.all([
          window.electronAPI.zotero.embedding.getConfig(),
          window.electronAPI.zotero.embedding.getStatus(),
          window.electronAPI.zotero.embedding.getModelStatus(),
        ])
        setConfig(c)
        setStatus(s)
        setModelStatus(m)
      } catch (err) {
        console.warn('[向量索引] 初始化失败:', err)
      }
    })()
    const unsubStatus = window.electronAPI.zotero.embedding.onStatusChanged(setStatus)
    const unsubModel = window.electronAPI.zotero.embedding.onModelStatusChanged(setModelStatus)
    return () => {
      unsubStatus()
      unsubModel()
    }
  }, [setConfig, setStatus, setModelStatus])

  const modeLabel = (m: ZoteroRetrievalMode): string =>
    t(`zotero.embedding.mode.${m === 'papers-rg' ? 'papersRg' : m}`)

  const handleSetMode = async (next: ZoteroRetrievalMode): Promise<void> => {
    if (next === config.mode || busy) return
    setBusy(true)
    try {
      const updated = await window.electronAPI.zotero.embedding.setConfig({ mode: next })
      setConfig(updated)
      const summary = await window.electronAPI.zotero.embedding.getStatus()
      setStatus(summary)
      toast.success(t('zotero.embedding.toast.modeChanged', { mode: modeLabel(next) }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.embedding.toast.updateFailed'), { description: msg })
    } finally {
      setBusy(false)
    }
  }

  const handleDownloadModel = async (): Promise<void> => {
    try {
      const s = await window.electronAPI.zotero.embedding.downloadModel()
      setModelStatus(s)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.embedding.toast.downloadFailed'), { description: msg })
    }
  }

  const handleRebuild = async (): Promise<void> => {
    if (rebuilding) return
    const ok = window.confirm(t('zotero.embedding.toast.rebuildConfirm'))
    if (!ok) return
    setRebuilding(true)
    try {
      const enqueued = await window.electronAPI.zotero.embedding.rebuildAll()
      const summary = await window.electronAPI.zotero.embedding.getStatus()
      setStatus(summary)
      toast.success(t('zotero.embedding.toast.rebuildEnqueued', { count: enqueued }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.embedding.toast.rebuildFailed'), { description: msg })
    } finally {
      setRebuilding(false)
    }
  }

  const inflightCount = status.byStatus.pending + status.byStatus.embedding
  const failedCount = status.byStatus.failed
  const completedCount = status.byStatus.completed
  const progress = modelStatus.progress

  /** 各模型状态 → 描述文案（ready 不渲染该卡片，无需条目） */
  const modelStatusText = (): string => {
    switch (modelStatus.state) {
      case 'downloading': {
        const pct =
          progress && progress.bytesTotal > 0
            ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100))
            : 0
        return t('zotero.embedding.model.downloading', {
          pct,
          done: formatBytes(progress?.bytesDone),
          total: formatBytes(progress?.bytesTotal),
        })
      }
      case 'verifying':
        return t('zotero.embedding.model.verifying')
      case 'error':
        return t('zotero.embedding.model.error', { error: modelStatus.error ?? '' })
      default:
        return t('zotero.embedding.model.missing', { size: formatBytes(modelStatus.expectedBytes) })
    }
  }

  return (
    <SettingsSection
      title={t('zotero.embedding.section.title')}
      description={t('zotero.embedding.section.description')}
    >
      <SettingsCard>
        <SettingsRow
          label={t('zotero.embedding.mode.label')}
          description={t('zotero.embedding.mode.description')}
        >
          <div className="inline-flex rounded-lg bg-muted p-0.5" role="radiogroup">
            {RETRIEVAL_MODES.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={config.mode === m}
                disabled={busy}
                onClick={() => void handleSetMode(m)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-50',
                  config.mode === m
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {modeLabel(m)}
              </button>
            ))}
          </div>
        </SettingsRow>
      </SettingsCard>

      {isVectorModeEnabled(config.mode) && (
        <>
          {/* 模型状态卡：missing → 下载入口；downloading → 进度；ready → 静默并入索引卡 */}
          {modelStatus.state !== 'ready' && (
            <SettingsCard>
              <div className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {t('zotero.embedding.model.title')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{modelStatusText()}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={modelStatus.state === 'downloading' || modelStatus.state === 'verifying'}
                  onClick={handleDownloadModel}
                >
                  {modelStatus.state === 'downloading' ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  <span>
                    {modelStatus.state === 'error'
                      ? t('zotero.embedding.model.retry')
                      : t('zotero.embedding.model.download')}
                  </span>
                </Button>
              </div>
            </SettingsCard>
          )}

          <SettingsCard>
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    {t('zotero.embedding.status.title')}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t('zotero.embedding.status.summary', {
                      total: status.total,
                      completed: completedCount,
                      inflight: inflightCount,
                      failed: failedCount,
                    })}
                    {' · '}
                    {t('zotero.embedding.status.chunks', { count: status.chunkCount })}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rebuilding || status.total === 0}
                  onClick={handleRebuild}
                  title={t('zotero.embedding.actions.rebuildTooltip')}
                >
                  {rebuilding ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  <span>{t('zotero.embedding.actions.rebuild')}</span>
                </Button>
              </div>

              {status.recentFailed.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground">
                    {t('zotero.embedding.status.recentFailed')}
                  </div>
                  <ul className="space-y-1">
                    {status.recentFailed.map((item) => (
                      <li
                        key={item.attachmentKey}
                        className="text-xs text-muted-foreground rounded-md bg-muted/40 px-2 py-1.5"
                      >
                        <div className="font-medium text-foreground truncate">
                          {item.attachmentKey}
                        </div>
                        <div className="truncate">{item.error}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </SettingsCard>
        </>
      )}
    </SettingsSection>
  )
}
