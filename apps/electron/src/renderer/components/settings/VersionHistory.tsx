/**
 * VersionHistory - 版本历史组件
 *
 * 显示 GitHub Release 历史版本列表。
 * embedded 模式下标题行与同卡的 SettingsRow 对齐（ROW_CLASS + 单行 LABEL_CLASS），
 * 副标题作为状态文字靠右排列（参考 AboutSettings 的 UpdateCard StatusText 模式）。
 * 加载中只显示一个指示器（刷新按钮内的 spinner），右侧副标题在 loading 时隐藏避免重复。
 */

import * as React from 'react'
import type { GitHubRelease } from '@asci/shared'
import { RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { SettingsCard } from './primitives'
import {
  LABEL_CLASS,
  ROW_CLASS,
} from './primitives/SettingsUIConstants'
import { ReleaseNotesViewer } from './ReleaseNotesViewer'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { formatDate } from '@/utils/dayjs'

interface VersionHistoryProps {
  /** 是否嵌入到外层设置卡片中 */
  embedded?: boolean
}

/**
 * VersionHistory 组件
 */
export function VersionHistory({
  embedded = false,
}: VersionHistoryProps): React.ReactElement {
  const { t } = useT('settings')
  const [releases, setReleases] = React.useState<GitHubRelease[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [hasLoaded, setHasLoaded] = React.useState(false)
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(new Set())

  // 加载 releases
  const loadReleases = React.useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await window.electronAPI.listReleases({
        perPage: 3,
        includePrerelease: false,
      })
      setReleases(data)
      setHasLoaded(true)
    } catch (err) {
      console.error('[版本历史] 加载失败:', err)
      setError(err instanceof Error ? err.message : t('versionHistory.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleToggleExpanded = (): void => {
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (nextExpanded && !hasLoaded) {
      void loadReleases()
    }
  }

  // 切换展开/折叠
  const toggleExpand = (id: number): void => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const summaryText = hasLoaded && releases.length === 0
    ? t('versionHistory.summary.empty')
    : hasLoaded && releases.length > 0
      ? t('versionHistory.summary.withCount', { count: releases.length })
      : t('versionHistory.summary.default')

  const content = (
    <>
      {/* 标题行：与同卡内的 SettingsRow 对齐；副标题靠右作为状态文字（参考 UpdateCard） */}
      <div className={ROW_CLASS}>
        <Button
          type="button"
          variant="ghost"
          onClick={handleToggleExpanded}
          className="mr-4 h-auto min-w-0 flex-1 justify-start p-0 text-left hover:bg-transparent"
        >
          <span className={LABEL_CLASS}>{t('versionHistory.title')}</span>
        </Button>
        <div className="flex shrink-0 items-center gap-3">
          {!loading && (
            <span className="text-xs text-muted-foreground">{summaryText}</span>
          )}
          {expanded && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void loadReleases()}
              disabled={loading}
              className="h-auto gap-1.5 px-3 py-1.5 [&_svg]:size-3.5"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t('versionHistory.refresh')}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleToggleExpanded}
            className="h-auto w-auto p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={expanded ? t('versionHistory.collapse') : t('versionHistory.expand')}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      {error && (
        <p className="px-4 pb-3 text-xs text-destructive">
          {error}
        </p>
      )}

      {/* 版本列表 */}
      {expanded && <div className="border-t border-border/40 divide-y divide-border/40">
        {loading && releases.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">{t('versionHistory.loading')}</p>
          </div>
        ) : releases.length === 0 ? (
          <div className="px-4 py-5 text-center">
            <p className="text-sm text-muted-foreground">{t('versionHistory.summary.empty')}</p>
          </div>
        ) : (
          releases.map((release, index) => {
            const isExpanded = expandedIds.has(release.id)
            const isLatest = index === 0

            return (
              <div key={release.id} className="p-4">
                {/* 版本标题（可点击展开） */}
                <Button
                  variant="ghost"
                  onClick={() => toggleExpand(release.id)}
                  className="w-full h-auto flex items-center justify-between text-left hover:bg-accent/50 -m-4 p-4 rounded-lg"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {release.tag_name}
                        </span>
                        {isLatest && (
                          <span className="text-xs text-primary font-medium">
                            {t('versionHistory.latest')}
                          </span>
                        )}
                      </div>
                      {release.name && release.name !== release.tag_name && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {release.name}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDate(release.published_at)}
                    </span>
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                  )}
                </Button>

                {/* Release Notes（展开时显示） */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t">
                    <ReleaseNotesViewer
                      release={release}
                      showHeader={false}
                      compact
                    />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>}
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
