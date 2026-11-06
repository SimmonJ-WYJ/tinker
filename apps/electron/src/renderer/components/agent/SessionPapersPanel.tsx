/**
 * SessionPapersPanel — 检索论文结果（极简版）
 *
 * 数据：listSessionPapers 返回的 PaperRecord[] —— 本会话 Agent 检到的论文
 * 标注：每条 PaperRecord 通过 recordKey 关联到 workspace papers 的 entry，
 *       用于判断是否已加入 Zotero；其他标注字段 UI 层不暴露（由 Zotero 管理）
 * 交互：点击卡片 → 右侧 preview 显示详情
 *         · 已入 workspace（有 entry）→ PaperEntryDetailPanel + ◀ ▶ 兄弟导航
 *         · 仅 record（未入 workspace）→ PaperDetailRenderer，无副作用、不参与兄弟导航
 *       加入 Zotero 按钮 → 打开 ZoteroLinkDialog（单条）
 *       行内 checkbox 多选 → 底部批量栏 → ZoteroBatchLinkDialog（批量）
 *       标题右侧展开按钮 → 在大窗口平铺所有卡片，方便集中浏览
 *
 * 多选规则：
 *   · 已加入 Zotero 的行（entry.linkedZoteroKey 存在）不显示 checkbox，无法被选中
 *   · 其余行（无 entry 或 entry 未链 Zotero）均可选
 *   · 列表变化（如新批论文进来）时，自动剪掉已不存在的勾选 key
 *   · 批量提交后：成功的从选中态移除，失败的保留勾选用于重试
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { BookText, FileText } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { workspacePapersAtom } from '@/atoms/workspace-papers-atoms'
import { previewPaperSiblingsAtom } from '@/atoms/side-panel-layout'
import { pendingAutoSendPromptAtom } from '@/atoms/starter-prompt-atoms.ts'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import { currentAgentWorkspaceIdAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
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
import { ZoteroLinkDialog } from './ZoteroLinkDialog'
import { ZoteroBatchLinkDialog, type BatchLinkItem } from './ZoteroBatchLinkDialog'
import {
  applyFilter,
  applySort,
  buildMergedPaperItems,
  type MergedPaperItem,
} from './session-papers-filter'
import { recordKey } from './session-papers-utils'
import { SessionPapersSelectionHeader } from './SessionPapersSelectionHeader'
import { SessionPapersSelectionActions } from './SessionPapersSelectionActions'
import { SessionPapersToolbar } from './SessionPapersToolbar'
import { SessionPapersLiveBanner } from './SessionPapersLiveBanner'
import { SessionPapersList, type SessionPapersListItem } from './SessionPapersList'
import { computeStats } from './session-papers-stats'
import type { PaperRecord, SessionPapersLive, WorkspacePaperEntry } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { toast } from 'sonner'

/** 兜底轮询间隔：主路径是 SESSION_PAPERS_CHANGED 事件推送，轮询只为事件丢失时补救 */
const POLL_INTERVAL_MS = 30_000

interface SessionPapersPanelProps {
  sessionId: string
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
  const { t: tLib } = useT('library')
  const [records, setRecords] = React.useState<PaperRecord[]>([])
  // 检索流式进度快照（retrieve 进行中才非 null；canonical 落地后文件被删自动清空）
  const [live, setLive] = React.useState<SessionPapersLive | null>(null)
  // 仅首次加载显示 loading 态；后台刷新（事件/轮询）不闪 loading
  const [initialLoading, setInitialLoading] = React.useState(true)
  const [zoteroDialogEntry, setZoteroDialogEntry] = React.useState<WorkspacePaperEntry | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [filter, setFilter] = useAtom(sessionPapersFilterFamilyAtom(sessionId))
  const [sortMode, setSortMode] = useAtom(sessionPapersSortFamilyAtom(sessionId))
  const [multiSelectActive, setMultiSelectActive] = useAtom(
    sessionPapersMultiSelectActiveFamilyAtom(sessionId),
  )
  const [selected, setSelected] = useAtom(
    sessionPapersSelectedKeysFamilyAtom(sessionId),
  )
  // 对话内"批量导入 Zotero"待处理 recordKeys：由全局监听器写入，本面板挂载后消费
  const [pendingZoteroImport, setPendingZoteroImport] = useAtom(
    sessionPapersPendingZoteroImportFamilyAtom(sessionId),
  )
  const [batchItems, setBatchItems] = React.useState<BatchLinkItem[] | null>(null)
  const [batchPreparing, setBatchPreparing] = React.useState(false)
  const workspacePapers = useAtomValue(workspacePapersAtom)
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const openInRightPanel = useOpenInRightPanel()
  const setPaperSiblings = useSetAtom(previewPaperSiblingsAtom)
  const setPendingAutoSend = useSetAtom(pendingAutoSendPromptAtom)

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

  // 找研究空白（0.4 Epic 1）：把勾选论文标题拼成指令预填到对话框，用户发送后由总控路由到
  // research-gap 能力包；对照表产出后经 present_research_gap_table 事件自动打开右侧「研究空白」Tab。
  const handleFindResearchGap = React.useCallback((): void => {
    const titles = rowMeta
      .filter((r) => selected.has(r.selectionKey))
      .map((r) => r.merged.record?.title ?? r.merged.entry?.title ?? '')
      .filter((t): t is string => Boolean(t))
    const list = titles.map((t, i) => `${i + 1}. ${t}`).join('\n')
    const msg = titles.length
      ? `${t('sessionPapers.researchGapPrompt.intro', { count: titles.length })}\n${list}`
      : t('sessionPapers.researchGapPrompt.introNoList')
    // 直接派发（自动开跑），不再填入输入框等用户回车
    setPendingAutoSend(msg)
  }, [rowMeta, selected, setPendingAutoSend, t])

  // 本会话 Agent 是否运行中——live 进度 banner 与「找研究空白」按钮共用这一真信号。
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const agentRunning = streamingStates.get(sessionId)?.running ?? false
  // 研究空白生成中 = Agent 运行中：button 转 loading + 禁用，完成（running=false）再激活
  const researchGapBusy = agentRunning

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

  // 用户主动把 record 回流到 workspace-papers，得到 entry 后打开 Zotero 弹窗
  const ingestAndOpenZotero = React.useCallback(
    async (record: PaperRecord) => {
      if (!workspaceId) return
      try {
        const [entry] = await window.electronAPI.workspacePapers.ingestRecords(
          workspaceId,
          [record],
          sessionId,
        )
        if (entry) setZoteroDialogEntry(entry)
      } catch (err) {
        console.error('[检索论文] 回流 workspace-papers 失败:', err)
      }
    },
    [workspaceId, sessionId],
  )

  /**
   * 批量加入 Zotero：先把 record-only 选中项回流为 workspace entries，
   * 然后把所有 entries（含原本就存在的）打包给 ZoteroBatchLinkDialog 处理。
   *
   * 可选 selectionKeysOverride：跳过 selected state，用调用方提供的 key 集触发（用于
   * asci-zotero MCP 触发的 IPC 路径，避免 React state batch 导致用旧 selected 值）。
   */
  const handleBatchAddToZotero = React.useCallback(async (selectionKeysOverride?: Set<string>) => {
    const effective = selectionKeysOverride ?? selected
    if (!workspaceId || effective.size === 0) {
      if (!workspaceId) toast.error(t('sessionPapers.selection.noWorkspace'))
      return
    }
    const selectedRows = rowMeta.filter((r) => effective.has(r.selectionKey) && r.selectable)
    if (selectedRows.length === 0) return

    setBatchPreparing(true)
    try {
      // 把已有 entry 的行直接收集；record-only 的批量 ingest 成 entries
      const directItems: BatchLinkItem[] = []
      const recordsToIngest: PaperRecord[] = []
      const recordSelectionKeyByRecordKey = new Map<string, string>()

      for (const r of selectedRows) {
        if (r.row.kind === 'entry') {
          directItems.push({ selectionKey: r.selectionKey, entry: r.row.entry })
        } else {
          recordsToIngest.push(r.row.record)
          const k = recordKey(r.row.record)
          if (k) recordSelectionKeyByRecordKey.set(k, r.selectionKey)
          // 无 recordKey 的项：ingest 后无法回找映射，下面会兜底为"全部成功后无需保留"
        }
      }

      let ingested: WorkspacePaperEntry[] = []
      if (recordsToIngest.length > 0) {
        try {
          ingested = await window.electronAPI.workspacePapers.ingestRecords(
            workspaceId,
            recordsToIngest,
            sessionId,
          )
        } catch (err) {
          console.error('[Zotero 批量] 回流 workspace-papers 失败:', err)
          toast.error(tLib('batchLinkDialog.ingestFailed'))
          return
        }
      }

      const ingestedItems: BatchLinkItem[] = ingested.map((entry) => {
        // 用 entry.key 反查原 selectionKey；entry.key 与 recordKey 等价（参见 main 端规范化）
        const sk = recordSelectionKeyByRecordKey.get(entry.key)
        return { selectionKey: sk ?? `e:${entry.key}`, entry }
      })

      const allItems = [...directItems, ...ingestedItems]
        // 已绑过 Zotero 的（理论不会进来，但兜底过滤一次）跳过
        .filter((it) => !it.entry.linkedZoteroKey)

      // 全部已链 Zotero 时静默退出 —— 不是错误状态，无需 toast
      if (allItems.length === 0) return

      setBatchItems(allItems)
    } finally {
      setBatchPreparing(false)
    }
  }, [workspaceId, selected, rowMeta, sessionId, t, tLib])

  const handleBatchComplete = React.useCallback((failedSelectionKeys: string[]) => {
    // 成功的从选中态移除，失败的保留以便重试
    setSelected(new Set(failedSelectionKeys))
    setBatchItems(null)
  }, [])

  /**
   * 消费来自 asci-zotero MCP 工具的"批量导入"意图（issue #61）。
   *
   * IPC 监听器在全局常驻的 useGlobalAgentListeners 中（本面板只在 session-papers tab
   * 激活时挂载，监听器若放面板内会随卸载丢失事件）。监听器把 recordKeys 写入常驻
   * sessionPapersPendingZoteroImportFamilyAtom，本 effect 在面板挂载后读取并：
   *   1. 先 load() 刷新 records（避免 process_search_results 刚写完 panel 还没轮询拉到）
   *   2. 暂存待匹配的 recordKeys 到本地 pendingImport，并清空常驻 atom（一次性消费）
   *   3. 下方 effect 在 rowMeta 更新后映射到 selectionKey 并调用 handleBatchAddToZotero
   *
   * 整体目标是把"对话内导入"收敛到与用户手点完全同一条 UI 链路。
   */
  const [pendingImport, setPendingImport] = React.useState<string[] | null>(null)

  React.useEffect(() => {
    if (!pendingZoteroImport || pendingZoteroImport.length === 0) return
    const recordKeys = pendingZoteroImport
    // 立刻清空常驻 atom，防止重复消费。
    // 注意：不能用 cancelled 守卫——清空 atom 会让本 effect 因依赖变化重跑，
    // React 先执行上一次 cleanup（置 cancelled=true），导致 load() 完成后 setPendingImport 被跳过，
    // 映射 effect 永不触发、弹窗不出现。setState 在卸载后是 no-op，无需该守卫。
    setPendingZoteroImport(null)
    void load().finally(() => setPendingImport(recordKeys))
  }, [pendingZoteroImport, setPendingZoteroImport, load])

  React.useEffect(() => {
    if (!pendingImport || pendingImport.length === 0) return
    if (rowMeta.length === 0) return // 等 load() 完成 / records 渲染到 rowMeta

    // 把 main 端给的 canonical recordKey 映射回本地 rowMeta 的 selectionKey
    const matched = new Set<string>()
    for (const k of pendingImport) {
      for (const m of rowMeta) {
        if (!m.selectable) continue
        const candidate = m.row.kind === 'entry'
          ? m.row.entry.key
          : recordKey(m.row.record)
        if (candidate === k) {
          matched.add(m.selectionKey)
          break
        }
      }
    }
    // 一旦消费 pendingImport 立刻清空，防止 rowMeta 变化引起重复触发
    setPendingImport(null)
    if (matched.size === 0) return
    setSelected(matched)
    // 不展开检索结果面板：用户只关心 Zotero 导入弹窗本身，背景展开反而干扰焦点
    void handleBatchAddToZotero(matched)
  }, [pendingImport, rowMeta, handleBatchAddToZotero])

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
        onLinkZotero={(item) => {
          if (item.entry) {
            setZoteroDialogEntry(item.entry)
          } else if (item.record) {
            void ingestAndOpenZotero(item.record)
          }
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

      {/* 选择态底部常驻动作条 */}
      {multiSelectActive && (
        <SessionPapersSelectionActions
          selectedCount={selectedCount}
          onAddToZoteroBatch={() => handleBatchAddToZotero()}
          onFindResearchGap={handleFindResearchGap}
          researchGapBusy={researchGapBusy}
        />
      )}

      <ZoteroLinkDialog
        open={!!zoteroDialogEntry}
        onOpenChange={(o) => { if (!o) setZoteroDialogEntry(null) }}
        entry={zoteroDialogEntry}
      />

      <ZoteroBatchLinkDialog
        open={!!batchItems && batchItems.length > 0}
        onOpenChange={(o) => { if (!o) setBatchItems(null) }}
        items={batchItems ?? []}
        workspaceId={workspaceId}
        onComplete={handleBatchComplete}
      />

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
          {multiSelectActive && (
            <SessionPapersSelectionActions
              selectedCount={selectedCount}
              onAddToZoteroBatch={() => handleBatchAddToZotero()}
              onFindResearchGap={handleFindResearchGap}
              researchGapBusy={researchGapBusy}
            />
          )}
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
