import { describe, expect, it } from 'bun:test'
import { buildQaSnapshot, parseQaSnapshot } from './qa-snapshot'

describe('qa-snapshot', () => {
  it('build → parse 往返：有问句', () => {
    const s = buildQaSnapshot({ question: '什么是 RAG?', answer: '**RAG** 是…' })
    expect(s).toBe('Q: 什么是 RAG?\n\nA: **RAG** 是…')
    expect(parseQaSnapshot(s)).toEqual({ question: '什么是 RAG?', answer: '**RAG** 是…' })
  })

  it('build → parse 往返：无问句退化为 A:', () => {
    const s = buildQaSnapshot({ question: '', answer: '开场白' })
    expect(s).toBe('A: 开场白')
    expect(parseQaSnapshot(s)).toEqual({ question: null, answer: '开场白' })
  })

  it('答案含多段 markdown（表格/标题）保持 verbatim', () => {
    const answer = '### 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |'
    const parsed = parseQaSnapshot(buildQaSnapshot({ question: 'Q', answer }))
    expect(parsed.answer).toBe(answer)
  })

  it('不符合约定的整段 → 兜底为 answer', () => {
    expect(parseQaSnapshot('随便一段文本')).toEqual({ question: null, answer: '随便一段文本' })
  })
})
