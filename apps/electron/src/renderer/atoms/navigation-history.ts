/** 工作台页面浏览历史；与会话消息和生成任务独立。 */
import { atom } from 'jotai'
import type { ActiveView } from './active-view'
export interface NavigationEntry { view: ActiveView; workspaceId: string | null; sessionId: string | null; title: string }
interface NavigationHistory { entries: NavigationEntry[]; index: number }
export const navigationHistoryAtom = atom<NavigationHistory>({ entries: [], index: -1 })
export function sameNavigation(a: NavigationEntry | undefined, b: NavigationEntry): boolean {
 return !!a && a.view === b.view && a.workspaceId === b.workspaceId && a.sessionId === b.sessionId
}
export const recordNavigationAtom = atom(null, (get, set, entry: NavigationEntry) => {
 const history = get(navigationHistoryAtom)
 if (sameNavigation(history.entries[history.index], entry)) return
 const entries = [...history.entries.slice(0, history.index + 1), entry].slice(-80)
 set(navigationHistoryAtom, { entries, index: entries.length - 1 })
})
