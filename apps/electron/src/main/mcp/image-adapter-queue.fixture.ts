/** 使用真实 adapter 与合成 SDK 流验证 replay 消费边界，不启动 CLI 或访问模型。 */
import { expect, mock } from 'bun:test'
import { ImageRequestAuthorization, IMAGE_GENERATION_TOOL } from '@asci/shared'
import { ImageTurnController, injectQueuedImageMessage } from './image-turn-controller.ts'
import type { SDKMessage } from '@asci/shared'
import type { ClaudeAgentQueryOptions } from '../lib/adapters/claude-agent-adapter.ts'

interface FixtureSdkInput {prompt:AsyncGenerator<{uuid?:string;message:{content:string}}> ;options:{extraArgs?:Record<string,string|null>}}
mock.module('@anthropic-ai/claude-agent-sdk',()=>({query:({prompt,options}:FixtureSdkInput)=>(async function*(){
 expect(options.extraArgs?.['replay-user-messages']).toBeNull()
 const initial=await prompt.next()
 expect(initial.value?.uuid).toBe('initial-user')
 yield {type:'user',uuid:initial.value?.uuid,isReplay:true,parent_tool_use_id:null,message:{content:initial.value?.message.content}}
 const next=await prompt.next()
 yield {type:'user',uuid:next.value?.uuid,isReplay:true,parent_tool_use_id:null,message:{content:next.value?.message.content}}
 yield {type:'result',subtype:'success'}
})()}))
try{
 const {ClaudeAgentAdapter}=await import('../lib/adapters/claude-agent-adapter.ts')
 const adapter=new ClaudeAgentAdapter()
 const create=(id:string,userMessage:string)=>({id,authorization:new ImageRequestAuthorization({userMessage})})
 const controller=new ImageTurnController(create('initial','生成图片'),create,['initial-user'])
 const options:ClaudeAgentQueryOptions={sessionId:'fixture',prompt:'initial prompt',inputMessageUuid:'initial-user',sdkCliPath:'unused',executable:{type:'node',path:'unused'},executableArgs:[],env:{},sdkPermissionMode:'acceptEdits',allowDangerouslySkipPermissions:false,systemPrompt:'fixture',onUserMessageConsumed:message=>{controller.consume(message)}}
 const iterator=adapter.query(options)[Symbol.asyncIterator]()
 const initial=await iterator.next()
 expect((initial.value as SDKMessage).type).toBe('user')
 expect(controller.getScopeId()).toBe('initial')
 await injectQueuedImageMessage({controller,id:'queued-user',text:'继续帮我生图',send:()=>adapter.sendQueuedMessage('fixture',{type:'user',uuid:'queued-user',message:{role:'user',content:'继续帮我生图'},parent_tool_use_id:null,session_id:'fixture',priority:'next'})})
 expect(controller.getScopeId()).toBe('initial')
 await iterator.next()
 expect(controller.getScopeId()).toBe('queued-user')
 expect(controller.authorize(IMAGE_GENERATION_TOOL,{prompt:'queued image'},'new-call').action).toBe('allow')
 await iterator.next();await iterator.next()
 console.log('IMAGE_ADAPTER_QUEUE_PASS: replay enabled, initial UUID bound, queued scope switches only at actual SDK user echo')
}finally{mock.restore()}
