import { afterEach, expect, spyOn, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { createDesktopApi } from '../preload/api.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, NativeEvent } from './protocol.ts'
import { useGlobalAgentListeners } from '../renderer/hooks/useGlobalAgentListeners.ts'
import { agentStreamingStatesAtom, agentMessageRefreshAtom } from '../renderer/atoms/agent-atoms.ts'
import { registerAgentAttempt } from '../renderer/lib/agent-attempt.ts'
import * as notifications from '../renderer/atoms/notifications.ts'

afterEach(cleanup)
test('StrictMode receipt 重放不会重新开启已完成请求，也不会触发 refresh 循环；新请求仍工作', async () => {
  let emit: (event: NativeEvent) => void = () => {}
  const bridge: NativeBridge = {
    listen: async (cb) => { emit = cb; return () => {} },
    request: async <T,>(request: Record<string, unknown>): Promise<T> => {
      const result = request.command === 'bootstrap' ? { generation: 'document-1', activeRuns: [], platformSnapshot: { version: 1, revision: 0, settings: {}, userProfile: {}, workspaces: [], theme: { mode: 'system', isDark: false }, chrome: { platform: 'darwin', fullscreen: false } } } : request.command === 'invoke' ? { value: [] } : { attached: true, activeRuns: [] }
      return result as T
    },
  }
  const transport = await createFormalTransport(bridge, (code) => code)
  window.electronAPI = createDesktopApi(transport)
  const store = createStore()
  const notify = spyOn(notifications, 'sendDesktopNotification').mockImplementation(() => {})
  function Listeners() { useGlobalAgentListeners(); return null }
  try {
    const mounted = render(<Provider store={store}><Listeners /></Provider>)
    const packet = (sequence: number, requestId: string, complete = false) => emit({ version: 1, generation: 'document-1', deliverySequence: sequence, channel: complete ? 'agent:stream:complete' : 'agent:stream:event', payload: { sessionId: 's', requestId, startedAt: 100, ...(complete ? { resultSubtype: 'success' } : { payload: { kind: 'asci_event', event: { type: 'text_snapshot', text: requestId } } }) } })
    await act(async () => { packet(1, 'old'); packet(2, 'old', true) })
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
    const refresh = store.get(agentMessageRefreshAtom)
    store.set(agentStreamingStatesAtom, new Map())
    mounted.unmount()
    render(<Provider store={store}><Listeners /></Provider>)
    await act(async () => packet(3, 'old'))
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
    await act(async () => packet(4, 'old', true))
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
    expect(store.get(agentMessageRefreshAtom)).toBe(refresh)
    expect(notify).toHaveBeenCalledTimes(1)
    const newId = registerAgentAttempt(store, 's')!
    store.set(agentStreamingStatesAtom, new Map([['s', { running: true, content: '', toolActivities: [], teammates: [], startedAt: 100 }]]))
    await act(async () => packet(5, newId))
    expect(store.get(agentStreamingStatesAtom).get('s')?.content).toBe(newId)
    expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(true)
    await act(async () => packet(6, newId, true))
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
  } finally { cleanup(); transport.dispose(); notify.mockRestore() }
})

test('original hook deduplicates permission events and atomically reconciles tool snapshots by exact run', async () => {
  const { allPendingPermissionRequestsAtom, liveMessagesMapAtom }=await import('../renderer/atoms/agent-atoms.ts')
  let emit:(event:NativeEvent)=>void=()=>{}
  const bridge:NativeBridge={listen:async(cb)=>{emit=cb;return()=>{}},request:async<T,>(request:Record<string,unknown>):Promise<T>=>{
    const result=request.command==='bootstrap'?{generation:'g',activeRuns:[],platformSnapshot:{version:1,revision:0,settings:{},userProfile:{},workspaces:[],theme:{mode:'system',isDark:false},chrome:{platform:'darwin',fullscreen:false}}}:request.command==='invoke'?{value:[]}:{attached:true,activeRuns:[]}
    return result as T
  }}
  const transport=await createFormalTransport(bridge,code=>code)
  const previousApi=window.electronAPI;window.electronAPI=createDesktopApi(transport)
  const store=createStore();const notify=spyOn(notifications,'sendDesktopNotification').mockImplementation(()=>{})
  const request={requestId:'p-r-0',sessionId:'s',toolName:'workspace_read',toolPreview:{kind:'file',path:'notes/intro.txt'},description:'',dangerLevel:'safe',canAlwaysAllow:false}
  let sequence=0
  const packet=(event:Record<string,unknown>)=>emit({version:1,generation:'g',deliverySequence:++sequence,channel:'agent:stream:event',payload:{sessionId:'s',requestId:'r',startedAt:1,payload:{kind:'asci_event',event}}})
  function Listeners(){useGlobalAgentListeners();return null}
  try {
    render(<Provider store={store}><Listeners/></Provider>)
    await act(async()=>{packet({type:'permission_request',request});packet({type:'permission_request',request})})
    expect(store.get(allPendingPermissionRequestsAtom).get('s')).toHaveLength(1);expect(notify).toHaveBeenCalledTimes(1)
    await act(async()=>packet({type:'permission_resolved',requestId:'p-r-0',behavior:'deny'}))
    expect(store.get(allPendingPermissionRequestsAtom).get('s')).toHaveLength(0)
    const snapshot={type:'tool_run_snapshot',activeText:'round partial',pendingPermissions:[],sdkMessages:[{type:'assistant',uuid:'r-assistant-0',_desktopRunId:'r',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'r-tool-0',name:'workspace_read',input:{path:'notes/intro.txt'}}]}},{type:'user',uuid:'r-result-0',_desktopRunId:'r',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'r-tool-0',content:'Permission denied.',is_error:true}]}}]}
    await act(async()=>{packet(snapshot);packet(snapshot)})
    expect(store.get(liveMessagesMapAtom).get('s')).toHaveLength(2)
    expect(store.get(agentStreamingStatesAtom).get('s')?.toolActivities).toHaveLength(1)
    expect(store.get(agentStreamingStatesAtom).get('s')?.toolActivities[0]?.done).toBe(true)
    expect(store.get(agentStreamingStatesAtom).get('s')?.content).toBe('round partial')
    expect(notify).toHaveBeenCalledTimes(1)
    // 已删 session 不再出现在列表，仍接受精确 run 的终态清理；保留其他 run/session。
    const other={type:'assistant',uuid:'r-other-assistant-0',_desktopRunId:'r-other',parent_tool_use_id:null,message:{content:[]}}
    store.set(liveMessagesMapAtom,new Map([['s',[...(store.get(liveMessagesMapAtom).get('s') ?? []),other]],['other',[other]]]))
    const owned={...request,toolPreview:{kind:'file' as const,path:'notes/intro.txt'},dangerLevel:'safe' as const}
    store.set(allPendingPermissionRequestsAtom,new Map([['s',[owned,{...owned,requestId:'p-r-other-0'}]],['other',[{...owned,sessionId:'other',requestId:'other-p'}]]]))
    await act(async()=>{
      packet({type:'tool_run_snapshot',sdkMessages:[],activeText:'',pendingPermissions:[]})
      emit({version:1,generation:'g',deliverySequence:++sequence,channel:'agent:stream:complete',payload:{sessionId:'s',requestId:'r',startedAt:1,resultSubtype:'error_during_execution',stoppedByUser:true,messages:[]}})
    })
    expect(store.get(allPendingPermissionRequestsAtom).get('s')?.map(p=>p.requestId)).toEqual(['p-r-other-0'])
    expect(store.get(allPendingPermissionRequestsAtom).get('other')).toHaveLength(1)
    expect(store.get(liveMessagesMapAtom).get('s')).toEqual([other])
    expect(store.get(liveMessagesMapAtom).get('other')).toEqual([other])
    expect(store.get(agentStreamingStatesAtom).get('s')?.running ?? false).toBe(false)
  } finally {cleanup();transport.dispose();notify.mockRestore();window.electronAPI=previousApi}
})
