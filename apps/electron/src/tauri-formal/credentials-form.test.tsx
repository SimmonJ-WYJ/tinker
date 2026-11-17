import {afterEach,expect,test} from 'bun:test'
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {Provider,createStore} from 'jotai'
import type {Channel} from '@asci/shared'
import {createFormalTransport} from './transport.ts'
import {createDesktopApi} from '../preload/api.ts'
import type {NativeBridge} from './protocol.ts'
import {useChannelCredentials} from '../renderer/components/settings/useChannelCredentials.ts'
import {ChannelForm} from '../renderer/components/settings/ChannelForm.tsx'
import {setAppLanguage} from '../renderer/lib/i18n.ts'
const channel:Channel={id:'owned',name:'Owned',provider:'custom-openai',baseUrl:'https://owned.invalid/v1',apiKey:'',hasCredential:true,models:[{id:'plain',name:'Plain',enabled:true}],enabled:true,createdAt:0,updatedAt:0}
const original=window.electronAPI
afterEach(()=>{cleanup();window.electronAPI=original})
function mount(){render(<Provider store={createStore()}><ChannelForm channel={channel} onSaved={()=>{}} onCancel={()=>{}}/></Provider>)}
async function setup(){
 await setAppLanguage('en');const calls:string[]=[];let resolveMode:(v:'managed'|'legacy')=>void=()=>{};let resolveSave:()=>void=()=>{};let failSave=false
 window.electronAPI={...original,getChannelCredentialMode:()=>new Promise(r=>{resolveMode=r}),decryptApiKey:async()=>{calls.push('decrypt');return 'legacy-key'},testChannel:async(id)=>{calls.push(`saved:${id}`);return {success:true,message:'saved catalog'}},testChannelDirect:async()=>{calls.push('typed');return {success:true,message:'typed catalog'}},fetchModels:async(input)=>{calls.push(typeof input==='string'?'refresh-saved':'refresh-typed');return {success:true,message:'catalog',models:[]}},updateChannel:async(_id,input)=>{calls.push(`save:${input.apiKey??''}`);await new Promise<void>(r=>{resolveSave=r});if(failSave)throw new Error('lost');return channel},listChannels:async()=>[channel]}
 return {calls,mode:(mode:'managed'|'legacy')=>act(async()=>{resolveMode(mode)}),ack:()=>act(async()=>{resolveSave()}),lose:()=>{failSave=true}}
}
test('managed capability resolves before decrypt; saved key stays blank and manual probes use identity without autosave',async()=>{
 const f=await setup();mount();expect(f.calls).toEqual([])
 await f.mode('managed');expect(f.calls).toEqual([]);const key=screen.getByLabelText('API Key') as HTMLInputElement;expect(key.value).toBe('')
 fireEvent.click(screen.getByRole('button',{name:'Show API key'}));expect(key.value).toBe('')
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Test connection'}))});expect(f.calls).toEqual(['saved:owned'])
 const refresh=screen.getByRole('button',{name:'Refresh'});await act(async()=>{fireEvent.click(refresh)});expect(f.calls).toContain('refresh-saved')
 fireEvent.change(key,{target:{value:'replacement'}});await new Promise(r=>setTimeout(r,1700));expect(f.calls.filter(c=>c==='typed'||c.startsWith('save:'))).toEqual([])
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Test connection'}))});expect(f.calls).toContain('typed')
 fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(f.calls).toContain('save:replacement'));expect(key.value).toBe('replacement');await f.ack();await waitFor(()=>expect(key.value).toBe(''))
})
test('changed binding cannot probe with stored key; stale typed test result cannot enable Save',async()=>{
 const f=await setup();mount();await f.mode('managed')
 const url=screen.getByDisplayValue(channel.baseUrl);fireEvent.change(url,{target:{value:'https://other.invalid/v1'}})
 expect((screen.getByRole('button',{name:'Test connection'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Test connection'}));expect(f.calls).toEqual([])
 expect((screen.getByRole('button',{name:'Save'}) as HTMLButtonElement).disabled).toBe(true)
})
test('legacy capability retains saved-key decrypt behavior',async()=>{
 const f=await setup();mount();await f.mode('legacy');await screen.findByDisplayValue('legacy-key');expect(f.calls).toEqual(['decrypt'])
})

test('pending save and lost ack retain replacement; changed key cannot be silently cleared by earlier ack',async()=>{
 const f=await setup();mount();await f.mode('managed');const key=screen.getByLabelText('API Key') as HTMLInputElement
 fireEvent.change(key,{target:{value:'replacement-one'}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Test connection'}))})
 fireEvent.click(screen.getByRole('button',{name:'Save'}));await waitFor(()=>expect(f.calls).toContain('save:replacement-one'));expect(key.disabled).toBe(true)
 fireEvent.change(key,{target:{value:'replacement-two'}});await f.ack();expect(key.value).toBe('replacement-two')
})
test('stale typed probe cannot enable Save, and duplicate explicit probe makes one request',async()=>{
 const f=await setup();let finish:(v:{success:boolean;message:string})=>void=()=>{}
 window.electronAPI.testChannelDirect=()=>{f.calls.push('typed-held');return new Promise(r=>{finish=r})}
 mount();await f.mode('managed');const key=screen.getByLabelText('API Key');fireEvent.change(key,{target:{value:'replacement'}})
 const testButton=screen.getByRole('button',{name:'Test connection'});act(()=>{fireEvent.click(testButton);fireEvent.click(testButton)})
 expect(f.calls.filter(c=>c==='typed-held')).toHaveLength(1);fireEvent.change(screen.getByDisplayValue(channel.baseUrl),{target:{value:'https://changed.invalid/v1'}})
 await act(async()=>finish({success:true,message:'stale-catalog'}));expect(screen.queryByText('stale-catalog')).toBeNull();expect(screen.getByRole('button',{name:'Save'})).toBeDisabled()
})

test('changing provider while a probe is pending releases testing state and drops stale success',async()=>{
 const f=await setup();let finish:(v:{success:boolean;message:string})=>void=()=>{}
 window.electronAPI.testChannelDirect=()=>new Promise(r=>{finish=r})
 let state!:ReturnType<typeof useChannelCredentials>;const setKey=()=>{};const setModels=()=>{}
 function Probe({provider}:{provider:'custom-openai'|'custom-anthropic'}){state=useChannelCredentials({channel,provider,baseUrl:channel.baseUrl,apiKey:'replacement',imageProtocol:'openai-images',models:channel.models,setModels,setApiKey:setKey,agentChannelId:null,agentModelId:null,intentFields:[]});return null}
 const view=render(<Probe provider="custom-openai"/>);await f.mode('managed');await act(async()=>{void state.handleTest()});expect(state.testing).toBe(true)
 state.requestId.current+=1;view.rerender(<Probe provider="custom-anthropic"/>);await act(async()=>finish({success:true,message:'stale-provider-success'}));expect(state.testResult).toBeNull();expect(state.testing).toBe(false)
})

test('original managed form reconciles lost final ack without staging again and clears only after durable ack',async()=>{
 await setAppLanguage('en');const calls:Record<string,unknown>[]=[];let lose=true;let saved=0
 const snapshot={version:1,revision:0,settings:{},theme:{},chrome:{}}
 const native:NativeBridge={listen:async()=>()=>{},request:async<T,>(r:Record<string,unknown>):Promise<T>=>{
  calls.push(structuredClone(r));if(r.command==='bootstrap')return {credentialedChannels:true,queueing:false,generation:'doc',activeRuns:[],platformSnapshot:snapshot} as T
  if(r.channel==='channel:list')return {value:[channel]} as T
  if(r.channel==='channel:test-direct')return {value:{success:true,message:'typed catalog'}} as T
  if(r.channel==='channel:stage'){const input=(r.args as {request:{args:{credential:unknown}[]}}[])[0]!;const normalized=structuredClone(input.request);normalized.args[0]!.credential={replace:'b'.repeat(32)};return {value:normalized} as T}
  if(r.channel==='channel:update'){if(lose){lose=false;throw {code:'runtimeUnavailable'}}return {value:channel,snapshot:{...snapshot,revision:1}} as T}
  return {value:null} as T
 }}
 const transport=await createFormalTransport(native,c=>c);window.electronAPI=createDesktopApi(transport);await window.electronAPI.listChannels()
 render(<Provider store={createStore()}><ChannelForm channel={channel} onSaved={()=>{saved++}} onCancel={()=>{}}/></Provider>)
 await act(async()=>{});const key=screen.getByLabelText('API Key') as HTMLInputElement;fireEvent.change(key,{target:{value:'owned-replacement'}});await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Test connection'}))})
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save'}))});expect(saved).toBe(0);expect(key.value).toBe('owned-replacement');expect(transport.revision).toBe(0)
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Save'}))});expect(saved).toBe(1);expect(key.value).toBe('');expect(transport.revision).toBe(1)
 expect(calls.filter(c=>c.channel==='channel:stage')).toHaveLength(1);const writes=calls.filter(c=>c.channel==='channel:update');expect(writes[1]).toEqual(writes[0]);expect(JSON.stringify(writes)).not.toContain('owned-replacement');expect(calls.some(c=>c.channel==='channel:decrypt-key')).toBe(false);cleanup();transport.dispose()
})
