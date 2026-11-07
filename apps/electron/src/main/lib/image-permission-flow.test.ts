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
