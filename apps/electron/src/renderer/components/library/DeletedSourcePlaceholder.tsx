/**
 * DeletedSourcePlaceholder —— Zotero 源条目已删除时的右栏降级占位（issue #462）
 *
 * 背景：综述引用的 paper 在 Zotero 被删除后，本地 SQLite papers 行仍刻意保留
 * （避免 evidence_refs 悬空）。点击引用跳转后 `zotero.library.getItem` 命中 404 →
 * 返回 { status: 'deleted', cachedMeta }。本组件渲染该降级态，替代原先空白 /
 * 误导性的"加载失败请重试"，给用户明确的"源已删除"反馈 + 降级动作。
 *
 * 展示：⚠️ 警示色标题 + 说明 → 缓存元数据（标题 / 作者 / DOI）→ 降级动作按钮。
 * cachedMeta=null（本地也无缓存）时退化为纯文字提示。
 */
import * as React from 'react'
import { MAX_AUTHORS_FULL, sanitizeText } from '@asci/shared'
import { AlertTriangle, ExternalLink, Copy, Search } from 'lucide-react'
import { toast } from 'sonner'
import type { CachedPaperMeta } from '@asci/core/zotero'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'

interface DeletedSourcePlaceholderProps {
  cachedMeta: CachedPaperMeta | null
}

export function DeletedSourcePlaceholder({
  cachedMeta,
}: DeletedSourcePlaceholderProps): React.ReactElement {
  const { t } = useT('library')

  const openExternal = (url: string): void => {
    window.electronAPI.openExternal(url).catch(console.error)
  }

  const copyDoi = (doi: string): void => {
    navigator.clipboard
      .writeText(doi)
      .then(() => toast.success(t('detail.deletedSource.copiedToast')))
      .catch(console.error)
  }

  return (
    <div className="h-full overflow-auto p-4 scrollbar-thin">
      <div
        className={cn(
          'rounded-lg border p-4 space-y-3',
          'border-warning/30 bg-warning/10',
        )}
      >
        {/* 警示头 */}
        <div className="flex items-start gap-2">
          <AlertTriangle className="size-4 flex-shrink-0 mt-0.5 text-warning" />
          <div className="space-y-1 min-w-0">
            <div className="text-sm font-medium text-foreground">
              {t('detail.deletedSource.title')}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('detail.deletedSource.description')}
            </p>
          </div>
        </div>

        {cachedMeta ? (
          <div className="space-y-2 pl-6">
            {/* 缓存标题 */}
            <h2 className="text-base font-semibold leading-snug text-foreground/90">
              {sanitizeText(cachedMeta.title)}
            </h2>
            {/* 作者 */}
            {cachedMeta.authors.length > 0 && (
              <div className="text-sm text-muted-foreground leading-relaxed">
                {cachedMeta.authors.slice(0, MAX_AUTHORS_FULL).join(', ')}
                {cachedMeta.authors.length > MAX_AUTHORS_FULL ? ' et al.' : ''}
              </div>
            )}
            {/* DOI / venue / year */}
            {(cachedMeta.doi || cachedMeta.venue || cachedMeta.year) && (
              <div className="text-sm text-muted-foreground/80 tabular-nums break-all">
                {[
                  cachedMeta.doi ? `DOI: ${cachedMeta.doi}` : null,
                  cachedMeta.venue,
                  cachedMeta.year ? String(cachedMeta.year) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            )}
          </div>
        ) : (
          <p className="pl-6 text-sm text-muted-foreground/70">
            {t('detail.deletedSource.noMetadata')}
          </p>
        )}

        {/* 降级动作 */}
        <div className="flex flex-wrap gap-2 pl-6 pt-1">
          {cachedMeta?.doi && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-sm [&_svg]:size-3"
              onClick={() => cachedMeta.doi && openExternal(`https://doi.org/${cachedMeta.doi}`)}
            >
              <ExternalLink className="size-3" />
              {t('detail.deletedSource.action.openDoi')}
            </Button>
          )}
          {cachedMeta?.doi && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-sm [&_svg]:size-3"
              onClick={() => cachedMeta.doi && copyDoi(cachedMeta.doi)}
            >
              <Copy className="size-3" />
              {t('detail.deletedSource.action.copyDoi')}
            </Button>
          )}
          {cachedMeta?.title && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-sm [&_svg]:size-3"
              onClick={() =>
                cachedMeta.title &&
                openExternal(
                  `https://scholar.google.com/scholar?q=${encodeURIComponent(sanitizeText(cachedMeta.title))}`,
                )
              }
            >
              <Search className="size-3" />
              {t('detail.deletedSource.action.searchWeb')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
