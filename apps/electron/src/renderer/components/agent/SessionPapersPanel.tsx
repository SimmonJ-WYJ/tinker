/** 旧会话论文只读兼容面板：保留筛选、选择、预览，禁止导入或启动科研任务。 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { BookText, FileText } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { workspacePapersAtom } from '@/atoms/workspace-papers-atoms'
import { previewPaperSiblingsAtom } from '@/atoms/side-panel-layout'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import { agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import {
  sessionPapersFilterFamilyAtom,
  sessionPapersSortFamilyAtom,
  countActiveFilters,
} from '@/atoms/session-papers-filter-atoms'
import {
  sessionPapersMultiSelectActiveFamilyAtom,
  sessionPapersSelectedKeysFamilyAtom,
  sessionPapersPendingZoteroImportFamilyAtom,
} from '@/atoms/session-papers-ui-atoms'
import {
  applyFilter,
  applySort,
  buildMergedPaperItems,
  type MergedPaperItem,
} from './session-papers-filter'
import { recordKey } from './session-papers-utils'
import { SessionPapersSelectionHeader } from './SessionPapersSelectionHeader'
import { SessionPapersToolbar } from './SessionPapersToolbar'
import { SessionPapersLiveBanner } from './SessionPapersLiveBanner'
import { SessionPapersList, type SessionPapersListItem } from './SessionPapersList'
import { computeStats } from './session-papers-stats'
import type { PaperRecord, SessionPapersLive, WorkspacePaperEntry } from '@asci/shared'
import { useT } from '@/hooks/useT'

/** 兜底轮询间隔：主路径是 SESSION_PAPERS_CHANGED 事件推送，轮询只为事件丢失时补救 */
const POLL_INTERVAL_MS = 30_000

interface SessionPapersPanelProps {
  sessionId: string
  readOnly?: true
}

/** 一行的选择身份：用于稳定标识可勾选行 */
type SelectableRow =
  | { kind: 'entry'; selectionKey: string; entry: WorkspacePaperEntry; record?: PaperRecord }
  | { kind: 'record'; selectionKey: string; record: PaperRecord }

/** 给 record-only 行算出稳定 selectionKey：优先 recordKey，缺失时用 ts+title 兜底 */
function selectionKeyForRow(item: { entry?: WorkspacePaperEntry; record: PaperRecord }, idx: number): string {
  if (item.entry) return `e:${item.entry.key}`
  const k = recordKey(item.record)
  if (k) return `r:${k}`
  const title = item.record.title ? item.record.title.slice(0, 40) : ''
  return `r:_:${item.record.ts ?? ''}:${title}:${idx}`
}

export function SessionPapersPanel({ sessionId }: SessionPapersPanelProps): React.ReactElement {
  const { t } = useT('conversation')
  const [records, setRecords] = React.useState<PaperRecord[]>([])
  // 检索流式进度快照（retrieve 进行中才非 null；canonical 落地后文件被删自动清空）
  const [live, setLive] = React.useState<SessionPapersLive | null>(null)
  // 仅首次加载显示 loading 态；后台刷新（事件/轮询）不闪 loading
  const [initialLoading, setInitialLoading] = React.useState(true)
  const [expanded, setExpanded] = React.useState(false)
  const [filter, setFilter] = useAtom(sessionPapersFilterFamilyAtom(sessionId))
  const [sortMode, setSortMode] = useAtom(sessionPapersSortFamilyAtom(sessionId))
  const [multiSelectActive, setMultiSelectActive] = useAtom(
    sessionPapersMultiSelectActiveFamilyAtom(sessionId),
  )
  const [selected, setSelected] = useAtom(
    sessionPapersSelectedKeysFamilyAtom(sessionId),
  )
  // 兼容旧内存状态；历史面板仅清理，不执行导入。
  const [pendingZoteroImport, setPendingZoteroImport] = useAtom(
    sessionPapersPendingZoteroImportFamilyAtom(sessionId),
  )
  const workspacePapers = useAtomValue(workspacePapersAtom)
  const openInRightPanel = useOpenInRightPanel()
  const setPaperSiblings = useSetAtom(previewPaperSiblingsAtom)

  const load = React.useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await window.electronAPI.listSessionPapers(sessionId)
      setRecords(res.records)
    } catch (err) {
      console.error('[检索论文] 加载失败:', err)
    } finally {
      setInitialLoading(false)
    }
  }, [sessionId])

  const loadLive = React.useCallback(async (): Promise<SessionPapersLive | null> => {
    if (!sessionId) return null
    try {
      const snapshot = await window.electronAPI.getSessionPapersLive(sessionId)
      setLive(snapshot)
      return snapshot
    } catch (err) {
      console.error('[检索论文] live 进度加载失败:', err)
      return null
    }
  }, [sessionId])

  React.useEffect(() => {
    setInitialLoading(true)
    setLive(null)
    void load()
    void loadLive()
    const t = setInterval(() => {
      void load()
      void loadLive()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load, loadLive])

  // 事件驱动刷新：主进程 watcher 监听 agent-sessions-papers/ 推送变化。
  // live（检索流式进度）→ 拉 live 快照；canonical（retrieve 落盘 / apply_rerank
  // 回写 / recorder 补漏）→ 重载列表 + 顺带刷 live（文件可能已被 finalize 删除）
  React.useEffect(() => {
    if (!sessionId) return
    const unsubscribe = window.electronAPI.onSessionPapersChanged((event) => {
      if (event.sessionId !== sessionId) return
      if (event.kind === 'live') {
        // live 文件被删除（finalize：本轮检索定稿）时 retrieve 已先把去重结果写入 canonical
        // JSONL，删除事件即"canonical 接管展示"的确定性信号 —— 必须同步重读列表。否则一旦
        // canonical 自身的文件事件被 chokidar 去抖合并 / 漏掉，面板会停在空态直到 30s 兜底
        // 轮询，表现为概率性右侧不渲染 paper 列表（#439）。
        void loadLive().then((snapshot) => {
          if (snapshot == null) void load()
        })
      } else {
        void load()
        void loadLive()
      }
    })
    return unsubscribe
  }, [sessionId, load, loadLive])

  // 流式中判定：
  // - searching/processing（retrieve 中）：本轮（live.turnId）的 canonical 记录尚未落盘；
  //   canonical 一落地（同 turn_id 记录出现）即收口，避免去重前后两份数据并存。
  // - scoring/reporting（#775，retrieve 之后）：canonical 早已落地是正常的，凭 phase 直接
  //   显示进度（scorer 打分 / 报告生成），不再靠 turnId 对照。
  const streaming = React.useMemo(() => {
    if (!live) return false
    if (live.phase === 'scoring' || live.phase === 'reporting') return true
    if (!live.turnId) return false
    return !records.some((r) => r.turn_id === live.turnId)
  }, [records, live])

  // 流式中本轮的有效 turn_id：live 记录的辨识依据（Python 写 live 文件时已给
  // 每条 record 注入 turn_id；流式期间 canonical 里不存在同 turn_id 的记录，
  // 否则 streaming 即为 false），不需要额外的标记字段。
  // scoring/reporting 阶段不产 live 记录、且 canonical 已落地（同 turn_id），
  // 故不设 liveTurnId，避免把已落地的 canonical 记录误当本轮 live 浮顶。
  const liveTurnId =
    streaming && live && live.phase !== 'scoring' && live.phase !== 'reporting' ? live.turnId : undefined

  // 流式中把 live 记录拼到 canonical 之后：dedupeByIdentity 保留先出现
  // 的一条 → 同 recordKey 时 canonical（带评分/entry 关联）优先，live 平滑收敛
  const combinedRecords = React.useMemo<PaperRecord[]>(() => {
    if (!streaming || !live || live.records.length === 0) return records
    return [...records, ...live.records]
  }, [records, live, streaming])

  // session record × workspace entry 合并（共享函数，DOI 点击解析同口径组装 siblings）
  const merged = React.useMemo<MergedPaperItem[]>(
    () => buildMergedPaperItems(combinedRecords, workspacePapers),
    [combinedRecords, workspacePapers],
  )

  // F23 多维筛选：年份 / 来源 / 引用量 / 摘要
  const filtered = React.useMemo(() => applyFilter(merged, filter), [merged, filter])

  // 排序：默认相关度（保留输入顺序）；流式期间 applySort 把本轮 live 记录浮顶
  const sorted = React.useMemo(
    () => applySort(filtered, sortMode, liveTurnId),
    [filtered, sortMode, liveTurnId],
  )

  const stats = React.useMemo(() => computeStats(merged), [merged])
  const activeFilterCount = countActiveFilters(filter)
  const hiddenByUrl = records.length - merged.length

  // 派生：每行的 selectionKey + 是否可选（已入 Zotero 的不可选）
  const rowMeta = React.useMemo(() => {
    return sorted.map((m, idx) => {
      const selectionKey = selectionKeyForRow(m, idx)
      const selectable = !(m.entry?.linkedZoteroKey)
      const row: SelectableRow = m.entry
        ? { kind: 'entry', selectionKey, entry: m.entry, record: m.record }
        : { kind: 'record', selectionKey, record: m.record }
      return { selectionKey, selectable, row, merged: m }
    })
  }, [sorted])

  const selectableKeySet = React.useMemo(() => {
    const s = new Set<string>()
    for (const r of rowMeta) if (r.selectable) s.add(r.selectionKey)
    return s
  }, [rowMeta])

  // 列表变化时剪掉已不存在或已不可选的 key，避免幽灵选中态。
  // 用 updater 形式不依赖 selected，防止 selected 自身引用变更引发回环。
  React.useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set<string>()
      for (const k of prev) {
        if (selectableKeySet.has(k)) next.add(k)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [selectableKeySet])

  const selectedCount = selected.size

  // 本会话 Agent 是否运行中，仅用于历史 live 进度 banner。
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const agentRunning = streamingStates.get(sessionId)?.running ?? false

  const exitMultiSelect = React.useCallback((): void => {
    setMultiSelectActive(false)
    setSelected(new Set<string>())
  }, [setMultiSelectActive, setSelected])

  // 切换多选模式：开启仅置位，退出时清空已选，避免选中态残留
  const toggleMultiSelect = React.useCallback((): void => {
    if (multiSelectActive) setSelected(new Set<string>())
    setMultiSelectActive((active) => !active)
  }, [multiSelectActive, setMultiSelectActive, setSelected])

  const toggleSelectAll = React.useCallback((): void => {
    setSelected((prev) => (prev.size === selectableKeySet.size ? new Set<string>() : new Set(selectableKeySet)))
  }, [selectableKeySet, setSelected])

  // session 切换时退出多选态，避免幽灵勾选残留
  React.useEffect(() => {
    return () => {
      setMultiSelectActive(false)
      setSelected(new Set<string>())
    }
  }, [sessionId, setMultiSelectActive, setSelected])

  // 旧导入意图仅清除内存状态；打开历史不会启动已退役工作流。
  React.useEffect(() => {
    if (pendingZoteroImport) setPendingZoteroImport(null)
  }, [pendingZoteroImport, setPendingZoteroImport])

  // 兄弟列表 = 完整 sorted 列表（entries + records 同池），↑↓ 跨全表导航，
  // 计数器分母与「检索论文」总数一致。每个 item 必有 record，entry 可选。
  const siblingItems = React.useMemo(
    () => sorted.map((m) => ({ record: m.record, entry: m.entry })),
    [sorted],
  )

  // 打开某条 entry 的预览：写入全表兄弟列表，支持 ↑↓ 键盘导航
  const openEntryPreview = React.useCallback((entry: WorkspacePaperEntry) => {
    const currentIndex = siblingItems.findIndex((it) => it.entry?.key === entry.key)
    setPaperSiblings({ items: siblingItems, currentIndex })
    openInRightPanel({ kind: 'paper-entry', entry })
  }, [siblingItems, setPaperSiblings, openInRightPanel])

  // 打开仅有 record（未入 workspace）的预览：复用 PreviewTarget.kind='paper' 通路。
  const openRecordPreview = React.useCallback((record: PaperRecord) => {
    const currentIndex = siblingItems.findIndex(
      (it) => !it.entry && it.record.ts === record.ts && it.record.title === record.title,
    )
    setPaperSiblings({ items: siblingItems, currentIndex })
    openInRightPanel({ kind: 'paper', record })
  }, [siblingItems, setPaperSiblings, openInRightPanel])

  // 把 rowMeta 转换为 SessionPapersList 所需的 items 格式
  const listItems = React.useMemo<SessionPapersListItem[]>(() =>
    rowMeta.map(({ selectionKey, row, selectable }) => ({
      key: selectionKey,
      record: row.record,
      entry: row.kind === 'entry' ? row.entry : undefined,
      selectable,
    })),
    [rowMeta],
  )

  const renderList = (inDialog: boolean) => {
    if (sorted.length === 0) {
      const reason: EmptyReason = initialLoading
        ? 'loading'
        : merged.length > 0 && activeFilterCount > 0
          ? 'filtered'
          : 'empty'
      return <EmptyState reason={reason} />
    }
    return (
      <SessionPapersList
        sessionId={sessionId}
        items={listItems}
        onOpenPreview={(item) => {
          if (item.entry) {
            openEntryPreview(item.entry)
          } else if (item.record) {
            openRecordPreview(item.record)
          }
          if (inDialog) setExpanded(false)
        }}
      />
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 选择态替换普通工具栏：顶部计数 + 全选 + 取消，动作下沉到底部 */}
      {multiSelectActive ? (
        <SessionPapersSelectionHeader
          selectedCount={selectedCount}
          totalCount={selectableKeySet.size}
          onToggleSelectAll={toggleSelectAll}
          onExit={exitMultiSelect}
        />
      ) : (
        <SessionPapersToolbar
          sessionId={sessionId}
          totalCount={merged.length}
          filteredCount={sorted.length}
          hiddenByUrl={hiddenByUrl}
          stats={stats}
          onRefresh={() => void load()}
          onOpenInNewWindow={() => setExpanded(true)}
          onToggleMultiSelect={toggleMultiSelect}
        />
      )}

      {/* #775：banner 仅在本会话 Agent 运行中显示——「Agent 在跑」是「这不是残留」的真信号，
          比时间 TTL 准：长报告(>5min)期间不误删，Agent 崩溃/结束则立即收起、不等 TTL。 */}
      {live && streaming && agentRunning && <SessionPapersLiveBanner live={live} />}

      <div className="flex-1 min-h-0 overflow-y-auto pb-1 scrollbar-thin">
        {renderList(false)}
      </div>

      {/* 展开大窗口：平铺所有卡片，点击卡片 → preview + 自动关闭本 Dialog */}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="max-w-4xl w-[85vw] h-[80vh] flex flex-col"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-muted-foreground" />
              {t('sessionPapers.title')}
              <span className="text-sm text-muted-foreground/70 tabular-nums font-normal">
                {activeFilterCount > 0 && sorted.length !== merged.length
                  ? `${t('sessionPapers.papersCount', { count: sorted.length })} / ${merged.length}`
                  : t('sessionPapers.papersCount', { count: merged.length })}
              </span>
            </DialogTitle>
          </DialogHeader>
          {multiSelectActive && (
            <SessionPapersSelectionHeader
              selectedCount={selectedCount}
              totalCount={selectableKeySet.size}
              onToggleSelectAll={toggleSelectAll}
              onExit={exitMultiSelect}
            />
          )}
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {renderList(true)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type EmptyReason = 'loading' | 'empty' | 'filtered'

function EmptyState({ reason }: { reason: EmptyReason }): React.ReactElement {
  const { t } = useT('conversation')
  const primary =
    reason === 'loading'
      ? t('sessionPapers.loading')
      : reason === 'filtered'
        ? t('sessionPapers.emptyAfterFilter')
        : t('sessionPapers.empty')
  const hint =
    reason === 'filtered'
      ? t('sessionPapers.emptyAfterFilterHint')
      : reason === 'empty'
        ? t('sessionPapers.emptyHint')
        : null
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <BookText className="size-6 text-muted-foreground/40" />
      <div className="text-sm text-muted-foreground">{primary}</div>
      {hint && (
        <div className="text-sm text-muted-foreground/60 max-w-[200px] leading-relaxed whitespace-pre-line">
          {hint}
        </div>
      )}
    </div>
  )
}
