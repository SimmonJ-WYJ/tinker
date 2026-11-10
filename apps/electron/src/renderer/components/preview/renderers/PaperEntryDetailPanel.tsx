/** 工作区历史论文详情：元数据、摘要、来源链接只读展示。 */
import * as React from 'react'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readCitedBy } from '@/components/agent/session-papers-utils'
import { useT } from '@/hooks/useT'
import { formatDateTime } from '@/utils/dayjs'
import type { WorkspacePaperEntry } from '@asci/shared'
import { MAX_AUTHORS_FULL, sanitizeText } from '@asci/shared'

interface PaperEntryDetailPanelProps {
  entry: WorkspacePaperEntry
  readOnly?: true
}

export function PaperEntryDetailPanel({ entry }: PaperEntryDetailPanelProps): React.ReactElement {
  const { t } = useT('library')
  // 防御性兜底：entry.authors 在历史数据 / IPC 边界可能为 undefined（main 上 hotfix）
  const safeAuthors = Array.isArray(entry.authors) ? entry.authors : []
  const citedBy = readCitedBy(entry)
  const arxivId = extractArxivId(entry)

  const openExternal = (url: string): void => {
    window.electronAPI.openExternal(url).catch(console.error)
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-3 scrollbar-thin">
      {/* 标题 */}
      <h2 className="text-base font-semibold leading-snug text-foreground">{sanitizeText(entry.title)}</h2>

      {/* 作者 + 期刊 */}
      {safeAuthors.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {safeAuthors.slice(0, MAX_AUTHORS_FULL).join(', ')}{safeAuthors.length > MAX_AUTHORS_FULL ? ' et al.' : ''}
        </div>
      )}
      {/* 期刊 + 分区：独立一行，灰色小框（分区来自 extra.journalRank / EasyScholar） */}
      {(() => {
        const jr = (entry.extra as { journalRank?: { casPartition?: string | null; jcrPartition?: string | null; impactFactor?: string | null } } | undefined)?.journalRank
        const parts = [
          entry.venue,
          jr?.jcrPartition,
          jr?.impactFactor ? t('paperDetail.meta.impactFactor', { value: jr.impactFactor }) : null,
        ].filter(Boolean)
        if (parts.length === 0) return null
        return (
          <div className="inline-block rounded-md bg-muted px-2.5 py-1.5 text-sm text-muted-foreground">
            {parts.join(' · ')}
          </div>
        )
      })()}
      {entry.year && (
        <div className="text-sm text-muted-foreground">{t('paperDetail.meta.published')} {entry.year}</div>
      )}

      {/* 操作栏 */}
      <div className="flex flex-wrap gap-2 pt-1">
        {entry.doi && (
          <Button size="sm" variant="outline" onClick={() => entry.doi && openExternal(`https://doi.org/${entry.doi}`)}>
            <ExternalLink className="size-3 mr-1" />
            DOI
          </Button>
        )}
        {arxivId && (
          <Button size="sm" variant="outline" onClick={() => openExternal(`https://arxiv.org/abs/${arxivId}`)}>
            <ExternalLink className="size-3 mr-1" />
            arXiv: {arxivId}
          </Button>
        )}
        {entry.url && !entry.doi && !arxivId && (
          <Button size="sm" variant="outline" onClick={() => entry.url && openExternal(entry.url)}>
            <ExternalLink className="size-3 mr-1" />
            {t('paperDetail.actions.openSource')}
          </Button>
        )}
      </div>

      {/* 摘要 —— 缺失时显式标注"不可获取"，避免与"系统坏了"混淆 */}
      <div className="text-sm font-bold text-muted-foreground tracking-wider uppercase pt-2">{t('paperDetail.field.abstractHeading')}</div>
      {entry.abstract ? (
        <div className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {sanitizeText(entry.abstract)}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground/60">
          {t('paperDetail.field.abstractUnavailable')}
        </div>
      )}

      {/* 元信息 — 与 PaperDetailRenderer 的 Source/Query/Captured/Citations grid 对齐 */}
      <div className="pt-3 border-t border-border">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground font-medium" title={t('paperDetail.meta.capturedTooltip')}>{t('paperDetail.meta.captured')}</dt>
          <dd className="text-sm text-foreground">{formatTs(entry.firstSeenAt)}</dd>
          {entry.lastSeenAt && entry.lastSeenAt !== entry.firstSeenAt && (<>
            <dt className="text-muted-foreground font-medium" title={t('paperDetail.meta.lastSeenTooltip')}>{t('paperDetail.meta.lastSeen')}</dt>
            <dd className="text-sm text-foreground">{formatTs(entry.lastSeenAt)}</dd>
          </>)}
          {citedBy != null && (<>
            <dt className="text-muted-foreground font-medium">{t('paperDetail.meta.citations')}</dt>
            <dd className="text-sm text-foreground tabular-nums">{citedBy.toLocaleString()}</dd>
          </>)}
        </dl>
      </div>

    </div>
  )
}

/** 从 entry.extra / url / doi 里抽出 arXiv ID（与 PaperDetailRenderer 同款） */
function extractArxivId(entry: WorkspacePaperEntry): string | null {
  const extra = entry.extra as { arxivId?: string } | undefined
  if (extra?.arxivId) return extra.arxivId
  if (entry.url) {
    const match = entry.url.match(/arxiv\.org\/(?:abs|pdf)\/([\w./-]+?)(?:\.pdf)?(?:$|[?#])/)
    if (match?.[1]) return match[1]
  }
  return null
}

function formatTs(ts: string): string {
  try {
    return formatDateTime(ts)
  } catch {
    return ts
  }
}
