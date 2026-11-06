/**
 * SessionPaperCard — 单条 paper 卡片（含 SimplePaperCard / RecordOnlyCard）
 *
 * Phase 1 是纯抽离，签名保持向后兼容（checkboxNode 仍作为 ReactNode prop 注入）。
 * Phase 2 在此之上加 multiSelectActive 内部分发逻辑。
 */
import * as React from 'react'
import { BookMarked, ExternalLink, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge.tsx'
import { ScoreBadge } from './ScoreBadge'
import { readCitedBy, readScoreObject } from './session-papers-utils'
import type { PaperRecord, WorkspacePaperEntry, PaperScore } from '@asci/shared'
import { MAX_AUTHORS_COMPACT, sanitizeText } from '@asci/shared'
import { useT } from '@/hooks/useT'

export interface SimplePaperCardProps {
  entry: WorkspacePaperEntry
  /** 对应 session record；entry 的 title/authors/year 是占位时用 record 兜底显示 */
  record?: PaperRecord
  onOpenPreview: () => void
  onLinkZotero: () => void
  size?: 'compact' | 'expanded'
  /** 左侧多选 checkbox 节点（由父组件根据"是否可选"决定是否传入） */
  checkboxNode?: React.ReactNode
  isSelected?: boolean
  /** 是否显示 checkbox（默认 false，仅在多选模式下设为 true） */
  showCheckbox?: boolean
  /** 是否可被多选（已入 Zotero 不可选）；仅作 memo 比较键，确保 checkboxNode 禁用态不滞留 */
  selectable?: boolean
}

const paperActionRowClassName = 'flex items-center justify-end flex-wrap gap-1.5'
const paperSecondaryButtonClassName = 'inline-flex items-center justify-center gap-1 rounded-md border border-border/70 bg-background px-2 py-0.5 text-sm font-normal text-foreground shadow-sm shadow-black/[0.03] transition-colors hover:bg-muted/70 hover:border-foreground/25'
const paperPrimaryButtonClassName = 'gap-1 rounded-md bg-foreground px-1.5 py-0.5 text-sm font-normal text-background shadow-none hover:bg-foreground/90 hover:text-background'
const paperDisabledButtonClassName = 'inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-sm font-normal text-muted-foreground opacity-75 cursor-default select-none'

function paperCardSurfaceClassName({ isSelected, isLinked }: { isSelected?: boolean; isLinked: boolean }): string {
  if (isSelected) return 'bg-primary/10 hover:bg-primary/15'
  if (isLinked) return 'bg-muted/50 hover:bg-muted/70'
  return 'bg-background ring-1 ring-border/70 shadow-sm shadow-black/[0.04] hover:bg-background hover:ring-foreground/20'
}

function PaperAbstractBlock({ abstractText }: { abstractText: string | null }): React.ReactElement | null {
  if (!abstractText) return null
  return (
    <div className="mt-1.5 text-xs text-muted-foreground/90 line-clamp-2 leading-relaxed">
      {abstractText}
    </div>
  )
}

function SimplePaperCardImpl({ entry, record, onOpenPreview, onLinkZotero, size = 'compact', checkboxNode, isSelected, showCheckbox = false }: SimplePaperCardProps): React.ReactElement {
  const { t } = useT('conversation')
  const isExpanded = size === 'expanded'
  // 身份字段按 entry 优先 → 缺失或占位时用 record 兜底
  const entryTitleIsReal = Boolean(
    entry.title && entry.title !== '(无标题)' && entry.title !== '(DOI 片段)',
  )
  const recordTitleIsReal = Boolean(
    record?.title && record.title !== '(无标题)' && record.title !== '(DOI 片段)',
  )
  const hasRealTitle = entryTitleIsReal || recordTitleIsReal
  const displayTitle = entryTitleIsReal
    ? sanitizeText(entry.title)
    : recordTitleIsReal
      ? sanitizeText(record!.title)
      : entry.doi ?? entry.url ?? t('agent.sessionPapers.unidentified')
  const safeEntryAuthors = Array.isArray(entry.authors) ? entry.authors : []
  const safeRecordAuthors = record && Array.isArray(record.authors) ? record.authors : []
  const effectiveAuthors = safeEntryAuthors.length > 0 ? safeEntryAuthors : safeRecordAuthors
  const effectiveYear = entry.year ?? record?.year ?? null
  const effectiveVenue = entry.venue ?? record?.venue ?? null
  const effectiveAbstract = sanitizeText(entry.abstract ?? record?.abstract ?? null) || null
  const citedByCount = readCitedBy(entry) ?? readCitedBy(record)
  const citedByText = citedByCount != null ? t('sessionPapers.citedBy', { count: citedByCount.toLocaleString() }) : null
  const authorsText = formatAuthors(effectiveAuthors)
  const relevanceExtra = (entry.extra ?? record?.extra) as Record<string, unknown> | undefined
  // 评分已切到七维 score 线路；原 F22/finalRelevance 徽章不再展示
  const score = readScore(relevanceExtra)
  const isLinked = Boolean(entry.linkedZoteroKey)
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpenPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPreview() } }}
      className={cn(
        'rounded-xl transition-colors cursor-pointer focus-visible:outline-none',
        paperCardSurfaceClassName({ isSelected, isLinked }),
        'p-4',
      )}
    >
      <div className="flex items-start gap-2">
        {showCheckbox && checkboxNode && (
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {checkboxNode}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={cn(
            'leading-snug font-medium line-clamp-2 break-all',
            isExpanded ? 'text-sm' : 'text-sm',
            !hasRealTitle && 'text-primary',
          )}>
            {displayTitle}
          </div>
          {(authorsText || effectiveYear || citedByText) && (() => {
            const metaText = [effectiveYear, citedByText, authorsText].filter(Boolean).join(' · ')
            return (
              <div className={cn(
                'mt-0.5 text-muted-foreground flex items-center gap-1 min-w-0',
                isExpanded ? 'text-xs' : 'text-sm',
              )}>
                {metaText && (
                  <span className="truncate min-w-0 flex-1" title={metaText}>
                    {metaText}
                  </span>
                )}
              </div>
            )
          })()}
          <VenueRankLine score={score} venue={effectiveVenue} rank={readJournalRank(relevanceExtra)} isExpanded={isExpanded} />
          {isExpanded && <PaperAbstractBlock abstractText={effectiveAbstract} />}
          <div className={cn(paperActionRowClassName, isExpanded ? 'mt-2' : 'mt-1')}>
            {entry.doi && (
              <a
                href={`https://doi.org/${entry.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={paperSecondaryButtonClassName}
              >
                <ExternalLink className="!size-3.5" />
                DOI
              </a>
            )}
            {isLinked ? (
              <span
                aria-disabled="true"
                className={paperDisabledButtonClassName}
                title={t('sessionPapers.addedToZoteroTooltip')}
              >
                <BookMarked className="!size-3.5" /> {t('sessionPapers.addedToZotero')}
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="chip"
                onClick={(e) => { e.stopPropagation(); onLinkZotero() }}
                className={paperPrimaryButtonClassName}
              >
                <Plus className="!size-3.5" />
                {t('sessionPapers.addToZotero')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * memo 比较器：只比数据 props，忽略回调 / checkboxNode 的引用变化。
 * 列表层每次 render 都会重建闭包与 checkbox JSX，但它们的行为完全由
 * 这里比较的数据决定（checkbox 的 checked 与 isSelected 同源），
 * 浅比较会让 memo 永远失效，故显式声明数据等价即跳过重渲。
 * 注意：若未来给卡片新增"影响渲染的非回调 prop"，必须同步加进比较器。
 */
interface PaperCardCompareProps {
  entry?: WorkspacePaperEntry
  record?: PaperRecord
  size?: 'compact' | 'expanded'
  isSelected?: boolean
  showCheckbox?: boolean
  selectable?: boolean
}

function paperCardPropsEqual(prev: PaperCardCompareProps, next: PaperCardCompareProps): boolean {
  return (
    prev.entry === next.entry &&
    prev.record === next.record &&
    prev.size === next.size &&
    prev.isSelected === next.isSelected &&
    prev.showCheckbox === next.showCheckbox &&
    prev.selectable === next.selectable
  )
}

/** 含 workspace entry 的卡片（memo：选择/多选等父级状态变化时不重渲未涉及的卡片） */
export const SimplePaperCard = React.memo(SimplePaperCardImpl, paperCardPropsEqual)

export interface RecordOnlyCardProps {
  record: PaperRecord
  size?: 'compact' | 'expanded'
  onOpenPreview: () => void
  onLinkZotero: () => void
  checkboxNode?: React.ReactNode
  isSelected?: boolean
  /** 是否显示 checkbox（默认 false，仅在多选模式下设为 true） */
  showCheckbox?: boolean
  /** 是否可被多选（已入 Zotero 不可选）；仅作 memo 比较键，确保 checkboxNode 禁用态不滞留 */
  selectable?: boolean
}

function RecordOnlyCardImpl({ record, size = 'compact', onOpenPreview, onLinkZotero, checkboxNode, isSelected, showCheckbox = false }: RecordOnlyCardProps): React.ReactElement {
  const { t } = useT('conversation')
  const isExpanded = size === 'expanded'
  const hasRealTitle = Boolean(
    record.title && record.title !== '(无标题)' && record.title !== '(DOI 片段)',
  )
  const displayTitle = hasRealTitle
    ? sanitizeText(record.title)
    : record.doi ?? record.url ?? t('agent.sessionPapers.unidentified')
  // 能进本组件就说明 record.url 非空（上游 merged 已过滤）
  const link = record.url!
  const effectiveAbstract = sanitizeText(record.abstract ?? null) || null
  const citedByCount = readCitedBy(record)
  const citedByText = citedByCount != null ? t('sessionPapers.citedBy', { count: citedByCount.toLocaleString() }) : null
  const recExtra = record.extra as Record<string, unknown> | undefined
  // 评分已切到七维 score 线路；原 F22/finalRelevance 徽章不再展示
  const recScore = readScore(recExtra)
  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpenPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenPreview() } }}
      className={cn(
        'rounded-xl transition-colors cursor-pointer focus-visible:outline-none',
        paperCardSurfaceClassName({ isSelected, isLinked: false }),
        'p-4',
      )}>
      <div className="flex items-start gap-2">
        {showCheckbox && checkboxNode && (
          <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {checkboxNode}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className={cn(
            'font-medium line-clamp-2 break-all',
            isExpanded ? 'text-sm' : 'text-sm',
            !hasRealTitle && 'text-primary',
          )}>
            {displayTitle}
          </div>
          {(() => {
            const recAuthorsText = (Array.isArray(record.authors) ? record.authors : []).slice(0, MAX_AUTHORS_COMPACT).join(', ')
            const metaText = [record.year, citedByText, recAuthorsText].filter(Boolean).join(' · ')
            return (
              <div className={cn(
                'text-muted-foreground mt-0.5 flex items-center gap-1 min-w-0',
                isExpanded ? 'text-xs' : 'text-sm',
              )}>
                {metaText && (
                  <span className="truncate min-w-0 flex-1" title={metaText}>
                    {metaText}
                  </span>
                )}
              </div>
            )
          })()}
          <VenueRankLine score={recScore} venue={record.venue ?? null} rank={readJournalRank(recExtra)} isExpanded={isExpanded} />
          {isExpanded && <PaperAbstractBlock abstractText={effectiveAbstract} />}
          <div className={cn(paperActionRowClassName, isExpanded ? 'mt-2' : 'mt-1')}>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={paperSecondaryButtonClassName}
            >
              <ExternalLink className="!size-3.5" />
              {t('sessionPapers.link')}
            </a>
            <Button
              type="button"
              variant="ghost"
              size="chip"
              onClick={(e) => { e.stopPropagation(); onLinkZotero() }}
              className={paperPrimaryButtonClassName}
            >
              <Plus className="!size-3.5" />
              {t('sessionPapers.addToZotero')}
            </Button>
          </div>
        </div>
      </div>
    </li>
  )
}

/** 纯 record 卡片（无 workspace entry；memo 策略同 SimplePaperCard） */
export const RecordOnlyCard = React.memo(RecordOnlyCardImpl, paperCardPropsEqual)

export function formatAuthors(authors: string[]): string {
  if (!authors || authors.length === 0) return ''
  if (authors.length <= MAX_AUTHORS_COMPACT) return authors.join(', ')
  return `${authors.slice(0, MAX_AUTHORS_COMPACT).join(', ')} et al.`
}

/** EasyScholar 期刊分区 / 影响因子（来自 record.extra.journalRank，由检索后处理补全） */
interface JournalRankInfo {
  impactFactor?: string | null
  impactFactor5Year?: string | null
  casPartition?: string | null
  jcrPartition?: string | null
}

function readJournalRank(extra: Record<string, unknown> | undefined): JournalRankInfo | null {
  const jr = extra?.journalRank
  if (!jr || typeof jr !== 'object') return null
  return jr as JournalRankInfo
}

function readScore(extra: Record<string, unknown> | undefined): PaperScore | null {
  return readScoreObject(extra) as PaperScore | null
}

/**
 * 期刊名 + 分区行：标题下方独立一行，展示 venue 与分区 chips（中科院分区 / JCR 分区 / IF）。
 * venue 与分区均无时不渲染。
 */
const quartileBadgeClassName = 'bg-primary/10 text-primary'

/** IF 按数值高低分段配色（≥10 高 / ≥5 / ≥2 / 更低），映射到 Badge tone */
function impactFactorTone(ifValue: string | null | undefined): BadgeProps['tone'] {
  const v = Number.parseFloat(String(ifValue ?? ''))
  if (!Number.isFinite(v)) return 'neutral'
  if (v >= 10) return 'success'
  if (v >= 5) return 'info'
  if (v >= 2) return 'warning'
  return 'neutral'
}

function VenueRankLine({ score, venue, rank, isExpanded }: { score: PaperScore | null; venue: string | null; rank: JournalRankInfo | null; isExpanded: boolean }): React.ReactElement | null {
  const { t } = useT('conversation')
  // 中科院分区（casPartition）暂不显示
  const jcr = rank?.jcrPartition || null
  const ifText = rank?.impactFactor ? t('sessionPapers.impactFactor', { value: rank.impactFactor }) : null
  if (!score && !venue && !jcr && !ifText) return null
  // 基底 Badge 已含 text-badge / rounded-md / py-0.5；这里只保留差异化的水平 padding
  const pad = 'px-1.5'
  return (
    <div className={cn('mt-1 flex flex-wrap items-center gap-1.5 min-w-0', 'text-sm')}>
      <ScoreBadge score={score} />
      {jcr && (
        <Badge tone="neutral" variant="soft" className={cn('flex-shrink-0 whitespace-nowrap', quartileBadgeClassName, pad)}>
          {jcr}
        </Badge>
      )}
      {ifText && (
        <Badge tone={impactFactorTone(rank?.impactFactor)} variant="soft" className={cn('flex-shrink-0 whitespace-nowrap', pad)}>
          {ifText}
        </Badge>
      )}
      {venue && (
        <Badge
          tone="neutral"
          variant="soft"
          className={cn('inline-block max-w-full min-w-0 truncate whitespace-nowrap bg-foreground/[0.04] text-muted-foreground/80 cursor-default', pad)}
          title={venue}
        >
          {venue}
        </Badge>
      )}
    </div>
  )
}
