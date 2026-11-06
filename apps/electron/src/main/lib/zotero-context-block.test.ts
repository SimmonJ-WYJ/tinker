import { test, expect } from 'bun:test'
import { buildZoteroContextBlock } from './zotero-context-block.ts'

test('两数组均空返回 null', () => {
  expect(buildZoteroContextBlock(undefined, undefined)).toBeNull()
  expect(buildZoteroContextBlock([], [])).toBeNull()
})

test('只含条目', () => {
  const out = buildZoteroContextBlock(
    [{ key: 'A1', title: 'Attention', creators: ['Vaswani', 'Shazeer', 'Parmar', 'Uszkoreit'], date: '2017-06-12' }],
    [],
  )
  expect(out).toContain('<zotero-context>')
  expect(out).toContain('key=A1')
  expect(out).toContain('《Attention》')
  expect(out).toContain('Vaswani, Shazeer, Parmar et al.')
  expect(out).toContain('2017')
  expect(out).not.toContain('<mentioned-collections>')
})

test('只含类目', () => {
  const out = buildZoteroContextBlock(
    undefined,
    [{ key: 'C1', name: 'Transformers', path: 'Papers / Transformers' }],
  )
  expect(out).toContain('<mentioned-collections>')
  expect(out).toContain('key=C1')
  expect(out).toContain('路径: Papers / Transformers')
  expect(out).not.toContain('<mentioned-items>')
  // 仅有 collection 时显式禁令，引导 agent 先 list 再读
  expect(out).toContain('<itemkey-constraint>')
  expect(out).toContain('zotero_list_collection_items')
  expect(out).toContain('禁止从对话上下文推测/编造 itemKey')
})

test('有条目时也带禁令但允许 mentioned 列出的 key', () => {
  const out = buildZoteroContextBlock(
    [{ key: 'A1', title: 'T', creators: ['A'] }],
    undefined,
  )
  expect(out).toContain('<itemkey-constraint>')
  expect(out).toContain('mentioned-items')
})

test('3 位以内作者完整显示', () => {
  const out = buildZoteroContextBlock(
    [{ key: 'X', title: 'Short', creators: ['A', 'B'], date: '2024' }],
    undefined,
  )
  expect(out).toContain('A, B')
  expect(out).not.toContain('et al.')
})

test('条目无年份时只显示作者', () => {
  const out = buildZoteroContextBlock(
    [{ key: 'X', title: 'T', creators: ['A'] }],
    undefined,
  )
  expect(out).toContain('A')
  expect(out).not.toContain('· ·')
})
