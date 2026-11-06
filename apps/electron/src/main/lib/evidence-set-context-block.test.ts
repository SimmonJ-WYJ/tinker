import { describe, expect, it } from 'bun:test'
import type { EvidenceSetDetail } from '@asci/shared'
import { buildEvidenceSetContextBlock } from './evidence-set-context-block.ts'

// 构造最小可用的 EvidenceSetDetail，仅填本块序列化用到的字段。
// 其余 ObjectMeta 字段用 cast 收口，避免在测试里铺设无关样板。
function makeDetail(over: {
  id?: string
  name?: string | null
  noteBody?: string
  papers?: Array<{ title: string; authors?: string[]; year?: number; zoteroKey?: string }>
  reviewTitles?: string[]
  quotes?: Array<{
    kind: 'paper' | 'review' | 'conversation'
    text: string
    removed?: boolean
    /** 模拟查询层判伪归一（issue #446）：派生 quote 为空串，raw anchor 保留原值 */
    sanitizedAway?: boolean
  }>
}): EvidenceSetDetail {
  const refs = (over.quotes ?? []).map((q) => ({
    ref: {
      source: { kind: q.kind, id: 'src', anchor: { snapshotText: q.text } },
      target: { kind: 'evidence-set', id: over.id ?? 's1' },
    },
    sourcePaper: q.removed
      ? { state: 'removed', id: 'p', removedAt: '2026-01-01' }
      : { state: 'present', ref: { title: 'P' } },
    quote: q.sanitizedAway ? '' : q.text,
  }))
  return {
    set: { id: over.id ?? 's1', name: over.name === undefined ? 'My Set' : over.name, persisted: true },
    note: over.noteBody !== undefined ? { body: over.noteBody } : null,
    refs,
    memberPapers: (over.papers ?? []).map((p) => ({
      title: p.title,
      authors: p.authors ?? [],
      year: p.year,
      zoteroKey: p.zoteroKey,
    })),
    memberReviews: (over.reviewTitles ?? []).map((title) => ({ title })),
    memberConversations: [],
    sourceReview: null,
  } as unknown as EvidenceSetDetail
}

describe('buildEvidenceSetContextBlock', () => {
  it('空输入返回 null', () => {
    expect(buildEvidenceSetContextBlock([])).toBeNull()
  })

  it('单个证据集输出名字 / 动机 / 成员 / 引文', () => {
    const out = buildEvidenceSetContextBlock([
      makeDetail({
        name: 'Transformers',
        noteBody: 'Survey of attention mechanisms',
        papers: [{ title: 'Attention Is All You Need', authors: ['Vaswani', 'Shazeer', 'Parmar', 'Uszkoreit'], year: 2017, zoteroKey: 'ABCD' }],
        reviewTitles: ['My Review'],
        quotes: [{ kind: 'paper', text: 'The Transformer relies entirely on self-attention.' }],
      }),
    ])
    expect(out).not.toBeNull()
    expect(out!).toContain('<evidence-set-context>')
    expect(out!).toContain('</evidence-set-context>')
    expect(out!).toContain('Transformers')
    expect(out!).toContain('Survey of attention mechanisms')
    expect(out!).toContain('Attention Is All You Need')
    expect(out!).toContain('zoteroKey=ABCD')
    // 4 名作者 → 截断为 et al.
    expect(out!).toContain('et al.')
    expect(out!).toContain('My Review')
    expect(out!).toContain('The Transformer relies entirely on self-attention.')
  })

  it('引文超过上限时截断并标注省略数', () => {
    const quotes = Array.from({ length: 25 }, (_, i) => ({ kind: 'paper' as const, text: `quote-${i}` }))
    const out = buildEvidenceSetContextBlock([makeDetail({ quotes })])
    expect(out!).toContain('quote-0')
    expect(out!).toContain('quote-19')
    expect(out!).not.toContain('quote-24')
    // 25 - 20 = 5 条省略
    expect(out!).toMatch(/5 more/)
  })

  it('单条超长引文按字符截断', () => {
    const long = 'x'.repeat(2000)
    const out = buildEvidenceSetContextBlock([makeDetail({ quotes: [{ kind: 'paper', text: long }] })])
    // 截断后远小于原始长度
    expect(out!.length).toBeLessThan(1500)
    expect(out!).toContain('…')
  })

  it('多个证据集各自成块', () => {
    const out = buildEvidenceSetContextBlock([
      makeDetail({ id: 'a', name: 'Set A' }),
      makeDetail({ id: 'b', name: 'Set B' }),
    ])
    expect(out!).toContain('Set A')
    expect(out!).toContain('Set B')
    expect(out!.match(/<evidence-set /g)?.length).toBe(2)
  })

  it('无名集合（name 为 null）回退到占位名', () => {
    const out = buildEvidenceSetContextBlock([makeDetail({ name: null })])
    expect(out!).toContain('Untitled evidence set')
  })

  it('查询层判伪归一的引文（quote 为空串）不注入，即便 raw anchor 仍有值（issue #446）', () => {
    const out = buildEvidenceSetContextBlock([
      makeDetail({
        quotes: [
          { kind: 'paper', text: 'forged-from-note-body', sanitizedAway: true },
          { kind: 'paper', text: 'real excerpt' },
        ],
      }),
    ])
    expect(out!).not.toContain('forged-from-note-body')
    expect(out!).toContain('real excerpt')
  })
})
