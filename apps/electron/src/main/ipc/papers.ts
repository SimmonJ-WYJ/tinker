/**
 * 论文 / 笔记 / 综述 / 证据集 IPC 处理器
 *
 * 汇集工作区论文库、Notes（划词建注）、Reviews 反查、EvidenceSets 聚合查询与容器操作、
 * Papers 反查（综述引文 → Library 联动）、OutputFeedback（👍/👎 反馈采集）相关的 IPC 通道。
 */

import { ipcMain } from 'electron'
import {
  WORKSPACE_PAPERS_IPC_CHANNELS,
  NOTES_IPC_CHANNELS,
  EVIDENCE_SETS_IPC_CHANNELS,
  OUTPUT_FEEDBACK_IPC_CHANNELS,
  REVIEWS_IPC_CHANNELS,
  PAPERS_IPC_CHANNELS,
} from '@asci/shared'
import type {
  PapersGetByDoiInput,
  PapersGetByIdInput,
  PapersResolveZoteroKeyInput,
  PapersResolveZoteroKeyResult,
  PapersLookupDoiMetadataInput,
  PapersLookupDoiMetadataResult,
  WorkspacePapersFilter,
  WorkspacePaperPatch,
  OutputFeedbackSetInput,
  OutputFeedbackGetForSessionInput,
  EvidenceSetsAddConversationMessageInput,
  EvidenceSetsAddConversationMessageResult,
  EvidenceSetsCreateWithConversationMessageInput,
  EvidenceSetsCreateWithConversationMessageResult,
  EvidenceSetsPreviewConversationInput,
  EvidenceSetsPreviewConversationResult,
  EvidenceSetsListConversationTurnsInput,
  EvidenceSetsListConversationTurnsResult,
  EvidenceSetsGetDetailInput,
  EvidenceSetsGetLatestForSessionInput,
  EvidenceSetsListByPaperInput,
  EvidenceSetsListSummaryInput,
  EvidenceSetsCreateNamedInput,
  EvidenceSetsCreateNamedResult,
  EvidenceSetsRenameInput,
  EvidenceSetsRenameResult,
  EvidenceSetsAddNoteInput,
  EvidenceSetsAddNoteResult,
  EvidenceSetsRemoveNoteInput,
  EvidenceSetsAddEvidenceInput,
  EvidenceSetsAddEvidenceResult,
  EvidenceSetsRemoveEvidenceInput,
  EvidenceSetsSetTagsInput,
  NotesCreateFromPaperHighlightInput,
  NotesCreateFromReviewHighlightInput,
  NotesListAllInput,
  NotesListByPaperInput,
  NotesSoftDeleteInput,
  NotesUpdateBodyInput,
  ReviewsResolveByBodyPathInput,
  ReviewsResolveByBodyPathResult,
  ReviewsListResult,
} from '@asci/shared'
import * as workspacePaperStore from '../lib/workspace-paper-store'
import { emitPapersChanged } from '../lib/workspace-paper-events'
import { getAgentWorkspace } from '../lib/agent-workspace-manager'
import { getPaperByDoi, getPaperById } from '../lib/objects/repositories/paper-repository.ts'
import { resolveZoteroKeyForEvidence } from '../lib/workspace-paper-lookup.ts'
import { lookupDoiMetadata } from '../lib/doi-metadata-lookup.ts'
import { appendOutputFeedback, getSessionFeedbackMap } from '../lib/output-feedback-service'
import { getDb as getObjectsDb } from '../lib/objects/object-store.ts'
import {
  createNoteFromPaperHighlight as notesCreateFromPaperHighlight,
  createNoteFromReviewHighlight as notesCreateFromReviewHighlight,
  listAllNotes as notesListAll,
  listNotesByPaper as notesListByPaper,
  softDeleteNote as notesSoftDelete,
  updateNoteBody as notesUpdateBody,
} from '../lib/notes-service.ts'
import {
  queryEvidenceSetDetail,
  queryEvidenceSetSummaries,
  queryEvidenceSetSummariesByPaper,
  queryLatestReviewSetByAgentSession,
} from '../lib/objects/query-service.ts'
import {
  addEvidenceToContainer,
  addFreeNoteToContainer,
  createNamedEvidenceSet,
  removeEvidenceFromContainer,
  removeNoteFromContainer,
  renameEvidenceSet,
  setContainerTags,
} from '../lib/evidence-set-service.ts'
import {
  addConversationToSet,
  createSetWithConversation,
  previewConversationEvidence,
} from '../lib/evidence-conversation-service.ts'
import { listConversationTurns } from '../lib/objects/conversation-turns-service.ts'
import { getReviewByBodyPath, listReviews } from '../lib/objects/repositories/review-repository.ts'

/** 注册论文 / 笔记 / 综述 / 证据集 IPC 处理器 */
export function registerPapersIpc(): void {
  // 在解析工作区、打开数据库或触发网络前结束已退役的科研写入。
  const unavailable = (): never => { throw new Error('SCIENTIFIC_WORKFLOW_UNAVAILABLE: Existing data remains readable.') }
  for (const channel of [
    WORKSPACE_PAPERS_IPC_CHANNELS.INGEST_RECORDS,
    WORKSPACE_PAPERS_IPC_CHANNELS.LINK_ZOTERO,
    EVIDENCE_SETS_IPC_CHANNELS.ADD_PAPER,
    EVIDENCE_SETS_IPC_CHANNELS.CREATE_WITH_PAPER,
    EVIDENCE_SETS_IPC_CHANNELS.PROMOTE_FROM_REVIEW,
    EVIDENCE_SETS_IPC_CHANNELS.ENSURE_AND_PROMOTE_FROM_REVIEW,
  ]) ipcMain.handle(channel, unavailable)

  // ===== 工作区论文库 =====

  function resolveSlug(workspaceId: string): string {
    const ws = getAgentWorkspace(workspaceId)
    if (!ws) throw new Error(`工作区不存在: ${workspaceId}`)
    return ws.slug
  }

  ipcMain.handle(WORKSPACE_PAPERS_IPC_CHANNELS.LIST, (_e, workspaceId: string, filter: WorkspacePapersFilter) => {
    return workspacePaperStore.list(resolveSlug(workspaceId), filter ?? {})
  })

  ipcMain.handle(WORKSPACE_PAPERS_IPC_CHANNELS.GET, (_e, workspaceId: string, key: string) => {
    return workspacePaperStore.get(resolveSlug(workspaceId), key)
  })

  ipcMain.handle(WORKSPACE_PAPERS_IPC_CHANNELS.UPDATE, (_e, workspaceId: string, key: string, patch: WorkspacePaperPatch) => {
    const slug = resolveSlug(workspaceId)
    const updated = workspacePaperStore.update(slug, key, patch)
    emitPapersChanged(workspaceId, [key], 'update')
    return updated
  })

  ipcMain.handle(WORKSPACE_PAPERS_IPC_CHANNELS.BATCH_UPDATE, (_e, workspaceId: string, keys: string[], patch: WorkspacePaperPatch) => {
    const slug = resolveSlug(workspaceId)
    const touched = workspacePaperStore.batchUpdate(slug, keys, patch)
    emitPapersChanged(workspaceId, touched.map((e) => e.key), 'batchUpdate')
    return touched
  })

  // 用户主动把 session-level PaperRecord 回流到 workspace-papers（加 Zotero / 收藏前的前置）


  // 占位（T9/T15/T16 实现）

  ipcMain.handle(WORKSPACE_PAPERS_IPC_CHANNELS.DOWNLOAD_PDF, async () => {
    throw new Error('downloadPdf 未实现 - 见 T15')
  })
  ipcMain.handle(WORKSPACE_PAPERS_IPC_CHANNELS.CREATE_NOTE, async () => {
    throw new Error('createNote 未实现 - 见 T16')
  })

  // ===== Notes (v0.2 证据列表重构后) =====
  // renderer 划词建注 → 主进程单事务 4 步：
  //   note → evidence_set (1:1) → evidence_ref (source=paper, target=set) → evidence_set_refs。
  // renderer 端只持有 Zotero item key，由 notes-service 内部 lazy-upsert Paper 行。
  ipcMain.handle(
    NOTES_IPC_CHANNELS.CREATE_FROM_PAPER_HIGHLIGHT,
    (_e, input: NotesCreateFromPaperHighlightInput) => {
      return notesCreateFromPaperHighlight(getObjectsDb(), input)
    },
  )
  // 综述里 Evidence trace "+ Add note here" 入口 —— 与 paper 链路对偶
  ipcMain.handle(
    NOTES_IPC_CHANNELS.CREATE_FROM_REVIEW_HIGHLIGHT,
    (_e, input: NotesCreateFromReviewHighlightInput) => {
      return notesCreateFromReviewHighlight(getObjectsDb(), input)
    },
  )
  ipcMain.handle(NOTES_IPC_CHANNELS.LIST_BY_PAPER, (_e, input: NotesListByPaperInput) => {
    return notesListByPaper(getObjectsDb(), input)
  })
  ipcMain.handle(NOTES_IPC_CHANNELS.LIST_ALL, (_e, input: NotesListAllInput) => {
    return notesListAll(getObjectsDb(), input.workspaceId)
  })
  ipcMain.handle(NOTES_IPC_CHANNELS.UPDATE_BODY, (_e, input: NotesUpdateBodyInput) => {
    return notesUpdateBody(getObjectsDb(), input)
  })
  ipcMain.handle(NOTES_IPC_CHANNELS.SOFT_DELETE, (_e, input: NotesSoftDeleteInput) => {
    notesSoftDelete(getObjectsDb(), input)
  })

  // ===== Reviews 辅助反查 =====
  // 综述 HTML 预览组件按文件路径加载，要启用 Add note here 入口需要先拿到 reviewId。
  ipcMain.handle(
    REVIEWS_IPC_CHANNELS.RESOLVE_BY_BODY_PATH,
    (_e, input: ReviewsResolveByBodyPathInput): ReviewsResolveByBodyPathResult => {
      const review = getReviewByBodyPath(getObjectsDb(), input.bodyPath)
      return review ? { id: review.id } : null
    },
  )
  // 列出所有非 deleted 综述（id+title）—— 证据集「补证据 · 综述」选择器候选（#709）
  ipcMain.handle(REVIEWS_IPC_CHANNELS.LIST, (): ReviewsListResult => {
    return listReviews(getObjectsDb()).map((r) => ({ id: r.id, title: r.title }))
  })

  // ===== EvidenceSets 聚合查询 =====
  // 详情页一次拿全 set + 绑定 note + 所有 ref + 派生 memberPapers，避免 4 次 IPC 拼装。
  // 见 docs/superpowers/specs/2026-05-24-evidence-set-aggregate-query-design.md
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.GET_DETAIL,
    (_e, input: EvidenceSetsGetDetailInput) => {
      return queryEvidenceSetDetail(getObjectsDb(), input.id, {
        includeDeleted: input.includeDeleted,
      })
    },
  )
  // 列表摘要：dialog 下拉 / 列表页用
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.LIST_SUMMARY,
    (_e, input: EvidenceSetsListSummaryInput) => {
      return queryEvidenceSetSummaries(getObjectsDb(), {
        persistedOnly: input.persistedOnly,
        workspaceId: input.workspaceId,
      })
    },
  )
  // 把 paper 加入既有 set（幂等）

  // 新建 set + 同时挂 paper（自动建占位 note）

  // 反查包含此 paper 的 evidence set 列表（Library 详情面板 CITED BY 区数据源）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.LIST_BY_PAPER,
    (_e, input: EvidenceSetsListByPaperInput) => {
      return queryEvidenceSetSummariesByPaper(getObjectsDb(), input.zoteroKey, input.workspaceId)
    },
  )
  // B5: 拿当前 agent session 最近 review 的 EvidenceSet 状态（BookmarkPlus popover 用）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.GET_LATEST_FOR_SESSION,
    (_e, input: EvidenceSetsGetLatestForSessionInput) => {
      return queryLatestReviewSetByAgentSession(getObjectsDb(), input.agentSessionId)
    },
  )
  // B5: 把综述自动建出的临时 set 提升为正式（persisted=1 + name + saved_at）

  // B5 follow-up: 重命名已保存的证据集（popover 已保存态的 Rename 按钮）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.RENAME,
    (_e, input: EvidenceSetsRenameInput): EvidenceSetsRenameResult => {
      const { set } = renameEvidenceSet(getObjectsDb(), input)
      return { setId: set.id, name: set.name ?? '' }
    },
  )
  // B5 follow-up: 兜底独立建命名 set —— review 无临时 set 时让用户始终能"新建证据集"
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.CREATE_NAMED,
    (_e, input: EvidenceSetsCreateNamedInput): EvidenceSetsCreateNamedResult => {
      const { set } = createNamedEvidenceSet(getObjectsDb(), input)
      return { setId: set.id, name: set.name ?? '' }
    },
  )
  // B5 follow-up: 综述兜底入口 —— review 没挂 set 时先解析再 promote；已挂则直接 promote/rename

  // v0.2.x: 会话 Q&A 存为证据条目（添加到既有集合）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.ADD_CONVERSATION_MESSAGE,
    (
      _e,
      input: EvidenceSetsAddConversationMessageInput,
    ): EvidenceSetsAddConversationMessageResult => {
      return addConversationToSet(getObjectsDb(), input)
    },
  )
  // v0.2.x: 新建命名集合 + 同时挂当前 Q&A
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.CREATE_WITH_CONVERSATION_MESSAGE,
    (
      _e,
      input: EvidenceSetsCreateWithConversationMessageInput,
    ): EvidenceSetsCreateWithConversationMessageResult => {
      return createSetWithConversation(getObjectsDb(), input)
    },
  )
  // v0.2.x: 只读预览本条问答的论文证据候选数（popover 判空，不落库）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.PREVIEW_CONVERSATION,
    (
      _e,
      input: EvidenceSetsPreviewConversationInput,
    ): EvidenceSetsPreviewConversationResult => {
      return previewConversationEvidence(getObjectsDb(), input)
    },
  )
  // #709「补证据 · 历史对话」picker：列某会话内可加入的 Q&A 回合候选（只读，不落库）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.LIST_CONVERSATION_TURNS,
    (
      _e,
      input: EvidenceSetsListConversationTurnsInput,
    ): EvidenceSetsListConversationTurnsResult => {
      return listConversationTurns(input.sessionId)
    },
  )
  // #709 主题容器：详情页内联补笔记（自由笔记）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.ADD_NOTE,
    (_e, input: EvidenceSetsAddNoteInput): EvidenceSetsAddNoteResult => {
      const note = addFreeNoteToContainer(getObjectsDb(), input.setId, input.body)
      return { noteId: note.id }
    },
  )
  // #709 主题容器：从容器移除一条笔记（软删 note + 删 join）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.REMOVE_NOTE,
    (_e, input: EvidenceSetsRemoveNoteInput): void => {
      removeNoteFromContainer(getObjectsDb(), input.setId, input.noteId)
    },
  )
  // #709 主题容器：补证据（对象级引用库对象进容器）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.ADD_EVIDENCE,
    (_e, input: EvidenceSetsAddEvidenceInput): EvidenceSetsAddEvidenceResult => {
      const ref = addEvidenceToContainer(getObjectsDb(), input.setId, {
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        snapshotText: input.snapshotText,
      })
      return { refId: ref.id }
    },
  )
  // #709 主题容器：从容器移除一条证据（删 join；孤儿 ref 软删，来源对象留库）
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.REMOVE_EVIDENCE,
    (_e, input: EvidenceSetsRemoveEvidenceInput): void => {
      removeEvidenceFromContainer(getObjectsDb(), input.setId, input.refId)
    },
  )
  // #709 主题容器：整体替换容器标签
  ipcMain.handle(
    EVIDENCE_SETS_IPC_CHANNELS.SET_TAGS,
    (_e, input: EvidenceSetsSetTagsInput): void => {
      setContainerTags(getObjectsDb(), input.setId, input.tags)
    },
  )

  // ===== OutputFeedback：助手输出 👍/👎 直观反馈采集（issue #477） =====
  // 追加写 ~/.asci/feedback/<sessionId>.jsonl，回显按 messageUuid 折叠取最后一条。
  ipcMain.handle(OUTPUT_FEEDBACK_IPC_CHANNELS.SET, (_e, input: OutputFeedbackSetInput) => {
    return appendOutputFeedback(input)
  })
  ipcMain.handle(
    OUTPUT_FEEDBACK_IPC_CHANNELS.GET_FOR_SESSION,
    (_e, input: OutputFeedbackGetForSessionInput) => {
      return getSessionFeedbackMap(input.sessionId)
    },
  )

  // ===== Papers 反查（综述引文 → Library 联动） =====
  // renderer 综述视图点击 <cite> 后，若 §7 <li> 只有 data-doi/data-paper-id 而无
  // data-zotero-key，则通过本通道反查 Paper.zoteroKey 用于 librarySelectedItemKeyAtom。
  ipcMain.handle(PAPERS_IPC_CHANNELS.GET_BY_DOI, (_e, input: PapersGetByDoiInput) => {
    return getPaperByDoi(getObjectsDb(), input.doi)
  })
  ipcMain.handle(PAPERS_IPC_CHANNELS.GET_BY_ID, (_e, input: PapersGetByIdInput) => {
    return getPaperById(getObjectsDb(), input.id)
  })
  ipcMain.handle(
    PAPERS_IPC_CHANNELS.RESOLVE_ZOTERO_KEY,
    (_e, input: PapersResolveZoteroKeyInput): PapersResolveZoteroKeyResult => {
      return resolveZoteroKeyForEvidence(input)
    },
  )
  // DOI 点击未命中本次检索 → crossref 即时查询（不写入 session papers，不过 Agent）
  ipcMain.handle(
    PAPERS_IPC_CHANNELS.LOOKUP_DOI_METADATA,
    (_e, input: PapersLookupDoiMetadataInput): Promise<PapersLookupDoiMetadataResult> => {
      return lookupDoiMetadata(input.doi)
    },
  )
}
