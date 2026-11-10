/** 历史研究空白只读对照表：保留洞察高亮、文字与来源锚点。 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink, Info } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { toast } from 'sonner'
import { researchGapTablesBySessionAtom } from '@/atoms/research-gap-atoms'
import type { GapCell, ResearchGap, ConflictNote, ResearchGapTable } from '@asci/shared'

type InsightTone = 'warning' | 'destructive'
type ActiveInsight = { id: string; tone: InsightTone } | null

/** 斜纹空格背景（语义 token via CSS var，非 Tailwind 调色板硬编码） */
const STRIPED_EMPTY: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, hsl(var(--border)) 0, hsl(var(--border)) 1px, transparent 1px, transparent 6px)',
}

/** 可信底线提示：仅 ⓘ 图标，hover 出完整注释 */
function TrustInfo({ text }: { text: string }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className="flex-shrink-0 text-muted-foreground/70 hover:text-foreground [&_svg]:size-3.5"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[240px]">
        <p className="leading-snug">{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** tableId 在内存中找不到时的安全空表（例如重启清空了内存态后又点了旧 Tab） */
const EMPTY_TABLE: ResearchGapTable = {
  id: '',
  title: '',
  sourceSelection: { kind: 'papers', paperIds: [] },
  scopeLabel: '',
  columns: [],
  rows: [],
  gaps: [],
  conflicts: [],
}

export function ResearchGapTableView({
  sessionId,
  tableId,
}: {
  sessionId: string
  tableId: string
  readOnly?: true
}): React.ReactElement {
  const { t } = useT('conversation')
  // 按 tableId 在本会话的表列表里定位这张表；找不到 → 空表 + 顶部提示
  const tablesBySession = useAtomValue(researchGapTablesBySessionAtom)
  const found = tablesBySession.get(sessionId)?.find((tb) => tb.id === tableId)
  const table = found ?? EMPTY_TABLE
  const notFound = !found

  const columns = table.columns
  const [active, setActive] = React.useState<ActiveInsight>(null)
  const paperCount = table.rows.length

  // 冲突格集合（始终红框）：每条冲突的 paperIds × involvedColumnIds 交叉
  const conflictCells = React.useMemo(() => {
    const s = new Set<string>()
    for (const cf of table.conflicts) {
      for (const pid of cf.paperIds) for (const cid of cf.involvedColumnIds) s.add(`${pid}:${cid}`)
    }
    return s
  }, [table.conflicts])

  // 选中洞察 → 联动高亮的行/列
  const hl = React.useMemo(() => {
    if (!active) return null
    const gap = table.gaps.find((g) => g.id === active.id)
    if (gap) return { rows: new Set(gap.supportingPaperIds), cols: new Set(gap.involvedColumnIds), tone: active.tone }
    const cf = table.conflicts.find((c) => c.id === active.id)
    if (cf) return { rows: new Set(cf.paperIds), cols: new Set(cf.involvedColumnIds), tone: active.tone }
    return null
  }, [active, table])

  const toneBand = (tone: InsightTone): string => (tone === 'warning' ? 'bg-warning/10' : 'bg-destructive/10')

  // 内存里找不到这张表（如重启清空后又点了旧 Tab）：给空态提示，而不是渲染空表
  if (notFound) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <p>{t('researchGap.notFound')}</p>
      </div>
    )
  }

  return (
    // 左侧栏（洞察分类 + 底部操作）+ 右侧对照表（占满高度）。flex-row-reverse → 末子（侧栏）居左
    <div className="flex h-full min-h-0 flex-row-reverse bg-background">
      {/* 对照表（右，占满高度）：滚动表格。
          min-w-0 关键：否则宽表撑开 flex-1、把左侧洞察侧栏挤出可视区 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {/* w-full：列少时铺满容器（避免宽面板/全屏下右侧留一大片 bg-background 空白占位）；
              列多时各列 min-w-[7rem] 撑出表宽 > 容器 → 由外层 overflow-auto 横向滚动 */}
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr>
                <th className="min-w-[8rem] border-b border-r border-border bg-muted px-2.5 py-1.5 text-left align-top font-medium text-muted-foreground">
                  {t('researchGap.table.paperHeader')}
                </th>
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className={cn(
                      'group min-w-[7rem] border-b border-r border-border bg-muted px-2.5 py-1.5 text-left align-top font-medium text-foreground/80',
                      hl?.cols.has(col.id) && toneBand(hl.tone),
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{col.name}</span>
                      {col.origin === 'ai' && (
                        <span className="rounded border border-dashed border-muted-foreground/50 px-1 text-sm font-normal text-muted-foreground">
                          {t('researchGap.table.aiColumn')}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => {
                const rowHl = hl?.rows.has(row.paperId)
                return (
                  <tr key={row.paperId}>
                    <th
                      scope="row"
                      className={cn(
                        'min-w-[8rem] break-words border-b border-r border-border bg-background px-2.5 py-1.5 text-left align-top font-medium text-foreground/90',
                        rowHl && hl && toneBand(hl.tone),
                      )}
                    >
                      {row.paperLabel}
                    </th>
                    {columns.map((col) => {
                      const cell: GapCell | undefined = row.cells[col.id]
                      const key = `${row.paperId}:${col.id}`
                      const isConflict = conflictCells.has(key)
                      const banded = hl && (hl.rows.has(row.paperId) || hl.cols.has(col.id))
                      return (
                        <td
                          key={col.id}
                          className={cn(
                            'border-b border-r border-border align-top',
                            banded && hl && toneBand(hl.tone),
                          )}
                        >
                          <CellContent cell={cell} isConflict={isConflict} />
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

        {/* 洞察卡侧栏：只读分类与高亮 */}
        <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border">
          <TrustInfo text={t('researchGap.trustFooter', { count: paperCount })} />
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2 scrollbar-thin">
            <InsightGroup title={t('researchGap.insights.gapsTitle')}>
              {table.gaps.map((gap) => (
                <GapCard
                  key={gap.id}
                  gap={gap}
                  active={active?.id === gap.id}
                  onActivate={() => setActive({ id: gap.id, tone: 'warning' })}
                />
              ))}
            </InsightGroup>

            <InsightGroup title={t('researchGap.insights.conflictsTitle')}>
              {table.conflicts.map((cf) => (
                <ConflictCard
                  key={cf.id}
                  conflict={cf}
                  active={active?.id === cf.id}
                  onActivate={() => setActive({ id: cf.id, tone: 'destructive' })}
                />
              ))}
            </InsightGroup>
          </div>

        </aside>
    </div>
  )
}

/** 单个格子内容：填了的格子可点出溯源 popover；空格斜纹 */
function CellContent({
  cell,
  isConflict,
}: {
  cell: GapCell | undefined
  isConflict: boolean
}): React.ReactElement {
  const { t } = useT('conversation')
  if (!cell || cell.value === null) {
    return (
      <div
        className="h-full min-h-[2rem] w-full"
        style={STRIPED_EMPTY}
        title={t('researchGap.table.emptyCell')}
      />
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'block w-full px-2.5 py-1.5 text-left text-foreground hover:bg-accent',
            isConflict && 'rounded-sm ring-1 ring-inset ring-destructive/60',
          )}
        >
          {cell.value}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 space-y-2 p-3 text-[14px]">
        <div className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('researchGap.cell.sourceLabel')}
        </div>
        {cell.source && (
          <>
            <p className="leading-relaxed text-foreground/90">“{cell.source.anchor.snapshotText}”</p>
            <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
              <span className="truncate text-sm text-muted-foreground">{cell.source.label}</span>
              <button
                type="button"
                onClick={() => toast.info(t('researchGap.cell.jumpToSource'))}
                className="inline-flex flex-shrink-0 items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                {t('researchGap.cell.jumpToSource')}
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** 洞察分组容器；标题（组合空白 / 结论冲突）放大显示，无前置圆点、无计数 */
function InsightGroup({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="px-0.5 text-sm font-semibold text-foreground/80">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

interface InsightCardShellProps {
  tone: InsightTone
  title: string
  meta: string
  rationale: string
  active: boolean
  onActivate: () => void
}

/** 洞察卡点击仅联动高亮并展开保存依据。 */
function InsightCardShell({
  tone,
  title,
  meta,
  rationale,
  active,
  onActivate,
}: InsightCardShellProps): React.ReactElement {
  const accent = tone === 'warning' ? 'border-l-warning' : 'border-l-destructive'
  const handleClick = onActivate
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      className={cn(
        'group relative cursor-pointer rounded-md border border-l-2 border-border bg-card p-2 transition-colors',
        accent,
        active ? (tone === 'warning' ? 'bg-warning/10' : 'bg-destructive/10') : 'hover:bg-accent',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* 长标题：line-clamp-2 截断 + break-words 防长 token 撑破 */}
          <div className="line-clamp-2 break-words pr-6 text-[14px] font-medium leading-snug text-foreground">{title}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{meta}</div>
          {/* 依据默认折叠，选中（高亮）时才展开；超长依据封顶 max-h 内部滚动，避免卡片无限拉长 */}
          {active && (
            <p className="mt-1 max-h-48 overflow-y-auto scrollbar-thin break-words text-sm leading-relaxed text-muted-foreground/90">
              {rationale}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function GapCard({
  gap,
  active,
  onActivate,
}: {
  gap: ResearchGap
  active: boolean
  onActivate: () => void
}): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <InsightCardShell
      tone="warning"
      title={gap.title}
      meta={t('researchGap.insights.involvedPapers', { count: gap.supportingPaperIds.length })}
      rationale={gap.rationale}
      active={active}
      onActivate={onActivate}
    />
  )
}

function ConflictCard({
  conflict,
  active,
  onActivate,
}: {
  conflict: ConflictNote
  active: boolean
  onActivate: () => void
}): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <InsightCardShell
      tone="destructive"
      title={conflict.title}
      meta={t('researchGap.insights.involvedPapers', { count: conflict.paperIds.length })}
      rationale={conflict.rationale}
      active={active}
      onActivate={onActivate}
    />
  )
}
