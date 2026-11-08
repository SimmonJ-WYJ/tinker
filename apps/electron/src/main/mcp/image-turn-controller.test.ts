import { expect, test } from 'bun:test'
import { ImageRequestAuthorization, IMAGE_GENERATION_TOOL } from '@asci/shared'
import { ImageTurnController } from './image-turn-controller.ts'
import { ImageExecutionGuard } from './image-execution-guard.ts'
const input={prompt:'office'}
const create=(id:string,userMessage:string)=>({id,authorization:new ImageRequestAuthorization({userMessage})})
const consumed=(uuid:string)=>({type:'user',uuid,source_uuid:uuid,isReplay:true,parent_tool_use_id:null,message:{content:[{type:'text',text:'untrusted echo'}]}})

test('next只排队，消费前当前图继续；消费后旧调用不能继承新scope',async()=>{
 const controller=new ImageTurnController(create('initial','生成图片'),create)
 controller.authorize(IMAGE_GENERATION_TOOL,input,'old')
 const oldGuard=new ImageExecutionGuard({authorization:controller.current.authorization})
 controller.enqueue('next','继续帮我生图')
 expect(controller.getScopeId()).toBe('initial')
 expect(await oldGuard.run(input,'bytes',async()=>'saved')).toBe('saved')
 expect(controller.consume(consumed('next'))).toBe(true)
 expect(controller.getScopeId()).toBe('next')
 expect(controller.authorize(IMAGE_GENERATION_TOOL,input,'new').action).toBe('allow')
 expect(controller.authorize(IMAGE_GENERATION_TOOL,input,'old').action).toBe('deny')
 await expect(oldGuard.run(input,'bytes',async()=>'bad')).rejects.toThrow('ended')
})
test('now中断只撤销旧scope，实际消费新user后重新允许；注入失败不切换',()=>{
 const controller=new ImageTurnController(create('initial','生成图片'),create)
 controller.enqueue('failed','继续帮我生图')
 controller.removeQueued('failed')
 expect(controller.consume(consumed('failed'))).toBe(false)
 expect(controller.authorize(IMAGE_GENERATION_TOOL,input,'initial-call').action).toBe('allow')
 controller.enqueue('now','继续帮我生图')
 controller.interrupt()
 expect(controller.authorize(IMAGE_GENERATION_TOOL,input,'late-old').action).toBe('deny')
 expect(controller.consume(consumed('now'))).toBe(true)
 expect(controller.authorize(IMAGE_GENERATION_TOOL,input,'new').action).toBe('allow')
})
test('只接受当前已登记的真实replay回显，拒绝历史、synthetic和tool_result',()=>{
 const controller=new ImageTurnController(create('initial','生成图片'),create)
 controller.enqueue('next','继续帮我生图')
 for(const message of [consumed('history'),{...consumed('next'),isSynthetic:true},consumed('unknown'),{...consumed('next'),message:{content:[{type:'tool_result'}]}}])expect(controller.consume(message)).toBe(false)
 expect(controller.getScopeId()).toBe('initial')
 expect(controller.consume(consumed('next'))).toBe(true)
})

 test('重复UUID不能被CLI的重复回放ack解释成新授权',()=>{
 const controller=new ImageTurnController(create('initial','生成图片'),create)
 controller.enqueue('next','继续帮我生图')
 expect(controller.consume(consumed('next'))).toBe(true)
 expect(()=>controller.enqueue('next','继续帮我生图')).toThrow('identity')
 expect(controller.consume(consumed('next'))).toBe(false)
 })

 test('历史和初始真实user UUID不能以新的queued消息登记',()=>{
 const controller=new ImageTurnController(create('initial','生成图片'),create,['old-user','initial-real-user'])
 expect(()=>controller.enqueue('old-user','生成图片')).toThrow('identity')
 expect(()=>controller.enqueue('initial-real-user','生成图片')).toThrow('identity')
 expect(controller.consume(consumed('old-user'))).toBe(false)
 expect(controller.getScopeId()).toBe('initial')
 })

import { injectQueuedImageMessage } from './image-turn-controller.ts'
test('队列注入失败回滚本次登记，重复注入不删除先前已登记消息',async()=>{
 const controller=new ImageTurnController(create('initial','生成图片'),create)
 await expect(injectQueuedImageMessage({controller,id:'failed',text:'生成图片',send:async()=>{throw new Error('injection failed')}})).rejects.toThrow('injection failed')
 expect(controller.consume(consumed('failed'))).toBe(false)
 expect(controller.authorize(IMAGE_GENERATION_TOOL,input,'initial-call').action).toBe('allow')
 await injectQueuedImageMessage({controller,id:'queued',text:'继续帮我生图',send:async()=>{}})
 await expect(injectQueuedImageMessage({controller,id:'queued',text:'替代文本',send:async()=>{}})).rejects.toThrow('identity')
 expect(controller.consume(consumed('queued'))).toBe(true)
 expect(controller.authorize(IMAGE_GENERATION_TOOL,input,'new').action).toBe('allow')
})
