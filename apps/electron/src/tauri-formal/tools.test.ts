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

test('snapshot ownership preserves explicit other runs and original Electron messages with colliding UUIDs', () => {
  const current = message('r', 'shared')
  const other = message('other', 'shared')
  const conflictingUser = { ...message('other', 'r-user'), type: 'user' } as SDKMessage
  const electron = { type: 'user', uuid: 'r-user', message: { content: [{ type: 'text', text: 'Electron input' }] } } as SDKMessage
  const electronShared = { type: 'assistant', uuid: 'shared', message: { content: [] } } as SDKMessage
  const currentUser = { ...message('r', 'r-user'), type: 'user' } as SDKMessage
  const initial = { messages: [other, conflictingUser, electron, electronShared, current], permissions: [], activities: [], content: '' }
  const next = reconcileToolSnapshot(initial, 'r', { type: 'tool_run_snapshot', sdkMessages: [current, currentUser], activeText: '', pendingPermissions: [] })
  expect(next.messages).toEqual([other, conflictingUser, electron, electronShared, current, currentUser])
  const empty = reconcileToolSnapshot(next, 'r', { type: 'tool_run_snapshot', sdkMessages: [], activeText: '', pendingPermissions: [] })
  expect(empty.messages).toEqual([other, conflictingUser, electron, electronShared])
})

test('malformed or foreign snapshot identities fail closed before replacing any state', () => {
  const initial = { messages: [message('r', 'old')], permissions: [permission('p-r-0')], activities: [], content: 'private history' }
  const valid = message('r', 'new')
  for (const invalid of [message('other', 'old'), { ...valid, _desktopRunId: undefined }, { ...valid, _desktopRunId: 3 }, { ...valid, _desktopRunId: '' }, { ...valid, uuid: undefined }, { ...valid, uuid: '' }]) {
    const snapshot = { type: 'tool_run_snapshot' as const, sdkMessages: [valid, invalid] as SDKMessage[], activeText: 'overwrite', pendingPermissions: [] }
    expect(reconcileToolSnapshot(initial, 'r', snapshot)).toBe(initial)
  }
})

test.each([
  { type: 'tool_use', id: 'other-tool-0', name: 'workspace_read', input: {} },
  { type: 'tool_result', tool_use_id: 'other-tool-0', content: 'foreign result' },
  { type: 'tool_use', id: 'r-tool-4', name: 'workspace_read', input: {} },
  { type: 'tool_result', content: 'missing tool identity' },
])('snapshot rejects invalid scoped tool identity %j without mutating retained activity objects', block => {
  const activity = { toolUseId: 'other-tool-0', toolName: 'workspace_read', input: {}, done: false }
  const initial = { messages: [message('other', 'other-user')], permissions: [], activities: [activity], content: 'private history' }
  const invalid = { type: 'user', uuid: 'r-result-0', _desktopRunId: 'r', message: { content: [block] } } as SDKMessage
  const next = reconcileToolSnapshot(initial, 'r', { type: 'tool_run_snapshot', sdkMessages: [invalid], activeText: 'overwrite', pendingPermissions: [] })
  expect(activity).toEqual({ toolUseId: 'other-tool-0', toolName: 'workspace_read', input: {}, done: false })
  expect(next).toBe(initial)
})

test.each(['p-other-0', 'p-r-4', 'p-r-00'])('snapshot rejects foreign or malformed pending permission %s', requestId => {
  const initial = { messages: [message('r', 'old')], permissions: [permission('p-r-0')], activities: [], content: 'private history' }
  expect(reconcileToolSnapshot(initial, 'r', { type: 'tool_run_snapshot', sdkMessages: [message('r', 'new')], activeText: 'overwrite', pendingPermissions: [permission(requestId)] })).toBe(initial)
})

test('atomic snapshot rejects a foreign permission session without writes or notification candidates', async () => {
  const { createStore } = await import('jotai')
  const { applyToolRunSnapshotAtom } = await import('../renderer/hooks/tool-run-snapshot-state.ts')
  const { liveMessagesMapAtom, agentStreamingStatesAtom, allPendingPermissionRequestsAtom } = await import('../renderer/atoms/agent-atoms.ts')
  const store = createStore()
  store.set(liveMessagesMapAtom, new Map([['s', [message('r', 'private')]], ['other', [message('other', 'private')]]]))
  store.set(allPendingPermissionRequestsAtom, new Map([['s', [permission('p-r-0')]], ['other', [{ ...permission('p-other-0'), sessionId: 'other' }]]]))
  const messages = store.get(liveMessagesMapAtom)
  const permissions = store.get(allPendingPermissionRequestsAtom)
  const streams = store.get(agentStreamingStatesAtom)
  let writes = 0
  const unsubscribers = [liveMessagesMapAtom, allPendingPermissionRequestsAtom, agentStreamingStatesAtom].map(atom => store.sub(atom, () => { writes++ }))
  try {
    const result = store.set(applyToolRunSnapshotAtom, { sessionId: 's', requestId: 'r', startedAt: 1, payload: { kind: 'asci_event', event: { type: 'tool_run_snapshot', sdkMessages: [message('r', 'new')], activeText: 'overwrite', pendingPermissions: [{ ...permission('p-r-0'), sessionId: 'other' }] } } })
    expect(result).toEqual([])
    expect(store.get(liveMessagesMapAtom)).toBe(messages)
    expect(store.get(allPendingPermissionRequestsAtom)).toBe(permissions)
    expect(store.get(agentStreamingStatesAtom)).toBe(streams)
    expect(writes).toBe(0)
  } finally { unsubscribers.forEach(unsubscribe => unsubscribe()) }
})
