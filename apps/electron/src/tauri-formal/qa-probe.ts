/** 仅 native-qa config 注入，同一默认 Jotai store 的有界持久化探针。 */
import { getDefaultStore } from 'jotai'
import { sidebarProjectFilesExpandedMapAtom } from '../renderer/atoms/agent-atoms.ts'
const probe = {
  projectFiles(value: boolean): Record<string, boolean> {
    const store = getDefaultStore()
    const next = new Map(store.get(sidebarProjectFilesExpandedMapAtom))
    next.set('local-mock-workspace-id', value)
    store.set(sidebarProjectFilesExpandedMapAtom, next)
    return Object.fromEntries(next)
  },
}
Object.defineProperty(window, '__NATIVE_QA_ATOMS__', { value: probe })
