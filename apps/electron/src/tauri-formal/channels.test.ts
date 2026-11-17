import {expect,test} from 'bun:test'
import {createDesktopApi} from '../preload/api.ts'
import {createFormalTransport} from './transport.ts'
import type {NativeBridge} from './protocol.ts'
test('原渠道 API 与 settings 共用串行 revision，失败不提前改 cache，quiesce 等待提交',async()=>{
 const calls:Record<string,unknown>[]=[];let release=()=>{};let fail=false
 const snapshot={version:1,revision:0,settings:{agentChannelId:'local-mock',agentModelId:'local-mock-a'},theme:{mode:'system',isDark:false},chrome:{platform:'darwin',fullscreen:false}}
 const native:NativeBridge={listen:async()=>()=>{},request:async<T>(request:Record<string,unknown>):Promise<T>=>{
  calls.push(request)
  if(request.command==='bootstrap')return {generation:'document-1',activeRuns:[],platformSnapshot:snapshot} as T
  if(request.channel==='channel:update'){
   await new Promise<void>(resolve=>{release=resolve})
   if(fail)throw {code:'storeIo'}
   return {value:{id:'local-mock',name:'Alias'},snapshot:{...snapshot,revision:1,settings:{...snapshot.settings,agentModelId:'local-mock-b'}}} as T
  }
  return {value:null,snapshot:{...snapshot,revision:2}} as T
 }}
 const transport=await createFormalTransport(native,code=>code);const api=createDesktopApi(transport)
 const patch={name:'Alias',provider:'custom-openai' as const,baseUrl:'http://127.0.0.1:1234/v1',apiKey:'synthetic-local-mock-key',enabled:true,models:[{id:'local-mock-b',name:'Secondary',enabled:true}],capabilities:{supportsPdfDocumentBlock:true,imageProtocol:'openai-images' as const,imageQualityPriority:0,imageMaxReferences:4}}
 const pending=api.updateChannel('local-mock',patch);const setting=api.updateSettings({language:'zh'});let quiet=false;const q=transport.quiesce().then(()=>{quiet=true})
 await new Promise(resolve=>setTimeout(resolve,0));expect(transport.revision).toBe(0);expect(quiet).toBe(false);expect(calls.filter(c=>c.channel==='settings:update')).toHaveLength(0)
 expect(calls[1]).toMatchObject({channel:'channel:update',args:['local-mock',patch],mutation:{expectedRevision:0}})
 release();await pending;await setting;await q;expect(calls[2]).toMatchObject({channel:'settings:update',mutation:{expectedRevision:1}});expect(transport.revision).toBe(2)
 fail=true;const rejected=api.updateChannel('local-mock',{enabled:false});await new Promise(resolve=>setTimeout(resolve,0));release();await expect(rejected).rejects.toThrow('storeIo');expect(transport.revision).toBe(2);transport.dispose()
})

test('原 UI 的 undefined 模型清空意图转换为显式成对空选择',async()=>{
 const calls:Record<string,unknown>[]=[]
 const bridge:NativeBridge={listen:async()=>()=>{},request:async<T>(request:Record<string,unknown>):Promise<T>=>{
  calls.push(request)
  return (request.command==='bootstrap'?{generation:'g',activeRuns:[],platformSnapshot:{revision:0,settings:{agentChannelId:'local-mock',agentModelId:'local-mock-a'},theme:{},chrome:{}}}:{value:{}}) as T
 }}
 const transport=await createFormalTransport(bridge,code=>code)
 await createDesktopApi(transport).updateSettings({agentModelId:undefined})
 expect(calls[1]?.args).toEqual([{agentChannelId:'',agentModelId:''}]);transport.dispose()
})
