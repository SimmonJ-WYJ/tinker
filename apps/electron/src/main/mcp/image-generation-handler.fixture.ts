/** 独立进程中的真实 handler 验证；全部配置、网络和附件写入均指向合成数据。 */
import { expect, mock } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageRequestAuthorization, IMAGE_GENERATION_TOOL } from '@asci/shared'
import type { AttachmentSaveInput, Channel, PermissionRequest } from '@asci/shared'
import { readSessionImageScope } from './image-turn-context.ts'
import { ImageTurnController } from './image-turn-controller.ts'
import { createImageTurnFactory } from './image-turn-factory.ts'
import { AgentPermissionService } from '../lib/agent-permission-service.ts'

const directory=mkdtempSync(join(tmpdir(),'image-handler-fixture-'))
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')
const channel:Channel={id:'fixture',name:'Fixture',provider:'custom-image',baseUrl:'https://fixture.invalid',apiKey:'unused',enabled:true,models:[{id:'fixture-image',name:'Fixture Image',enabled:true}],createdAt:0,updatedAt:0}
let calls=0
let saved=0
let proxyBarrier:Promise<void>|undefined
mock.module('../lib/config-paths.ts',()=>({getConversationAttachmentsDir:()=>directory}))
mock.module('../lib/channel-manager.ts',()=>({listChannels:()=>[channel],decryptApiKey:()=>'fixture-key'}))
mock.module('../lib/proxy-settings-service.ts',()=>({getEffectiveProxyUrl:async()=>{await proxyBarrier;return undefined}}))
mock.module('../lib/proxy-fetch.ts',()=>({getFetchFn:()=>async()=>{calls++;return new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{status:200})}}))
mock.module('../lib/attachment-service.ts',()=>({saveAttachment:(input:AttachmentSaveInput)=>{
 const id=`image-${++saved}`;const filename=`${id}.png`
 writeFileSync(join(directory,filename),Buffer.from(input.data,'base64'))
 return {attachment:{id,filename,mediaType:'image/png',localPath:`s/${filename}`,size:png.length}}
}}))
interface FixtureResult {isError?:boolean;content:{type:string;text?:string}[]}
interface FixtureTool {handler:(input:Record<string,unknown>,extra:unknown)=>Promise<FixtureResult>}
try {
 const {createImageGenerationMcpServer}=await import('./image-generation-tool.ts')
 const handler=(scope?:ImageRequestAuthorization,runId='turn',selected?:string,allowed=()=>true)=>{
  const server=createImageGenerationMcpServer('s',directory,runId,selected,{authorization:scope,isExecutionAllowed:allowed})!
  const registered=server.instance as unknown as {_registeredTools:Record<string,FixtureTool>}
  return registered._registeredTools.generate_image!.handler
 }
 const input={prompt:'office',complex:true}
 expect((await handler()(input,{})).isError).toBe(true)
 expect(calls).toBe(0)
 const scope=new ImageRequestAuthorization({userMessage:'继续帮我生图 这个女生拿文件在办公室大堂和男生对话'})
 const generate=handler(scope)
 const first=await generate(input,{})
 expect(first.isError,JSON.stringify(first)).not.toBe(true)
 expect(calls).toBe(1)
 expect((await generate(input,{})).isError).not.toBe(true)
 expect(calls).toBe(1)
 expect((await generate({prompt:'unrequested second'},{})).isError).toBe(true)
 expect(calls).toBe(1)
 const editScope=new ImageRequestAuthorization({userMessage:'把这个女生加入旁边 并换了一个泳衣',selectedImageId:'image-1',...readSessionImageScope('s',directory)})
 expect((await handler(editScope,'turn2','image-1')({prompt:'English version',baseImageId:'image-1'},{})).isError).not.toBe(true)
 expect(calls).toBe(2)
 const latestScope=new ImageRequestAuthorization({userMessage:'修改这张图片',...readSessionImageScope('s',directory)})
 const latest=handler(latestScope,'turn3')
 const latestInput={prompt:'latest edit',baseImageId:'latest'}
 expect((await latest(latestInput,{})).isError).not.toBe(true)
 expect((await latest(latestInput,{})).isError).not.toBe(true)
 expect(calls).toBe(3)
 expect((await handler(new ImageRequestAuthorization({userMessage:'生成图片'}),'plan',undefined,()=>false)(input,{})).isError).toBe(true)
 scope.cancel()
 expect((await generate(input,{})).isError).toBe(true)
 expect(calls).toBe(3)
 const createTurn=createImageTurnFactory('s',directory,directory,[])
 const controller=new ImageTurnController(createTurn('queue-initial','生成图片'),createTurn)
 const queuedServer=createImageGenerationMcpServer('s',directory,'queue-initial',undefined,{getTurn:()=>controller.current})!
 const queuedTools=queuedServer.instance as unknown as {_registeredTools:Record<string,FixtureTool>}
 const queued=queuedTools._registeredTools.generate_image!.handler
 controller.enqueue('queue-next','再次生成')
 expect((await queued({prompt:'queue image'},{})).isError).not.toBe(true)
 expect(controller.getScopeId()).toBe('queue-initial')
 expect(controller.consume({type:'user',uuid:'queue-next',isReplay:true,parent_tool_use_id:null})).toBe(true)
 expect((await queued({prompt:'queue image'},{})).isError).not.toBe(true)
 let releaseProxy:()=>void=()=>{}
 proxyBarrier=new Promise<void>(resolve=>{releaseProxy=resolve})
 controller.enqueue('queue-now','重新生成')
 const old=queued({prompt:'old pending'}, {})
 // 此scope默认名额已用，另创建一个明确请求回合进入proxy await竞态。
 controller.consume({type:'user',uuid:'queue-now',isReplay:true,parent_tool_use_id:null})
 const pending=queued({prompt:'inflight'}, {})
 await Promise.resolve();await Promise.resolve()
 controller.enqueue('replacement','Try again')
 controller.interrupt()
 controller.consume({type:'user',uuid:'replacement',isReplay:true,parent_tool_use_id:null})
 releaseProxy();proxyBarrier=undefined
 expect((await old).isError).toBe(true)
 expect((await pending).isError).toBe(true)
 expect((await queued({prompt:'new after interrupt'},{})).isError).not.toBe(true)
 expect(calls).toBe(6)
 // 正常发送（新 query）从宿主历史恢复，真实 handler 不依赖模型声称已获授权。
 const resumed=createImageTurnFactory('s',directory,directory,[{type:'user',uuid:'previous',parent_tool_use_id:null,message:{content:[{type:'text',text:'帮我生图'}]}}])
 const retried=resumed('manual-retry','再次生成')
 expect((await handler(retried.authorization,'manual-retry')({prompt:'retry scene'},{})).isError).not.toBe(true)
 expect(calls).toBe(7)
 const discussed=resumed('discussion','再次生成需要多少钱')
 expect((await handler(discussed.authorization,'discussion')({prompt:'unrequested'},{})).isError).toBe(true)
 expect(calls).toBe(7)
 // 用户原句必须穿过真实文件范围、选图绑定、执行守卫和 handler；无真实网络。
 const upload=join(directory,'new-reference.png');writeFileSync(upload,png)
 const naturalText=`<attached_files>\n- new-reference.png: ${upload}\n</attached_files>\n你看看加入这个女生 三个人一起`
 const naturalCreate=createImageTurnFactory('s',directory,directory,[])
 const natural=naturalCreate('natural-original',naturalText,'image-1')
 const naturalInput={prompt:'three-person composition',baseImageId:'image-1',referenceImagePaths:[upload],complex:true}
 const service=new AgentPermissionService({cwd:directory,workspaceRoot:directory,homeDir:directory})
 const approvalCards:PermissionRequest[]=[]
 const naturalPermission=service.createCanUseTool('s',card=>approvalCards.push(card),undefined,undefined,natural.authorization)
 const naturalHook=service.createPreToolUseHardRuleHookForSession('s',{confirmPaidImage:naturalPermission})
 expect(await naturalHook({hook_event_name:'PreToolUse',tool_name:IMAGE_GENERATION_TOOL,tool_input:naturalInput,session_id:'s',transcript_path:'/tmp/synthetic',cwd:directory,tool_use_id:'natural-call'},'natural-call',{signal:new AbortController().signal})).toMatchObject({hookSpecificOutput:{permissionDecision:'allow'}})
 expect(await naturalPermission(IMAGE_GENERATION_TOOL,naturalInput,{toolUseID:'natural-call',signal:new AbortController().signal})).toMatchObject({behavior:'allow'})
 expect(approvalCards).toHaveLength(0)
 const naturalHandler=handler(natural.authorization,'natural-original','image-1')
 expect((await naturalHandler(naturalInput,{})).isError).not.toBe(true)
 expect((await naturalHandler(naturalInput,{})).isError).not.toBe(true)
 expect((await naturalHandler({...naturalInput,prompt:'unrequested extra'},{})).isError).toBe(true)
 expect(calls).toBe(8)
 const approvedCreate=createImageTurnFactory('s',directory,directory,[])
 const approvedTurn=approvedCreate('manual-approved','看看这个构图','image-1')
 const approvedInput={prompt:'manual approval',baseImageId:'image-1'}
 const approvedHandler=handler(approvedTurn.authorization,'manual-approved','image-1')
 expect((await approvedHandler(approvedInput,{})).isError).toBe(true)
 const approvePermission=service.createCanUseTool('s',card=>approvalCards.push(card),undefined,undefined,approvedTurn.authorization)
 const pendingApproval=approvePermission(IMAGE_GENERATION_TOOL,approvedInput,{toolUseID:'approved-call',signal:new AbortController().signal})
 expect(approvalCards).toHaveLength(1)
 service.respondToPermission(approvalCards[0]!.requestId,'allow',false)
 expect(await pendingApproval).toMatchObject({behavior:'allow'})
 expect((await approvedHandler(approvedInput,{})).isError).not.toBe(true)
 expect(calls).toBe(9)
 const approvedHistory=[{type:'user',uuid:'manual-approved',parent_tool_use_id:null,imageEditReference:{imageId:'image-1'},message:{content:[{type:'text',text:'看看这个构图'}]}}]
 const restored=createImageTurnFactory('s',directory,directory,approvedHistory)('approved-retry','再次生成')
 const restoredPermission=service.createCanUseTool('s',card=>approvalCards.push(card),undefined,undefined,restored.authorization)
 expect(await restoredPermission(IMAGE_GENERATION_TOOL,{prompt:'approved task retry'},{toolUseID:'restored-call',signal:new AbortController().signal})).toMatchObject({behavior:'allow'})
 expect(approvalCards).toHaveLength(1)
 const restoredHandler=handler(restored.authorization,'approved-retry')
 expect((await restoredHandler({prompt:'approved task retry'},{})).isError).not.toBe(true)
 expect((await restoredHandler({prompt:'extra file',referenceImagePaths:['/another-session/private.png']},{})).isError).toBe(true)
 restored.authorization.cancel()
 expect((await restoredHandler({prompt:'late'},{})).isError).toBe(true)
 expect(calls).toBe(10)
 service.clearSessionPending('s')
 console.log('IMAGE_HANDLER_FIXTURE_PASS: 10 fake API calls; natural edits, approved task recovery, queue, immutable inflight scope, exact files, plan and cancellation verified')
} finally {rmSync(directory,{recursive:true,force:true});mock.restore()}
