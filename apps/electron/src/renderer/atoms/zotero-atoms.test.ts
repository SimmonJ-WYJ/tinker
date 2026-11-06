import { test, expect } from 'bun:test'
import { createStore } from 'jotai'
import {
  zoteroEnabledAtom,
  zoteroPingStatusAtom,
  zoteroInstallStatusAtom,
  zoteroDataDirAtom,
  zoteroMentionItemCacheAtom,
} from './zotero-atoms.ts'

test('默认值', () => {
  const store = createStore()
  expect(store.get(zoteroEnabledAtom)).toBe(false)
  expect(store.get(zoteroPingStatusAtom)).toEqual({ running: false, remoteEnabled: false })
  expect(store.get(zoteroInstallStatusAtom)).toEqual({ installed: false })
  expect(store.get(zoteroDataDirAtom)).toBeNull()
})

test('可写入', () => {
  const store = createStore()
  store.set(zoteroEnabledAtom, true)
  store.set(zoteroPingStatusAtom, { running: true, remoteEnabled: true })
  expect(store.get(zoteroEnabledAtom)).toBe(true)
  expect(store.get(zoteroPingStatusAtom).running).toBe(true)
})

test('zoteroMentionItemCacheAtom 默认为空 Map', () => {
  const store = createStore()
  const map = store.get(zoteroMentionItemCacheAtom)
  expect(map).toBeInstanceOf(Map)
  expect(map.size).toBe(0)
})

test('zoteroMentionItemCacheAtom 可写入并按 key 读出', () => {
  const store = createStore()
  const next = new Map(store.get(zoteroMentionItemCacheAtom))
  next.set('ABC', { key: 'ABC', title: 'T', creators: ['A'], tags: [], collections: [] })
  store.set(zoteroMentionItemCacheAtom, next)
  expect(store.get(zoteroMentionItemCacheAtom).get('ABC')?.title).toBe('T')
})
