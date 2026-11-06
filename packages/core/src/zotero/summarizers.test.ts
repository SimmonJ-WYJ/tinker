import { test, expect } from 'bun:test'
import { creatorDisplayName, summarizeItem, detailItem, summarizeCollection } from './summarizers.ts'
import type { ZoteroItem, ZoteroCollection } from './types.ts'

test('creatorDisplayName 优先使用 name', () => {
  expect(creatorDisplayName({ creatorType: 'author', name: 'Smith Lab' })).toBe('Smith Lab')
})

test('creatorDisplayName 拼 firstName + lastName', () => {
  expect(creatorDisplayName({ creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' })).toBe('Ashish Vaswani')
})

test('creatorDisplayName 只有 firstName', () => {
  expect(creatorDisplayName({ creatorType: 'author', firstName: 'A' })).toBe('A')
})

test('creatorDisplayName 只有 lastName', () => {
  expect(creatorDisplayName({ creatorType: 'author', lastName: 'V' })).toBe('V')
})

test('creatorDisplayName 全空 → 空串', () => {
  expect(creatorDisplayName({ creatorType: 'author' })).toBe('')
})

test('summarizeItem 返回预期字段', () => {
  const item: ZoteroItem = {
    key: 'ABC', version: 1,
    data: {
      itemType: 'journalArticle',
      title: 'T',
      creators: [{ creatorType: 'author', firstName: 'A', lastName: 'B' }],
      date: '2020',
      tags: [{ tag: 'ml' }],
      collections: ['C1'],
    },
  }
  expect(summarizeItem(item)).toEqual({
    key: 'ABC',
    title: 'T',
    creators: ['A B'],
    date: '2020',
    tags: ['ml'],
    collections: ['C1'],
  })
})

test('summarizeItem title 缺省时回退', () => {
  const item: ZoteroItem = { key: 'X', version: 1, data: { itemType: 'x' } }
  expect(summarizeItem(item).title).toBe('(无标题)')
})

test('summarizeItem 过滤全空 creator', () => {
  const item: ZoteroItem = {
    key: 'X', version: 1,
    data: { itemType: 'x', creators: [{ creatorType: 'author' }, { creatorType: 'author', name: 'Real' }] },
  }
  expect(summarizeItem(item).creators).toEqual(['Real'])
})

test('detailItem 返回扩展字段', () => {
  const item: ZoteroItem = {
    key: 'X', version: 1,
    data: { itemType: 'article', title: 't', abstractNote: 'abs', DOI: '10.x', url: 'http://x' },
  }
  const result = detailItem(item)
  expect(result.itemType).toBe('article')
  expect(result.abstract).toBe('abs')
  expect(result.doi).toBe('10.x')
  expect(result.url).toBe('http://x')
})

test('summarizeCollection parentCollection=false → parentKey=null', () => {
  const coll: ZoteroCollection = {
    key: 'A', version: 1,
    data: { name: 'Root', parentCollection: false },
  }
  expect(summarizeCollection(coll)).toEqual({ key: 'A', name: 'Root', parentKey: null })
})

test('summarizeCollection parentCollection=string → parentKey=string', () => {
  const coll: ZoteroCollection = {
    key: 'B', version: 1,
    data: { name: 'Child', parentCollection: 'A' },
  }
  expect(summarizeCollection(coll)).toEqual({ key: 'B', name: 'Child', parentKey: 'A' })
})
