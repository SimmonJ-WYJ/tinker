/**
 * 综述完成 hook：Agent artifact → reviews 表 + HTML 文件
 *
 * 编排职责（不做解析，由调用方传 ready-to-write payload）：
 *   1. 用 agent_session_id 反查；命中 → updateReview + 覆写 HTML（同会话重跑）
 *   2. 未命中 → createReview → writeReviewBody；写文件失败回滚 DB 行
 *
 * 边界：
 *   - 不在此处解析 marker / frontmatter（解析在 agent-orchestrator 侧，
 *     保持本服务对 Agent SDK 解耦，便于单元测试）
 *   - 不在此处发 IPC 通知（本版 UI 冻结，主进程内闭环）
 *   - 不抽 EvidenceRef（下版任务）
 */

import type { AgentMessage, ObjectId, Review } from '@asci/shared'
import { toIso } from '@asci/shared'

import {
  createReview,
  getReviewByAgentSessionId,
  getReviewById,
  listReviews,
  updateReview,
  type CreateReviewInput,
} from './repositories/review-repository.ts'
import {
  deleteReviewBody,
  writeReviewBody,
  type ReviewBodyExt,
} from './review-body-service.ts'
import { extractReviewArtifact } from './review-artifact-parser.ts'
import { scanSessionReviewsDir } from './review-cwd-scanner.ts'
import { extractReviewCitations } from './review-citation-extractor.ts'
import type { ParsedReference } from './review-citation-extractor.ts'
import {
  attachReviewEvidenceBundle,
  attachEvidenceSetToReview,
  buildEvidenceSetForRefs,
  type EvidenceItemInput,
  type PaperRef,
} from './evidence-attachment-service.ts'
import {
  getPaperByDoi,
  findPaperByZoteroKey,
  getPaperById,
} from './repositories/paper-repository.ts'
import { syncPapers, type PaperSyncInput } from './paper-sync-service.ts'
import { lookupSnapshotByDoi } from '../workspace-paper-lookup.ts'
import { getAgentSessionMeta } from '../agent-session-manager.ts'
import {
  isReviewHtmlWrapped,
  wrapReviewHtmlFragment,
} from './review-html-wrapper.ts'
import {
  listEvidenceRefsByReview,
  softDeleteEvidenceRef,
} from './repositories/evidence-ref-repository.ts'
import {
  getEvidenceSetById,
  softDeleteEvidenceSet,
} from './repositories/evidence-set-repository.ts'
import { softDeleteRow } from './internal/common.ts'
import { nowIso } from './internal/common.ts'
import type { RepoDb } from './internal/repo-db.ts'
import { readFileSync, writeFileSync } from 'node:fs'

/** 综述能力包 ID。当前两种来源（inline artifact / cwd md 文件）共用同一个 capability。 */
export const REVIEW_SOURCE_CAPABILITY = 'asci-core-synthesizer'

export interface PersistReviewInput extends CreateReviewInput {
  /** 正文文本（HTML fragment 或 Markdown）。
   *  仅在需要本服务"代写镜像文件"时填写（inline 模式 / 测试）；
   *  cwd 模式只在 DB 存 bodyPath，html 留空即可。 */
  html?: string
  /** 镜像文件扩展名；默认 'html'（v0.19.0+）。仅当 html 非空时生效。 */
  bodyExt?: ReviewBodyExt
}

export interface PersistReviewResult {
  review: Review
  /** 'created'：首次落；'updated'：同 agentSessionId 反查命中 → update */
  mode: 'created' | 'updated'
}

/**
 * 把 Agent 综述输出落库 + 落文件。
 *
 * 失败回滚策略：
 *   - DB create 失败 → 不写文件（自然回滚）
 *   - DB create 成功、写文件失败 → 硬删 DB 行（区别于软删；这条记录从未对外可见过）
 *   - update 路径写文件失败 → 不回滚 DB（旧文件仍在，update 已经把 meta 改了；
 *     由调用方决定是否重试）
 */
export function persistReviewFromAgentOutput(
  db: RepoDb,
  input: PersistReviewInput,
): PersistReviewResult {
  console.log(
    `[review-persistence] persistReviewFromAgentOutput 开始: agentSessionId=${input.agentSessionId ?? '(none)'} title="${input.title}"`,
  )

  const existing = input.agentSessionId
    ? getReviewByAgentSessionId(db, input.agentSessionId)
    : null
  console.log(
    `[review-persistence] ↳ 反查 by-session 命中? ${existing ? `是 (id=${existing.id})` : '否'}`,
  )

  if (existing) {
    // 注意：sourceEvidenceSetId **保持 undefined 直接传**（不要 `?? null`）。
    // updateReview repository 把 undefined 视为"不改"（保留 existing.sourceEvidenceSetId），
    // null 视为"显式清空"。自动 hook 重跑同 session 时，外层未传 sourceEvidenceSetId →
    // 此处 ?? null 会把旧 set 引用抹掉 → tryAttachReviewEvidence 反查不到旧 set →
    // 无法 softDelete，导致 orphan。改为直传 input.sourceEvidenceSetId 保留语义。
    const updated = updateReview(db, existing.id, {
      title: input.title,
      intent: input.intent,
      topic: input.topic ?? null,
      sourceEvidenceSetId: input.sourceEvidenceSetId,
      bodyPath: input.bodyPath ?? null,
    })
    console.log(`[review-persistence] ↳ updateReview 成功 id=${updated.id}`)
    if (input.html !== undefined) {
      writeReviewBody(updated.id, input.html, input.bodyExt ?? 'html')
    } else {
      console.log(
        `[review-persistence] ↳ cwd 模式：不镜像，body 仍由 bodyPath=${updated.bodyPath} 解析`,
      )
    }
    console.log(`[review-persistence] ↳ ✅ updated review ${updated.id}`)
    return { review: updated, mode: 'updated' }
  }

  let review: Review
  try {
    review = createReview(db, {
      title: input.title,
      intent: input.intent,
      sourceCapability: input.sourceCapability,
      sourceEvidenceSetId: input.sourceEvidenceSetId,
      topic: input.topic,
      agentSessionId: input.agentSessionId,
      bodyPath: input.bodyPath,
    })
    console.log(`[review-persistence] ↳ createReview 成功 id=${review.id} bodyPath=${review.bodyPath ?? '(none)'}`)
  } catch (err) {
    console.error(`[review-persistence] ↳ ❌ createReview 失败:`, err)
    throw err
  }

  if (input.html !== undefined) {
    try {
      writeReviewBody(review.id, input.html, input.bodyExt ?? 'html')
    } catch (err) {
      console.error(
        `[review-persistence] ↳ ❌ writeReviewBody 失败 id=${review.id}，回滚 DB 行:`,
        err,
      )
      // 文件写失败 → 这条 DB 行从未对外可见过，硬删而不是软删
      hardDeleteReviewRow(db, review.id)
      deleteReviewBody(review.id) // 兜底清理可能写出来的半截文件
      throw err
    }
  } else {
    console.log(
      `[review-persistence] ↳ cwd 模式：不镜像，body 由 bodyPath=${review.bodyPath ?? '(none)'} 解析`,
    )
  }

  console.log(`[review-persistence] ↳ ✅ created review ${review.id}`)
  return { review, mode: 'created' }
}

/**
 * 硬删 reviews 行（仅供失败回滚）。绕过软删 helper，因为这条记录从未
 * 对外可见过，没必要留 audit trail。
 *
 * 用 softDeleteRow 顺手把 visibility 置 'deleted' + deleted_at 也是
 * 可选方案，但会污染 listReviews(includeDeleted: true) 的视图，对调试不友好。
 */
function hardDeleteReviewRow(db: RepoDb, id: ObjectId): void {
  // 防御：极小概率被外键阻挡（evidence_refs CASCADE 应处理掉），
  // 失败时退化为软删，确保不至于抛二次错误。
  try {
    db.prepare(`DELETE FROM reviews WHERE id = ?`).run(id)
  } catch {
    softDeleteRow(db, 'reviews', id, nowIso())
  }
}

/**
 * 高阶入口（**当前为死代码兜底**）：扫描 assistant 消息找
 * `<asci-review-artifact>` 块。
 *
 * 历史背景：早期假设 synthesizer SubAgent 会按 contract 在 chat 中 inline
 * 输出 artifact；现已确认 ASCI 真实综述链路（litreview /
 * literature-review-result skill）走 cwd 模式（v0.19.0+：Write 工具落 .html
 * 到 session cwd 下的 reviews/），synthesizer SubAgent prompt 的 artifact
 * contract 也已撤掉。本函数**永远返回 null**，保留仅作扩展点：未来若某条
 * 新链路想用 inline 模式直接 emit artifact，可不改 service 直接复用。
 *
 * - 找不到 marker：返回 null，不做任何 DB / 文件操作
 * - 找到但解析失败：返回 null（artifact-parser 内部已宽容处理）
 * - 找到且持久化失败：抛错
 */
export function maybePersistReviewFromMessages(
  db: RepoDb,
  params: {
    agentSessionId: string
    intent: string
    sourceEvidenceSetId?: ObjectId
    messages: readonly AgentMessage[]
  },
): PersistReviewResult | null {
  // 反向遍历，只看最后一条 assistant 消息（artifact contract 要求 marker
  // 出现在最终消息末尾），但兜底允许向上回溯几条防止 SDK 把单轮拆多条
  const assistantTexts: string[] = []
  for (let i = params.messages.length - 1; i >= 0; i--) {
    const m = params.messages[i]
    if (!m || m.role !== 'assistant') continue
    assistantTexts.unshift(m.content ?? '')
    if (assistantTexts.length >= 3) break
  }
  console.log(
    `[review-persistence] 入口扫描 session=${params.agentSessionId} 消息总数=${params.messages.length} 末尾 assistant 消息=${assistantTexts.length} 条`,
  )

  if (assistantTexts.length === 0) {
    console.log(`[review-persistence] ↳ 未找到 assistant 消息，跳过`)
    return null
  }

  const concatenated = assistantTexts.join('\n')
  const hasOpenTag = /<asci-review-artifact>/i.test(concatenated)
  const hasCloseTag = /<\/asci-review-artifact>/i.test(concatenated)
  const tail = concatenated.slice(-300).replace(/\s+/g, ' ')
  console.log(
    `[review-persistence] ↳ 末尾文本 ${concatenated.length} 字符；含 <asci-review-artifact>=${hasOpenTag} 闭合=${hasCloseTag}`,
  )
  console.log(`[review-persistence] ↳ 末 300 字预览: ${tail}`)

  const artifact = extractReviewArtifact(concatenated)
  if (!artifact) {
    console.log(
      `[review-persistence] ↳ ❌ 未提取出合法 artifact（marker 不全 / frontmatter 缺 title / 解析失败）`,
    )
    return null
  }

  console.log(
    `[review-persistence] ↳ ✅ 提取到 artifact: title="${artifact.title}" topic="${artifact.topic ?? ''}" html=${artifact.html.length} 字符`,
  )

  return persistReviewFromAgentOutput(db, {
    title: artifact.title,
    intent: params.intent,
    sourceCapability: REVIEW_SOURCE_CAPABILITY,
    sourceEvidenceSetId: params.sourceEvidenceSetId,
    topic: artifact.topic,
    agentSessionId: params.agentSessionId,
    html: artifact.html,
    bodyExt: 'html',
    // inline 模式没有原始文件 path，bodyPath 留空 → 走 ~/.asci/reviews/{id}.html 兜底
  })
}

/**
 * 真实链路入口：扫 session cwd 下 reviews/*.html，对本轮新增的每一份调持久化。
 *
 * 与 maybePersistReviewFromMessages 是**并列关系**而非替换 —— 现阶段 inline
 * artifact 通道未被任何 skill 使用，但保留可调用入口；下一步可能把它废弃。
 *
 * 同 session 多份 html 文件：本版按 agent_session_id 反查只会保留一条。后续
 * 多份场景下需要引入 source_path 作为更细粒度的查重键 —— 当前 ASCI 综述
 * skill 一次 run 只产一份，这是合理的简化。
 *
 * 失败策略：
 *   - 任意一份持久化失败 → console.warn 并继续处理下一份（不阻塞其它综述）
 *   - 全部失败也不抛错（不影响 Agent 主路径）
 */
export function persistReviewsFromSessionCwd(
  db: RepoDb,
  params: {
    agentSessionId: string
    intent: string
    sessionCwd: string
    runStartedAtMs: number
    sourceEvidenceSetId?: ObjectId
  },
): PersistReviewResult[] {
  const files = scanSessionReviewsDir(params.sessionCwd, params.runStartedAtMs)
  if (files.length === 0) {
    console.log(`[review-persistence] cwd 模式：本轮 reviews/ 无新文件`)
    return []
  }

  const results: PersistReviewResult[] = []
  for (const file of files) {
    try {
      console.log(
        `[review-persistence] cwd 模式：处理 ${file.fileName}（mtime=${toIso(file.mtimeMs)} title="${file.title}"）`,
      )

      // 把 skill 写的 fragment 包成 self-contained HTML 文档：用户双击 .html
      // 在浏览器里可以看到完整渲染（嵌入的 CSS + JS + KaTeX）。已包过 / 已经是
      // 完整文档则跳过，幂等不重写。包装失败仅 warn，不阻塞落库。
      if (!isReviewHtmlWrapped(file.content)) {
        try {
          const wrapped = wrapReviewHtmlFragment(file.content, { title: file.title })
          writeFileSync(file.filePath, wrapped, 'utf-8')
          console.log(
            `[review-persistence] ↳ 已包 standalone: ${file.fileName}（${file.content.length} → ${wrapped.length} 字节）`,
          )
        } catch (err) {
          console.warn(
            `[review-persistence] ↳ standalone 包装失败（不阻塞落库）`,
            err,
          )
        }
      } else {
        console.log(`[review-persistence] ↳ ${file.fileName} 已是 standalone，跳过包装`)
      }

      const res = persistReviewFromAgentOutput(db, {
        title: file.title || file.fileName,
        intent: params.intent,
        sourceCapability: REVIEW_SOURCE_CAPABILITY,
        sourceEvidenceSetId: params.sourceEvidenceSetId,
        agentSessionId: params.agentSessionId,
        bodyPath: file.filePath,
        // 故意不传 html → 不再镜像，下游读取直接走 bodyPath
      })
      results.push(res)

      // 抽 cite/q 三件套落 evidence_refs / evidence_set。
      // **每次都走"清理旧 + 重新抽"流程**：用户重生成综述时 references 可能变化，
      // 旧 evidence_set 应被覆盖而非保留（与手动 reparseReviewCitations 同语义）。
      // 失败 try/catch 不阻塞 review 主路径。
      tryAttachReviewEvidence(db, res.review, file.content)
    } catch (err) {
      console.warn(
        `[review-persistence] cwd 模式：处理 ${file.fileName} 失败，继续下一份`,
        err,
      )
    }
  }
  return results
}

/** 解析 review 的 cite/q 返回详情（自动 hook 与手动 reparseReviewCitations 共用） */
export interface ReparseReviewCitationsResult {
  reviewId: ObjectId
  /** 实际落库的 evidence_refs 条数 */
  refCount: number
  /** 涉及的不同 paper 数 */
  paperCount: number
  /** 新创建的 evidence_set id（refCount=0 时为 null） */
  evidenceSetId: ObjectId | null
  /** §7 缺 paper 标识的 N */
  refsMissingPaper: number[]
  /** 正文 cite 在 §7 找不到 paper 的 N */
  citesUnresolved: number[]
  /** paper 反查不到（DOI/id/zoteroKey 不在 papers 表）的描述 */
  papersNotInDb: string[]
  /** 是否覆盖了已有 evidence_set */
  replacedExisting: boolean
}

/**
 * 自动 hook 路径包装：从 review HTML 抽 cite/q 落库；失败软容错，不抛错。
 *
 * **每次都走"清理旧 + 重新抽"流程**（与手动 reparseReviewCitations 共享 parseAndAttachReviewCitations）：
 * - 第一次：review.sourceEvidenceSetId == null → 清理是 no-op → 正常抽取
 * - 重生成同一 session：先软删旧 evidence_set + refs → 再用新 HTML 抽 → 覆盖
 *
 * 之前的 alreadyHasEvidenceSet 跳过逻辑被移除：用户每次重跑综述都希望解析跟着刷新，
 * "跳过"反而导致旧 references 残留误导。
 */
function tryAttachReviewEvidence(
  db: RepoDb,
  review: Review,
  html: string,
): void {
  try {
    const r = parseAndAttachReviewCitations(db, review, html)
    if (r.replacedExisting) {
      console.log(
        `[review-persistence] ↳ ♻️ 重抽 evidence_set ${r.evidenceSetId ?? '(empty)'}（${r.refCount} 条 ref，${r.paperCount} 篇 paper；覆盖旧 set）`,
      )
    } else if (r.evidenceSetId) {
      console.log(
        `[review-persistence] ↳ ✅ 已 attach evidence_set ${r.evidenceSetId}（${r.refCount} 条 ref，${r.paperCount} 篇 paper）`,
      )
    } else {
      console.log(`[review-persistence] ↳ review ${review.id} 没有可解析的 cite，跳过 attach`)
    }
    // 证据集条目明细打日志（问题排查：看这篇综述背后究竟是哪些证据）
    if (r.evidenceSetId) {
      const refs = listEvidenceRefsByReview(db, review.id)
      console.log(`[review-persistence] 📋 综述 ${review.id} 证据集明细（${refs.length} 条）：`)
      refs.forEach((ref, i) => {
        const snap = (ref.source.anchor?.snapshotText ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
        console.log(`   ${i + 1}. [${ref.source.kind}] ${ref.source.id} | ${snap}`)
      })
    }
    if (r.refsMissingPaper.length > 0) {
      console.warn(
        `[review-persistence] ↳ §7 References 缺 paper 标识：N=${r.refsMissingPaper.join(',')}（这些 cite 已略过）`,
      )
    }
    if (r.citesUnresolved.length > 0) {
      console.warn(
        `[review-persistence] ↳ 正文 cite 在 §7 找不到 paper：N=${r.citesUnresolved.join(',')}`,
      )
    }
    if (r.papersNotInDb.length > 0) {
      console.warn(
        `[review-persistence] ↳ ${r.papersNotInDb.length} 条 cite 的 paper 未入库，已丢弃：${r.papersNotInDb.join(' / ')}`,
      )
    }
  } catch (err) {
    console.warn(`[review-persistence] ↳ evidence 抽取失败（不影响 review 主路径）:`, err)
  }
}

/**
 * 由 review 反查其所属 workspace id（issue #457：综述自动建的证据集也必须 scope 到 workspace）。
 *
 * 综述总是在某个 workspace 的 agent 会话里生成（litreview cwd 模式落
 * agent-workspaces/<ws>/...），故 review.agentSessionId → session meta.workspaceId 必能命中。
 * 反查失败（缺 agentSessionId / session 已删 / meta 无 workspaceId）→ 抛错：
 *   - 自动 hook 路径（tryAttachReviewEvidence）外层 try/catch 转 warn，不阻断综述落库；
 *   - 手动 UI 路径（reparseReviewCitations / ensureAndPromote）原样上抛由 UI 提示。
 */
function resolveWorkspaceIdForReview(review: Review): string {
  const workspaceId = review.agentSessionId
    ? getAgentSessionMeta(review.agentSessionId)?.workspaceId
    : undefined
  if (!workspaceId) {
    throw new Error(
      `[review-persistence] 无法为 review ${review.id} 反查 workspaceId` +
        `（agentSessionId=${review.agentSessionId ?? '(空)'}）；证据集需 scope 到 workspace（issue #457）`,
    )
  }
  return workspaceId
}

/**
 * 解析 review HTML 的 cite/q 三件套，落 evidence_refs + evidence_set + 更新 review.source_evidence_set_id。
 *
 * **核心实现，被 tryAttachReviewEvidence（自动 hook）与 reparseReviewCitations（手动 UI）共享**。
 * 每次都先软删旧的 evidence_set + 所有 evidence_refs，然后重新抽 + attach。
 *
 * 不吞错：抽取 / SQL 抛错向上传递，由调用方决定是软容错还是上报 UI。
 */
function parseAndAttachReviewCitations(
  db: RepoDb,
  review: Review,
  html: string,
): ReparseReviewCitationsResult {
  // issue #457：先解析所属 workspace —— 综述自动建的临时 set 也要 scope 到 workspace。
  const workspaceId = resolveWorkspaceIdForReview(review)
  // 1) 清理旧 evidence_set + refs
  //    B5 之后语义改造：旧 set 已被用户 promote 成 persisted=1（"已保存为证据集"）→
  //    **保留不动**，只把 review 与旧 set 断开（updateReview sourceEvidenceSetId=null）。
  //    旧 set 仍在证据集列表里独立存在，避免用户主动保存的内容被重生成覆盖。
  //    旧 set 仍是 persisted=0 → 维持原 softDelete + 重抽逻辑。
  const replacedExisting = review.sourceEvidenceSetId != null
  let currentReview = review
  let preservedPersistedSet = false
  if (replacedExisting) {
    const oldSet = getEvidenceSetById(db, currentReview.sourceEvidenceSetId!)
    if (oldSet?.persisted) {
      // 已保存的正式 set：仅切断 review 关联，set 行保留
      preservedPersistedSet = true
    } else if (oldSet) {
      // 临时 set：仍按旧语义软删，避免悬空
      softDeleteEvidenceSet(db, oldSet.id)
    }
    currentReview = updateReview(db, currentReview.id, { sourceEvidenceSetId: null })
  }
  // 旧 refs 始终软删：review.id 重新指向新 set 后，target='review' 的旧 ref 已经无意义
  const oldRefs = listEvidenceRefsByReview(db, currentReview.id)
  for (const ref of oldRefs) softDeleteEvidenceRef(db, ref.id)
  // 静默使用 preservedPersistedSet，方便未来上抛到 ReparseReviewCitationsResult
  void preservedPersistedSet

  // 2) 抽 cite/q
  const extracted = extractReviewCitations(html)

  // 3) 管道 C：把 §7 出现但 papers 表里没有的 paper 兜底建出来（失败仅 warn）
  try {
    syncPapersFromReferences(db, extracted.references)
  } catch (err) {
    console.warn(`[review-persistence] paper-sync 兜底失败（继续挂 evidence）:`, err)
  }

  // 4) paper 反查预过滤：把 papers 表里查不到的 cite 单条丢弃
  const items: EvidenceItemInput[] = []
  const papersNotInDb: string[] = []
  for (const item of extracted.items) {
    if (resolvePaperRefExists(db, item.paper)) {
      items.push(item)
    } else {
      papersNotInDb.push(describePaperRef(item.paper))
    }
  }

  // 5) items 全空时：建一个空的临时 set + 挂到 review。
  //    B5 改造：用户期望"每个 review 都有一个可保存的临时 set"，即使 cite 抽不到也保证
  //    popover 能调 promoteFromReview。空 set 后续用户点保存仍可命名 + 升格 persisted=1，
  //    没有 ref 不影响保存动作；详情面板 EVIDENCE ITEMS 区域显示空即可。
  if (items.length === 0) {
    const emptySet = buildEvidenceSetForRefs(db, {
      refIds: [],
      noteBody: currentReview.title,
      persisted: false,
      workspaceId,
    })
    const reviewWithSet = attachEvidenceSetToReview(db, {
      reviewId: currentReview.id,
      evidenceSetId: emptySet.id,
    })
    return {
      reviewId: reviewWithSet.id,
      refCount: 0,
      paperCount: 0,
      evidenceSetId: emptySet.id,
      refsMissingPaper: extracted.refsMissingPaper,
      citesUnresolved: extracted.citesUnresolved,
      papersNotInDb,
      replacedExisting,
    }
  }

  // 6) attach —— 综述自动建的 set 是临时的（B5）：用户在 Agent 消息上点
  //    BookmarkPlus → promoteFromReview 时再把 persisted=1 + 写入 name/savedAt。
  //    保持 persisted=0 → CHECK 约束要求 name + saved_at 必空。
  const attached = attachReviewEvidenceBundle(db, {
    reviewId: currentReview.id,
    items,
    workspaceId,
    evidenceSet: { persisted: false },
  })

  return {
    reviewId: currentReview.id,
    refCount: attached.evidenceRefs.length,
    paperCount: new Set(attached.evidenceRefs.map((r) => r.source.id)).size,
    evidenceSetId: attached.evidenceSet.id,
    refsMissingPaper: extracted.refsMissingPaper,
    citesUnresolved: extracted.citesUnresolved,
    papersNotInDb,
    replacedExisting,
  }
}

/**
 * 管道 C 兜底：把 §7 References 里出现但 papers 表里没有的 paper 同步建出来。
 *
 * 输入：extractReviewCitations 的 references（含 doi/zoteroKey/metadata）。
 * 行为：
 *   - 只对有 title 的 ref 发起 sync（避免靠 DOI 单字段建出空 title 的脏行）
 *   - syncPapers 幂等：已存在的 DOI/zoteroKey 不会重复创建
 *   - 已有 paper-id（PaperRef.id）的 ref：跳过 —— 调用方传 id 意味着 paper 已存在
 *   - **解析时 snapshot 补偿**：当 ref 自带 doi 但没有 zoteroKey 时，到
 *     zotero-pdf-snapshot.json 里反查；命中即用 parent.itemKey 作 zoteroKey，
 *     让 stub paper **一次成型带 zoteroKey**，"Open in Library" 立刻可点
 */
function syncPapersFromReferences(db: RepoDb, references: readonly ParsedReference[]): void {
  const inputs: PaperSyncInput[] = []
  let snapshotEnrichedCount = 0
  for (const ref of references) {
    // 跳过已经手动绑定 paper-id 的 ref
    if (ref.paper && 'id' in ref.paper) continue
    const m = ref.metadata
    if (!m.title) continue
    // snapshot 补偿：ref 有 doi 但没 zoteroKey → 看 zotero-pdf-snapshot.json
    let enrichedZk: string | null = m.zoteroKey ?? null
    if (!enrichedZk && m.doi) {
      const rec = safeLookupSnapshotByDoi(m.doi)
      if (rec && rec.parentItemKey) {
        enrichedZk = rec.parentItemKey
        snapshotEnrichedCount++
      }
    }
    inputs.push({
      source: 'review-citation',
      title: m.title,
      authors: m.authors,
      year: m.year ?? null,
      venue: m.venue ?? null,
      doi: m.doi ?? null,
      zoteroKey: enrichedZk,
    })
  }
  if (inputs.length === 0) return
  const result = syncPapers(db, inputs)
  if (result.created > 0 || result.updated > 0 || snapshotEnrichedCount > 0) {
    console.log(
      `[review-persistence] ↳ paper-sync 兜底：created=${result.created}, updated=${result.updated}, skipped=${result.skipped}, snapshot-enriched=${snapshotEnrichedCount}`,
    )
  }
}

/** lookupSnapshotByDoi 包一层 try/catch；任何失败软容错，sync 主流程不阻断 */
function safeLookupSnapshotByDoi(doi: string): ReturnType<typeof lookupSnapshotByDoi> {
  try {
    return lookupSnapshotByDoi(doi)
  } catch (err) {
    console.warn('[review-persistence] snapshot 反查失败（跳过补偿）:', err)
    return null
  }
}

/** PaperRef 在 DB 里能查到 paper 行 → true */
function resolvePaperRefExists(db: RepoDb, ref: PaperRef): boolean {
  if ('id' in ref) return getPaperById(db, ref.id) != null
  if ('doi' in ref) return getPaperByDoi(db, ref.doi) != null
  if ('zoteroKey' in ref) return findPaperByZoteroKey(db, ref.zoteroKey) != null
  return false
}

function describePaperRef(ref: PaperRef): string {
  if ('id' in ref) return `id=${ref.id}`
  if ('doi' in ref) return `doi=${ref.doi}`
  if ('zoteroKey' in ref) return `zoteroKey=${ref.zoteroKey}`
  return '<unknown>'
}

// ===========================================================================
// 手动「解析」入口（UI 按钮触发，用于 dev 期 / 用户手动重抽）
// ===========================================================================

export class ReviewNotFoundForReparseError extends Error {
  constructor(public readonly key: string) {
    super(`[review-reparse] 找不到 review：${key}`)
    this.name = 'ReviewNotFoundForReparseError'
  }
}

/**
 * 手动解析 review 的 cite/q，落 evidence_refs / evidence_set / 更新 source_evidence_set_id。
 *
 * **会先清掉旧的 evidence_set + refs**（软删），用于测试期反复触发或用户手动重抽。
 *
 * 与自动 hook（tryAttachReviewEvidence）共享核心 parseAndAttachReviewCitations，
 * 仅多一层 review 反查 + 文件读取 + 抛错（让 UI 能提示原因）。
 *
 * 参数：reviewId 或 bodyPath 二选一。UI 通常传 bodyPath（按预览面板当前文件路径）。
 */
export function reparseReviewCitations(
  db: RepoDb,
  params: { reviewId?: ObjectId; bodyPath?: string },
): ReparseReviewCitationsResult {
  // 1) 反查 review
  let review: Review | null = null
  if (params.reviewId) {
    review = getReviewById(db, params.reviewId)
    if (!review) throw new ReviewNotFoundForReparseError(`id=${params.reviewId}`)
  } else if (params.bodyPath) {
    review = findReviewByBodyPath(db, params.bodyPath)
    if (!review) throw new ReviewNotFoundForReparseError(`bodyPath=${params.bodyPath}`)
  } else {
    throw new Error('[review-reparse] 必须传 reviewId 或 bodyPath')
  }

  // 2) 读文件内容（拿 anchor 用的 HTML 原文）
  if (!review.bodyPath) {
    throw new Error(`[review-reparse] review ${review.id} 没有 bodyPath，无法解析`)
  }
  let html: string
  try {
    html = readFileSync(review.bodyPath, 'utf-8')
  } catch (err) {
    throw new Error(
      `[review-reparse] 读 bodyPath 失败：${review.bodyPath} — ${(err as Error).message}`,
    )
  }

  // 3) 走共享解析（清理 + 抽 + attach）
  return parseAndAttachReviewCitations(db, review, html)
}

/** 按 body_path 反查 review（O(n) 扫描；当前 reviews 量级低可接受） */
function findReviewByBodyPath(db: RepoDb, bodyPath: string): Review | null {
  // 直接走 SQL 一次取出比 listReviews 全量返回再过滤更省（但 reviews 数量本来就少，
  // 这里偷懒走 listReviews 拿 mapper 处理好的对象，避免重复字段映射）
  void db
  const all = listReviews(db, { includeDeleted: false })
  return all.find((r) => r.bodyPath === bodyPath) ?? null
}
