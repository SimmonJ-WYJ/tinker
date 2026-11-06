import { test, expect } from 'bun:test'
import { selectRightPanelPdfEvidence } from './useRightPanelPdfEvidence.ts'

const PDF = '/tmp/papers/foo.pdf'
const OTHER = '/tmp/papers/bar.pdf'

test('无信号 → 空高亮、无 pending', () => {
  const r = selectRightPanelPdfEvidence(PDF, null, null)
  expect(r.quoteHighlights).toEqual([])
  expect(r.pendingScrollNoteId).toBeNull()
})

test('持续高亮命中当前 path → 进 quoteHighlights，id 用 evidence:traceId', () => {
  const r = selectRightPanelPdfEvidence(
    PDF,
    { path: PDF, quote: 'improves accuracy by 23%', traceId: 'msg#3' },
    null,
  )
  expect(r.quoteHighlights).toEqual([{ id: 'evidence:msg#3', quote: 'improves accuracy by 23%' }])
  expect(r.pendingScrollNoteId).toBeNull()
})

test('持续高亮属于别的 PDF → 不渲染（path 门控）', () => {
  const r = selectRightPanelPdfEvidence(
    PDF,
    { path: OTHER, quote: 'x', traceId: 'm#1' },
    null,
  )
  expect(r.quoteHighlights).toEqual([])
})

test('一次性滚动命中 → 给 pendingScrollNoteId，且该 id 在 quoteHighlights 里（供扫页反查）', () => {
  const r = selectRightPanelPdfEvidence(
    PDF,
    null,
    { path: PDF, quote: 'the quote', traceId: 'msg#5' },
  )
  expect(r.pendingScrollNoteId).toBe('evidence:msg#5')
  expect(r.quoteHighlights).toContainEqual({ id: 'evidence:msg#5', quote: 'the quote' })
})

test('滚动属于别的 PDF → 无 pending', () => {
  const r = selectRightPanelPdfEvidence(
    PDF,
    null,
    { path: OTHER, quote: 'q', traceId: 'm#9' },
  )
  expect(r.pendingScrollNoteId).toBeNull()
  expect(r.quoteHighlights).toEqual([])
})

test('高亮与滚动同 traceId → quoteHighlights 不重复', () => {
  const sig = { path: PDF, quote: 'same', traceId: 'msg#7' }
  const r = selectRightPanelPdfEvidence(PDF, sig, sig)
  expect(r.quoteHighlights).toEqual([{ id: 'evidence:msg#7', quote: 'same' }])
  expect(r.pendingScrollNoteId).toBe('evidence:msg#7')
})

test('空 quote 不产生高亮', () => {
  const r = selectRightPanelPdfEvidence(
    PDF,
    { path: PDF, quote: '', traceId: 'm#1' },
    { path: PDF, quote: '', traceId: 'm#1' },
  )
  expect(r.quoteHighlights).toEqual([])
  expect(r.pendingScrollNoteId).toBeNull()
})
