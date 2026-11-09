/** 真实权限服务与执行守卫闭环；不发送网络或付费生成。 */
import {test,expect} from 'bun:test'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {IMAGE_GENERATION_TOOL} from '@asci/shared'
import type {PermissionRequest} from '@asci/shared'
import {AgentPermissionService} from './agent-permission-service.ts'
import {createImageTurnFactory} from '../mcp/image-turn-factory.ts'
import {ImageTurnController} from '../mcp/image-turn-controller.ts'
import {ImageExecutionGuard} from '../mcp/image-execution-guard.ts'
import {ImageAssets} from '../mcp/image-assets.ts'
const user=(uuid:string,text:string)=>({type:'user',uuid,parent_tool_use_id:null,message:{content:[{type:'text',text}]}})
const options=(id:string)=>({toolUseID:id,signal:new AbortController().signal})

test('原句经真实选图/上传范围、hook、canUseTool、执行守卫不弹审批卡',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-approval-original-'));const requests:PermissionRequest[]=[];const service=new AgentPermissionService()
 try{
  const path=join(directory,'upload.png');writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10]))
  new ImageAssets(directory).add({id:'poster',filename:'upload.png',prompt:'fixture',channelId:'fixture',model:'fixture',referenceIds:[]})
  const text=`<attached_files>\n- upload.png: ${path}\n</attached_files>\n你看看加入这个女生 三个人一起`
  const create=createImageTurnFactory('s',directory,directory,[])
  const turn=new ImageTurnController(create('original',text,'poster'),create)
  const use=service.createCanUseTool('s',request=>requests.push(request),undefined,undefined,turn)
  const hook=service.createPreToolUseHardRuleHookForSession('s',{confirmPaidImage:use})
  const input={prompt:'three-person composition',baseImageId:'poster',referenceImagePaths:[path]}
  const result=await hook({hook_event_name:'PreToolUse',tool_name:IMAGE_GENERATION_TOOL,tool_input:input,session_id:'s',transcript_path:'/tmp/synthetic',cwd:directory},'original-call',{signal:new AbortController().signal})
  expect(result).toMatchObject({hookSpecificOutput:{permissionDecision:'allow'}})
  expect(await use(IMAGE_GENERATION_TOOL,input,options('original-call'))).toMatchObject({behavior:'allow'})
  const guard=new ImageExecutionGuard({authorization:turn})
  expect(await guard.run(input,'fixture-fingerprint',async()=>'synthetic image')).toBe('synthetic image')
  expect(requests).toHaveLength(0)
  expect(await use('Bash',{command:'rm -rf /'},options('danger'))).toMatchObject({behavior:'deny'})
 }finally{service.clearSessionPending('s');rmSync(directory,{recursive:true,force:true})}
})

test('真实批准回调后的续作不再弹卡，额外文件/计划模式/取消仍受控',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-approval-live-'));const requests:PermissionRequest[]=[];const service=new AgentPermissionService()
 try{
  const create=createImageTurnFactory('s',directory,directory,[])
  const turn=new ImageTurnController(create('approved','看看这个构图'),create)
  const use=service.createCanUseTool('s',request=>requests.push(request),undefined,undefined,turn)
  const pending=use(IMAGE_GENERATION_TOOL,{prompt:'initial'},options('approved-call'))
  expect(requests).toHaveLength(1);expect(requests[0]!.canAlwaysAllow).toBe(false)
  service.respondToPermission(requests[0]!.requestId,'allow',false)
  expect(await pending).toMatchObject({behavior:'allow'})
  expect(turn.current.authorization.isImageTask()).toBe(true)
  turn.enqueue('retry','再次生成');turn.consume({...user('retry','ignored'),isReplay:true})
  const input={prompt:'regenerated'}
  expect(await use(IMAGE_GENERATION_TOOL,input,options('retry-call'))).toMatchObject({behavior:'allow'})
  expect(requests).toHaveLength(1)
  expect(await new ImageExecutionGuard({authorization:turn}).run(input,'fake',async()=>'fake network result')).toBe('fake network result')
  const extra=use(IMAGE_GENERATION_TOOL,{prompt:'extra',referenceImagePaths:['/additional/private.png']},options('extra-file'))
  expect(requests).toHaveLength(2);service.respondToPermission(requests[1]!.requestId,'deny',false)
  expect(await extra).toMatchObject({behavior:'deny'})
  const plan=service.createPreToolUseHardRuleHookForSession('s',{confirmPaidImage:use,imageGenerationAllowed:()=>false})
  expect(await plan({hook_event_name:'PreToolUse',tool_name:IMAGE_GENERATION_TOOL,tool_input:input,session_id:'s',transcript_path:'/tmp/synthetic',cwd:directory},'plan',options('plan'))).toMatchObject({hookSpecificOutput:{permissionDecision:'deny'}})
  turn.cancel()
  expect(await use(IMAGE_GENERATION_TOOL,input,options('late'))).toMatchObject({behavior:'deny'})
  const restored=createImageTurnFactory('s',directory,directory,[user('approved','看看这个构图'),{...user('retry','再次生成'),_imageQueued:true}])('restored','重新生成')
  expect(restored.authorization.authorize(IMAGE_GENERATION_TOOL,{prompt:'restored'}).action).toBe('allow')
  expect(restored.authorization.authorize(IMAGE_GENERATION_TOOL,{prompt:'second'}).action).toBe('ask')
 }finally{service.clearSessionPending('s');rmSync(directory,{recursive:true,force:true})}
})

test('真实审批被取消后，晚到批准不能污染侧车或重启上下文',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'image-approval-abort-'));const requests:PermissionRequest[]=[];const service=new AgentPermissionService()
 try{
  const create=createImageTurnFactory('s',directory,directory,[]);const current=create('initial','看看这个构图')
  const use=service.createCanUseTool('s',request=>requests.push(request),undefined,undefined,current.authorization)
  const abort=new AbortController()
  const pending=use(IMAGE_GENERATION_TOOL,{prompt:'initial'},{toolUseID:'pending',signal:abort.signal})
  abort.abort();expect(await pending).toMatchObject({behavior:'deny'})
  expect(service.respondToPermission(requests[0]!.requestId,'allow',false)).toBeNull()
  expect(current.authorization.isImageTask()).toBe(false)
  const restored=createImageTurnFactory('s',directory,directory,[user('initial','看看这个构图')])('retry','再次生成')
  expect(restored.authorization.authorize(IMAGE_GENERATION_TOOL,{prompt:'retry'}).action).toBe('ask')
 }finally{service.clearSessionPending('s');rmSync(directory,{recursive:true,force:true})}
})
