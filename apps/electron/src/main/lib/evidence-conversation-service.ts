/**
 * Conversation 源证据条目服务层
 *
 * 把 Agent session 内某次 Q&A 作为 conversation 类型 EvidenceRef 挂入证据集。
 * 与 notes-service 里 paper 路径的 addPaperToEvidenceSet / createEvidenceSetWithPaper
 * 同构（lazy upsert / 幂等 / 单事务），但来源端是 agent session 而非 paper：
 *   - source.kind = 'conversation'
 *   - source.id   = sessionId（agent-sessions.json 索引 id；非 ObjectId，无 FK）
 *   - source.anchor.locationData = ConversationLocation { sessionId, messageUuid, ... }
 *   - source.anchor.snapshotText = `Q: ...\n\nA: ...`（renderer 拼接好后传入）
 *
 * 触发入口：SDKMessageRenderer.tsx 的 AddToEvidenceSetButton popover
 *   - 点击列表中已有集合 → addConversationToSet
 *   - 「+ New evidence set」提交 → createSetWithConversation
 *
 * 幂等键：(setId, sessionId, messageUuid)。已存在同三元组的未删除 ref → 复用既有 ref。
 *
 * 不在事务内：调用方（IPC handler）已用 RepoDb 事务包裹本服务调用。
 *
 * 论文证据副产物：Q&A 入集合的同时，扫这条回答上游的工具调用（workspace_papers_get
 * / pdf_parse_batch），把引用到的论文一并落成 source.kind='paper' 的 EvidenceRef。
 * 见 attachPaperRefsForMessage。
 *
 * 综述证据副产物：若该 session 有关联 Review（按 agentSessionId 反查），综述 skill
 * 的引用全在它 Write 出的 HTML 里（papers-rg 工具不在上面的扫描白名单里），用
 * extractReviewCitations 从综述 HTML 的 §7 References / 正文 <cite> 抽出被引论文，
 * 同样落成 source.kind='paper' 的 EvidenceRef。见 attachReviewPaperRefsForSession。
 */

import type {
  EvidenceRef,
  EvidenceSetsAddConversationMessageInput,
  EvidenceSetsAddConversationMessageResult,
  EvidenceSetsCreateWithConversationMessageInput,
  EvidenceSetsCreateWithConversationMessageResult,
  ObjectId,
} from '@asci/shared'
import { sanitizeText } from '@asci/shared'

import { buildConversationAnchor, buildMdAnchor } from './objects/anchor-codec.ts'
import { nowIso } from './objects/internal/common.ts'
import {
  appendEvidenceRefToSet,
  createEvidenceSet,
} from './objects/repositories/evidence-set-repository.ts'
import {
  createEvidenceRef,
  listEvidenceRefsByTarget,
} from './objects/repositories/evidence-ref-repository.ts'
import { createNote as repoCreateNote } from './objects/repositories/note-repository.ts'
import { getAgentSessionMeta } from './agent-session-manager.ts'
import { createPaper, getPaperById, findPaperByZoteroKey } from './objects/repositories/paper-repository.ts'
import { getReviewByAgentSessionId } from './objects/repositories/review-repository.ts'
import { resolvePaperRef, type PaperRef } from './objects/evidence-attachment-service.ts'
import {
  extractAnswerPaperCitations,
  extractConversationPaperRefs,
  type PaperCandidateMeta,
  type PaperRefCandidate,
} from './objects/evidence-conversation-citations-extractor.ts'
import { extractReviewCitations } from './objects/review-citation-extractor.ts'
import { readReviewBody } from './objects/review-body-service.ts'
import { loadSnapshot } from './zotero-pdf-parser/snapshot-store.ts'
import type { RepoDb } from './objects/internal/repo-db.ts'

function validatePayload(input: {
  sessionId: string
  messageUuid: string
  snapshotText: string
}): { sessionId: string; messageUuid: string; snapshotText: string } {
  const sessionId = input.sessionId.trim()
  const messageUuid = input.messageUuid.trim()
  const snapshotText = input.snapshotText.trim()
  if (!sessionId) {
    throw new Error(`[evidence-conversation] sessionId 不能为空`)
  }
  if (!messageUuid) {
    throw new Error(`[evidence-conversation] messageUuid 不能为空`)
  }
  if (!snapshotText) {
    throw new Error(`[evidence-conversation] snapshotText 不能为空`)
  }
  return { sessionId, messageUuid, snapshotText }
}

/**
 * 把这条回答引用到的论文一并落成 source.kind='paper' 的 EvidenceRef（target=set）。
 *
 * 候选两路合并（按 doi/title 去重）：
 *   A. extractAnswerPaperCitations —— 扫回答正文里的精确标识（主，覆盖上下文注入场景）
 *   B. extractConversationPaperRefs —— 扫工具调用结果（次，覆盖 Agent 实际调工具场景）
 *
 * 每个候选 resolve-or-create 出 paperId：先反查 DB（doi/zoteroKey），不命中且候选带
 * 元数据则 createPaper 兜底建库；既反查不到又无元数据 → warn 跳过。
 *
 * 幂等键：(setId, paperId)。同一篇论文在一个集合里只留一条 paper ref。
 * 必须在调用方的事务内执行（与 conversation ref 同事务）。
 */
function attachPaperRefsForMessage(
  db: RepoDb,
  args: { setId: ObjectId; sessionId: string; messageUuid: string },
): EvidenceRef[] {
  const candidates = mergeCandidates(
    extractAnswerPaperCitations(args.sessionId, args.messageUuid),
    extractConversationPaperRefs(args.sessionId, args.messageUuid),
  )
  // allowMultiPerPaper：papers-rg 同一篇多段精读各成一条证据（按 (paperId, snapshotText) 去重）。
  // 其它工具 snapshot 多为稳定摘要/标题，同篇仍折叠，行为基本不变。
  return attachPaperCandidatesToSet(db, args.setId, candidates, { allowMultiPerPaper: true })
}

/**
 * 只读预览：统计本条问答**能抽出多少篇论文证据候选**（去重后），不落库、无副作用。
 *
 * 与 add 路径同口径：answer 正文标识 + 工具调用扫描（+ includeReviewCitations 时综述被引），
 * 但只数 candidateDedupKey 非空的候选（无任何标识/元数据的候选在 resolve 阶段本就会被跳过）。
 *
 * 用途：「加入证据集」popover 打开时判空——返回 0 表示这条对话没有可加入的相关证据，
 * UI 展示「无相关证据」提示并禁用添加，避免存出不含任何被引论文的空证据集。
 */
export function previewConversationEvidence(
  db: RepoDb,
  args: { sessionId: string; messageUuid: string; includeReviewCitations?: boolean },
): { paperCandidateCount: number } {
  const sessionId = args.sessionId.trim()
  const messageUuid = args.messageUuid.trim()
  if (!sessionId || !messageUuid) return { paperCandidateCount: 0 }

  const keys = new Set<string>()
  const countCandidates = (candidates: PaperRefCandidate[]): void => {
    for (const c of candidates) {
      const k = candidateDedupKey(c)
      if (k) keys.add(k) // 无 key 的候选 resolve 阶段会被跳过，不计入
    }
  }

  countCandidates(
    mergeCandidates(
      extractAnswerPaperCitations(sessionId, messageUuid),
      extractConversationPaperRefs(sessionId, messageUuid),
    ),
  )

  if (args.includeReviewCitations) {
    const review = getReviewByAgentSessionId(db, sessionId)
    const html = review ? readReviewBody(review) : null
    if (html) {
      const extracted = extractReviewCitations(html)
      countCandidates(reviewCitesToCandidates(extracted.references, extracted.items))
    }
  }

  return { paperCandidateCount: keys.size }
}

/**
 * 把一批论文候选 resolve-or-create 出 paperId 后，落成 source.kind='paper'、
 * target=set 的 EvidenceRef 并挂入集合。
 *
 * **幂等策略两挡**（v0.2.x 引入 allowMultiPerPaper）：
 *
 *   - `allowMultiPerPaper: false`（默认 / 消息扫描路径）：按 (setId, paperId) 幂等，
 *     同一篇论文在集合里只留一条 ref —— 既包括集合里已有的，也包括本批内重复的。
 *     用于扫回答正文 / 工具调用的兜底场景，那里同 paper 多次出现 snapshot 也都一样
 *     （都是 abstract / title），没有"按 cite 位置区分"的语义。
 *
 *   - `allowMultiPerPaper: true`（综述 HTML 路径）：按 (setId, paperId, snapshotText)
 *     三元组幂等，同一篇 paper 被 cite 多次、每次 `<q>` 不同 → 各落一条独立 ref。
 *     仅"既已存在 paperId & snapshotText 相同" 才视为重复。**前提**：调用方需保证此
 *     路径**先于** 默认路径触发（review-first），否则消息扫描路径已用 paperId 占位，
 *     review 路径所有候选会被默认 paperId 幂等扫掉。详见 createSetWithConversation /
 *     addConversationToSet 里 attachReviewPaperRefsForSession 先于 attachPaperRefsForMessage。
 *
 * 必须在调用方的事务内执行。
 *
 * 被 attachPaperRefsForMessage（消息扫描）与 attachReviewPaperRefsForSession
 * （综述 HTML 抽取）共享。
 */
function attachPaperCandidatesToSet(
  db: RepoDb,
  setId: ObjectId,
  candidates: PaperRefCandidate[],
  options?: { allowMultiPerPaper?: boolean },
): EvidenceRef[] {
  if (candidates.length === 0) return []
  const allowMulti = options?.allowMultiPerPaper === true

  // 既有 ref 的 paperId 集合 / (paperId, snapshotText) 集合：默认按 paperId 拦截，
  // allowMulti 模式按二元组拦截（同 paper 不同 snapshot 不视为重复）
  const existingPaperIds = new Set<string>()
  const existingPairs = new Set<string>()
  for (const r of listEvidenceRefsByTarget(db, 'evidence-set', setId)) {
    if (r.source.kind !== 'paper') continue
    existingPaperIds.add(r.source.id)
    existingPairs.add(`${r.source.id}|${r.source.anchor.snapshotText}`)
  }

  const created: EvidenceRef[] = []
  for (const candidate of candidates) {
    const paperId = resolveOrCreatePaperFromCandidate(db, candidate)
    if (paperId == null) continue

    // snapshotText 兜底：候选无摘要时用论文标题
    let snapshotText = candidate.snapshotText.trim()
    if (!snapshotText) {
      snapshotText = (getPaperById(db, paperId)?.title ?? '').trim()
    }
    if (!snapshotText) {
      console.warn(`[evidence-conversation] paper ${paperId} 无可用 snapshotText，跳过`)
      continue
    }

    // 幂等判定
    if (allowMulti) {
      const pairKey = `${paperId}|${snapshotText}`
      if (existingPairs.has(pairKey)) continue
      existingPairs.add(pairKey)
      existingPaperIds.add(paperId) // 仍累计，让后续默认模式跑时能拦截
    } else {
      if (existingPaperIds.has(paperId)) continue
      existingPaperIds.add(paperId)
      existingPairs.add(`${paperId}|${snapshotText}`)
    }

    const ref = createEvidenceRef(db, {
      source: {
        kind: 'paper',
        id: paperId,
        anchor: buildMdAnchor({ snapshotText }),
      },
      target: {
        kind: 'evidence-set',
        id: setId,
      },
    })
    appendEvidenceRefToSet(db, setId, ref.id)
    created.push(ref)
  }
  return created
}

/**
 * 综述证据副产物：若 session 有关联 Review，从综述 HTML 抽出被引论文落成 paper ref。
 *
 * 综述 skill 用 papers-rg 工具（papers_read_article_section 等，不在 message 扫描
 * 白名单里）检索论文，真正的引用全在它 Write 出的综述 HTML 的 §7 References /
 * 正文 <cite data-ref> 里 —— 因此 attachPaperRefsForMessage 对综述会话扒不到论文。
 * 这里用与综述落库同一套 extractReviewCitations 把被引论文还原成候选，复用
 * attachPaperCandidatesToSet 落库。
 *
 * v0.2.x 升级：**按 `<cite>` 一条 candidate**（不再按 §7 reference 折），传入
 * `allowMultiPerPaper: true` 让同 paper 多次 cite（不同 `<q>` 短引）各落一条独立 ref。
 * 调用顺序要求：本函数**必须先于** attachPaperRefsForMessage 触发，否则消息扫描路径
 * 会用 (setId, paperId) 单值幂等占位，本路径所有候选会被默认模式扫掉（review-first
 * 语义见 createSetWithConversation / addConversationToSet）。
 *
 * 触发条件：getReviewByAgentSessionId 命中。无关联 Review / 读不到 HTML → no-op。
 * 必须在调用方的事务内执行。
 */
function attachReviewPaperRefsForSession(
  db: RepoDb,
  args: { setId: ObjectId; sessionId: string },
): EvidenceRef[] {
  const review = getReviewByAgentSessionId(db, args.sessionId)
  if (!review) return []
  const html = readReviewBody(review)
  if (!html) return []

  const extracted = extractReviewCitations(html)
  const candidates = reviewCitesToCandidates(extracted.references, extracted.items)
  return attachPaperCandidatesToSet(db, args.setId, candidates, { allowMultiPerPaper: true })
}

/**
 * 把综述正文 `<cite>` 数组折成"每个 cite 一个候选"——同 paper 多 cite 不去重，
 * snapshotText = 该 cite 的 `<q>` 短引。
 *
 *   - 入参 items：extractReviewCitations 已逐 `<cite>` 产出的 EvidenceItemInput[]
 *     （只含 §7 能反查出 paper 的 cite —— refsMissingPaper / citesUnresolved 已过滤）
 *   - 入参 references：§7 References 表，供 meta 兜底建库（title/authors/year/doi）
 *
 * 内部按 (paperKey, snapshotText) 二元组去重：同 paper 同 quote（同段多 cite 同句 /
 * 跨段同句）合并；同 paper 不同 quote 各保留。
 *
 * 命名：原 `reviewReferencesToCandidates` 改名为 `reviewCitesToCandidates` 以反映新
 * 颗粒度（per-cite 而非 per-reference）。
 */
function reviewCitesToCandidates(
  references: ReturnType<typeof extractReviewCitations>['references'],
  items: ReturnType<typeof extractReviewCitations>['items'],
): PaperRefCandidate[] {
  // 按 paperKey 索引 §7 metadata，供 candidate.meta 兜底建库
  const metaByPaper = new Map<string, PaperCandidateMeta>()
  for (const ref of references) {
    if (!ref.paper) continue
    const key = paperRefKey(ref.paper)
    if (!key || metaByPaper.has(key)) continue
    const md = ref.metadata
    if (!md.title) continue
    const meta: PaperCandidateMeta = {
      title: md.title,
      ...(md.authors ? { authors: md.authors } : {}),
      ...(md.year !== undefined ? { year: md.year } : {}),
      ...(md.doi !== undefined ? { doi: md.doi } : {}),
    }
    metaByPaper.set(key, meta)
  }

  const candidates: PaperRefCandidate[] = []
  const seen = new Set<string>() // (paperKey, snapshotText)
  for (const item of items) {
    const paperKey = paperRefKey(item.paper)
    if (!paperKey) continue // 无标识符 → 无法幂等反查，跳过
    const quote = item.source.snapshotText.trim()
    if (!quote) continue // cite 无 <q> 内文 → 跳过（理论上不会，extractor 已要求 <q>）
    const dedupKey = `${paperKey}|${quote}`
    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    const meta = metaByPaper.get(paperKey)
    candidates.push({
      paper: item.paper,
      snapshotText: quote,
      toolName: 'review-citation',
      ...(meta ? { meta } : {}),
    })
  }
  return candidates
}

/** PaperRef 去重 key（id / doi / zoteroKey 三选一） */
function paperRefKey(ref: PaperRef): string | null {
  if ('id' in ref) return `id:${ref.id}`
  if ('doi' in ref) return `doi:${ref.doi.toLowerCase()}`
  if ('zoteroKey' in ref) return `zk:${ref.zoteroKey}`
  return null
}

/**
 * 候选去重 key：doi 优先，其次 zoteroKey/id/attachmentKey，最后 meta.title。
 * 带 passageKey（papers-rg 片段）时在 base 后拼 `#${passageKey}`，使同篇不同片段不被
 * merge 阶段折叠（落库再按 (paperId, snapshotText) 二元组幂等）。
 */
function candidateDedupKey(c: PaperRefCandidate): string | null {
  let base: string | null = null
  if (c.paper && 'doi' in c.paper) base = `doi:${c.paper.doi.toLowerCase()}`
  else if (c.meta?.doi) base = `doi:${c.meta.doi.toLowerCase()}`
  else if (c.paper && 'zoteroKey' in c.paper) base = `zk:${c.paper.zoteroKey}`
  else if (c.paper && 'id' in c.paper) base = `id:${c.paper.id}`
  else if (c.pdfAttachmentKey) base = `att:${c.pdfAttachmentKey}`
  else if (c.meta?.title) base = `t:${c.meta.title.toLowerCase()}`
  if (base == null) return null
  return c.passageKey ? `${base}#${c.passageKey}` : base
}

/** 合并两路候选：正文路优先（带元数据更全），按 dedupKey 去重；无 key 的全保留 */
function mergeCandidates(
  primary: PaperRefCandidate[],
  secondary: PaperRefCandidate[],
): PaperRefCandidate[] {
  const out: PaperRefCandidate[] = []
  const seen = new Set<string>()
  for (const c of [...primary, ...secondary]) {
    const key = candidateDedupKey(c)
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(c)
  }
  return out
}

/**
 * 把候选解析成 paperId：
 *   1. Read-PDF 候选（pdfAttachmentKey）：经 zotero-pdf-snapshot 确定性反查父条目
 *      DOI / itemKey → 命中 DB 即用；并用 snapshot 的 parent metadata 充实 meta。
 *   2. 普通候选：resolvePaperRef（doi/zoteroKey）反查 DB。
 *   3. 都不命中且有元数据（meta）→ createPaper 兜底建库（保证"读过/引用过"必出条目）。
 *   4. 既反查不到又无 meta → warn 跳过。
 */
function resolveOrCreatePaperFromCandidate(
  db: RepoDb,
  candidate: PaperRefCandidate,
): ObjectId | null {
  // 1) Read-PDF：snapshot 反查附件 → 父条目，顺带充实 meta
  let paper = candidate.paper
  let meta = candidate.meta
  if (candidate.pdfAttachmentKey) {
    const enriched = resolveZoteroAttachment(candidate.pdfAttachmentKey)
    if (enriched) {
      paper = paper ?? enriched.paper
      meta = enriched.meta ?? meta
      // snapshot DOI 比文件名 meta 更可靠
      if (enriched.meta?.doi && meta && !meta.doi) meta = { ...meta, doi: enriched.meta.doi }
    }
  }

  // 2) 反查 DB
  if (paper) {
    const found = resolvePaperRef(db, paper)
    if (found != null) return found
    // {id} 反查不到时，该 id 极可能是被误填进综述 §7 `data-paper-id` 的 zoteroKey（历史/错配数据）。
    // 退一步按 zoteroKey 反查命中既有论文，避免落到 createPaper 兜底而裂成重复行。
    if ('id' in paper) {
      const byKey = findPaperByZoteroKey(db, paper.id)
      if (byKey) return byKey.id
    }
  }

  // 2.5) zotero_read_attachment 的 zoteroKey 反查不到 → 按 parentItemKey 扫 snapshot 充实 meta
  if (!meta && paper && 'zoteroKey' in paper) {
    const enriched = resolveZoteroByItemKey(paper.zoteroKey)
    if (enriched) {
      if (enriched.paper) {
        // snapshot 给了更可反查的 doi/parentKey → 再试一次 DB 反查
        const found = resolvePaperRef(db, enriched.paper)
        if (found != null) return found
      }
      meta = enriched.meta ?? meta
    }
  }

  // 3) 兜底建库 —— 必须携带候选身份（zoteroKey/doi），否则同一篇论文的每条 cite 各建一行新
  //    paper，证据集详情里同篇展开成 N 行、且无 Zotero 关联（"No PDF attached"）。带上身份后，
  //    同篇后续 cite 能在本事务内经 resolvePaperRef(doi/zoteroKey) 反查命中、折叠为一个 paper group。
  if (meta && meta.title) {
    // zoteroKey：候选自带 → 用之；{id} 形态多为误填的 zoteroKey（见步骤 2 兜底）→ 也作 zoteroKey 落库去重
    const identityZoteroKey =
      paper && 'zoteroKey' in paper ? paper.zoteroKey
      : paper && 'id' in paper ? paper.id
      : undefined
    const identityDoi = (paper && 'doi' in paper ? paper.doi : undefined) ?? meta.doi
    const created = createPaper(db, {
      title: meta.title,
      authors: meta.authors ?? [],
      ...(meta.year !== undefined ? { year: meta.year } : {}),
      ...(meta.abstract !== undefined ? { abstract: meta.abstract } : {}),
      ...(identityDoi !== undefined ? { doi: identityDoi } : {}),
      ...(identityZoteroKey !== undefined ? { zoteroKey: identityZoteroKey } : {}),
    })
    return created.id
  }

  console.warn(
    `[evidence-conversation] paper 反查失败且无兜底元数据，跳过：${JSON.stringify(
      candidate.paper ?? candidate.pdfAttachmentKey ?? null,
    )}`,
  )
  return null
}

/** Zotero abstractNote 含 JATS / HTML 标签：清洗后非空才写入 meta（入 paper DB 前统一去脏）。 */
function setCleanAbstract(meta: PaperCandidateMeta, abstractNote: string | null | undefined): void {
  const cleaned = sanitizeText(abstractNote)
  if (cleaned) meta.abstract = cleaned
}

/**
 * 用 zotero-pdf-snapshot 把附件 key 反查成可反查 PaperRef + 父条目 metadata。
 * snapshot 无该附件 / 无父条目时返回 null（调用方退回文件名 meta 兜底）。
 */
function resolveZoteroAttachment(
  attachmentKey: string,
): { paper?: PaperRef; meta?: PaperCandidateMeta } | null {
  let record
  try {
    record = loadSnapshot()?.pdfs[attachmentKey]
  } catch (err) {
    console.warn('[evidence-conversation] loadSnapshot 失败:', err)
    return null
  }
  if (!record) return null

  const parent = record.parent
  const doi = parent?.DOI?.trim() || undefined
  const parentKey = record.parentItemKey?.trim() || undefined

  let paper: PaperRef | undefined
  if (doi) paper = { doi }
  else if (parentKey) paper = { zoteroKey: parentKey }

  let meta: PaperCandidateMeta | undefined
  const title = (parent?.title ?? record.title)?.trim()
  if (title) {
    meta = { title }
    const year = parseYearFromDate(parent?.date)
    if (year !== undefined) meta.year = year
    const authors = creatorsToAuthors(parent?.creators)
    if (authors.length > 0) meta.authors = authors
    setCleanAbstract(meta, parent?.abstractNote)
    if (doi) meta.doi = doi
  }

  return { ...(paper ? { paper } : {}), ...(meta ? { meta } : {}) }
}

/**
 * 用 zotero-pdf-snapshot 按**父条目 itemKey**（或顶层附件 attachmentKey）反扫，得到
 * 可反查 PaperRef + metadata。用于 zotero_read_attachment 的 itemKey 反查不到 DB 时兜底。
 * snapshot 无匹配记录 → null。
 */
function resolveZoteroByItemKey(
  itemKey: string,
): { paper?: PaperRef; meta?: PaperCandidateMeta } | null {
  let snapshot
  try {
    snapshot = loadSnapshot()
  } catch (err) {
    console.warn('[evidence-conversation] loadSnapshot 失败:', err)
    return null
  }
  if (!snapshot) return null

  // 优先按 parentItemKey 匹配；兜底按 attachmentKey（顶层附件 itemKey===attachmentKey）
  const record =
    Object.values(snapshot.pdfs).find((r) => r.parentItemKey === itemKey) ??
    snapshot.pdfs[itemKey]
  if (!record) return null

  const parent = record.parent
  const doi = parent?.DOI?.trim() || undefined
  let paper: PaperRef | undefined
  if (doi) paper = { doi }

  let meta: PaperCandidateMeta | undefined
  const title = (parent?.title ?? record.title)?.trim()
  if (title) {
    meta = { title }
    const year = parseYearFromDate(parent?.date)
    if (year !== undefined) meta.year = year
    const authors = creatorsToAuthors(parent?.creators)
    if (authors.length > 0) meta.authors = authors
    setCleanAbstract(meta, parent?.abstractNote)
    if (doi) meta.doi = doi
  }

  return { ...(paper ? { paper } : {}), ...(meta ? { meta } : {}) }
}

/** Zotero 原始日期串里取 4 位年份 */
function parseYearFromDate(date: string | null | undefined): number | undefined {
  if (!date) return undefined
  const m = date.match(/(19|20)\d{2}/)
  return m ? Number.parseInt(m[0], 10) : undefined
}

/** Zotero creators → 作者名数组（lastName/firstName 合并，或直接 name） */
function creatorsToAuthors(
  creators: Array<{ firstName?: string; lastName?: string; name?: string }> | undefined,
): string[] {
  if (!Array.isArray(creators)) return []
  const out: string[] = []
  for (const c of creators) {
    if (c.name && c.name.trim()) out.push(c.name.trim())
    else {
      const full = [c.firstName, c.lastName].filter((s) => s && s.trim()).join(' ').trim()
      if (full) out.push(full)
    }
  }
  return out
}

/**
 * 把当前 Q&A 加入既有证据集。幂等：(setId, sessionId, messageUuid) 已有未删除 ref → 复用。
 */
export function addConversationToSet(
  db: RepoDb,
  input: EvidenceSetsAddConversationMessageInput,
): EvidenceSetsAddConversationMessageResult {
  const { sessionId, messageUuid, snapshotText } = validatePayload(input)
  // 仅当 UI 明确告知"这条消息是综述生成消息"时才带入综述被引论文。
  // 默认 false：避免同 session 普通 Q&A 加入集合时错误拖入综述论文（review-first
  // 原版本只按 sessionId 判定，跨消息误伤；详见 ConversationEvidencePayload 注释）。
  const includeReviewCitations = input.includeReviewCitations === true

  let ref!: EvidenceRef
  let created = false

  db.transaction(() => {
    // 幂等：查既有 ref（target=set，source=conversation，同 sessionId+messageUuid，未删）
    const existing = listEvidenceRefsByTarget(db, 'evidence-set', input.setId).find((r) => {
      if (r.source.kind !== 'conversation') return false
      if (r.source.id !== sessionId) return false
      const loc = r.source.anchor.locationData
      return loc?.kind === 'conversation' && loc.messageUuid === messageUuid
    })
    if (existing) {
      ref = existing
      // 即使 Q&A 快照已存在，也补扫一次论文引用（幂等去重，便于历史条目补全）。
      // review-first：综述 HTML 路径仅在 includeReviewCitations=true 时跑，按
      // (paperId, snapshotText) 落"每 cite 一条" ref；占用 paperId 后，消息扫描路径
      // 在 (paperId) 单值幂等检查里被自然拦截 → 不再产 abstract 卡。
      if (includeReviewCitations) {
        attachReviewPaperRefsForSession(db, { setId: input.setId, sessionId })
      }
      attachPaperRefsForMessage(db, { setId: input.setId, sessionId, messageUuid })
      return
    }

    const anchor = buildConversationAnchor({
      snapshotText,
      sessionId,
      messageUuid,
      ...(input.userMessageUuid !== undefined ? { userMessageUuid: input.userMessageUuid } : {}),
      ...(input.messageTimestamp !== undefined ? { messageTimestamp: input.messageTimestamp } : {}),
    })
    ref = createEvidenceRef(db, {
      source: {
        kind: 'conversation',
        id: sessionId as ObjectId,
        anchor,
      },
      target: {
        kind: 'evidence-set',
        id: input.setId,
      },
    })
    appendEvidenceRefToSet(db, input.setId, ref.id)
    // review-first：见 addConversationToSet "existing" 分支同处注释
    if (includeReviewCitations) {
      attachReviewPaperRefsForSession(db, { setId: input.setId, sessionId })
    }
    attachPaperRefsForMessage(db, { setId: input.setId, sessionId, messageUuid })
    created = true
  })()

  return { ref, created }
}

/**
 * 新建命名证据集 + 同时挂当前 Q&A —— 单事务 4 步：
 *   ① 建占位 note（body = noteBody ?? name）
 *   ② INSERT evidence_set (note_id, persisted=true, name, savedAt=now)
 *   ③ INSERT evidence_ref (source=conversation, target=set)
 *   ④ append 到 evidence_set_refs
 */
export function createSetWithConversation(
  db: RepoDb,
  input: EvidenceSetsCreateWithConversationMessageInput,
): EvidenceSetsCreateWithConversationMessageResult {
  const { sessionId, messageUuid, snapshotText } = validatePayload(input)
  const name = input.name.trim()
  if (!name) {
    throw new Error(`[evidence-conversation] createSetWithConversation: name 不能为空`)
  }
  // issue #457：会话证据集 scope 到该 session 所属 workspace；反查不到则抛错。
  const workspaceId = getAgentSessionMeta(sessionId)?.workspaceId
  if (!workspaceId) {
    throw new Error(
      `[evidence-conversation] createSetWithConversation: 无法为 session ${sessionId} 反查 workspaceId（证据集需 scope 到 workspace，issue #457）`,
    )
  }
  // 同 addConversationToSet：仅当 UI 明确传 true 时带入综述论文，默认 false 跳过。
  const includeReviewCitations = input.includeReviewCitations === true

  let evidenceSetId!: ObjectId
  let noteId!: ObjectId
  let ref!: EvidenceRef

  db.transaction(() => {
    const note = repoCreateNote(db, { body: input.noteBody ?? name })
    noteId = note.id

    const set = createEvidenceSet(db, {
      noteId: note.id,
      persisted: true,
      name,
      savedAt: nowIso(),
      evidenceRefIds: [],
      workspaceId,
    })
    evidenceSetId = set.id

    const anchor = buildConversationAnchor({
      snapshotText,
      sessionId,
      messageUuid,
      ...(input.userMessageUuid !== undefined ? { userMessageUuid: input.userMessageUuid } : {}),
      ...(input.messageTimestamp !== undefined ? { messageTimestamp: input.messageTimestamp } : {}),
    })
    ref = createEvidenceRef(db, {
      source: {
        kind: 'conversation',
        id: sessionId as ObjectId,
        anchor,
      },
      target: {
        kind: 'evidence-set',
        id: set.id,
      },
    })
    appendEvidenceRefToSet(db, set.id, ref.id)
    // review-first：综述 HTML 路径仅在 includeReviewCitations=true 时跑（UI 已确认 messageUuid
    // 属于综述生成 turn），让 cite quote 占住 paperId；消息扫描兜底候选走默认 (paperId)
    // 幂等，自然被拦截，不会再为同 paper 产生 abstract 卡。
    // 默认 false 防止同 session 普通 Q&A 误拖入综述论文。
    if (includeReviewCitations) {
      attachReviewPaperRefsForSession(db, { setId: set.id, sessionId })
    }
    attachPaperRefsForMessage(db, { setId: set.id, sessionId, messageUuid })
  })()

  return { evidenceSetId, noteId, ref }
}
