/**
 * ReleaseNotesViewer - Release Notes 查看器
 *
 * 显示 GitHub Release 的发布说明（Markdown 格式）
 */

import * as React from 'react'
import type { GitHubRelease } from '@asci/shared'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'
import { CodeBlock } from '@asci/ui'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { dayjs, formatDate } from '@/utils/dayjs'

interface ReleaseNotesViewerProps {
  /** Release 数据 */
  release: GitHubRelease
  /** 是否显示标题（默认 true） */
  showHeader?: boolean
  /** 是否紧凑模式（默认 false） */
  compact?: boolean
}

/**
 * ReleaseNotesViewer 组件
 */
export function ReleaseNotesViewer({
  release,
  showHeader = true,
  compact = false,
}: ReleaseNotesViewerProps): React.ReactElement {
  const { t } = useT('settings')
  const { t: tCommon } = useT('common')
  const releaseName = release.name || release.tag_name

  // 格式化发布日期：i18n 化，30 天以上回退到本地化日期
  const formattedDate = (() => {
    const date = dayjs(release.published_at)
    const diffDays = dayjs().diff(date, 'day')
    if (diffDays === 0) return t('releaseNotes.today')
    if (diffDays === 1) return t('releaseNotes.yesterday')
    if (diffDays < 7) return t('releaseNotes.daysAgo', { count: diffDays })
    if (diffDays < 30) return t('releaseNotes.weeksAgo', { count: Math.floor(diffDays / 7) })
    return formatDate(date)
  })()

  return (
    <div className="space-y-3">
      {/* 标题部分 */}
      {showHeader && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold truncate">
                {releaseName}
              </h3>
              {release.prerelease && (
                <Badge tone="neutral" variant="soft">
                  {t('releaseNotes.preRelease')}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formattedDate}
            </p>
          </div>

          {/* GitHub 链接 */}
          <a
            href={release.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
            title={t('releaseNotes.github')}
          >
            <ExternalLink className="h-3 w-3" />
            GitHub
          </a>
        </div>
      )}

      {/* Release Notes 内容 */}
      <div
        className={cn(
          'prose dark:prose-invert max-w-none',
          compact ? 'text-xs prose-sm' : 'text-sm',
          'prose-p:my-1.5 prose-p:leading-[1.6] prose-li:leading-[1.6]',
          '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
        )}
      >
        {release.body ? (
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children: preChildren }) => (
                <CodeBlock copyLabel={tCommon('copy')} copiedLabel={tCommon('copied')}>{preChildren}</CodeBlock>
              ),
              a: ({ href, children: linkChildren, ...linkProps }) => (
                <a
                  {...linkProps}
                  href={href ?? undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                      window.electronAPI.openExternal(href)
                    }
                  }}
                  title={href ?? undefined}
                >
                  {linkChildren}
                </a>
              ),
            }}
          >
            {release.body}
          </Markdown>
        ) : (
          <p className="text-muted-foreground">{t('releaseNotes.empty')}</p>
        )}
      </div>
    </div>
  )
}
