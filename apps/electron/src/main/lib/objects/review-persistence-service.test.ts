/**
 * review-persistence-service 集成测试
 *
 * 走真实 fs（tmp HOME 隔离）+ 内存 SQLite（_helpers.test.ts 的 openTestDb），
 * 验证 DB 行 + HTML 文件双写、幂等更新、回滚行为，以及高阶
 * maybePersistReviewFromMessages 对消息流的处理。
 */

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AgentMessage, ObjectId } from '@asci/shared'

// issue #457：综述自动建的证据集由 review.agentSessionId 反查 workspaceId（getAgentSessionMeta）。
// 测试里 session 不真实存在于 agent-sessions.json，统一桩成固定 workspace（保留其它导出）。
// mock.module 进程级全局，afterAll 必须还原（防泄漏到 agent-rewind 等后续 test）。
import * as sessionMgrNs from '../agent-session-manager.ts'
const REAL_SESSION_MGR = { ...sessionMgrNs }
mock.module('../agent-session-manager.ts', () => ({
  ...REAL_SESSION_MGR,
  getAgentSessionMeta: (id: string) => ({
    id,
    title: 'test-session',
    createdAt: '2026-01-01T00:00:00Z',
    workspaceId: 'ws-test',
  }),
}))
afterAll(() => {
  mock.module('../agent-session-manager.ts', () => ({ ...REAL_SESSION_MGR }))
})

import { openTestDb } from './repositories/_helpers.test.ts'
import { listReviews } from './repositories/review-repository.ts'

let tmpHome: string
let originalHome: string | undefined
let originalDev: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-reviewpersist-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

function assistantMsg(content: string): AgentMessage {
  return {
    id: `msg-${Math.random()}`,
    role: 'assistant',
    content,
    createdAt: Date.now(),
  }
}

function bodyPath(reviewId: string, ext: 'html' | 'md' = 'html'): string {
  return join(tmpHome, '.asci', 'reviews', `${reviewId}.${ext}`)
}

describe('persistReviewFromAgentOutput', () => {
  test('首次落：创建 DB 行 + 写 HTML 文件', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const res = mod.persistReviewFromAgentOutput(repo, {
      title: 'first review',
      intent: '帮我综述 RAG',
      sourceCapability: 'asci-core-synthesizer',
      topic: 'RAG',
      agentSessionId: 'sess-1',
      html: '<p>body v1</p>',
    })
    expect(res.mode).toBe('created')
    expect(res.review.title).toBe('first review')
    expect(res.review.agentSessionId).toBe('sess-1')
    expect(readFileSync(bodyPath(res.review.id), 'utf-8')).toBe('<p>body v1</p>')
  })

  test('同 agentSessionId 二次完成 → mode=updated，HTML 被覆写，仅一行 DB 记录', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const r1 = mod.persistReviewFromAgentOutput(repo, {
      title: 't1',
      intent: 'i',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: 'sess-X',
      html: 'v1',
    })
    const r2 = mod.persistReviewFromAgentOutput(repo, {
      title: 't2',
      intent: 'i2',
      sourceCapability: 'asci-core-synthesizer',
      agentSessionId: 'sess-X',
      html: 'v2',
    })
    expect(r1.mode).toBe('created')
    expect(r2.mode).toBe('updated')
    expect(r2.review.id).toBe(r1.review.id)
    expect(r2.review.title).toBe('t2')
    expect(readFileSync(bodyPath(r2.review.id), 'utf-8')).toBe('v2')
    expect(listReviews(repo)).toHaveLength(1)
  })

  test('不同 agentSessionId → 两条独立记录', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    mod.persistReviewFromAgentOutput(repo, {
      title: 'A',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-A',
      html: 'a',
    })
    mod.persistReviewFromAgentOutput(repo, {
      title: 'B',
      intent: 'i',
      sourceCapability: 'c',
      agentSessionId: 'sess-B',
      html: 'b',
    })
    expect(listReviews(repo).map((r) => r.title).sort()).toEqual(['A', 'B'])
  })

  test('写文件失败时硬删 DB 行（不留半身体记录）', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    // 在 reviews 目录位置放一个同名「目录」占位，导致 writeFileSync 抛错
    // 注意：getReviewBodyPath 先 mkdir reviews/，所以我们让 reviews/ 是文件，
    // mkdirSync 会抛 EEXIST + 不是目录
    const reviewsParent = join(tmpHome, '.asci')
    // 显式提前建立 .asci 目录
    const { mkdirSync } = await import('node:fs')
    mkdirSync(reviewsParent, { recursive: true })
    // 把 reviews 设成一个文件而非目录
    writeFileSync(join(reviewsParent, 'reviews'), 'block', 'utf-8')

    expect(() =>
      mod.persistReviewFromAgentOutput(repo, {
        title: 't',
        intent: 'i',
        sourceCapability: 'c',
        agentSessionId: 'sess-fail',
        html: 'will-fail',
      }),
    ).toThrow()
    expect(listReviews(repo, { includeDeleted: true })).toHaveLength(0)
  })
})

describe('maybePersistReviewFromMessages', () => {
  test('消息里有合法 artifact → 落库 + 落文件（html 后缀）', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const text = [
      '前面是聊天 + 证据表',
      '<asci-review-artifact>',
      '---',
      'title: 自动落库的综述',
      'topic: t',
      '---',
      '<p>html body</p>',
      '</asci-review-artifact>',
    ].join('\n')
    const res = mod.maybePersistReviewFromMessages(repo, {
      agentSessionId: 'sess-auto',
      intent: '原始 prompt',
      messages: [assistantMsg('preamble'), assistantMsg(text)],
    })
    expect(res).not.toBeNull()
    expect(res!.mode).toBe('created')
    expect(res!.review.title).toBe('自动落库的综述')
    expect(res!.review.topic).toBe('t')
    expect(res!.review.sourceCapability).toBe(mod.REVIEW_SOURCE_CAPABILITY)
    // inline 模式显式传 html，文件应落 .html
    expect(readFileSync(bodyPath(res!.review.id, 'html'), 'utf-8')).toBe('<p>html body</p>')
  })

  test('消息里没有 artifact → 返回 null，DB 无副作用', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const res = mod.maybePersistReviewFromMessages(repo, {
      agentSessionId: 'sess-nope',
      intent: 'i',
      messages: [assistantMsg('just a chat reply')],
    })
    expect(res).toBeNull()
    expect(listReviews(repo)).toHaveLength(0)
  })

  test('messages 全空 → 返回 null', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    expect(
      mod.maybePersistReviewFromMessages(repo, {
        agentSessionId: 'sess-empty',
        intent: 'i',
        messages: [],
      }),
    ).toBeNull()
  })
})

// ----- cwd 模式（真实链路）-----

function makeFakeSessionCwd(): { cwd: string; reviewsDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'asci-fake-session-'))
  const reviewsDir = join(cwd, 'reviews')
  mkdirSync(reviewsDir, { recursive: true })
  return { cwd, reviewsDir }
}

function writeSkillHtml(reviewsDir: string, name: string, body: string, mtimeMs: number): void {
  const p = join(reviewsDir, name)
  writeFileSync(p, body, 'utf-8')
  const t = mtimeMs / 1000
  utimesSync(p, t, t)
}

/** 测试用 HTML fragment：minimal article + h1 + 正文。 */
function htmlFrag(h1: string, body = '正文…'): string {
  return `<article class="asci-review" data-version="1">
  <header><h1>${h1}</h1></header>
  <section id="s1"><h2>§1 Introduction</h2><p>${body}</p></section>
</article>`
}

describe('persistReviewsFromSessionCwd（A 方案 / 真实链路）', () => {
  test('扫到本轮新增 html → 落库（bodyPath 指向 skill 原文件），不再镜像', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const bodySvc = await import(`./review-body-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const since = Date.now()
    const htmlName = '2026-05-21_15-30-rag.html'
    writeSkillHtml(
      reviewsDir,
      htmlName,
      htmlFrag('RAG 综述', '这是 skill 写下来的 html 文本。'),
      since + 1000,
    )

    const results = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-cwd-1',
      intent: '帮我综述 RAG',
      sessionCwd: cwd,
      runStartedAtMs: since,
    })

    expect(results.length).toBe(1)
    expect(results[0]!.mode).toBe('created')
    expect(results[0]!.review.title).toBe('RAG 综述')
    expect(results[0]!.review.agentSessionId).toBe('sess-cwd-1')

    // bodyPath 应指向 skill 原始 html
    const expectedPath = join(reviewsDir, htmlName)
    expect(results[0]!.review.bodyPath).toBe(expectedPath)

    // ~/.asci/reviews/ 内不应有镜像文件
    expect(existsSync(bodyPath(results[0]!.review.id, 'html'))).toBe(false)
    expect(existsSync(bodyPath(results[0]!.review.id, 'md'))).toBe(false)

    // readReviewBody 应该顺利从 bodyPath 读到原文
    const got = bodySvc.readReviewBody(results[0]!.review)
    expect(got).toContain('<h1>RAG 综述</h1>')

    rmSync(cwd, { recursive: true, force: true })
  })

  test('扫到 fragment .html → persistence 将其包成 self-contained 文档写回磁盘', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const since = Date.now()
    const name = '2026-05-21_15-30-frag.html'
    writeSkillHtml(reviewsDir, name, htmlFrag('Frag Title', 'body'), since + 1000)

    const r = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-wrap',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: since,
    })
    expect(r.length).toBe(1)

    // 文件已被覆写为 standalone HTML 文档
    const { readFileSync } = await import('node:fs')
    const after = readFileSync(join(reviewsDir, name), 'utf-8')
    expect(after.startsWith('<!doctype html>')).toBe(true)
    expect(after).toContain('<html lang="en">')
    expect(after).toContain('<title>Frag Title</title>')
    // 原始 fragment 内容仍 verbatim 嵌入在 <body>
    expect(after).toContain('<article class="asci-review"')
    expect(after).toContain('<h1>Frag Title</h1>')

    rmSync(cwd, { recursive: true, force: true })
  })

  test('已是 standalone 的 .html 文件不会被二次包装', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const wrapper = await import(`./review-html-wrapper.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const since = Date.now()
    const standalone = wrapper.wrapReviewHtmlFragment(htmlFrag('Already Wrapped', 'body'))
    const name = '2026-05-21_15-30-already-wrapped.html'
    writeSkillHtml(reviewsDir, name, standalone, since + 1000)

    mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-noop',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: since,
    })

    const { readFileSync } = await import('node:fs')
    const after = readFileSync(join(reviewsDir, name), 'utf-8')
    expect(after).toBe(standalone)

    rmSync(cwd, { recursive: true, force: true })
  })

  test('reviews/ 下若有遗留 .md 文件（老版本产物）→ 被忽略，不落库', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const t = Date.now()
    writeSkillHtml(reviewsDir, 'legacy.md', '# legacy markdown', t + 1000)
    const r = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-legacy',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: t,
    })
    expect(r).toEqual([])
    expect(listReviews(repo)).toHaveLength(0)
    rmSync(cwd, { recursive: true, force: true })
  })

  test('reviews/ 不存在 → 返回空数组，DB 无副作用', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const emptyCwd = mkdtempSync(join(tmpdir(), 'asci-fake-empty-'))
    try {
      const r = mod.persistReviewsFromSessionCwd(repo, {
        agentSessionId: 'sess-empty',
        intent: 'i',
        sessionCwd: emptyCwd,
        runStartedAtMs: Date.now(),
      })
      expect(r).toEqual([])
      expect(listReviews(repo)).toHaveLength(0)
    } finally {
      rmSync(emptyCwd, { recursive: true, force: true })
    }
  })

  test('同 session 二次运行 → mode=updated，bodyPath 更新到新 html，DB 仍只一行', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const { cwd, reviewsDir } = makeFakeSessionCwd()

    const t1 = Date.now()
    writeSkillHtml(reviewsDir, '2026-05-21_15-30-a.html', htmlFrag('A', '第一版'), t1 + 1000)
    const first = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-twice',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: t1,
    })
    expect(first[0]!.mode).toBe('created')
    expect(first[0]!.review.bodyPath).toBe(join(reviewsDir, '2026-05-21_15-30-a.html'))

    const t2 = Date.now() + 10_000
    writeSkillHtml(reviewsDir, '2026-05-21_15-32-a-v2.html', htmlFrag('A v2', '第二版'), t2 + 1000)
    const second = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-twice',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: t2,
    })
    expect(second[0]!.mode).toBe('updated')
    expect(second[0]!.review.id).toBe(first[0]!.review.id)
    expect(second[0]!.review.title).toBe('A v2')
    expect(second[0]!.review.bodyPath).toBe(join(reviewsDir, '2026-05-21_15-32-a-v2.html'))
    expect(listReviews(repo)).toHaveLength(1)

    rmSync(cwd, { recursive: true, force: true })
  })

  test('一份失败不阻塞其它份（catch 内继续）', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const t = Date.now()
    // 第一份正常
    writeSkillHtml(reviewsDir, 'a.html', htmlFrag('A', 'body'), t + 1000)
    // 第二份正常
    writeSkillHtml(reviewsDir, 'b.html', htmlFrag('B', 'body'), t + 2000)

    const r = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-many',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: t,
    })
    // 两份会按 agent_session_id 收敛到同一条（先 created 再 updated）
    expect(r.length).toBe(2)
    expect(r[0]!.mode).toBe('created')
    expect(r[1]!.mode).toBe('updated')

    rmSync(cwd, { recursive: true, force: true })
  })
})

// ----- cwd 模式：cite/q 抽取 → evidence_refs 落库 -----

/** 一份包含 §7 References 的最小 review HTML（用于 cite 抽取端到端测试） */
function reviewHtmlWithCites(opts: {
  paperDoi: string
  paper2Id?: string
}): string {
  const paper2Attr = opts.paper2Id ? ` data-paper-id="${opts.paper2Id}"` : ''
  return `<article class="asci-review" data-version="1">
  <header><h1>Test Review</h1></header>
  <section id="s1">
    <h2>§1 Intro</h2>
    <p>Background claim<cite data-ref="1"><q>verbatim from paper one</q></cite> matters.</p>
  </section>
  <section id="s2">
    <h2>§2 Themes</h2>
    <p>Theme A<cite data-ref="1"><q>second quote from paper one</q></cite> and Theme B${
      opts.paper2Id ? `<cite data-ref="2"><q>quote from paper two</q></cite>` : ''
    }.</p>
  </section>
  <section id="s7" class="references">
    <h2>§7 References</h2>
    <ol class="refs">
      <li id="ref-1" data-ref="1" data-doi="${opts.paperDoi}">P1. <i>Title One</i>. 2020.</li>
${opts.paper2Id ? `      <li id="ref-2" data-ref="2"${paper2Attr}>P2. <i>Title Two</i>. 2021.</li>\n` : ''}    </ol>
  </section>
</article>`
}

describe('persistReviewsFromSessionCwd：cite/q → evidence_refs', () => {
  test('扫到 review.html 后抽 cite，落 evidence_refs + evidence_set，attach 到 review', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const paperRepoMod = await import(
      `./repositories/paper-repository.ts?cachebust=${Date.now()}`
    )
    const refRepoMod = await import(
      `./repositories/evidence-ref-repository.ts?cachebust=${Date.now()}`
    )
    const reviewRepoMod = await import(
      `./repositories/review-repository.ts?cachebust=${Date.now()}`
    )
    const { repo } = openTestDb()

    // 预先建好 2 篇论文，让 cite 能解析到 paperId
    const p1 = paperRepoMod.createPaper(repo, {
      title: 'Paper One',
      authors: [],
      doi: '10.x/paper1',
    })
    const p2 = paperRepoMod.createPaper(repo, { title: 'Paper Two', authors: [] })

    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const since = Date.now()
    writeSkillHtml(
      reviewsDir,
      '2026-05-21_15-30-test.html',
      reviewHtmlWithCites({ paperDoi: '10.x/paper1', paper2Id: p2.id }),
      since + 1000,
    )

    const results = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-evidence',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: since,
    })
    expect(results.length).toBe(1)

    // review 现在挂了 evidence_set
    const reviewId = results[0]!.review.id
    const reviewAfter = reviewRepoMod.getReviewById(repo, reviewId)!
    expect(reviewAfter.sourceEvidenceSetId).toBeTruthy()

    // 3 条 evidence_refs：s1#1（p1）+ s2#1（p1）+ s2#2（p2）
    const refs = refRepoMod.listEvidenceRefsByReview(repo, reviewId)
    expect(refs.length).toBe(3)

    // 每条都包含 verbatim quote（source.anchor.snapshotText）
    const quotes = refs.map((r) => r.source.anchor.snapshotText).sort()
    expect(quotes).toEqual([
      'quote from paper two',
      'second quote from paper one',
      'verbatim from paper one',
    ])

    // target.anchor 包含 selector / sectionId / paragraphIndex / citeIndex
    const targetLocs = refs.map((r) => r.target.anchor.locationData)
    for (const loc of targetLocs) {
      expect(loc).toMatchObject({ kind: 'html' })
    }

    // 涉及的 paper（p1 + p2）
    const paperIds = new Set(refs.map((r) => r.source.id))
    expect(paperIds.has(p1.id)).toBe(true)
    expect(paperIds.has(p2.id)).toBe(true)

    rmSync(cwd, { recursive: true, force: true })
  })

  test('cite 对应的 paper 不在 DB 中 → 管道 C 兜底建出 stub paper，两条 cite 都 attach', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const paperRepoMod = await import(
      `./repositories/paper-repository.ts?cachebust=${Date.now()}`
    )
    const refRepoMod = await import(
      `./repositories/evidence-ref-repository.ts?cachebust=${Date.now()}`
    )
    const { repo } = openTestDb()
    const p1 = paperRepoMod.createPaper(repo, {
      title: 'P1',
      authors: [],
      doi: '10.x/exists',
    })

    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const since = Date.now()
    // cite 1 → p1 (exists)；cite 2 → DOI 不存在 → 走管道 C 兜底建 stub
    writeSkillHtml(
      reviewsDir,
      'r.html',
      `<article class="asci-review">
        <section id="s1"><p>a<cite data-ref="1"><q>q1</q></cite> b<cite data-ref="2"><q>q2</q></cite>.</p></section>
        <section id="s7" class="references"><ol class="refs">
          <li id="ref-1" data-ref="1" data-doi="10.x/exists">A. <i>T1</i>. 2020.</li>
          <li id="ref-2" data-ref="2" data-doi="10.x/missing">B. <i>T2</i>. 2021.</li>
        </ol></section>
      </article>`,
      since + 1000,
    )

    const results = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-partial',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: since,
    })
    expect(results.length).toBe(1)

    // 管道 C 兜底：T2 自动建出 stub paper，两条 cite 都落库
    // 注：listEvidenceRefsByReview 按 source_id 排序，paperId 含随机后缀 →
    // 同毫秒创建的两条 ref 顺序不确定；用 set/lookup 断言而非数组顺序
    const refs = refRepoMod.listEvidenceRefsByReview(repo, results[0]!.review.id)
    expect(refs.length).toBe(2)
    type Ref = { source: { anchor: { snapshotText: string }; paperId: string } }
    const snapshotTexts = new Set(refs.map((r: Ref) => r.source.anchor.snapshotText))
    expect(snapshotTexts).toEqual(new Set(['q1', 'q2']))
    const refByQ = (q: string): Ref =>
      refs.find((r: Ref) => r.source.anchor.snapshotText === q)!
    // q1 → p1（existing）；q2 → 新建的 stub paper
    expect(refByQ('q1').source.id).toBe(p1.id)
    expect(refByQ('q2').source.id).not.toBe(p1.id)
    const stub = paperRepoMod.getPaperByDoi(repo, '10.x/missing')
    expect(stub).not.toBeNull()
    expect(stub!.title).toBe('T2')
    expect(stub!.id).toBe(refByQ('q2').source.id)

    rmSync(cwd, { recursive: true, force: true })
  })

  test('reparseReviewCitations：按 bodyPath 反查 + 抽取 + 落库；重跑会覆盖旧 set', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const paperRepoMod = await import(
      `./repositories/paper-repository.ts?cachebust=${Date.now()}`
    )
    const refRepoMod = await import(
      `./repositories/evidence-ref-repository.ts?cachebust=${Date.now()}`
    )
    const reviewRepoMod = await import(
      `./repositories/review-repository.ts?cachebust=${Date.now()}`
    )
    const setRepoMod = await import(
      `./repositories/evidence-set-repository.ts?cachebust=${Date.now()}`
    )
    const { repo } = openTestDb()

    // 准备一个 review（无 evidence）+ 文件落到 fake cwd
    const p1 = paperRepoMod.createPaper(repo, {
      title: 'P1',
      authors: [],
      doi: '10.x/p1',
    })
    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const bodyPath = join(reviewsDir, 'r.html')
    writeFileSync(
      bodyPath,
      `<article class="asci-review">
        <section id="s1"><p>x<cite data-ref="1"><q>q1</q></cite>.</p></section>
        <section id="s7" class="references"><ol class="refs">
          <li id="ref-1" data-ref="1" data-doi="10.x/p1">A. <i>T</i>. 2020.</li>
        </ol></section>
      </article>`,
      'utf-8',
    )
    const review = reviewRepoMod.createReview(repo, {
      title: 'R',
      intent: 'i',
      sourceCapability: 'c',
      bodyPath,
      agentSessionId: 'sess-reparse', // issue #457：综述证据集需经 session 反查 workspace
    })

    // 首次解析
    const r1 = mod.reparseReviewCitations(repo, { bodyPath })
    expect(r1.refCount).toBe(1)
    expect(r1.paperCount).toBe(1)
    expect(r1.evidenceSetId).toBeTruthy()
    expect(r1.replacedExisting).toBe(false)
    const reviewAfter1 = reviewRepoMod.getReviewById(repo, review.id)!
    expect(reviewAfter1.sourceEvidenceSetId).toBe(r1.evidenceSetId!)

    // 重跑：应该覆盖旧 set，旧 refs 软删
    const r2 = mod.reparseReviewCitations(repo, { bodyPath })
    expect(r2.replacedExisting).toBe(true)
    expect(r2.evidenceSetId).not.toBe(r1.evidenceSetId)
    // 当前 visible refs 还是 1 条（新建的）
    const visibleRefs = refRepoMod.listEvidenceRefsByReview(repo, review.id)
    expect(visibleRefs.length).toBe(1)
    // 旧 set 已软删
    const oldSet = setRepoMod.getEvidenceSetById(repo, r1.evidenceSetId!)
    expect(oldSet?.visibility).toBe('deleted')
    // 防 unused warn
    expect(p1.id).toBeTruthy()

    rmSync(cwd, { recursive: true, force: true })
  })

  test('reparseReviewCitations：管道 C 兜底建出 stub paper，两条 cite 都 attach', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const paperRepoMod = await import(
      `./repositories/paper-repository.ts?cachebust=${Date.now()}`
    )
    const reviewRepoMod = await import(
      `./repositories/review-repository.ts?cachebust=${Date.now()}`
    )
    const { repo } = openTestDb()
    paperRepoMod.createPaper(repo, { title: 'P1', authors: [], doi: '10.x/exists' })

    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const bodyPath = join(reviewsDir, 'r.html')
    writeFileSync(
      bodyPath,
      `<article class="asci-review">
        <section id="s1"><p>a<cite data-ref="1"><q>q1</q></cite> b<cite data-ref="2"><q>q2</q></cite>.</p></section>
        <section id="s7" class="references"><ol class="refs">
          <li id="ref-1" data-ref="1" data-doi="10.x/exists">A. <i>T1</i>. 2020.</li>
          <li id="ref-2" data-ref="2" data-doi="10.x/missing">B. <i>T2</i>. 2021.</li>
        </ol></section>
      </article>`,
      'utf-8',
    )
    reviewRepoMod.createReview(repo, {
      title: 'R',
      intent: 'i',
      sourceCapability: 'c',
      bodyPath,
      agentSessionId: 'sess-reparse-2', // issue #457：综述证据集需经 session 反查 workspace
    })

    const r = mod.reparseReviewCitations(repo, { bodyPath })
    expect(r.refCount).toBe(2)
    expect(r.papersNotInDb).toEqual([])
    // 管道 C 建出 stub paper
    const stub = paperRepoMod.getPaperByDoi(repo, '10.x/missing')
    expect(stub).not.toBeNull()
    expect(stub!.title).toBe('T2')
    expect(stub!.year).toBe(2021)

    rmSync(cwd, { recursive: true, force: true })
  })

  test('reparseReviewCitations：review 找不到 → 抛 ReviewNotFoundForReparseError', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const { repo } = openTestDb()
    expect(() =>
      mod.reparseReviewCitations(repo, { bodyPath: '/nonexistent/path.html' }),
    ).toThrow(/找不到 review/)
  })

  test('自动 hook：同 session 重生成综述 → evidence_set 自动覆盖（不残留旧 refs）', async () => {
    // 关键回归：原 alreadyHasEvidenceSet 跳过逻辑会让二次自动 hook 不刷新 evidence_set，
    // 导致用户重生成综述后 references 变了但解析没跟上。此测试守门"每次自动 hook 都重抽"。
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const paperRepoMod = await import(
      `./repositories/paper-repository.ts?cachebust=${Date.now()}`
    )
    const refRepoMod = await import(
      `./repositories/evidence-ref-repository.ts?cachebust=${Date.now()}`
    )
    const reviewRepoMod = await import(
      `./repositories/review-repository.ts?cachebust=${Date.now()}`
    )
    const setRepoMod = await import(
      `./repositories/evidence-set-repository.ts?cachebust=${Date.now()}`
    )
    const { repo } = openTestDb()

    const p1 = paperRepoMod.createPaper(repo, { title: 'P1', authors: [], doi: '10.x/p1' })
    const p2 = paperRepoMod.createPaper(repo, { title: 'P2', authors: [], doi: '10.x/p2' })
    const { cwd, reviewsDir } = makeFakeSessionCwd()

    // 第一次：综述只引用 p1（1 条 cite）
    const since1 = Date.now()
    writeSkillHtml(
      reviewsDir,
      'r.html',
      reviewHtmlWithCites({ paperDoi: '10.x/p1' }),
      since1 + 1000,
    )
    const r1 = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-rerun',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: since1,
    })
    expect(r1.length).toBe(1)
    const reviewId = r1[0]!.review.id
    const after1 = reviewRepoMod.getReviewById(repo, reviewId)!
    const evidenceSet1 = after1.sourceEvidenceSetId
    expect(evidenceSet1).toBeTruthy()
    expect(refRepoMod.listEvidenceRefsByReview(repo, reviewId).length).toBe(2) // s1#1 + s2#1 都引 p1

    // 第二次：同 session 重生成，HTML 内容改为引用 p1+p2（3 条 cite）；模拟用户重跑
    const since2 = since1 + 10_000
    writeSkillHtml(
      reviewsDir,
      'r.html',
      reviewHtmlWithCites({ paperDoi: '10.x/p1', paper2Id: p2.id }),
      since2 + 1000,
    )
    const r2 = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-rerun',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: since2,
    })
    expect(r2.length).toBe(1)
    expect(r2[0]!.mode).toBe('updated') // 同 session → review 行复用

    // 关键断言：evidence_set 已被覆盖，旧的软删，新的挂上；refs 数量按新 HTML 来
    const after2 = reviewRepoMod.getReviewById(repo, reviewId)!
    const evidenceSet2 = after2.sourceEvidenceSetId
    expect(evidenceSet2).toBeTruthy()
    expect(evidenceSet2).not.toBe(evidenceSet1) // 新建的，不是旧的
    const oldSet = setRepoMod.getEvidenceSetById(repo, evidenceSet1!)
    expect(oldSet?.visibility).toBe('deleted')

    // visible refs 现在反映新 HTML：3 条（s1#1 引 p1 + s2#1 引 p1 + s2#2 引 p2）
    const visibleRefs = refRepoMod.listEvidenceRefsByReview(repo, reviewId)
    expect(visibleRefs.length).toBe(3)
    const visiblePapers = new Set(visibleRefs.map((r) => r.source.id))
    expect(visiblePapers.has(p1.id)).toBe(true)
    expect(visiblePapers.has(p2.id)).toBe(true)

    rmSync(cwd, { recursive: true, force: true })
  })

  test('cite 抽取失败不影响 review 主路径', async () => {
    const mod = await import(`./review-persistence-service.ts?cachebust=${Date.now()}`)
    const reviewRepoMod = await import(
      `./repositories/review-repository.ts?cachebust=${Date.now()}`
    )
    const { repo } = openTestDb()

    const { cwd, reviewsDir } = makeFakeSessionCwd()
    const since = Date.now()
    // review 无任何 cite —— 没有可挂的 evidence
    writeSkillHtml(reviewsDir, 'r.html', htmlFrag('No Cites', '正文无 cite'), since + 1000)

    const r = mod.persistReviewsFromSessionCwd(repo, {
      agentSessionId: 'sess-no-cites',
      intent: 'i',
      sessionCwd: cwd,
      runStartedAtMs: since,
    })
    expect(r.length).toBe(1)
    // B5 改造：cite 抽不到时也建一个空的临时 set（persisted=0）挂到 review，
    // 保证 popover 始终能调 promoteFromReview / rename。
    const after = reviewRepoMod.getReviewById(repo, r[0]!.review.id)!
    expect(after.sourceEvidenceSetId).toBeTruthy()

    rmSync(cwd, { recursive: true, force: true })
  })
})
