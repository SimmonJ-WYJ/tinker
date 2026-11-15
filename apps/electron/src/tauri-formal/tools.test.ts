import { expect, test } from 'bun:test'
import type { SDKMessage, PermissionRequest } from '@asci/shared'
import { reconcileToolSnapshot, mergeToolRunMessages } from '../renderer/hooks/tool-run-snapshot.ts'
const permission = (requestId: string): PermissionRequest => ({ requestId, sessionId:'s', toolName:'workspace_read', toolPreview:{kind:'file',path:'notes/intro.txt'}, description:'', dangerLevel:'safe', canAlwaysAllow:false })
const message = (run: string, uuid: string): SDKMessage => ({ type:'assistant', uuid, _desktopRunId:run, parent_tool_use_id:null, message:{content:[{type:'tool_use',id:`${run}-tool-0`,name:'workspace_read',input:{path:'notes/intro.txt'}}]} })
test('snapshot replaces the exact run and is idempotent, retaining prefix-related runs and permissions', () => {
  const other=message('r-other','r-other-assistant-0')
  const current=message('r','r-assistant-0')
  const initial={messages:[other,current],permissions:[permission('p-r-other-0'),permission('p-r-0')],activities:[],content:'old'}
  const snapshot={type:'tool_run_snapshot' as const,sdkMessages:[current],activeText:'new',pendingPermissions:[]}
  const next=reconcileToolSnapshot(initial,'r',snapshot)
  expect(next.messages).toEqual([other,current])
  expect(next.permissions.map(p=>p.requestId)).toEqual(['p-r-other-0'])
  expect(next.activities).toHaveLength(1)
  expect(next.content).toBe('new')
  expect(reconcileToolSnapshot(next,'r',snapshot)).toBe(next)
})
test('same permission repeated only produces one notification candidate', () => {
  const snapshot={type:'tool_run_snapshot' as const,sdkMessages:[message('r','r-assistant-0')],activeText:'',pendingPermissions:[permission('p-r-0')]}
  const next=reconcileToolSnapshot({messages:[],permissions:[],activities:[],content:''},'r',snapshot)
  expect(next.newPermissions).toHaveLength(1)
  const repeated=reconcileToolSnapshot(next,'r',snapshot)
  expect(repeated).toBe(next)
})

test('atomic snapshot restores messages, tools and pending together for only one session', async () => {
  const { createStore } = await import('jotai')
  const { applyToolRunSnapshotAtom } = await import('../renderer/hooks/tool-run-snapshot-state.ts')
  const { liveMessagesMapAtom, agentStreamingStatesAtom, allPendingPermissionRequestsAtom } = await import('../renderer/atoms/agent-atoms.ts')
  const store=createStore()
  store.set(allPendingPermissionRequestsAtom,new Map([['other',[{...permission('other-p'),sessionId:'other'}]]]))
  let observations=0
  store.sub(liveMessagesMapAtom,()=>{observations++;expect(store.get(agentStreamingStatesAtom).get('s')?.toolActivities).toHaveLength(1);expect(store.get(allPendingPermissionRequestsAtom).get('s')).toHaveLength(1)})
  const envelope={sessionId:'s',requestId:'r',startedAt:1,payload:{kind:'asci_event' as const,event:{type:'tool_run_snapshot' as const,sdkMessages:[message('r','r-assistant-0')],activeText:'working',pendingPermissions:[permission('p-r-0')]}}}
  expect(store.set(applyToolRunSnapshotAtom,envelope)).toHaveLength(1)
  expect(store.set(applyToolRunSnapshotAtom,envelope)).toHaveLength(0)
  expect(observations).toBe(1)
  expect(store.get(allPendingPermissionRequestsAtom).get('other')).toHaveLength(1)
})

test('original preload permission response passes while SEND promise remains pending', async () => {
  const { createFormalTransport }=await import('./transport.ts')
  const { createDesktopApi }=await import('../preload/api.ts')
  const calls:Record<string,unknown>[]=[]
  let finishSend:(value:unknown)=>void=()=>{}
  const { bridge } = { bridge: {
    listen:async()=>()=>{},
    request:async<T,>(request:Record<string,unknown>):Promise<T>=>{
      calls.push(request)
      if(request.command==='bootstrap') return {generation:'g',activeRuns:[],platformSnapshot:{version:1,revision:0,settings:{},userProfile:{},workspaces:[],theme:{mode:'system',isDark:false},chrome:{platform:'darwin',fullscreen:false}}} as T
      if(request.channel==='agent:send-message') return new Promise(resolve=>{finishSend=resolve})
      return {value:null} as T
    },
  } }
  const transport=await createFormalTransport(bridge,code=>code,{commandTimeoutMs:500})
  const api=createDesktopApi(transport)
  const sending=transport.invoke('agent:send-message',{})
  await api.respondPermission({requestId:'p-r-0',behavior:'allow',alwaysAllow:false})
  expect(calls.at(-1)).toMatchObject({command:'invoke',generation:'g',channel:'agent:permission:respond',args:[{requestId:'p-r-0',behavior:'allow',alwaysAllow:false}]})
  finishSend({value:null});await sending;transport.dispose()
})

test('restored persisted and live tool messages merge by exact run and UUID', () => {
  const persisted=message('r','r-assistant-0')
  const live=JSON.parse(JSON.stringify(persisted)) as SDKMessage
  const otherRun=message('r-other','r-assistant-0')
  const otherUuid=message('r','r-assistant-1')
  const legacy={type:'assistant',uuid:'legacy',message:{content:[]}} as SDKMessage
  const legacyCopy=JSON.parse(JSON.stringify(legacy)) as SDKMessage
  expect(mergeToolRunMessages([persisted,otherRun,otherUuid,legacy],[live,legacyCopy])).toEqual([otherRun,otherUuid,legacy,live,legacyCopy])
  expect(mergeToolRunMessages([persisted],[persisted])).toEqual([persisted])
})
