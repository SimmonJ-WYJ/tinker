/**
 * evidence-conversation-service 集成测试 —— 综述会话证据条目带入
 *
 * 内存 SQLite + 完整 001-initial schema。聚焦本次新增的"综述会话加入证据集时
 * 自动带入被引论文"链路（attachReviewPaperRefsForSession）：
 *   - 综述 HTML 的 §7 References / 正文 <cite> → paper 证据条目
 *   - 会话条目仍保留（additive）
 *   - **v0.2.x 幂等键 (setId, paperId, snapshotText)**：同 paper 不同 cite 各落一条 ref；
 *     同 paper 同 quote 重复出现仍幂等（reviewCitesToCandidates 内部 + attachPaperCandidatesToSet）
 *   - 无关联 Review 时行为不变（仅会话条目）
 *   - §7 论文不在 papers 表 → createPaper 兜底
 *
 * 综述 HTML 经临时文件落盘，Review.bodyPath 指向它（readReviewBody 直读 bodyPath）。
 * agent session 在测试里无消息文件 → attachPaperRefsForMessage 自然 no-op（不干扰断言）。
 */

import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// issue #457：createSetWithConversation 由 sessionId 反查 workspaceId（getAgentSessionMeta）。
// 测试不依赖真实 agent-sessions.json，统一桩成固定 workspace。
// 注意：mock.module 是进程级全局，afterAll 必须还原，否则泄漏到后续 test 文件
// （如 agent-rewind.test.ts 依赖真实 getAgentSessionMeta）。先快照原模块再桩。
import * as sessionMgrNs from './agent-session-manager.ts'
const REAL_SESSION_MGR = { ...sessionMgrNs }
mock.module('./agent-session-manager.ts', () => ({
  ...REAL_SESSION_MGR,
  getAgentSessionMeta: (id: string) => ({
    id,
    title: 'test-session',
    createdAt: '2026-01-01T00:00:00Z',
    workspaceId: 'ws-test',
  }),
}))
afterAll(() => {
  mock.module('./agent-session-manager.ts', () => ({ ...REAL_SESSION_MGR }))
})

import { openTestDb } from './objects/repositories/_helpers.test.ts'
import { createPaper } from './objects/repositories/paper-repository.ts'
import { createReview } from './objects/repositories/review-repository.ts'
import { listEvidenceRefsByTarget } from './objects/repositories/evidence-ref-repository.ts'
import {
  addConversationToSet,
  createSetWithConversation,
} from './evidence-conversation-service.ts'

// 临时目录托管综述 HTML 文件，测试结束统一清理
const TMP_ROOT = mkdtempSync(join(tmpdir(), 'asci-evi-conv-'))
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }))

/** 写一份综述 HTML 到临时文件，返回绝对路径 */
function writeReviewHtml(name: string, html: string): string {
  const p = join(TMP_ROOT, `${name}.html`)
  writeFileSync(p, html, 'utf-8')
  return p
}

/**
 * 两篇被引论文的综述 fragment（均带 data-doi 标识符，符合 skill 契约）：
 *   - ref 1：data-doi="10.1234/a"（测试库内反查命中）
 *   - ref 2：data-doi="10.5678/b"（库内无 → createPaper 带 doi 兜底建库 → 可幂等）
 */
function buildReviewHtml(): string {
  return `<article class="asci-review" data-version="1">
  <section id="s1"><h2>§1 Intro</h2>
    <p>Foo bar <cite data-ref="1"><q>verbatim quote from paper A</q></cite> baz.</p>
  </section>
  <section id="s2"><h2>§2 Themes</h2>
    <p>Lorem <cite data-ref="2"><q>verbatim quote from paper B</q></cite> ipsum
       and again <cite data-ref="1"><q>another quote A</q></cite>.</p>
  </section>
  <section id="s7" class="references"><h2>§7 References</h2>
    <ol class="refs">
      <li id="ref-1" data-ref="1" data-doi="10.1234/a">Author A. <i>Paper A Title</i>. Venue, 2021.</li>
      <li id="ref-2" data-ref="2" data-doi="10.5678/b">Author B. <i>Paper B Title</i>. Venue, 2022.</li>
    </ol>
  </section>
</article>`
}

const QA_SNAPSHOT = 'Q: 综述一下\n\nA: Review saved to ...html'

function countByKind(refs: ReturnType<typeof listEvidenceRefsByTarget>): {
  conversation: number
  paper: number
} {
  let conversation = 0
  let paper = 0
  for (const r of refs) {
    if (r.source.kind === 'conversation') conversation++
    else if (r.source.kind === 'paper') paper++
  }
  return { conversation, paper }
}

describe('createSetWithConversation —— 综述会话带入被引论文', () => {
  test('includeReviewCitations: true → 1 会话 + 3 paper ref（v0.2.x 按 cite 折，paper A 被引 2 次 → 2 条独立 ref）', () => {
    const { repo } = openTestDb()
    const sessionId = 'sess-review-1'

    // 库内预置 ref 1 对应论文（doi 反查命中）；ref 2 不预置（走 createPaper 带 doi 兜底）
    createPaper(repo, { title: 'Paper A Title', authors: ['Author A'], doi: '10.1234/a' })

    const bodyPath = writeReviewHtml('r1', buildReviewHtml())
    createReview(repo, {
      title: 'AI 后训练综述',
      intent: 'literature-review',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: sessionId,
      bodyPath,
    })

    const { evidenceSetId } = createSetWithConversation(repo, {
      name: '我的证据集',
      sessionId,
      messageUuid: 'msg-1',
      snapshotText: QA_SNAPSHOT,
      includeReviewCitations: true,
    })

    const refs = listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId)
    const { conversation, paper } = countByKind(refs)
    expect(conversation).toBe(1)
    // 综述 HTML 含 3 个 <cite>：2× ref-1（quote A 两段不同）+ 1× ref-2 → 3 条 paper ref
    expect(paper).toBe(3)

    // paper ref 的 snapshotText 取自各自正文 cite 的 verbatim 短引；同 paper 各 cite 不被合并
    const paperRefs = refs.filter((r) => r.source.kind === 'paper')
    const snapshots = paperRefs.map((r) => r.source.anchor.snapshotText).sort()
    expect(snapshots).toEqual([
      'another quote A',
      'verbatim quote from paper A',
      'verbatim quote from paper B',
    ])
  })

  test('同一未入库论文被引 2 次（data-zotero-key）→ 两条 ref 指向同一 paperId（回归：createPaper 兜底带身份，证据集详情才能按 paper 折叠）', () => {
    const { repo } = openTestDb()
    const sessionId = 'sess-fold'
    // 库内**不预置**该论文 → 走 createPaper 兜底；§7 用 data-zotero-key 携带身份
    const html = `<article class="asci-review" data-version="1">
  <section id="s1"><h2>§1</h2>
    <p>X <cite data-ref="1"><q>quote one from the paper</q></cite> Y
       <cite data-ref="1"><q>quote two from the paper</q></cite>.</p>
  </section>
  <section id="s7" class="references"><ol class="refs">
    <li id="ref-1" data-ref="1" data-zotero-key="ZKNEW123">Author. <i>Uncited Paper</i>. Venue, 2023.</li>
  </ol></section>
</article>`
    const bodyPath = writeReviewHtml('r-fold', html)
    createReview(repo, {
      title: 'T',
      intent: 'literature-review',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: sessionId,
      bodyPath,
    })

    const { evidenceSetId } = createSetWithConversation(repo, {
      name: 'fold',
      sessionId,
      messageUuid: 'm-fold',
      snapshotText: QA_SNAPSHOT,
      includeReviewCitations: true,
    })

    const paperRefs = listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId).filter(
      (r) => r.source.kind === 'paper',
    )
    // 2 条 cite（不同 <q>）→ 2 条独立 ref（allowMultiPerPaper），但必须指向**同一** paperId
    expect(paperRefs).toHaveLength(2)
    const paperIds = new Set(paperRefs.map((r) => r.source.id))
    expect(paperIds.size).toBe(1) // 关键断言：同篇折叠为一个 paper group，而非裂成两行
  })

  test('includeReviewCitations 缺省 → 即使 session 关联综述也仅落会话条目（修复同 session 普通 Q&A 误拖论文）', () => {
    // 核心回归：session 历史上产出过综述，但本次添加的是普通 Q&A 消息（UI 未传 flag）。
    // 旧逻辑会按 sessionId 反查 review → 误把所有被引论文拖入；新逻辑必须只落 1 条 conversation。
    const { repo } = openTestDb()
    const sessionId = 'sess-review-mixed'

    createPaper(repo, { title: 'Paper A Title', authors: ['Author A'], doi: '10.1234/a' })
    const bodyPath = writeReviewHtml('r-mixed', buildReviewHtml())
    createReview(repo, {
      title: 'T',
      intent: 'literature-review',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: sessionId,
      bodyPath,
    })

    const { evidenceSetId } = createSetWithConversation(repo, {
      name: '普通 Q&A 不应拖论文',
      sessionId,
      messageUuid: 'msg-followup-question',
      snapshotText: 'Q: 一个普通追问\n\nA: 普通回答',
      // 注意：**不传 includeReviewCitations**（UI 端 isReviewOutput=false 时不会传 true）
    })

    const { conversation, paper } = countByKind(
      listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId),
    )
    expect(conversation).toBe(1)
    expect(paper).toBe(0)
  })

  test('includeReviewCitations: false 显式传 false → 等价缺省，不带入', () => {
    const { repo } = openTestDb()
    const sessionId = 'sess-review-explicit-false'
    createPaper(repo, { title: 'Paper A Title', authors: ['Author A'], doi: '10.1234/a' })
    createReview(repo, {
      title: 'T',
      intent: 'literature-review',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: sessionId,
      bodyPath: writeReviewHtml('r-false', buildReviewHtml()),
    })

    const { evidenceSetId } = createSetWithConversation(repo, {
      name: '显式 false',
      sessionId,
      messageUuid: 'msg-q',
      snapshotText: QA_SNAPSHOT,
      includeReviewCitations: false,
    })

    const { conversation, paper } = countByKind(
      listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId),
    )
    expect(conversation).toBe(1)
    expect(paper).toBe(0)
  })

  test('session 无关联综述 → 仅会话条目（回归不破）', () => {
    const { repo } = openTestDb()
    const sessionId = 'sess-no-review'

    const { evidenceSetId } = createSetWithConversation(repo, {
      name: '空集合',
      sessionId,
      messageUuid: 'msg-x',
      snapshotText: QA_SNAPSHOT,
    })

    const { conversation, paper } = countByKind(
      listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId),
    )
    expect(conversation).toBe(1)
    expect(paper).toBe(0)
  })
})

describe('addConversationToSet —— 加入已有集合幂等', () => {
  test('重复加入同一综述会话 → paper ref 总数不变（(paperId, snapshotText) 二元组幂等）', () => {
    const { repo } = openTestDb()
    const sessionId = 'sess-review-2'
    createPaper(repo, { title: 'Paper A Title', authors: ['Author A'], doi: '10.1234/a' })
    const bodyPath = writeReviewHtml('r2', buildReviewHtml())
    createReview(repo, {
      title: 'T',
      intent: 'literature-review',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: sessionId,
      bodyPath,
    })

    // 先用新建路径建集合（综述消息 → includeReviewCitations: true）
    const { evidenceSetId } = createSetWithConversation(repo, {
      name: '集合',
      sessionId,
      messageUuid: 'msg-a',
      snapshotText: QA_SNAPSHOT,
      includeReviewCitations: true,
    })
    const after1 = countByKind(listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId))
    // v0.2.x：3 条 paper ref（2× ref-1 + 1× ref-2，按 cite 折）
    expect(after1.paper).toBe(3)

    // 再加入同一条 Q&A（幂等分支）+ 不同 Q&A（新增 conversation 但论文 (paperId, snapshotText) 二元组幂等）
    // 两次都模拟综述消息再加一次：includeReviewCitations: true
    addConversationToSet(repo, {
      setId: evidenceSetId,
      sessionId,
      messageUuid: 'msg-a',
      snapshotText: QA_SNAPSHOT,
      includeReviewCitations: true,
    })
    addConversationToSet(repo, {
      setId: evidenceSetId,
      sessionId,
      messageUuid: 'msg-b',
      snapshotText: 'Q: 再问\n\nA: 再答',
      includeReviewCitations: true,
    })

    const after2 = countByKind(listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId))
    // 论文仍是 3（同 (paperId, snapshotText) 二元组幂等），会话变成 2（msg-a + msg-b）
    expect(after2.paper).toBe(3)
    expect(after2.conversation).toBe(2)
  })

  test('addConversationToSet 缺省 flag → 不触发综述论文带入（关键回归）', () => {
    // 用户场景：session 已有综述（且综述消息此前已建过集合带入论文），再追问普通 Q&A
    // 并把追问消息加入同一集合时——不应额外触发综述路径。论文数维持原状（=3）；
    // 仅新增 1 条 conversation ref。
    const { repo } = openTestDb()
    const sessionId = 'sess-review-3'
    createPaper(repo, { title: 'Paper A Title', authors: ['Author A'], doi: '10.1234/a' })
    createReview(repo, {
      title: 'T',
      intent: 'literature-review',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: sessionId,
      bodyPath: writeReviewHtml('r3', buildReviewHtml()),
    })
    // 综述消息先建集合（带入 3 条 paper ref）
    const { evidenceSetId } = createSetWithConversation(repo, {
      name: 'C',
      sessionId,
      messageUuid: 'msg-review',
      snapshotText: QA_SNAPSHOT,
      includeReviewCitations: true,
    })
    const before = countByKind(listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId))
    expect(before.paper).toBe(3)
    expect(before.conversation).toBe(1)

    // 追问普通 Q&A 加入同一集合（UI 不传 flag）—— 不应再次触发综述路径
    addConversationToSet(repo, {
      setId: evidenceSetId,
      sessionId,
      messageUuid: 'msg-followup',
      snapshotText: 'Q: 再问\n\nA: 再答',
      // includeReviewCitations 缺省
    })

    const after = countByKind(listEvidenceRefsByTarget(repo, 'evidence-set', evidenceSetId))
    expect(after.paper).toBe(3) // 论文数不变
    expect(after.conversation).toBe(2) // 新增 1 条会话
  })
})
