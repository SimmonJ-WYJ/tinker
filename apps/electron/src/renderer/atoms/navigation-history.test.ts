import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import { navigationHistoryAtom, recordNavigationAtom, type NavigationEntry } from './navigation-history'
const entry = (id: string): NavigationEntry => ({ view: 'conversations', workspaceId: 'workspace', sessionId: id, title: id })
test('浏览历史去重，返回后访问新页面会截断前进分支', () => {
 const store = createStore()
 store.set(recordNavigationAtom, entry('a'))
 store.set(recordNavigationAtom, entry('a'))
 store.set(recordNavigationAtom, entry('b'))
 store.set(recordNavigationAtom, entry('c'))
 expect(store.get(navigationHistoryAtom).entries).toHaveLength(3)
 store.set(navigationHistoryAtom, prev => ({ ...prev, index: 0 }))
 store.set(recordNavigationAtom, entry('a'))
 expect(store.get(navigationHistoryAtom).index).toBe(0)
 store.set(recordNavigationAtom, entry('d'))
 expect(store.get(navigationHistoryAtom).entries.map(e => e.sessionId)).toEqual(['a', 'd'])
})
