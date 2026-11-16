import { expect, test } from 'bun:test'
import { createDesktopApi } from '../preload/api.ts'
import { createFormalTransport } from './transport.ts'
import type { NativeBridge, NativeEvent } from './protocol.ts'

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
function fixture() {
  const calls: Record<string, unknown>[] = []
  let listener: (event: NativeEvent) => void = () => {}
  let stopAck: (() => void) | undefined
  const bridge: NativeBridge = {
    listen: async cb => { listener = cb; return () => {} },
    request: async <T>(request: Record<string, unknown>): Promise<T> => {
      calls.push(request)
      if (request.command === 'bootstrap') return {generation:'g',queueing:true,activeRuns:[],platformSnapshot:{version:1,revision:0,settings:{},userProfile:{},workspaces:[],theme:{mode:'system',isDark:false},chrome:{platform:'darwin',fullscreen:false}}} as T
      if (request.channel === 'agent:stop') await new Promise<void>(resolve => { stopAck = resolve })
      const input = (request.args as Record<string, unknown>[] | undefined)?.[0]
      return {value:request.channel === 'agent:queue-message' ? {uuid:input?.uuid,chainId:request.expectedChainId,sessionId:input?.sessionId} : null} as T
    },
  }
  return { calls, bridge, releaseStop: () => stopAck?.(), emit: (requestId: string, sequence: number) => listener({version:1,generation:'g',deliverySequence:sequence,channel:'agent:stream:complete',payload:{sessionId:'s',requestId,resultSubtype:'success'}}) }
}

test('original facade queues the exact public UUID behind Begin and keeps send pending until chain completion', async () => {
  const f=fixture(); const t=await createFormalTransport(f.bridge, code=>code)
  for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error']) t.subscribe(c,()=>{})
  const api=createDesktopApi(t)
  let finished=false
  const send=api.sendAgentMessage({sessionId:'s',requestId:'a',userMessage:'A',channelId:'mock',modelId:'mock'}).then(()=>{finished=true})
  const uuid=await api.queueAgentMessage({sessionId:'s',uuid:'b-user',userMessage:'B',interrupt:false})
  expect(uuid).toBe('b-user')
  expect(f.calls.find(c=>c.channel==='agent:queue-message')).toMatchObject({expectedChainId:'a'})
  expect(finished).toBe(false)
  f.emit('a',1);await send;t.dispose()
})

test('rapid Stop/new Send orders acceptance without waiting for the old chain and captures old ownership', async () => {
  const f=fixture();const t=await createFormalTransport(f.bridge,code=>code)
  for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error']) t.subscribe(c,()=>{})
  const api=createDesktopApi(t)
  const first=api.sendAgentMessage({sessionId:'s',requestId:'a',userMessage:'A',channelId:'mock',modelId:'mock'})
  await tick()
  const stop=api.stopAgent('s')
  const next=api.sendAgentMessage({sessionId:'s',requestId:'b',userMessage:'B',channelId:'mock',modelId:'mock'})
  await tick()
  expect(f.calls.filter(c=>c.channel==='agent:send-message')).toHaveLength(1)
  expect(f.calls.find(c=>c.channel==='agent:stop')).toMatchObject({expectedChainId:'a'})
  f.releaseStop();await stop;await tick()
  expect(f.calls.filter(c=>c.channel==='agent:send-message')).toHaveLength(2)
  f.emit('a',1);await first;f.emit('b',2);await next;t.dispose()
})

test('completion before Begin acknowledgment settles once and quiesce still waits for acceptance',async()=>{
  const f=fixture();const original=f.bridge.request;let ack=()=>{}
  f.bridge.request=async<T>(request:Record<string,unknown>):Promise<T>=>{
    const result=await original<T>(request)
    if(request.channel==='agent:send-message')await new Promise<void>(resolve=>{ack=resolve})
    return result
  }
  const t=await createFormalTransport(f.bridge,code=>code);for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error'])t.subscribe(c,()=>{})
  const sending=t.invoke('agent:send-message',{sessionId:'s',requestId:'early'})
  await tick();f.emit('early',1)
  let quiet=false;const quiesce=t.quiesce().then(()=>{quiet=true});await tick();expect(quiet).toBe(false)
  ack();await sending;await quiesce;expect(quiet).toBe(true);t.dispose()
})

test('unknown queue acknowledgment reconciles the exact UUID without resending',async()=>{
  const f=fixture();const original=f.bridge.request
  f.bridge.request=async<T>(request:Record<string,unknown>):Promise<T>=>{
    const result=await original<T>(request)
    if(request.channel==='agent:queue-message')throw {code:'transportTimeout'}
    if(request.channel==='agent:queue-state')return {value:{receipt:{uuid:'same',chainId:'a',sessionId:'s'}}} as T
    return result
  }
  const t=await createFormalTransport(f.bridge,code=>code);for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error'])t.subscribe(c,()=>{})
  const send=t.invoke('agent:send-message',{sessionId:'s',requestId:'a'})
  expect(await t.invoke('agent:queue-message',{sessionId:'s',uuid:'same',userMessage:'text',interrupt:false})).toBe('same')
  expect(f.calls.filter(c=>c.channel==='agent:queue-message')).toHaveLength(1)
  expect(f.calls.find(c=>c.channel==='agent:queue-state')).toMatchObject({expectedChainId:'a',args:[{sessionId:'s',uuid:'same'}]})
  f.emit('a',1);await send;t.dispose()
})

test('unresolved queue acknowledgment retains recoverable identity and freezes the acceptance lane',async()=>{
  const f=fixture();const original=f.bridge.request
  f.bridge.request=async<T>(request:Record<string,unknown>):Promise<T>=>{const result=await original<T>(request);if(request.channel==='agent:queue-message'||request.channel==='agent:queue-state')throw {code:'transportTimeout'};return result}
  const t=await createFormalTransport(f.bridge,code=>code);for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error'])t.subscribe(c,()=>{})
  const send=t.invoke('agent:send-message',{sessionId:'s',requestId:'a'})
  let error:unknown;try{await t.invoke('agent:queue-message',{sessionId:'s',uuid:'unknown',userMessage:'retain'})}catch(e){error=e}
  expect(error).toMatchObject({queueAcknowledgmentUnknown:true})
  await expect(t.invoke('agent:send-message',{sessionId:'s',requestId:'new'})).rejects.toThrow()
  expect(f.calls.filter(c=>c.channel==='agent:send-message')).toHaveLength(1)
  f.emit('a',1);await send;t.dispose()
})

test('rapid Stop/new Send settles old completion before delayed Stop ACK without resetting the new owner',async()=>{
 const f=fixture();const t=await createFormalTransport(f.bridge,code=>code);for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error'])t.subscribe(c,()=>{})
 let oldSettles=0;const old=t.invoke('agent:send-message',{sessionId:'s',requestId:'a'}).then(()=>{oldSettles++})
 await tick();const stop=t.invoke('agent:stop','s');const next=t.invoke('agent:send-message',{sessionId:'s',requestId:'b'})
 await tick();f.emit('a',1);await old;expect(oldSettles).toBe(1);f.releaseStop();await stop;await tick()
 const uuid=await t.invoke('agent:queue-message',{sessionId:'s',uuid:'late',userMessage:'late'});expect(uuid).toBe('late');expect(f.calls.at(-1)).toMatchObject({expectedChainId:'b'})
 f.emit('a',2);expect(oldSettles).toBe(1);f.emit('b',3);await next;t.dispose()
})

test('existing optional public request and queue UUIDs receive one stable identity per initiated action',async()=>{
 const f=fixture();const t=await createFormalTransport(f.bridge,code=>code);for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error'])t.subscribe(c,()=>{})
 const sent=t.invoke('agent:send-message',{sessionId:'s',userMessage:'legacy'});void sent.catch(()=>{})
 await tick();const begin=f.calls.find(c=>c.channel==='agent:send-message');expect(begin).toBeDefined()
 const chain=(begin!.args as {requestId:string}[])[0]!.requestId;expect(chain).toBeString()
 expect(await t.invoke('agent:queue-message',{sessionId:'s',userMessage:'append'})).toBeString()
 f.emit(chain,1);await sent;t.dispose()
})

for (const newer of [false,true]) test(`review I1: restored closed proof publishes exactly one completion after history consumption (new owner=${newer})`,async()=>{
 const f=fixture();const original=f.bridge.request;let release=()=>{}
 f.bridge.request=async<T>(request:Record<string,unknown>):Promise<T>=>{
   if(request.command==='restore') {
     f.emit('a',1)
     if(newer)await new Promise<void>(resolve=>{release=resolve})
     return {restoreToken:'r',deliverySequence:1,messages:[],sdkMessages:[],activeSnapshot:null,cursor:1,chainStates:[{sessionId:'s',chainId:'a',closureReason:'completed'}]} as T
   }
   return original<T>(request)
 }
 const t=await createFormalTransport(f.bridge,code=>code);let consumed=false;let owner='a';let running=true;let completions=0
 t.subscribe('agent:stream:event',()=>{});t.subscribe('agent:stream:error',()=>{})
 t.subscribe<{requestId:string}>('agent:stream:complete',data=>{expect(consumed).toBe(true);completions++;if(data.requestId===owner)running=false})
 const send=t.invoke('agent:send-message',{sessionId:'s',requestId:'a'});await tick()
 const history=t.invoke('agent:get-sdk-messages','s').then(()=>{consumed=true})
 await tick();let next:Promise<unknown>|undefined
 if(newer){owner='b';next=t.invoke('agent:send-message',{sessionId:'s',requestId:'b'});release()}
 await history;await send;await tick()
 expect(completions).toBe(1);expect(running).toBe(newer)
 f.emit('a',2);expect(completions).toBe(1)
 if(newer){expect(await t.invoke('agent:queue-message',{sessionId:'s',uuid:'b-child',userMessage:'B child'})).toBe('b-child');expect(f.calls.at(-1)).toMatchObject({expectedChainId:'b'});f.emit('b',3);await next}
 t.dispose()
})

test('review I2: storeIo after durable interrupt acceptance reconciles exact UUID and freezes subsequent admissions',async()=>{
 const f=fixture();const original=f.bridge.request
 f.bridge.request=async<T>(request:Record<string,unknown>):Promise<T>=>{
   const result=await original<T>(request)
   if(request.channel==='agent:queue-message')throw {code:'storeIo'}
   if(request.channel==='agent:queue-state')return {value:{receipt:{uuid:'d',chainId:'a',sessionId:'s'}}} as T
   return result
 }
 const t=await createFormalTransport(f.bridge,code=>code);for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error'])t.subscribe(c,()=>{})
 const send=t.invoke('agent:send-message',{sessionId:'s',requestId:'a'})
 const accepted=t.invoke('agent:queue-message',{sessionId:'s',uuid:'d',userMessage:'retain exact D',interrupt:true})
 await expect(accepted).resolves.toBe('d')
 expect(f.calls.find(c=>c.channel==='agent:queue-state')).toMatchObject({expectedChainId:'a',args:[{sessionId:'s',uuid:'d'}]})
 let error:unknown;try{await t.invoke('agent:queue-message',{sessionId:'s',uuid:'child',userMessage:'must not send'})}catch(e){error=e}
 expect(error).toMatchObject({queueAcknowledgmentUnknown:true});expect(f.calls.filter(c=>c.channel==='agent:queue-message')).toHaveLength(1)
 f.emit('a',1);await send;t.dispose()
})

test('review I2: unconfirmed persistence outcome remains recoverable and never rolls back as definite rejection',async()=>{
 const f=fixture();const original=f.bridge.request
 f.bridge.request=async<T>(request:Record<string,unknown>):Promise<T>=>{const result=await original<T>(request);if(request.channel==='agent:queue-message'||request.channel==='agent:queue-state')throw {code:'storeIo'};return result}
 const t=await createFormalTransport(f.bridge,code=>code);for(const c of ['agent:stream:event','agent:stream:complete','agent:stream:error'])t.subscribe(c,()=>{})
 const send=t.invoke('agent:send-message',{sessionId:'s',requestId:'a'})
 let error:unknown;try{await t.invoke('agent:queue-message',{sessionId:'s',uuid:'d',userMessage:'retain D',interrupt:true})}catch(e){error=e}
 expect(error).toMatchObject({queueAcknowledgmentUnknown:true});expect(f.calls.filter(c=>c.channel==='agent:queue-state')).toHaveLength(1)
 f.emit('a',1);await send;t.dispose()
})

for (const code of ['historyLimit','pageLimit']) test(`review I3: accepted Begin projection ${code} reconciles exact closed owner and completes once`,async()=>{
 const f=fixture();const original=f.bridge.request
 f.bridge.request=async<T>(request:Record<string,unknown>):Promise<T>=>{
   const result=await original<T>(request)
   if(request.channel==='agent:send-message')throw {code}
   if(request.channel==='agent:queue-state')return {value:{sessionId:'s',chainId:'a',closureReason:'failure'}} as T
   return result
 }
 const t=await createFormalTransport(f.bridge,code=>code);let completions=0
 for(const c of ['agent:stream:event','agent:stream:error'])t.subscribe(c,()=>{})
 t.subscribe('agent:stream:complete',()=>{completions++})
 await expect(t.invoke('agent:send-message',{sessionId:'s',requestId:'a'})).rejects.toThrow('responseFailed')
 expect(f.calls.find(c=>c.channel==='agent:queue-state')).toMatchObject({expectedChainId:'a',args:[{sessionId:'s'}]})
 expect(completions).toBe(1);f.emit('a',1);expect(completions).toBe(1)
 await expect(t.invoke('agent:send-message',{sessionId:'s',requestId:'child'})).rejects.toMatchObject({queueAcknowledgmentUnknown:true})
 expect(f.calls.filter(c=>c.channel==='agent:send-message')).toHaveLength(1);t.dispose()
})
