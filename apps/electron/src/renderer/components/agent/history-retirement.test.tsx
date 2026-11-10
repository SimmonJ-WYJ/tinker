import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { TooltipProvider } from '@/components/ui/tooltip'
import { setAppLanguage } from '@/lib/i18n'
import { DEFAULT_TABS, rightPanelTabsBySessionAtom, upsertTab, closeTab } from '@/atoms/right-panel-tabs'
import { sessionPapersPendingZoteroImportFamilyAtom } from '@/atoms/session-papers-ui-atoms'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { SessionPapersPanel } from './SessionPapersPanel'
import { LitReviewDirectionsCard } from './choice/LitReviewDirectionsCard'
import { SearchPlanCard } from './choice/SearchPlanCard'
import { ZoteroSettings } from '@/components/settings/ZoteroSettings'
import type { PaperRecord } from '@asci/shared'

const api = window.electronAPI
afterEach(() => { cleanup(); window.electronAPI = api })
const record: PaperRecord = { title: 'Saved paper', ts: '2026-01-01', query: 'saved', source: 'history', authors: ['Author'], year: 2026, venue: 'Saved venue', abstract: 'Saved abstract', doi: '10.1/saved', url: 'https://example.org/paper' }

test('新会话仅 Files；显式打开历史 Papers 可关闭并重新打开', () => {
 const store = createStore()
 const state = store.get(rightPanelTabsBySessionAtom('history-retirement'))
 expect(DEFAULT_TABS.map(t => t.id)).toEqual(['session-files'])
 expect(state.activeId).toBe('session-files')
 const opened = upsertTab(state, 'session-papers', 'session-papers', '', null)
 expect(closeTab(opened, 'session-papers')).toEqual(state)
 expect(upsertTab(closeTab(opened, 'session-papers'), 'session-papers', 'session-papers', '', null).activeId).toBe('session-papers')
})

test('打开含旧导入意图的历史论文及展开窗口仅阅读，不 ingest/link/send', async () => {
 await setAppLanguage('en')
 const store = createStore()
 store.set(currentAgentWorkspaceIdAtom, 'synthetic-workspace')
 store.set(sessionPapersPendingZoteroImportFamilyAtom('saved'), ['doi:10.1/saved'])
 const write = mock(async () => [])
 window.electronAPI = { listSessionPapers: async () => ({ records: [record], filePath: '/tmp/synthetic.jsonl' }), getSessionPapersLive: async () => null, onSessionPapersChanged: () => () => {}, workspacePapers: { ingestRecords: write, linkZotero: write } } as unknown as typeof api
 render(<Provider store={store}><TooltipProvider><SessionPapersPanel sessionId="saved" /></TooltipProvider></Provider>)
 await screen.findByText('Saved paper')
 await waitFor(() => expect(store.get(sessionPapersPendingZoteroImportFamilyAtom('saved'))).toBeNull())
 expect(write).toHaveBeenCalledTimes(0)
 expect(screen.queryAllByRole('button', { name: /Zotero|research gap/i })).toHaveLength(0)
 const more = screen.getByRole('button', { name: /more/i })
 fireEvent.pointerDown(more, { button: 0, ctrlKey: false })
 fireEvent.mouseDown(more, { button: 0, ctrlKey: false })
 fireEvent.click(await screen.findByRole('menuitem', { name: /new window|expand/i }))
 expect(screen.getAllByText('Saved paper').length).toBeGreaterThan(1)
 expect(screen.queryAllByRole('button', { name: /Zotero|research gap/i })).toHaveLength(0)
 expect(write).toHaveBeenCalledTimes(0)
})

test('旧科研请求展示保存内容且不提供可提交按钮', () => {
 const respond = mock(() => {})
 render(<LitReviewDirectionsCard request={{ requestId: 'old', sessionId: 'saved', directions: [{ key: '1', title: 'Saved direction', thesis: 'Saved thesis', outlinePreview: ['Outline'], paperCount: 1, paperWithFulltextCount: 0 }] } as never} onRespond={respond} />)
 render(<SearchPlanCard request={{ requestId: 'old-plan', sessionId: 'saved', plan: { researchQuestion: 'Saved question', keywords: ['history'], sources: ['arxiv'] } } as never} onRespond={respond} />)
 expect(screen.getAllByText(/Saved direction/).length).toBeGreaterThan(0)
 expect(screen.getByText('Saved question')).toBeInTheDocument()
 expect(screen.queryAllByRole('button')).toHaveLength(0)
 expect(respond).toHaveBeenCalledTimes(0)
})

test('旧 Zotero 设置路由仅说明，不挂载主动科学控件或发起 IPC', () => {
 const calls = mock(() => { throw new Error('旧设置不得发起 IPC') })
 window.electronAPI = new Proxy({}, { get: () => calls }) as typeof api
 render(<ZoteroSettings />)
 expect(screen.queryAllByRole('button')).toHaveLength(0)
 expect(screen.queryAllByRole('switch')).toHaveLength(0)
 expect(screen.queryAllByRole('textbox')).toHaveLength(0)
 expect(calls).toHaveBeenCalledTimes(0)
})

test('两种旧论文详情只读，保留元数据和来源链接', async () => {
 const PaperDetailRenderer = (await import('@/components/preview/renderers/PaperDetailRenderer')).default
 const { PaperEntryDetailPanel } = await import('@/components/preview/renderers/PaperEntryDetailPanel')
 render(<PaperDetailRenderer record={record} />)
 render(<PaperEntryDetailPanel entry={{ ...record, key: 'doi:10.1/saved', firstSeenAt: '2026-01-01', lastSeenAt: '2026-01-01' } as never} />)
 expect(screen.getAllByText('Saved paper')).toHaveLength(2)
 expect(screen.getAllByText('DOI').length).toBeGreaterThan(0)
 expect(screen.queryAllByRole('button', { name: /Zotero|graph/i })).toHaveLength(0)
})

test('研究空白历史保留文字、洞察和溯源，没有修改列或沉淀动作', async () => {
 const { ResearchGapTableView } = await import('./research-gap/ResearchGapTableView')
 const { researchGapTablesBySessionAtom } = await import('@/atoms/research-gap-atoms')
 const store = createStore()
 store.set(researchGapTablesBySessionAtom, new Map([['saved', [{ id: 'table', title: 'Saved analysis', sourceSelection: { kind: 'papers', paperIds: ['p'] }, scopeLabel: 'Saved scope', columns: [{ id: 'c', name: 'Saved column', origin: 'ai' }], rows: [{ paperId: 'p', paperLabel: 'Saved row', cells: { c: { value: 'Saved cell', source: { label: 'Saved source', anchor: { snapshotText: 'Saved anchor' } } } } }], gaps: [{ id: 'g', title: 'Saved gap', rationale: 'Saved rationale', supportingPaperIds: ['p'], involvedColumnIds: ['c'] }], conflicts: [] } as never]]]))
 render(<Provider store={store}><TooltipProvider><ResearchGapTableView sessionId="saved" tableId="table" /></TooltipProvider></Provider>)
 expect(screen.getByText('Saved column')).toBeInTheDocument()
 expect(screen.getByText('Saved cell')).toBeInTheDocument()
 fireEvent.click(screen.getByText('Saved cell'))
 expect(await screen.findByText(/Saved anchor/)).toBeInTheDocument()
 expect(screen.queryAllByRole('button', { name: /remove|undo|redo|evidence|select/i })).toHaveLength(0)
})

test('科研残留请求退出活动 banner 队列，不提交任何工作流；通用选择不受影响', async () => {
 const { LitReviewDirectionsBanner } = await import('./LitReviewDirectionsBanner')
 const { SearchPlanBanner } = await import('./SearchPlanBanner')
 const { allPendingLitReviewDirectionsRequestsAtom: review, allPendingSearchPlanRequestsAtom: search } = await import('@/atoms/agent-atoms')
 const store = createStore()
 const write = mock(async () => {})
 window.electronAPI = { respondLitReviewPresentDirections: write, respondSearchPlan: write } as unknown as typeof api
 store.set(review, new Map([['saved', [{ requestId: 'old', sessionId: 'saved', directions: [] } as never]]]))
 store.set(search, new Map([['saved', [{ requestId: 'old-plan', sessionId: 'saved', plan: { researchQuestion: 'Old question', keywords: [], sources: [] } } as never]]]))
 render(<Provider store={store}><LitReviewDirectionsBanner sessionId="saved" /><SearchPlanBanner sessionId="saved" /></Provider>)
 await waitFor(() => {
  expect(store.get(review).has('saved')).toBe(false)
  expect(store.get(search).has('saved')).toBe(false)
 })
 expect(write).toHaveBeenCalledTimes(0)
})

test('账户双语数据说明面向通用用户数据，保留原兼容目录与授权行为文案', async () => {
 const en = (await import('@/locales/en/auth/profile.json')).default
 const zh = (await import('@/locales/zh/auth/profile.json')).default
 expect(en.dataLocality.body).not.toContain('Research data')
 expect(zh.dataLocality.body).not.toContain('研究数据')
 expect(en.deleteConfirm.impactLocalKept).not.toContain('research library')
 expect(zh.deleteConfirm.impactLocalKept).not.toContain('研究库')
 expect(en.dataLocality.body).toContain('~/.asci/')
 expect(zh.dataLocality.body).toContain('~/.asci/')
})

test('空右栏仅恢复 Files；历史搜索结果仍可显式打开 Papers', async () => {
 await setAppLanguage('en')
 const { RightPanelTabContent } = await import('@/components/app-shell/RightPanelTabContent')
 const { currentAgentSessionIdAtom } = await import('@/atoms/agent-atoms')
 const { PaperSearchResultRenderer } = await import('./tool-result-renderers/paper-search-result.tsx')
 const store = createStore()
 store.set(currentAgentSessionIdAtom, 'restore')
 store.set(rightPanelTabsBySessionAtom('restore'), { tabs: [], activeId: null })
 render(<Provider store={store}><RightPanelTabContent /></Provider>)
 const buttons = screen.getAllByRole('button')
 expect(buttons).toHaveLength(1)
 fireEvent.click(buttons[0]!)
 expect(store.get(rightPanelTabsBySessionAtom('restore'))).toEqual({ tabs: [...DEFAULT_TABS], activeId: 'session-files' })
 cleanup()
 render(<Provider store={store}><PaperSearchResultRenderer result={JSON.stringify({ display_count: 1, sources: ['arxiv'] })} isError={false} input={{ query: 'saved query' }} /></Provider>)
 fireEvent.click(screen.getByText(/saved query/))
 expect(store.get(rightPanelTabsBySessionAtom('restore')).activeId).toBe('session-papers')
})

test('历史引文的 Library 详情替代路由保留摘要与来源，不再提供证据集或图谱新动作', async () => {
 await setAppLanguage('en')
 const { ItemDetailPanel } = await import('@/components/library/ItemDetailPanel')
 const { librarySelectedItemKeyAtom } = await import('@/atoms/library-atoms')
 const store = createStore()
 store.set(currentAgentWorkspaceIdAtom, 'synthetic-workspace')
 store.set(librarySelectedItemKeyAtom, 'saved-zotero-key')
 const write = mock(async () => { throw new Error('历史打开不得科学写入') })
 const detail = { key: 'saved-zotero-key', title: 'Saved library paper', creators: ['Author'], abstract: 'Saved library abstract', doi: '10.1/saved', tags: [], itemType: 'journalArticle' }
 window.electronAPI = {
  zotero: { library: { getItem: async () => ({ status: 'ok', detail }), getAttachmentPath: async () => ({ found: false }) } },
  notes: { listByPaper: async () => [], createFromPaperHighlight: write, updateBody: write, softDelete: write },
  evidenceSets: { listByPaper: async () => [], addPaper: write, createWithPaper: write },
  citationGraph: { build: write },
 } as unknown as typeof api
 render(<Provider store={store}><TooltipProvider><ItemDetailPanel /></TooltipProvider></Provider>)
 expect(await screen.findByText('Saved library paper')).toBeInTheDocument()
 expect(await screen.findByText('Saved library abstract')).toBeInTheDocument()
 expect(screen.getByRole('button', { name: /DOI/ })).toBeInTheDocument()
 expect(screen.queryAllByRole('button', { name: /Add evidence set|Citation graph|Add to evidence/i })).toHaveLength(0)
 expect(write).toHaveBeenCalledTimes(0)
})

test('账户本地记录说明不承诺模型与工具输入永不上传', async () => {
 const en = (await import('@/locales/en/auth/profile.json')).default
 const zh = (await import('@/locales/zh/auth/profile.json')).default
 expect(en.dataLocality.body).not.toContain('It is not uploaded')
 expect(zh.dataLocality.body).not.toContain('不会上传')
 expect(en.dataLocality.body).toContain('model or tool')
 expect(zh.dataLocality.body).toContain('模型或工具')
})

test('历史容器补证据只引用既有综述/对话，零paper入库；普通笔记保留', async () => {
 await setAppLanguage('en')
 const { AddEvidenceDialog } = await import('@/components/library/evidence-set-detail/AddEvidenceDialog')
 const { EvidenceSetMembers } = await import('@/components/library/evidence-set-detail/EvidenceSetMembers')
 const store = createStore()
 store.set(currentAgentWorkspaceIdAtom, 'synthetic-workspace')
 const paperWrite = mock(async () => ({ created: true }))
 const noteWrite = mock(async () => ({ noteId: 'note' }))
 const reviewWrite = mock(async () => ({ refId: 'ref' }))
 const conversationWrite = mock(async () => ({ created: true }))
 const detail = { set: { id: 'set' }, notes: [], refs: [], memberPapers: [], memberReviews: [], memberConversations: [] } as never
 window.electronAPI = {
  workspacePapers: { list: async () => [{ key: 'p', title: 'Should not import', linkedZoteroKey: 'z' }] },
  zotero: { library: { getAttachmentPath: async () => ({ found: false }) } },
  reviews: { list: async () => [{ id: 'review', title: 'Existing review' }] },
  listAgentSessions: async () => [{ id: 'session', workspaceId: 'synthetic-workspace', title: 'Existing conversation', updatedAt: '2026-01-01' }],
  evidenceSets: { addPaper: paperWrite, addNote: noteWrite, addEvidence: reviewWrite, addConversationMessage: conversationWrite, getDetail: async () => detail, listConversationTurns: async () => [{ messageUuid: 'answer', questionPreview: 'Existing question', answerPreview: 'Existing answer', snapshotText: 'Existing question and answer' }] },
 } as unknown as typeof api
 render(<Provider store={store}><AddEvidenceDialog open onOpenChange={() => {}} setId={'set' as never} workspaceId="synthetic-workspace" addedZoteroKeys={new Set()} addedReviewIds={new Set()} addedConversationKeys={new Set()} onAdded={() => {}} /></Provider>)
 expect(screen.queryAllByRole('button', { name: /^Papers$/i })).toHaveLength(0)
 expect(await screen.findByText('Existing review')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: /^Cite$/i }))
 await waitFor(() => expect(reviewWrite).toHaveBeenCalledTimes(1))
 fireEvent.click(screen.getByRole('button', { name: /conversation/i }))
 fireEvent.click(await screen.findByText('Existing conversation'))
 expect(await screen.findByText('Existing question')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: /^Cite$/i }))
 await waitFor(() => expect(conversationWrite).toHaveBeenCalledTimes(1))
 expect(paperWrite).toHaveBeenCalledTimes(0)
 cleanup()
 render(<Provider store={store}><EvidenceSetMembers detail={detail} onUpdateDetail={() => {}} /></Provider>)
 fireEvent.click(screen.getByRole('button', { name: /Add note/i }))
 fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ordinary note' } })
 fireEvent.click(screen.getByRole('button', { name: /^Save note$/i }))
 await waitFor(() => expect(noteWrite).toHaveBeenCalledTimes(1))
 expect(paperWrite).toHaveBeenCalledTimes(0)
})
