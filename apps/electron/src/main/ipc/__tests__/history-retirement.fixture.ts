/** 独立进程替身记录真实 registrar 的委托，避免 mock 污染其他用例。 */
import { mock } from 'bun:test'
import { strict as assert } from 'node:assert'
import { WORKSPACE_PAPERS_IPC_CHANNELS as W, EVIDENCE_SETS_IPC_CHANNELS as E, NOTES_IPC_CHANNELS as N, OUTPUT_FEEDBACK_IPC_CHANNELS as F, PAPERS_IPC_CHANNELS as P, CITATION_GRAPH_IPC_CHANNELS as G } from '@asci/shared'
const handlers = new Map<string, (...args: unknown[]) => unknown>()
const calls: string[] = []
const side = (name: string) => (..._args: unknown[]) => { calls.push(name); return { id: 'saved', records: ['saved'] } }
mock.module('electron', () => ({ ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) } }))
mock.module('../../lib/workspace-paper-store', () => ({ list: side('list'), get: side('get'), update: side('update'), batchUpdate: side('batchUpdate'), appendOrMerge: side('ingest') }))
mock.module('../../lib/workspace-paper-events', () => ({ emitPapersChanged: side('changed') }))
mock.module('../../lib/workspace-paper-actions', () => ({ performLinkZotero: side('link') }))
mock.module('../../lib/agent-workspace-manager', () => ({ getAgentWorkspace: () => { calls.push('workspace'); return { slug: 'synthetic' } } }))
mock.module('../../lib/objects/repositories/paper-repository.ts', () => ({ getPaperByDoi: side('paper-read'), getPaperById: side('paper-read') }))
mock.module('../../lib/workspace-paper-lookup.ts', () => ({ resolveZoteroKeyForEvidence: side('resolve') }))
mock.module('../../lib/doi-metadata-lookup.ts', () => ({ lookupDoiMetadata: side('lookup') }))
mock.module('../../lib/output-feedback-service', () => ({ appendOutputFeedback: side('feedback'), getSessionFeedbackMap: side('feedback-read') }))
mock.module('../../lib/objects/object-store.ts', () => ({ getDb: () => { calls.push('db'); return {} } }))
mock.module('../../lib/notes-service.ts', () => Object.fromEntries(['addPaperToEvidenceSet','createEvidenceSetWithPaper','createNoteFromPaperHighlight','createNoteFromReviewHighlight','listAllNotes','listNotesByPaper','softDeleteNote','updateNoteBody'].map(name => [name, side(name)])))
mock.module('../../lib/objects/query-service.ts', () => Object.fromEntries(['queryEvidenceSetDetail','queryEvidenceSetSummaries','queryEvidenceSetSummariesByPaper','queryLatestReviewSetByAgentSession'].map(name => [name, side(name)])))
mock.module('../../lib/evidence-set-service.ts', () => Object.fromEntries(['addEvidenceToContainer','addFreeNoteToContainer','createNamedEvidenceSet','ensureAndPromoteReviewEvidenceSet','promoteReviewEvidenceSet','removeEvidenceFromContainer','removeNoteFromContainer','renameEvidenceSet','setContainerTags'].map(name => [name, side(name)])))
mock.module('../../lib/evidence-conversation-service.ts', () => ({ addConversationToSet: side('addConversation'), createSetWithConversation: side('createConversation'), previewConversationEvidence: side('previewConversation') }))
mock.module('../../lib/objects/conversation-turns-service.ts', () => ({ listConversationTurns: side('conversation-read') }))
mock.module('../../lib/objects/repositories/review-repository.ts', () => ({ getReviewByBodyPath: side('review-read'), listReviews: () => [] }))
mock.module('../../lib/citation-graph', () => ({ buildGraph: async () => { calls.push('graph-build') } }))
mock.module('../../lib/citation-graph/cache', () => ({ clearAllCache: side('clear'), clearCacheByKey: side('clear'), computeCacheKey: side('key') }))
mock.module('../../lib/zotero-write', () => ({ createItem: side('zotero-write') }))
const { registerPapersIpc } = await import('../papers.ts')
const { registerCitationGraphIpc } = await import('../citation-graph.ts')
registerPapersIpc(); registerCitationGraphIpc()
for (const channel of [W.INGEST_RECORDS, W.LINK_ZOTERO, E.ADD_PAPER, E.CREATE_WITH_PAPER, E.PROMOTE_FROM_REVIEW, E.ENSURE_AND_PROMOTE_FROM_REVIEW]) {
 assert.throws(() => handlers.get(channel)!(null, {}), /SCIENTIFIC_WORKFLOW_UNAVAILABLE/)
 assert.deepEqual(calls, [])
}
assert.deepEqual(await handlers.get(G.BUILD)!(null, { requestId: 'saved' }), { requestId: 'saved', accepted: false, message: 'SCIENTIFIC_WORKFLOW_UNAVAILABLE' })
await assert.rejects(async () => handlers.get(G.ADD_TO_ZOTERO)!(null, {}), /SCIENTIFIC_WORKFLOW_UNAVAILABLE/)
assert.deepEqual(calls, [])
handlers.get(W.LIST)!(null, 'workspace', {})
handlers.get(N.UPDATE_BODY)!(null, { id: 'note', body: 'saved' })
handlers.get(F.SET)!(null, {})
handlers.get(P.GET_BY_ID)!(null, { id: 'paper' })
assert.deepEqual(calls, ['workspace', 'list', 'db', 'updateNoteBody', 'feedback', 'db', 'paper-read'])
console.log('history retirement IPC passed')
