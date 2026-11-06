/**
 * PaperEntryDetailPanel - 工作区论文详情预览
 *
 * 视觉与 PaperDetailRenderer（kind='paper'）保持一致：
 *   title → 紧凑 authors/venue/year → 操作按钮行 → Abstract → 元信息 grid
 * 业务差异：entry 已在 workspace，加入 Zotero 走 ZoteroLinkDialog（可选 tags），
 * 而 record 路径直接 ingest+link 不弹窗。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink, Share2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ZoteroLinkDialog } from '@/components/agent/ZoteroLinkDialog'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { useOpenCitationGraph } from '@/components/citation-graph/useOpenCitationGraph'
import { readCitedBy } from '@/components/agent/session-papers-utils'
import { useT } from '@/hooks/useT'
import { formatDateTime } from '@/utils/dayjs'
import type { WorkspacePaperEntry } from '@asci/shared'
import { MAX_AUTHORS_FULL, sanitizeText } from '@asci/shared'

/** Zotero 风格 Z 字 logo（红底白 Z），与 PaperDetailRenderer 同源 */
function ZoteroLogoIcon({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect width="24" height="24" rx="5" fill="#CC2936" />
      <path
        d="M7 7.5h10L8 16h9"
        stroke="white"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

interface PaperEntryDetailPanelProps {
  entry: WorkspacePaperEntry
}

export function PaperEntryDetailPanel({ entry }: PaperEntryDetailPanelProps): React.ReactElement {
  const { t } = useT('library')
  const [zoteroDialogOpen, setZoteroDialogOpen] = React.useState(false)
  // 防御性兜底：entry.authors 在历史数据 / IPC 边界可能为 undefined（main 上 hotfix）
  const safeAuthors = Array.isArray(entry.authors) ? entry.authors : []
  const citedBy = readCitedBy(entry)
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const openGraph = useOpenCitationGraph()

  const arxivId = extractArxivId(entry)
  const canOpenGraph = Boolean(entry.doi || arxivId || entry.title)
  const zoteroAdded = !!entry.linkedZoteroKey

  const handleOpenGraph = (): void => {
    if (!canOpenGraph) return
    openGraph({
      seed: { doi: entry.doi, arxivId, title: entry.title },
      workspaceId,
      seedTitleHint: entry.title,
    })
  }

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
        <Button
          size="sm"
          variant="outline"
          onClick={handleOpenGraph}
          disabled={!canOpenGraph}
          title={canOpenGraph ? t('paperDetail.actions.openGraphTitle') : t('paperDetail.actions.openGraphDisabledEntryTitle')}
        >
          <Share2 className="size-3.5 mr-1" />
          {t('paperDetail.actions.openGraph')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setZoteroDialogOpen(true)}
          disabled={zoteroAdded || !entry.title}
          title={zoteroAdded ? t('paperDetail.actions.addedToZoteroTitle') : !entry.title ? t('paperDetail.actions.missingTitleTitle') : t('paperDetail.actions.addToZoteroTitle')}
        >
          {zoteroAdded ? (
            <>
              <Check className="size-3.5 mr-1" />
              {t('paperDetail.actions.addedToZotero')}
            </>
          ) : (
            <>
              <ZoteroLogoIcon className="size-4 mr-1" />
              {t('paperDetail.actions.addToZotero')}
            </>
          )}
        </Button>
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

      <ZoteroLinkDialog
        open={zoteroDialogOpen}
        onOpenChange={setZoteroDialogOpen}
        entry={entry}
      />
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
