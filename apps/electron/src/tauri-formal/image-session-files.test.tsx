import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, waitFor } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { createDesktopApi } from '../preload/api.ts'
import { AgentView } from '../renderer/components/agent/AgentView.tsx'
import { TooltipProvider } from '../renderer/components/ui/tooltip.tsx'
import { agentSessionPathMapAtom } from '../renderer/atoms/agent-atoms.ts'
import { createFormalTransport } from './transport.ts'

const previous = window.electronAPI
const oldHost = window.__TAURI_FORMAL__
afterEach(() => {
  cleanup()
  window.electronAPI = previous
  window.__TAURI_FORMAL__ = oldHost
})

test('the original global conversation opens its own native image directory without a project', async () => {
  const calls: unknown[] = []
  const t = await createFormalTransport({
    listen: async () => () => {},
    request: async<T,>(req: Record<string,unknown>): Promise<T> => {
      if (req.command === 'bootstrap') return {generation:'g',nativeImages:true,activeRuns:[],platformSnapshot:{revision:0,settings:{},chrome:{},theme:{}}} as T
      if (req.command === 'restore') return {restoreToken:'r',deliverySequence:0,messages:[],sdkMessages:[],activeSnapshot:null} as T
      if (req.channel === 'agent:get-session-path') {
        calls.push(req.args)
        return {value:'/synthetic/deliverables/global-session'} as T
      }
      return {value:null} as T
    },
  }, code => code)
  window.__TAURI_FORMAL__ = { hydrated: () => {}, nativeImages: true }
  window.electronAPI = createDesktopApi(t)
  for (const name of ['event','complete','error']) t.subscribe('agent:stream:' + name, () => {})
  const store = createStore()
  const view = render(<Provider store={store}><TooltipProvider><AgentView sessionId="global-session" /></TooltipProvider></Provider>)
  await waitFor(() => expect(store.get(agentSessionPathMapAtom).get('global-session')).toBe('/synthetic/deliverables/global-session'))
  expect(calls).toEqual([[null,'global-session']])
  view.unmount()
  t.dispose()
})
