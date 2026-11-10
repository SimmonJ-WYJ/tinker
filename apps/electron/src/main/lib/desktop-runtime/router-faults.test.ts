/** 真实 JSONL 子进程注入合法协议响应，验证宿主边界的分页和错误语义。 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AGENT_IPC_CHANNELS } from '@asci/shared'
import type { AgentStreamEvent, DesktopTurn } from '@asci/shared'
import { applyAgentEvent } from '../../../renderer/atoms/agent-atoms.ts'
import type { AgentStreamState } from '../../../renderer/atoms/agent-atoms.ts'
import { DesktopClient } from './client.ts'
import { DesktopRouter } from './router.ts'
const clients:DesktopClient[]=[]
const roots:string[]=[]
afterEach(()=>{for(const client of clients.splice(0))client.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const input={sessionId:'s',requestId:'r',channelId:'p',modelId:'m',userMessage:'synthetic draft',startedAt:123,effort:'high' as const}
const turn:DesktopTurn={...input,profileId:'p',effort:'high',runId:'r',userMessageId:'r-user',assistantMessageId:'r-assistant',configRevision:'v1',assistantMessage:'',status:'running',sequence:1,errorCode:null}
// 去掉 AgentSendInput 专有字段，确保 fake wire 也通过真实 decoder。
const {channelId:_channel,...wireTurn}=turn as DesktopTurn & {channelId?:string}
function fixture(mode:'backlog'|'eventsError'|'historyError'|'invalidSnapshot') {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'tinker-router-fault-')));roots.push(root)
 const binary=join(root,'fake-runtime')
 const script=`#!/usr/bin/env python3
import json,sys
turn=json.loads(${JSON.stringify(JSON.stringify(wireTurn))})
mode=${JSON.stringify(mode)}
for line in sys.stdin:
 request=json.loads(line);method=request['method'];params=request['params']
 reply={'version':1,'id':request['id']}
 if method=='chat.send':
  reply['result']=dict(turn)
 elif method=='chat.events' and mode=='eventsError':
  reply['error']={'code':'storeIo'}
 elif method=='chat.events':
  after=params['afterSequence']
  current=dict(turn)
  if mode=='historyError':
   current.update(status='completed',sequence=2,assistantMessage='durable partial')
   events=[{'sequence':2,'kind':'completed','text':None}]
  elif after<201:
   current.update(sequence=201,assistantMessage='界'*200)
   events=[{'sequence':i,'kind':'started' if i==1 else 'delta','text':None if i==1 else '界'} for i in range(after+1,min(after+128,201)+1)]
  elif after==201:
   current.update(sequence=202,assistantMessage='界'*200+'新')
   events=[{'sequence':202,'kind':'delta','text':'新'}]
  else:
   current.update(status='completed',sequence=203,assistantMessage='界'*200+'新')
   events=[{'sequence':203,'kind':'completed','text':None}]
  for event in events:event.update(sessionId='s',requestId='r',runId='r',startedAt=123,errorCode=None)
  cursor=events[-1]['sequence']
  if mode=='invalidSnapshot':current['sequence']=cursor-1
  reply['result']={'turn':current,'events':events,'nextAfterSequence':cursor,'hasMore':cursor<current['sequence']}
 elif method=='sessions.history' and mode=='historyError':
  reply['error']={'code':'storeIo'}
 elif method=='sessions.history':
  current=dict(turn);current.update(status='completed',sequence=203,assistantMessage='界'*200+'新')
  reply['result']={'turns':[current],'nextAfter':1,'hasMore':False}
 else:
  reply['error']={'code':'unknownMethod'}
 print(json.dumps(reply),flush=True)
`
 writeFileSync(binary,script,{mode:0o700})
 const config={root,binary,profilesFile:'',compatHome:''}
 const client=new DesktopClient(config);clients.push(client)
 return {client,router:new DesktopRouter(client,config)}
}
test('restore latest snapshot over multiple unconsumed pages appends only later deltas',async()=>{
 const {router}=fixture('backlog')
 let state:AgentStreamState={running:true,content:'',toolActivities:[],teammates:[]}
 const observed:string[]=[]
 const sender={isDestroyed:()=>false,send:(channel:string,payload:unknown)=>{
  if(channel!==AGENT_IPC_CHANNELS.STREAM_EVENT)return
  const event=payload as AgentStreamEvent
  if(event.payload.kind==='sdk_message' && event.payload.message.type==='user')router.restoreStream('s',sender)
  if(event.payload.kind!=='asci_event')return
  const data=event.payload.event
  if(data.type==='text_snapshot')state=applyAgentEvent(state,{type:'text_complete',text:data.text,isIntermediate:false})
  if(data.type==='text_delta')state=applyAgentEvent(state,{type:'text_delta',text:data.text})
  observed.push(state.content)
 }}
 await router.send(input,sender)
 expect(observed).toEqual(['界'.repeat(200),'界'.repeat(200)+'新'])
 expect(state.content).toBe('界'.repeat(200)+'新')
})
test.each(['eventsError','historyError'] as const)('post-start %s rejects sanitized send and never reports success',async mode=>{
 const {client,router}=fixture(mode)
 const events:{channel:string;payload:unknown}[]=[]
 const sender={isDestroyed:()=>false,send:(channel:string,payload:unknown)=>events.push({channel,payload})}
 let draft='synthetic draft'
 const result=await router.send(input,sender).then(()=>{draft='';return 'resolved'},error=>String(error))
 expect(result).not.toBe('resolved')
 expect(result).not.toContain('storeIo')
 expect(draft).toBe('synthetic draft')
 expect(events.filter(e=>e.channel===AGENT_IPC_CHANNELS.STREAM_ERROR)).toHaveLength(1)
 const complete=events.filter(e=>e.channel===AGENT_IPC_CHANNELS.STREAM_COMPLETE)
 expect(complete).toHaveLength(1)
 expect(JSON.stringify(complete)).not.toContain('"success"')
 if(mode==='eventsError')await expect(client.request('runtime.describe',{})).rejects.toThrow('DESKTOP_TRANSPORT')
})

test('snapshot sequence cannot precede the event page cursor',async()=>{
 const {router}=fixture('invalidSnapshot')
 const sender={isDestroyed:()=>false,send:()=>{}}
 await expect(router.send(input,sender)).rejects.toThrow()
})
