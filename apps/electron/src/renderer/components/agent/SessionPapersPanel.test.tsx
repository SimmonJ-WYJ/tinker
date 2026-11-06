/**
 * SessionPapersPanel live → canonical 收口回归测试（#439）。
 *
 * 检索 finalize 时 paper-search MCP 先把去重结果写入 canonical JSONL，再删除
 * {sessionId}.live.json。删除产生一个 kind='live' 的 watcher 事件——这是
 * "canonical 已就绪、接管展示" 的确定性信号。若渲染端只在 live 事件里刷新 live 快照
 * （setLive(null)）而不重读 canonical，则一旦 canonical 自身的文件事件被 chokidar
 * 去抖合并 / 漏掉，面板会停在空态直到 30s 兜底轮询，表现为"概率性右侧不渲染 paper 列表"。
 *
 * 本测试只触发 live 事件（模拟 canonical 文件事件丢失的最坏情况），断言 finalize 后
 * 面板仍能从 canonical 拉到论文并渲染。
 */

import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionPapersPanel } from './SessionPapersPanel.tsx'
import type { PaperRecord, SessionPapersChangedEvent, SessionPapersLive } from '@asci/shared'

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

const SESSION_ID = 's-439'
const TURN_ID = 'turn-439'

function makeRecord(title: string, ts: string): PaperRecord {
  return {
    ts,
    query: 'gut microbiota depression',
    source: 'tool:mcp__paper-search',
    title,
    authors: ['Zhang J'],
    year: 2026,
    venue: 'Nature',
    doi: `10.1000/${title.replace(/\s+/g, '-').toLowerCase()}`,
    url: `https://example.com/${title.replace(/\s+/g, '-').toLowerCase()}`,
    abstract: 'abstract',
    turn_id: TURN_ID,
  }
}

function makeLive(records: PaperRecord[]): SessionPapersLive {
  return {
    schemaVersion: 1,
    sessionId: SESSION_ID,
    turnId: TURN_ID,
    phase: 'searching',
    updatedAt: 1_700_000_000,
    sources: { arxiv: { verdict: 'ok', count: records.length } },
    records,
    rawTotal: records.length,
  }
}

test('SessionPapersPanel: live 文件 finalize 后即便只收到 live 事件也重读 canonical 列表（#439）', async () => {
  await setAppLanguage('zh')

  const streamingRecord = makeRecord('Streaming Paper', '2026-06-26T00:00:00Z')
  const canonicalRecord = makeRecord('Canonical Paper', '2026-06-26T00:00:01Z')

  // 可变状态：模拟检索 finalize 前后的磁盘真相源。
  let liveSnapshot: SessionPapersLive | null = makeLive([streamingRecord])
  let canonicalRecords: PaperRecord[] = []
  // 用对象持有，避免 TS 控制流把闭包外的回调变量收窄成 null/never
  const holder: { cb: ((event: SessionPapersChangedEvent) => void) | null } = { cb: null }

  window.electronAPI = {
    listSessionPapers: mock(async () => ({ records: canonicalRecords, filePath: '/tmp/x.jsonl' })),
    getSessionPapersLive: mock(async () => liveSnapshot),
    onSessionPapersChanged: mock((cb: (event: SessionPapersChangedEvent) => void) => {
      holder.cb = cb
      return () => { holder.cb = null }
    }),
  } as unknown as Window['electronAPI']

  // 真实运行时整棵树由 App.tsx 的 TooltipProvider 包裹；工具栏图标按钮用 Radix Tooltip，
  // 缺 provider 会抛 `Tooltip must be used within TooltipProvider`，故测试同样包裹。
  render(
    <TooltipProvider>
      <SessionPapersPanel sessionId={SESSION_ID} />
    </TooltipProvider>,
  )

  // 流式阶段：canonical 尚空，live 快照承载展示
  await waitFor(() => {
    expect(screen.getByText('Streaming Paper')).toBeInTheDocument()
  })

  // finalize：canonical 落盘、live 文件被删除；只投递 live 事件（模拟 canonical 事件丢失）
  canonicalRecords = [canonicalRecord]
  liveSnapshot = null
  if (!holder.cb) throw new Error('onSessionPapersChanged 未注册回调')
  holder.cb({ sessionId: SESSION_ID, kind: 'live' })

  // 面板应从 canonical 拉到去重后的论文并渲染，而非停在空态
  await waitFor(() => {
    expect(screen.getByText('Canonical Paper')).toBeInTheDocument()
  })
})
