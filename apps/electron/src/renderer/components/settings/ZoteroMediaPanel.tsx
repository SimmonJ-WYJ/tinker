/**
 * 设置 → Zotero → 附件解析缓存面板
 *
 * 展示 Zotero 附件识别结果缓存，并提供刷新 / 清理入口。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  mediaCacheStatsAtom,
  mediaCacheLoadingAtom,
  refreshMediaCacheStatsAtom,
  clearMediaCacheAtom,
} from '@/atoms/media-cache'
import { SettingsSection, SettingsCard, SettingsModuleRow } from './primitives'
import { Badge } from '@/components/ui/badge.tsx'
import { useT } from '@/hooks/useT'
import { formatBytes } from '@/lib/format-bytes'

interface ZoteroMediaPanelProps {
  embedded?: boolean
}

export function ZoteroMediaPanel({ embedded = false }: ZoteroMediaPanelProps): React.ReactElement {
  const { t } = useT('settings')
  const stats = useAtomValue(mediaCacheStatsAtom)
  const loading = useAtomValue(mediaCacheLoadingAtom)
  const refresh = useSetAtom(refreshMediaCacheStatsAtom)
  const clear = useSetAtom(clearMediaCacheAtom)

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const entryCount = stats?.entryCount ?? 0
  const totalBytes = stats?.totalBytes ?? 0

  const handleClear = (): void => {
    if (entryCount === 0) return
    if (window.confirm(t('zotero.media.clearConfirm', { count: entryCount }))) {
      void clear()
    }
  }

  if (embedded) {
    return (
      <details className="group">
        <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-3 rounded-lg px-1 py-1 [&::-webkit-details-marker]:hidden">
          <div>
            <div className="text-sm font-medium text-foreground">{t('zotero.media.advanced.title')}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {t('zotero.media.advanced.summary', { count: entryCount, size: formatBytes(totalBytes) })}
            </div>
          </div>
          <span className="text-xs text-muted-foreground group-open:hidden">{t('zotero.media.advanced.expand')}</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">{t('zotero.media.advanced.collapse')}</span>
        </summary>
        <div className="mt-3 rounded-lg bg-background/70 px-3 py-3">
          <div className="mb-3 text-xs text-muted-foreground">
            {t('zotero.media.advanced.hint')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => { void refresh() }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              <span>{t('zotero.media.buttons.refresh')}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || entryCount === 0}
              onClick={handleClear}
            >
              <Trash2 size={14} />
              <span>{t('zotero.media.buttons.clear')}</span>
            </Button>
          </div>
        </div>
      </details>
    )
  }

  const card = (
    <SettingsCard divided={false}>
      <SettingsModuleRow
        title={t('zotero.media.card.title')}
        pill={
          <Badge variant="soft" className="h-6 leading-[1]">
            {t('zotero.media.card.metric', { count: entryCount, size: formatBytes(totalBytes) })}
          </Badge>
        }
        description={t('zotero.media.card.description')}
        action={
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => { void refresh() }}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
              <span>{t('zotero.media.buttons.refresh')}</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || entryCount === 0}
              onClick={handleClear}
            >
              <Trash2 size={14} />
              <span>{t('zotero.media.buttons.clearLong')}</span>
            </Button>
          </div>
        }
      />
    </SettingsCard>
  )

  if (embedded) return card

  return (
    <SettingsSection
      title={t('zotero.media.section.title')}
      description={t('zotero.media.section.description')}
    >
      {card}
    </SettingsSection>
  )
}

