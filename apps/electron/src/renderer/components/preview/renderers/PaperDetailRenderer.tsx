import * as React from 'react'
import { useAtomValue } from 'jotai'
import { toast } from 'sonner'
import { ExternalLink, Download, RotateCw, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import { readCitedBy } from '@/components/agent/session-papers-utils'
import { useT } from '@/hooks/useT'
import { formatDateTime } from '@/utils/dayjs'
import { normalizePaperSource } from '@asci/shared'
import { renderSourceLabel } from '@/components/agent/session-papers-source-label'
import type { PaperRecord } from '@asci/shared'
import { MAX_AUTHORS_FULL, sanitizeText } from '@asci/shared'

interface Props { record: PaperRecord; readOnly?: true }

/**
 * 论文详情卡
 * - 展示完整元数据：title / authors / venue / abstract / source / query / captured
 * - "下载 PDF 并预览"按钮：尝试 arXiv / URL(.pdf)，成功后切到 PdfRenderer
 * - DOI / arXiv / url 外链按钮（openExternal）
 */
export default function PaperDetailRenderer({ record }: Props): React.ReactElement {
  const { t } = useT('library')
  // 来源标签复用检索筛选的归一化映射（conversation ns），保证 'crossref' → 'Crossref' 一致
  const { t: tConv } = useT('conversation')
  const [downloading, setDownloading] = React.useState(false)
  const [downloadingLocal, setDownloadingLocal] = React.useState(false)
  const [downloadError, setDownloadError] = React.useState<string | null>(null)
  const openInRightPanel = useOpenInRightPanel()
  const sessionId = useAtomValue(currentAgentSessionIdAtom)

  const arxivId = extractArxivId(record)
  const citedBy = readCitedBy(record)
  const canDownload = !!(arxivId || (record.url && record.url.toLowerCase().endsWith('.pdf')))
  const handleDownload = async (): Promise<void> => {
    if (!sessionId) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const res = await window.electronAPI.previewDownloadPdf({
        sessionId,
        url: record.url,
        doi: record.doi,
        arxivId,
      })
      openInRightPanel({
        kind: 'file',
        path: res.localPath,
        ext: 'pdf',
        size: res.size,
      })
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  // 下载到系统下载文件夹（用户可见），与 handleDownload 的「缓存+预览」分开
  const handleDownloadLocal = async (): Promise<void> => {
    setDownloadingLocal(true)
    try {
      const res = await window.electronAPI.downloadPdfLocal({
        sessionId: sessionId ?? '',
        url: record.url,
        doi: record.doi,
        arxivId,
      })
      toast.success(t('paperDetail.toast.downloadedLocal', { filename: res.filename }))
    } catch (err) {
      toast.error(t('paperDetail.toast.downloadLocalFailed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setDownloadingLocal(false)
    }
  }

  const openExternal = (url: string): void => {
    window.electronAPI.openExternal(url).catch(console.error)
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-3 scrollbar-thin">
      {/* 顶部元信息：arXiv/DOI/URL 徽章 + 日期 · venue（对齐 ItemDetailPanel）；下载 PDF 已移到底部操作区 */}
      <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
        {arxivId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => openExternal(`https://arxiv.org/abs/${arxivId}`)}
            className={cn(
              'h-auto gap-1.5 px-2 py-1 text-sm',
              'bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground/80',
            )}
          >
            <ExternalLink className="!size-3" />
            arXiv:{arxivId}
          </Button>
        ) : record.doi ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => openExternal(`https://doi.org/${record.doi}`)}
            className={cn(
              'h-auto gap-1.5 px-2 py-1 text-sm',
              'bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground/80',
            )}
          >
            <ExternalLink className="!size-3" />
            <span className="truncate max-w-[200px]">DOI:{record.doi}</span>
          </Button>
        ) : record.url ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => record.url && openExternal(record.url)}
            className={cn(
              'h-auto gap-1.5 px-2 py-1 text-sm',
              'bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground/80',
            )}
          >
            <ExternalLink className="!size-3" />
            {t('paperDetail.actions.openSource')}
          </Button>
        ) : null}
        {record.year && (
          <span className="tabular-nums">{String(record.year)}</span>
        )}
      </div>

      {/* 标题 — 对齐 ItemDetailPanel：大字号 / 半粗 / 紧字距 */}
      <h2 className="text-xl font-semibold leading-snug text-foreground tracking-tight">{sanitizeText(record.title)}</h2>

      {/* 主操作行：加入 Zotero + 引用图谱 + 下载到本地 + 预览（紧跟标题下方） */}
      <div className="flex flex-wrap items-center gap-2">
        {canDownload && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadLocal}
            disabled={downloadingLocal}
            title={t('paperDetail.actions.downloadTitle')}
            className="gap-1.5"
          >
            {downloadingLocal ? <RotateCw className="!size-3.5 animate-spin" /> : <Download className="!size-3.5" />}
            {downloadingLocal ? t('paperDetail.actions.downloading') : t('paperDetail.actions.download')}
          </Button>
        )}
        {canDownload && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={downloading}
            title={t('paperDetail.actions.previewTitle')}
            className="gap-1.5"
          >
            {downloading ? <RotateCw className="!size-3.5 animate-spin" /> : <Eye className="!size-3.5" />}
            {downloading ? t('paperDetail.actions.downloading') : t('paperDetail.actions.preview')}
          </Button>
        )}
      </div>

      {/* 期刊 + 分区：标题下独立一行，灰色小框（分区来自 extra.journalRank / EasyScholar） */}
      {(() => {
        const jr = (record.extra as { journalRank?: { casPartition?: string | null; jcrPartition?: string | null; impactFactor?: string | null } } | undefined)?.journalRank
        const parts = [
          record.venue,
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

      {/* 作者 */}
      {Array.isArray(record.authors) && record.authors.length > 0 && (
        <div className="text-sm text-muted-foreground leading-relaxed">
          {record.authors.slice(0, MAX_AUTHORS_FULL).join(', ')}{record.authors.length > MAX_AUTHORS_FULL ? ' et al.' : ''}
        </div>
      )}

      {downloadError && (
        <div className="text-sm text-destructive bg-destructive/10 px-2 py-1 rounded">
          ⚠ {downloadError}
        </div>
      )}

      {/* 摘要 — 紧贴作者，无 section header（对齐 ItemDetailPanel）*/}
      {record.abstract ? (
        <div className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap">
          {sanitizeText(record.abstract)}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground/60">
          {/* DOI 即时查询：区分「源真没有」与「超时/限流取失败」，后者引导重试（错误必须可见） */}
          {record.extra?.abstractStatus === 'failed'
            ? t('paperDetail.field.abstractFetchFailed')
            : t('paperDetail.field.abstractUnavailable')}
        </div>
      )}

      {/* 元信息 */}
      <div className="pt-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground font-medium">{t('paperDetail.meta.source')}</dt>
          <dd className="text-sm text-foreground">{renderSourceLabel(normalizePaperSource(record.source), tConv)}</dd>
          {record.query && (<>
            <dt className="text-muted-foreground font-medium">{t('paperDetail.meta.query')}</dt>
            <dd className="text-sm text-foreground break-words">{record.query}</dd>
          </>)}
          <dt className="text-muted-foreground font-medium" title={t('paperDetail.meta.capturedTooltip')}>{t('paperDetail.meta.captured')}</dt>
          <dd className="text-sm text-foreground">{formatTs(record.ts)}</dd>
          {citedBy != null && (<>
            <dt className="text-muted-foreground font-medium">{t('paperDetail.meta.citations')}</dt>
            <dd className="text-sm text-foreground tabular-nums">{citedBy.toLocaleString()}</dd>
          </>)}
        </dl>
      </div>

    </div>
  )
}

/** 从 record.extra / url / doi 里抽出 arXiv ID */
function extractArxivId(record: PaperRecord): string | null {
  const extra = record.extra as { arxivId?: string } | undefined
  if (extra?.arxivId) return extra.arxivId
  if (record.url) {
    const match = record.url.match(/arxiv\.org\/(?:abs|pdf)\/([\w./-]+?)(?:\.pdf)?(?:$|[?#])/)
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
