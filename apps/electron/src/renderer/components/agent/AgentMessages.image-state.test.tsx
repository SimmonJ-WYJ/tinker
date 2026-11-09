/** 真实列表组合回归：Stop 已触发但后端尚未回传完成时，live 消息不再冒充运行。 */
import * as React from 'react'
import {afterEach,expect,test} from 'bun:test'
import {render,cleanup,act} from '@testing-library/react'
import {queuedMessageUuidsAtom} from '@/atoms/agent-atoms'
import {Provider,createStore} from 'jotai'
import type {SDKMessage} from '@asci/shared'
import {AgentMessages} from './AgentMessages.tsx'
import {TooltipProvider} from '@/components/ui/tooltip'
const persisted:SDKMessage[]=[{type:'user',uuid:'user',parent_tool_use_id:null,message:{content:[{type:'text',text:'Create a synthetic image'}]}}]
const live:SDKMessage[]=[{type:'assistant',uuid:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'pending-image',name:'mcp__asci-image__generate_image',input:{prompt:'Synthetic'}}]}}]
const originalApi=window.electronAPI
afterEach(()=>{cleanup();window.electronAPI=originalApi})
test('保留 live 消息也按真实 streaming=false 显示 stopped，继续运行时显示 generating',()=>{
 const store=createStore()
 const tree=(streaming:boolean)=><Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-stop" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={live} streaming={streaming} stoppedByUser={!streaming}/></TooltipProvider></Provider>
 const view=render(tree(true))
 expect(view.container.querySelector('[data-image-task-state="generating"]')).not.toBeNull()
 view.rerender(tree(false))
 expect(view.container.querySelector('[data-image-task-state="stopped"]')).not.toBeNull()
 expect(view.container.querySelector('[data-image-task-state="generating"]')).toBeNull()
})

test('等待使用静态品牌 Logo，思考到生图只有一个流光主状态，停止后无残留',()=>{
 const store=createStore()
 const tree=(streaming:boolean,active:SDKMessage[])=><Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-shimmer" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={active} streaming={streaming} stoppedByUser={!streaming}/></TooltipProvider></Provider>
 const view=render(tree(true,[]))
 expect(view.container.querySelector('.is-assistant > .conversation-symbol')).not.toBeNull()
 expect(view.container.querySelectorAll('[data-thinking-orb]')).toHaveLength(0)
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 const thinking:SDKMessage[]=[{type:'assistant',uuid:'thinking',parent_tool_use_id:null,message:{content:[{type:'thinking',thinking:'Synthetic thought',signature:'synthetic'}]}}]
 view.rerender(tree(true,thinking))
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 expect(view.container.querySelectorAll('.conversation-symbol')).toHaveLength(1)
 view.rerender(tree(true,live))
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 expect(view.container.querySelector('[data-image-task-state="generating"] .agent-status-text[data-active="true"]')).not.toBeNull()
 expect(view.container.querySelectorAll('[data-thinking-orb]')).toHaveLength(0)
 view.rerender(tree(false,live))
 expect(view.container.querySelector('[data-image-task-state="stopped"]')).not.toBeNull()
 expect(view.container.querySelector('.agent-status-text[data-active="true"]')===null).toBe(true)
})

test.each(['stopped','failed'] as const)('宿主已标记 %s 时，不等待延迟的 streaming 标记才停高光',state=>{
 const store=createStore()
 const streamState={running:false,content:'',toolActivities:[],teammates:[],retrying:state==='failed'?{currentAttempt:3,maxAttempts:3,history:[],failed:true}:undefined}
 const view=render(<Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-late-end" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={state==='stopped'?live:[]} streaming streamState={streamState} stoppedByUser={state==='stopped'}/></TooltipProvider></Provider>)
 expect(view.container.querySelector('.agent-status-text[data-active="true"]')===null).toBe(true)
 if(state==='stopped')expect(view.container.querySelector('[data-image-task-state="stopped"]')).not.toBeNull()
})

test.each(['','   \n '])('首个 text 块为空或空白时，只保留一个 Logo 和一个思考主状态：%j',text=>{
 const store=createStore()
 const pending:SDKMessage[]=[{type:'assistant',uuid:'empty-token',parent_tool_use_id:null,message:{content:[{type:'text',text}]}}]
 const view=render(<Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-empty-token" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={pending} streaming /></TooltipProvider></Provider>)
 expect(view.container.querySelectorAll('.conversation-symbol')).toHaveLength(1)
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 expect(view.container.querySelectorAll('[data-thinking-orb]')).toHaveLength(0)
})

test.each([false,true])('纯正文流式输出仍有一个运行提示，已有思考块=%s',withThinking=>{
 const store=createStore()
 const content=withThinking?[{type:'thinking' as const,thinking:'Synthetic thought',signature:'synthetic'},{type:'text' as const,text:'Partial answer'}]:[{type:'text' as const,text:'Partial answer'}]
 const active:SDKMessage[]=[{type:'assistant',uuid:'partial-answer',parent_tool_use_id:null,message:{content}}]
 const view=render(<Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-partial" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={active} streaming /></TooltipProvider></Provider>)
 expect(view.container.querySelectorAll('.conversation-symbol')).toHaveLength(1)
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
})

test('排队输入开启新回合后，旧 live 回合不再高光；等待下一回合时同样如此',()=>{
 const store=createStore()
 const first:SDKMessage={type:'assistant',uuid:'first-turn',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'first-search',name:'WebSearch',input:{query:'synthetic first'}}]}}
 const done:SDKMessage={type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'first-search',content:'Completed'}]}}
 const next:SDKMessage={type:'user',uuid:'queued-input',parent_tool_use_id:null,message:{content:[{type:'text',text:'Check next synthetic source'}]}}
 const second:SDKMessage={type:'assistant',uuid:'second-turn',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'second-search',name:'WebSearch',input:{query:'synthetic second'}}]}}
 const tree=(active:SDKMessage[])=><Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-queued" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={active} streaming /></TooltipProvider></Provider>
 const view=render(tree([first,done,next,second]))
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 expect(view.container.querySelectorAll('[data-agent-process]')[0]?.querySelector('.agent-status-text[data-active="true"]')).toBeNull()
 view.rerender(tree([first,done,next]))
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 expect(view.container.querySelectorAll('[data-agent-process]')[0]?.querySelector('.agent-status-text[data-active="true"]')).toBeNull()
})


test('仅乐观入队不结束当前生图，现有队列完成后才推进输入边界',()=>{
 window.electronAPI={readAttachment:async()=>''} as unknown as Window['electronAPI']
 const store=createStore(),sessionId='synthetic-fifo'
 const queued:SDKMessage={type:'user',uuid:'optimistic-queued',parent_tool_use_id:null,message:{content:[{type:'text',text:'Next queued task'}]}}
 store.set(queuedMessageUuidsAtom,new Map([[sessionId,[{uuid:'optimistic-queued',text:'Next queued task'}]]]))
 const tree=(active:SDKMessage[])=><Provider store={store}><TooltipProvider><AgentMessages sessionId={sessionId} messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={active} streaming /></TooltipProvider></Provider>
 const view=render(tree(live))
 view.rerender(tree([...live,queued]))
 expect(view.container.querySelector('[data-image-task-state="generating"]')).not.toBeNull()
 expect(view.container.querySelector('[data-image-task-state="incomplete"]')).toBeNull()
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 const done:SDKMessage={type:'user',parent_tool_use_id:null,message:{content:[{type:'tool_result',tool_use_id:'pending-image',content:JSON.stringify({imageId:'done',generatedImage:{localPath:'session/done.png',filename:'done.png',mediaType:'image/png'}})}]}}
 view.rerender(tree([...live,done,queued]))
 act(()=>store.set(queuedMessageUuidsAtom,new Map()))
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 expect(view.container.querySelector('[data-image-task-state="generated"] .agent-status-text[data-active="true"]')).toBeNull()
})

test('压缩边界前的回合静态，边界后的真实助手才重新开始高光',()=>{
 const store=createStore()
 const first:SDKMessage={type:'assistant',uuid:'compact-old',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'old-search',name:'WebSearch',input:{query:'synthetic'}}]}}
 const boundary={type:'system',subtype:'compact_boundary',compact_metadata:{trigger:'auto',pre_tokens:10}} as SDKMessage
 const second:SDKMessage={type:'assistant',uuid:'compact-new',parent_tool_use_id:null,message:{content:[{type:'thinking',thinking:'New synthetic thought',signature:'synthetic'}]}}
 const state={running:true,content:'',toolActivities:[],teammates:[],isCompacting:false,compactInFlight:true}
 const tree=(active:SDKMessage[])=><Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-compaction" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={active} streaming streamState={state}/></TooltipProvider></Provider>
 const view=render(tree([first,boundary]))
 expect(view.container.querySelector('.agent-status-text[data-active="true"]')===null).toBe(true)
 view.rerender(tree([first,boundary,second]))
 expect(view.container.querySelectorAll('.agent-status-text[data-active="true"]')).toHaveLength(1)
 expect(view.container.querySelector('[data-agent-process] .agent-status-text[data-active="true"]')).toBeNull()
})
