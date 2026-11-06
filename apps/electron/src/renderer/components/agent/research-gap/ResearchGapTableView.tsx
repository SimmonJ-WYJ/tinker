/**
 * ResearchGapTableView —— 研究空白对照表（0.4 Epic 1）右侧 Tab 视图
 *
 * 按 tableId 从 researchGapTablesBySessionAtom 定位 AI 产出的那张表（每次分析独立一张、
 * 各自一个可关闭 Tab）。待补齐：列管理重填 / 真实溯源跳转 / 沉淀进证据集（依赖 Epic 2）。
 *
 * 三道可信底线（spec §5.5）在 UI 层的落点：
 * - 顶部范围徽章「基于你选的 N 篇」常驻
 * - 底部可信底线条「仅在所选 N 篇内成立…由你判断」
 * - 措辞硬过滤 + 拍板止损在 AI 侧（本视图不产出"值得做/创新"结论）
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { BookMarked, BookmarkPlus, ExternalLink, X, Info, SquareCheck, Undo2, Redo2 } from 'lucide-react'
import { sessionPapersToolbarIconButtonClassNames } from '../session-papers-toolbar-primitives'
import { ResearchGapDepositDialog, type DepositInsight } from './ResearchGapDepositDialog'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { toast } from 'sonner'
import { researchGapTablesBySessionAtom } from '@/atoms/research-gap-atoms'
import type { GapColumn, GapCell, ResearchGap, ConflictNote, ResearchGapTable } from '@asci/shared'

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
}): React.ReactElement {
  const { t } = useT('conversation')
  // 按 tableId 在本会话的表列表里定位这张表；找不到 → 空表 + 顶部提示
  const tablesBySession = useAtomValue(researchGapTablesBySessionAtom)
  const found = tablesBySession.get(sessionId)?.find((tb) => tb.id === tableId)
  const table = found ?? EMPTY_TABLE
  const notFound = !found

  const [columns, setColumns] = React.useState<GapColumn[]>(table.columns)
  // 列操作的撤回/重做双栈（Phase 1 仅删列）：撤回回退、重做前进
  const [columnUndo, setColumnUndo] = React.useState<GapColumn[][]>([])
  const [columnRedo, setColumnRedo] = React.useState<GapColumn[][]>([])
  const removeColumn = (id: string): void => {
    setColumnUndo((s) => [...s, columns])
    setColumnRedo([]) // 新操作清空重做栈
    setColumns((prev) => prev.filter((c) => c.id !== id))
  }
  const undoColumns = (): void => {
    const prev = columnUndo[columnUndo.length - 1]
    if (!prev) return
    setColumnRedo((s) => [...s, columns])
    setColumns(prev)
    setColumnUndo((s) => s.slice(0, -1))
  }
  const redoColumns = (): void => {
    const next = columnRedo[columnRedo.length - 1]
    if (!next) return
    setColumnUndo((s) => [...s, columns])
    setColumns(next)
    setColumnRedo((s) => s.slice(0, -1))
  }
  // 真实表到达 / 切换会话时，按新表重置列与撤回栈（useState 仅初始化一次，需显式同步）
  React.useEffect(() => {
    setColumns(table.columns)
    setColumnUndo([])
    setColumnRedo([])
  }, [table])
  const [active, setActive] = React.useState<ActiveInsight>(null)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  // 模式化多选（与检索论文一致）：默认浏览（点卡片高亮），进入多选才出现勾选框/动作
  const [selectionMode, setSelectionMode] = React.useState(false)

  const enterSelection = (): void => {
    setSelectionMode(true)
    setActive(null)
  }
  const exitSelection = (): void => {
    setSelectionMode(false)
    setPicked(new Set())
    setActive(null)
  }

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

  const togglePicked = (id: string): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // 全选/清空：作用于全部洞察（组合空白 + 结论冲突）
  const allInsightIds = React.useMemo(
    () => [...table.gaps.map((g) => g.id), ...table.conflicts.map((c) => c.id)],
    [table],
  )
  const allPicked = allInsightIds.length > 0 && picked.size === allInsightIds.length
  const someSelected = picked.size > 0 && !allPicked
  const toggleSelectAll = (): void => setPicked(allPicked ? new Set() : new Set(allInsightIds))

  // 加入证据集：把洞察存为笔记。浏览态单条 hover 入口 + 多选态底部批量，都打开同一弹窗。
  const [depositOpen, setDepositOpen] = React.useState(false)
  const [depositInsights, setDepositInsights] = React.useState<DepositInsight[]>([])

  const paperLabelById = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const r of table.rows) m.set(r.paperId, r.paperLabel)
    return m
  }, [table.rows])
  const labelsOf = React.useCallback(
    (ids: string[]): string[] => ids.map((id) => paperLabelById.get(id) ?? id),
    [paperLabelById],
  )
  const gapToInsight = React.useCallback(
    (g: ResearchGap): DepositInsight => ({ kind: 'gap', title: g.title, rationale: g.rationale, paperLabels: labelsOf(g.supportingPaperIds) }),
    [labelsOf],
  )
  const conflictToInsight = React.useCallback(
    (c: ConflictNote): DepositInsight => ({ kind: 'conflict', title: c.title, rationale: c.rationale, paperLabels: labelsOf(c.paperIds) }),
    [labelsOf],
  )
  const openDeposit = React.useCallback((list: DepositInsight[]): void => {
    if (list.length === 0) return
    setDepositInsights(list)
    setDepositOpen(true)
  }, [])
  // 批量：把已勾选的洞察(空白 + 冲突)汇成一组
  const depositPicked = React.useCallback((): void => {
    const list: DepositInsight[] = [
      ...table.gaps.filter((g) => picked.has(g.id)).map(gapToInsight),
      ...table.conflicts.filter((c) => picked.has(c.id)).map(conflictToInsight),
    ]
    openDeposit(list)
  }, [table.gaps, table.conflicts, picked, gapToInsight, conflictToInsight, openDeposit])

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
      {/* 对照表（右，占满高度）：滚动表格 + 底部固定的 撤回/重做 条。
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
                      <button
                        type="button"
                        onClick={() => removeColumn(col.id)}
                        className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        aria-label={`remove ${col.name}`}
                      >
                        <X className="size-3.5" />
                      </button>
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
        {/* 底部固定：撤回 / 恢复（纯图标，hover 出提示；始终显示，无可操作时禁用） */}
        <div className="flex flex-shrink-0 items-center gap-1 border-t border-border px-2 py-1.5">
          <button
            type="button"
            onClick={undoColumns}
            disabled={columnUndo.length === 0}
            title={t('researchGap.undo')}
            aria-label={t('researchGap.undo')}
            className="inline-flex size-7 items-center justify-center rounded text-foreground/70 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent [&_svg]:size-4"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={redoColumns}
            disabled={columnRedo.length === 0}
            title={t('researchGap.redo')}
            aria-label={t('researchGap.redo')}
            className="inline-flex size-7 items-center justify-center rounded text-foreground/70 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent [&_svg]:size-4"
          >
            <Redo2 className="size-4" />
          </button>
        </div>
      </div>

        {/* 洞察卡侧栏（左）：顶部全选头 + 洞察分类（滚动）+ 底部加入证据集 */}
        <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border">
          {/* 顶部栏：默认显示「多选」入口；进入多选后换成 全选/取消 + 计数（与检索论文一致） */}
          {selectionMode ? (
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border bg-primary/5 px-2 py-1.5">
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-[14px] font-medium text-primary">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    checked={allPicked}
                    disabled={allInsightIds.length === 0}
                    onChange={toggleSelectAll}
                    aria-label={t('sessionPapers.bulk.selectAll')}
                    className="size-4 cursor-pointer"
                  />
                  {t('sessionPapers.bulk.selectAll')}
                </label>
                <button
                  type="button"
                  onClick={exitSelection}
                  className="text-[14px] font-medium text-primary hover:underline"
                >
                  {t('sessionPapers.bulk.exit')}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] text-muted-foreground tabular-nums">
                  {t('researchGap.deposit.selected', { count: picked.size })}
                </span>
                <TrustInfo text={t('researchGap.trustFooter', { count: paperCount })} />
              </div>
            </div>
          ) : (
            <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
              <button
                type="button"
                onClick={enterSelection}
                className={sessionPapersToolbarIconButtonClassNames({ shape: 'label' })}
              >
                <SquareCheck className="size-3.5" />
                {t('sessionPapers.multiSelect')}
              </button>
              <TrustInfo text={t('researchGap.trustFooter', { count: paperCount })} />
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2 scrollbar-thin">
            <InsightGroup title={t('researchGap.insights.gapsTitle')}>
              {table.gaps.map((gap) => (
                <GapCard
                  key={gap.id}
                  gap={gap}
                  selectionMode={selectionMode}
                  active={active?.id === gap.id}
                  picked={picked.has(gap.id)}
                  onActivate={() => setActive({ id: gap.id, tone: 'warning' })}
                  onTogglePick={() => togglePicked(gap.id)}
                  onDeposit={() => openDeposit([gapToInsight(gap)])}
                />
              ))}
            </InsightGroup>

            <InsightGroup title={t('researchGap.insights.conflictsTitle')}>
              {table.conflicts.map((cf) => (
                <ConflictCard
                  key={cf.id}
                  conflict={cf}
                  selectionMode={selectionMode}
                  active={active?.id === cf.id}
                  picked={picked.has(cf.id)}
                  onActivate={() => setActive({ id: cf.id, tone: 'destructive' })}
                  onTogglePick={() => togglePicked(cf.id)}
                  onDeposit={() => openDeposit([conflictToInsight(cf)])}
                />
              ))}
            </InsightGroup>
          </div>

          {/* 底部：加入证据集（仅多选态出现；可信提示已移到顶部 ⓘ） */}
          {selectionMode && (
            <div className="flex-shrink-0 border-t border-border p-2">
              <Button
                type="button"
                variant={picked.size > 0 ? 'default' : 'outline'}
                disabled={picked.size === 0}
                onClick={depositPicked}
                className="h-auto w-full gap-1.5 py-1.5 text-[14px] font-medium [&_svg]:size-4"
              >
                <BookMarked className="size-4" />
                {t('researchGap.deposit.button')}
              </Button>
            </div>
          )}
        </aside>
      <ResearchGapDepositDialog
        open={depositOpen}
        insights={depositInsights}
        defaultName={table.title || t('rightPanel.tabs.researchGap')}
        onOpenChange={setDepositOpen}
        onSuccess={() => { if (selectionMode) exitSelection() }}
      />
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
  /** 是否处于多选态：决定显示勾选框 + 卡片点击语义（与检索论文一致） */
  selectionMode: boolean
  active: boolean
  picked: boolean
  onActivate: () => void
  onTogglePick: () => void
  /** 单条加入证据集（浏览态 hover 出现的快捷入口） */
  onDeposit: () => void
}

/**
 * 洞察卡通用外壳（空白/冲突共用）：
 * - 浏览态：点卡片 → 联动高亮对照表对应行/列（active），展开依据；hover 右上角出现「加入证据集」图标
 * - 多选态：左侧勾选框出现，点卡片 = 勾选（与检索论文多选行为一致），批量入口在底部按钮
 */
function InsightCardShell({
  tone,
  title,
  meta,
  rationale,
  selectionMode,
  active,
  picked,
  onActivate,
  onTogglePick,
  onDeposit,
}: InsightCardShellProps): React.ReactElement {
  const { t } = useT('conversation')
  const accent = tone === 'warning' ? 'border-l-warning' : 'border-l-destructive'
  const handleClick = selectionMode ? onTogglePick : onActivate
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
        picked && 'ring-1 ring-primary/60',
      )}
    >
      <div className="flex items-start gap-2">
        {selectionMode && (
          <input
            type="checkbox"
            checked={picked}
            onChange={onTogglePick}
            onClick={(e) => e.stopPropagation()}
            aria-label={title}
            className="mt-0.5 size-4 flex-shrink-0 cursor-pointer"
          />
        )}
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
      {/* 浏览态：hover 右上角出现「加入证据集」图标，单条直接沉淀，无需先进多选；hover 出 Tooltip 提示 */}
      {!selectionMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDeposit()
              }}
              aria-label={t('researchGap.deposit.addOne')}
              className="absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 [&_svg]:size-4"
            >
              <BookmarkPlus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('researchGap.deposit.addOne')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function GapCard({
  gap,
  selectionMode,
  active,
  picked,
  onActivate,
  onTogglePick,
  onDeposit,
}: {
  gap: ResearchGap
  selectionMode: boolean
  active: boolean
  picked: boolean
  onActivate: () => void
  onTogglePick: () => void
  onDeposit: () => void
}): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <InsightCardShell
      tone="warning"
      title={gap.title}
      meta={t('researchGap.insights.involvedPapers', { count: gap.supportingPaperIds.length })}
      rationale={gap.rationale}
      selectionMode={selectionMode}
      active={active}
      picked={picked}
      onActivate={onActivate}
      onTogglePick={onTogglePick}
      onDeposit={onDeposit}
    />
  )
}

function ConflictCard({
  conflict,
  selectionMode,
  active,
  picked,
  onActivate,
  onTogglePick,
  onDeposit,
}: {
  conflict: ConflictNote
  selectionMode: boolean
  active: boolean
  picked: boolean
  onActivate: () => void
  onTogglePick: () => void
  onDeposit: () => void
}): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <InsightCardShell
      tone="destructive"
      title={conflict.title}
      meta={t('researchGap.insights.involvedPapers', { count: conflict.paperIds.length })}
      rationale={conflict.rationale}
      selectionMode={selectionMode}
      active={active}
      picked={picked}
      onActivate={onActivate}
      onTogglePick={onTogglePick}
      onDeposit={onDeposit}
    />
  )
}
