import { test, expect } from 'bun:test'
import type { Paper } from '@asci/shared'
import { paperIdentityTokens, groupBySharedIdentity } from './evidence-paper-grouping.ts'

function paper(partial: Partial<Paper>): Paper {
  return {
    id: 'p-x',
    title: '',
    authors: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Paper
}

// ---- paperIdentityTokens ----

test('present paper：doi/zoteroKey/标题各产一个 token；doi 小写、标题归一', () => {
  expect(paperIdentityTokens(paper({ doi: '10.1/X', zoteroKey: 'ZK', title: 'A  B' }))).toEqual([
    'doi:10.1/x',
    'zk:ZK',
    't:a b',
  ])
})

test('removed 占位：用 removedTitle 产标题 token', () => {
  expect(paperIdentityTokens(null, '  Attention  Is All ')).toEqual(['t:attention is all'])
})

test('无任何身份 → 空数组（调用方让其独立成组）', () => {
  expect(paperIdentityTokens(paper({ id: 'only-id' }))).toEqual([])
  expect(paperIdentityTokens(null, undefined)).toEqual([])
})

// ---- groupBySharedIdentity（并查集）----

test('一行带 doi、一行带 zoteroKey，但标题相同 → 桥接合并为同一组（核心场景）', () => {
  const tokens = [
    paperIdentityTokens(paper({ id: 'lit', doi: '10.1/attn', title: 'Attention Is All You Need' })),
    paperIdentityTokens(paper({ id: 'rev', zoteroKey: 'ZK1', title: 'Attention Is All You Need' })),
  ]
  const groups = groupBySharedIdentity(tokens)
  expect(groups[0]).toBe(groups[1]) // 同组
})

test('doi 相同 → 合并；完全无关 → 各自独立', () => {
  const groups = groupBySharedIdentity([
    paperIdentityTokens(paper({ id: 'a', doi: '10.1/x', title: 'X' })),
    paperIdentityTokens(paper({ id: 'b', doi: '10.1/X', title: 'X dup' })), // 同 doi
    paperIdentityTokens(paper({ id: 'c', doi: '10.9/y', title: 'Y' })), // 无关
  ])
  expect(groups[0]).toBe(groups[1])
  expect(groups[0]).not.toBe(groups[2])
})

test('传递性桥接：A(doi=D) — B(doi=D,zk=Z) — C(zk=Z) 三者并为一组', () => {
  const groups = groupBySharedIdentity([
    paperIdentityTokens(paper({ id: 'a', doi: '10/d' })),
    paperIdentityTokens(paper({ id: 'b', doi: '10/d', zoteroKey: 'Z' })),
    paperIdentityTokens(paper({ id: 'c', zoteroKey: 'Z' })),
  ])
  expect(groups[0]).toBe(groups[1])
  expect(groups[1]).toBe(groups[2])
})

test('组号 = 组内首条 ref 下标（稳定排序）', () => {
  const groups = groupBySharedIdentity([
    paperIdentityTokens(paper({ id: 'a', title: 'Same' })),
    paperIdentityTokens(paper({ id: 'b', title: 'Other' })),
    paperIdentityTokens(paper({ id: 'c', title: 'Same' })),
  ])
  expect(groups[0]).toBe(0)
  expect(groups[2]).toBe(0) // 与下标 0 同组
  expect(groups[1]).toBe(1)
})

test('空 token 列表的 ref 各自独立（不会被误并）', () => {
  const groups = groupBySharedIdentity([[], [], []])
  expect(new Set(groups).size).toBe(3)
})
