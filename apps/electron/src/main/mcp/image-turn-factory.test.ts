import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IMAGE_GENERATION_TOOL } from '@asci/shared'
import { ImageAssets } from './image-assets.ts'
import { createImageTurnFactory } from './image-turn-factory.ts'
import { ImageTurnController, injectQueuedImageMessage } from './image-turn-controller.ts'

const user=(uuid:string,text:string)=>({type:'user',uuid,parent_tool_use_id:null,message:{content:[{type:'text',text}]}})
const consumed=(uuid:string)=>({...user(uuid,'不可信的 SDK 回显'),isReplay:true})
const request={prompt:'scene'}
test('宿主历史恢复图片任务，正常手动重试与选图编辑可通过；历史噪声不扩权',()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-turn-factory-'))
 try {
  const create=createImageTurnFactory('s',directory,directory,[user('a','帮我生图')])
  expect(create('retry-image','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('allow')
  const reset=createImageTurnFactory('s',directory,directory,[user('a','帮我生图'),user('b','写一个函数')])
  expect(reset('c','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  const noise=createImageTurnFactory('s',directory,directory,[{...user('a','帮我生图'),isSynthetic:true},{...user('b','帮我生图'),message:{content:[{type:'tool_result',content:'帮我生图'}]}}])
  expect(noise('c','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  writeFileSync(join(directory,'chosen.png'),Buffer.from([137,80,78,71,13,10,26,10]))
  new ImageAssets(directory).add({id:'chosen',filename:'chosen.png',prompt:'p',channelId:'c',model:'m',referenceIds:[]})
  const selected=createImageTurnFactory('s',directory,directory,[])('d','把这个女生加入旁边 并换了一个泳衣','chosen')
  expect(selected.authorization.authorize(IMAGE_GENERATION_TOOL,{...request,baseImageId:'chosen'}).action).toBe('allow')
  expect(selected.authorization.authorize(IMAGE_GENERATION_TOOL,{...request,baseImageId:'other'}).action).toBe('deny')
 } finally {rmSync(directory,{recursive:true,force:true})}
})
test('队列 next/now/失败只按真正消费顺序轮换上下文和限额',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-queue-context-'))
 try {
  const create=createImageTurnFactory('s',directory,directory,[])
  const controller=new ImageTurnController(create('a','帮我生图'),create)
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'old').action).toBe('allow')
  await injectQueuedImageMessage({controller,id:'b',text:'再次生成',send:async()=>{}})
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'old').action).toBe('allow')
  expect(controller.consume(consumed('b'))).toBe(true)
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'new').action).toBe('allow')
  expect(controller.authorize(IMAGE_GENERATION_TOOL,{prompt:'extra'},'extra').action).toBe('ask')
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'old').action).toBe('deny')
  await expect(injectQueuedImageMessage({controller,id:'failed',text:'写一个函数',send:async()=>{throw new Error('failed')}})).rejects.toThrow('failed')
  expect(controller.consume(consumed('failed'))).toBe(false)
  await injectQueuedImageMessage({controller,id:'now',text:'重新生成',interrupt:async()=>true,send:async()=>{}})
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'new').action).toBe('deny')
  expect(controller.consume(consumed('now'))).toBe(true)
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'after-now').action).toBe('allow')
  controller.enqueue('code','写一个函数');controller.enqueue('later','再次生成')
  controller.consume(consumed('code'));controller.consume(consumed('later'))
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'unrelated').action).toBe('ask')
  controller.cancel()
  expect(controller.authorize(IMAGE_GENERATION_TOOL,request,'late').action).toBe('deny')
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('当前真实上传可表达自然编辑，历史附件和 SDK 回放不能维持过期任务',()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-upload-context-'))
 try {
  const path=join(directory,'upload.png')
  writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10]))
  const attachment=`<attached_files>\n- upload.png: ${path}\n</attached_files>\n`
  const create=createImageTurnFactory('s',directory,directory,[])
  expect(create('a',attachment+'把背景换成蓝色').authorization.authorize(IMAGE_GENERATION_TOOL,{...request,referenceImagePaths:[path]}).action).toBe('allow')
  const reset=createImageTurnFactory('s',directory,directory,[user('a',attachment+'帮我生图'),user('b','写代码'),{...user('a','帮我生图'),isReplay:true}])
  expect(reset('c','把背景换成蓝色').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  expect(reset('d','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  const foreign=attachment.replace(path,'/another-session/upload.png')
  expect(reset('e',foreign+'把背景换成蓝色').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('重建 query 不把未消费队列或独立 replay 当成图片任务',()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-consumed-history-'))
 try {
  const history=[user('a','写一个函数'),{...user('pending','帮我生图'),_imageQueued:true}]
  const reset=createImageTurnFactory('s',directory,directory,history)
  expect(reset('retry','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  const replay=createImageTurnFactory('s',directory,directory,[user('a','写一个函数'),{...user('independent','帮我生图'),isReplay:true}])
  expect(replay('retry2','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  const live=createImageTurnFactory('s',directory,directory,[])
  const controller=new ImageTurnController(live('a','写一个函数'),live)
  controller.enqueue('pending','帮我生图')
  expect(controller.consume(consumed('pending'))).toBe(true)
  const recovered=createImageTurnFactory('s',directory,directory,history)
  expect(recovered('retry3','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('allow')
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('恢复保留 now/next 实际消费顺序，消费日志缺失或截断均不能复活旧图片任务',()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-order-context-'))
 try {
  const history=[user('a','普通任务'),{...user('b','写一个函数'),_imageQueued:true},{...user('c','帮我生图'),_imageQueued:true}]
  const create=createImageTurnFactory('s',directory,directory,[])
  const controller=new ImageTurnController(create('a','普通任务'),create)
  controller.enqueue('b','写一个函数');controller.enqueue('c','帮我生图')
  controller.consume(consumed('c'));controller.consume(consumed('b'))
  expect(createImageTurnFactory('s',directory,directory,history)('retry','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  const revoked=[user('image','帮我生图'),{...user('code','写一个函数'),_imageQueued:true}]
  rmSync(join(directory,'.image-consumed-turns.jsonl'))
  expect(createImageTurnFactory('s',directory,directory,revoked)('missing','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  writeFileSync(join(directory,'.image-consumed-turns.jsonl'),'"image"\n{"id":')
  expect(createImageTurnFactory('s',directory,directory,revoked)('truncated','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('ask')
  const fresh=createImageTurnFactory('s',directory,directory,revoked)
  fresh('fresh','帮我生图')
  const renewed=[...revoked,user('fresh','帮我生图')]
  expect(createImageTurnFactory('s',directory,directory,renewed)('safe-retry','再次生成').authorization.authorize(IMAGE_GENERATION_TOOL,request).action).toBe('allow')
 }finally{rmSync(directory,{recursive:true,force:true})}
})
