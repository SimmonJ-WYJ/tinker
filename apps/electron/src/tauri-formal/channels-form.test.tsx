import {afterEach,expect,test} from 'bun:test'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {Provider,createStore} from 'jotai'
import type {Channel} from '@asci/shared'
import {ChannelForm} from '../renderer/components/settings/ChannelForm.tsx'
import {setAppLanguage} from '../renderer/lib/i18n.ts'
import {createDesktopApi} from '../preload/api.ts'
import {createFormalTransport} from './transport.ts'
import type {NativeBridge} from './protocol.ts'
afterEach(cleanup)
test('原 ChannelForm 用合成连接测试后，经原 preload 提交完整元数据 payload',async()=>{
 await setAppLanguage('en')
 let channel:Channel={id:'local-mock',name:'Local Mock',provider:'custom-openai',baseUrl:'http://127.0.0.1:1234/v1',apiKey:'',models:[{id:'local-mock-a',name:'Local Mock A',enabled:true}],enabled:true,createdAt:0,updatedAt:0,capabilities:{supportsPdfDocumentBlock:true,imageProtocol:'openai-images',imageQualityPriority:0,imageMaxReferences:4}}
 const calls:Record<string,unknown>[]=[];let revision=0
 const snapshot=()=>({version:1,revision,settings:{},theme:{mode:'system',isDark:false},chrome:{platform:'darwin',fullscreen:false}})
 const native:NativeBridge={listen:async()=>()=>{},request:async<T,>(request:Record<string,unknown>):Promise<T>=>{
  calls.push(request)
  if(request.command==='bootstrap')return {generation:'document-1',activeRuns:[],platformSnapshot:snapshot()} as T
  if(request.channel==='channel:decrypt-key')return {value:'synthetic-local-mock-key'} as T
  if(request.channel==='channel:test-direct')return {value:{success:true,message:'catalogValidated'}} as T
  if(request.channel==='channel:list')return {value:[channel]} as T
  if(request.channel==='channel:update'){
   const args=request.args as [string,Partial<Channel>];channel={...channel,...args[1],apiKey:''};revision++
   return {value:channel,snapshot:snapshot()} as T
  }
  return {value:null} as T
 }}
 const transport=await createFormalTransport(native,code=>code==='catalogValidated'?'Connection and model catalog validated. No model turn was executed.':code)
 const previous=window.electronAPI;window.electronAPI=createDesktopApi(transport)
 try{
  render(<Provider store={createStore()}><ChannelForm channel={channel} onSaved={()=>{}} onCancel={()=>{}}/></Provider>)
  await screen.findByDisplayValue('synthetic-local-mock-key')
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Test connection'}))})
  await screen.findByText('Connection and model catalog validated. No model turn was executed.')
  fireEvent.change(screen.getByDisplayValue('Local Mock'),{target:{value:'Alias'}})
  fireEvent.click(screen.getByRole('button',{name:'Save'}))
  await waitFor(()=>expect(calls.some(c=>c.channel==='channel:update')).toBe(true))
  const saved=calls.find(c=>c.channel==='channel:update')!
  expect(saved).toMatchObject({mutation:{expectedRevision:0},args:['local-mock',{name:'Alias',provider:'custom-openai',baseUrl:channel.baseUrl,apiKey:'synthetic-local-mock-key',enabled:true,models:channel.models,capabilities:channel.capabilities}]})
  expect(calls.find(c=>c.channel==='channel:test-direct')?.args).toEqual([{provider:'custom-openai',baseUrl:channel.baseUrl,apiKey:'synthetic-local-mock-key',probeModel:'local-mock-a',imageProtocol:'openai-images'}])
  await waitFor(()=>expect(transport.revision).toBeGreaterThan(0))
 }finally{cleanup();transport.dispose();window.electronAPI=previous}
})
