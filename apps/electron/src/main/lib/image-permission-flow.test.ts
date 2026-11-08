import { expect, test } from 'bun:test'
import { AgentPermissionService } from './agent-permission-service.ts'
import type { PermissionRequest } from '@asci/shared'
const options=()=>({signal:new AbortController().signal,toolUseID:'test-use'})
test('本会话图片只读工具免重复确认，付费生成仍逐次确认',async()=>{
 const service=new AgentPermissionService({cwd:'/workspace',workspaceRoot:'/workspace',homeDir:'/home/test'})
 const requests:PermissionRequest[]=[]
 const use=service.createCanUseTool('s',r=>requests.push(r))
 try{
  for(const tool of ['inspect_image','list_images']){
   const result=await Promise.race([use(`mcp__asci-image__${tool}`,{imageId:'fixture'},options()),new Promise(resolve=>setTimeout(()=>resolve('pending'),10))])
   expect(result).toMatchObject({behavior:'allow'})
  }
  const pending=use('mcp__asci-image__generate_image',{prompt:'fixture'},options())
  const request=requests.at(-1)!
  expect(request.canAlwaysAllow).toBe(false)
  service.respondToPermission(request.requestId,'allow',true)
  expect(await pending).toMatchObject({behavior:'allow'})
  const again=use('mcp__asci-image__generate_image',{prompt:'fixture2'},options())
  expect(requests.at(-1)?.requestId).not.toBe(request.requestId)
  service.respondToPermission(requests.at(-1)!.requestId,'deny',false)
  expect(await again).toMatchObject({behavior:'deny'})
 }finally{service.clearSessionPending('s')}
})
test('子任务也不能绕过付费确认',async()=>{
 const service=new AgentPermissionService({cwd:'/workspace',workspaceRoot:'/workspace',homeDir:'/home/test'})
 const requests:PermissionRequest[]=[]
 const use=service.createCanUseTool('s',r=>requests.push(r))
 const pending=use('mcp__asci-image__generate_image',{prompt:'fixture'},{...options(),agentID:'worker'})
 try{expect(requests.length).toBe(1)}finally{service.clearSessionPending('s');await pending}
})

test('SDK 自动/跳过模式之前仍完成一次付费授权，hook 返回最终决定',async()=>{
 const service=new AgentPermissionService({cwd:'/workspace',workspaceRoot:'/workspace',homeDir:'/home/test'})
 const requests:PermissionRequest[]=[]
 const confirm=service.createCanUseTool('s',request=>requests.push(request))
 const hook=service.createPreToolUseHardRuleHookForSession('s',{shouldAsk:()=>false,confirmPaidImage:confirm})
 const input={hook_event_name:'PreToolUse' as const,tool_name:'mcp__asci-image__generate_image',tool_input:{prompt:'fixture'},session_id:'s',transcript_path:'/tmp/fixture',cwd:'/workspace',tool_use_id:'paid-call'}
 const pending=hook(input,'paid-call',{signal:new AbortController().signal})
 expect(requests.length).toBe(1)
 expect(requests[0]!.canAlwaysAllow).toBe(false)
 service.respondToPermission(requests[0]!.requestId,'allow',false)
 expect(await pending).toMatchObject({hookSpecificOutput:{permissionDecision:'allow'}})
 const denied=hook(input,'next-paid-call',{signal:new AbortController().signal})
 service.respondToPermission(requests[1]!.requestId,'deny',false)
 expect(await denied).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}})
 expect(await hook(input,undefined,{signal:new AbortController().signal})).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}})
})

test('当前用户回合已授权的宿主生图不再发出权限卡', async () => {
 const service=new AgentPermissionService({cwd:'/workspace',workspaceRoot:'/workspace',homeDir:'/home/test'})
 const requests:PermissionRequest[]=[]
 const authorization={authorize:()=>({action:'allow' as const,reason:'Current user requested one image'}),approve:()=>{}}
 const use=service.createCanUseTool('explicit-turn',r=>requests.push(r),undefined,undefined,authorization)
 try {
  const result=await Promise.race([use('mcp__asci-image__generate_image',{prompt:'an office scene'},options()),new Promise(resolve=>setTimeout(()=>resolve('blocked'),30))])
  expect(result).toMatchObject({behavior:'allow'})
  expect(requests).toHaveLength(0)
 }finally{service.clearSessionPending('explicit-turn')}
})

import { ImageRequestAuthorization, IMAGE_GENERATION_TOOL } from '@asci/shared'

test('本回合hook/SDK重复回调只显示一次卡，批准后只覆盖精确参数', async () => {
 const service=new AgentPermissionService()
 const requests:PermissionRequest[]=[]
 const scope=new ImageRequestAuthorization({userMessage:'看看这个需求'})
 const use=service.createCanUseTool('s',r=>requests.push(r),undefined,undefined,scope)
 const first=use(IMAGE_GENERATION_TOOL,{prompt:'first'},options())
 const duplicate=use(IMAGE_GENERATION_TOOL,{prompt:'first'},options())
 const duplicateId=use(IMAGE_GENERATION_TOOL,{prompt:'first'},{...options(),toolUseID:'duplicate-id'})
 try {
  expect(requests).toHaveLength(1)
  service.respondToPermission(requests[0]!.requestId,'allow',true)
  expect(await first).toMatchObject({behavior:'allow'})
  expect(await duplicate).toMatchObject({behavior:'allow'})
  expect(await duplicateId).toMatchObject({behavior:'allow'})
  expect(await use(IMAGE_GENERATION_TOOL,{prompt:'changed'},options())).toMatchObject({behavior:'deny'})
 }finally{service.clearSessionPending('s')}
})

test('取消的请求与晚到批准不能扩展本回合授权', async () => {
 const service=new AgentPermissionService()
 const requests:PermissionRequest[]=[]
 const scope=new ImageRequestAuthorization({userMessage:'看看这个需求'})
 const controller=new AbortController()
 const use=service.createCanUseTool('s',r=>requests.push(r),undefined,undefined,scope)
 const pending=use(IMAGE_GENERATION_TOOL,{prompt:'first'},{...options(),signal:controller.signal})
 controller.abort()
 expect(await pending).toMatchObject({behavior:'deny'})
 expect(service.respondToPermission(requests[0]!.requestId,'allow',false)).toBeNull()
 expect(scope.authorize(IMAGE_GENERATION_TOOL,{prompt:'first'},'test-use').action).toBe('ask')
 expect(await use(IMAGE_GENERATION_TOOL,{prompt:'first'},{...options(),signal:controller.signal})).toMatchObject({behavior:'deny'})
})

test('明确生图在worker模式复用授权，危险终端仍被硬规则阻止', async () => {
 const service=new AgentPermissionService()
 const requests:PermissionRequest[]=[]
 const scope=new ImageRequestAuthorization({userMessage:'生成图片'})
 const use=service.createCanUseTool('s',r=>requests.push(r),undefined,undefined,scope)
 expect(await use(IMAGE_GENERATION_TOOL,{prompt:'first'},{...options(),agentID:'worker'})).toMatchObject({behavior:'allow'})
 expect(await use('Bash',{command:'rm -rf /'},{...options(),agentID:'worker'})).toMatchObject({behavior:'deny'})
 expect(requests).toHaveLength(0)
})

test('计划模式hook即使有生图意图也不能提前执行或发审批卡', async () => {
 const service=new AgentPermissionService()
 let confirmed=false
 const hook=service.createPreToolUseHardRuleHookForSession('s',{imageGenerationAllowed:()=>false,confirmPaidImage:async()=>{confirmed=true;return {behavior:'allow',updatedInput:{}}}})
 const result=await hook({hook_event_name:'PreToolUse',tool_name:IMAGE_GENERATION_TOOL,tool_input:{prompt:'first'},session_id:'s',transcript_path:'/tmp/fixture',cwd:'/workspace',tool_use_id:'one'},'one',{signal:new AbortController().signal})
 expect(result).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}})
 expect(confirmed).toBe(false)
})

import { ImageTurnController } from '../mcp/image-turn-controller.ts'
test('流内新用户回合不会复用旧权限promise，旧卡晚到批准也不能恢复',async()=>{
 const service=new AgentPermissionService()
 const requests:PermissionRequest[]=[]
 const create=(id:string,userMessage:string)=>({id,authorization:new ImageRequestAuthorization({userMessage})})
 const scope=new ImageTurnController(create('initial','讨论需求'),create)
 const use=service.createCanUseTool('s',r=>requests.push(r),undefined,undefined,scope)
 const prior=use(IMAGE_GENERATION_TOOL,{prompt:'same'},{...options(),toolUseID:'old'})
 scope.enqueue('next','继续讨论需求')
 expect(scope.consume({type:'user',uuid:'next',isReplay:true,parent_tool_use_id:null})).toBe(true)
 service.respondToPermission(requests[0]!.requestId,'allow',false)
 expect(await prior).toMatchObject({behavior:'deny'})
 const current=use(IMAGE_GENERATION_TOOL,{prompt:'same'},{...options(),toolUseID:'new'})
 expect(requests).toHaveLength(2)
 service.respondToPermission(requests[1]!.requestId,'deny',false)
 expect(await current).toMatchObject({behavior:'deny'})
})

test('真实宿主上下文的自然续作经过 hook 与 canUseTool 均不弹卡',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const {createImageTurnFactory}=await import('../mcp/image-turn-factory.ts')
 const directory=mkdtempSync(join(tmpdir(),'image-context-permission-'))
 const service=new AgentPermissionService()
 const requests:PermissionRequest[]=[]
 try{
  const create=createImageTurnFactory('s',directory,directory,[{type:'user',uuid:'prior',parent_tool_use_id:null,message:{content:[{type:'text',text:'帮我生图'}]}}])
  const controller=new ImageTurnController(create('retry','再次生成'),create)
  const use=service.createCanUseTool('s',request=>requests.push(request),undefined,undefined,controller)
  const hook=service.createPreToolUseHardRuleHookForSession('s',{confirmPaidImage:use})
  const input={prompt:'retry scene'}
  const hookResult=await hook({hook_event_name:'PreToolUse',tool_name:IMAGE_GENERATION_TOOL,tool_input:input,session_id:'s',transcript_path:'/tmp/fixture',cwd:directory,tool_use_id:'retry-call'},'retry-call',{signal:new AbortController().signal})
  expect(hookResult).toMatchObject({hookSpecificOutput:{permissionDecision:'allow'}})
  expect(await use(IMAGE_GENERATION_TOOL,input,{...options(),toolUseID:'retry-call'})).toMatchObject({behavior:'allow'})
  expect(requests).toHaveLength(0)
  expect(await use('Bash',{command:'rm -rf /'},{...options(),toolUseID:'danger'})).toMatchObject({behavior:'deny'})
  controller.interrupt()
  expect(await use(IMAGE_GENERATION_TOOL,input,{...options(),toolUseID:'retry-call'})).toMatchObject({behavior:'deny'})
 }finally{service.clearSessionPending('s');rmSync(directory,{recursive:true,force:true})}
})
