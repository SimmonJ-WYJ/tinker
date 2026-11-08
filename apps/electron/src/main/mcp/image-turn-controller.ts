/** 只在 SDK 确认消费宿主登记的用户消息后轮换图片授权；排队不等于消费。 */
import type { ImageAuthorization, ImageRequestAuthorization } from '@asci/shared'
export interface ImageTurnSnapshot {id:string;authorization:ImageRequestAuthorization;selectedImageId?:string;latestImageId?:string}
export class ImageTurnController implements ImageAuthorization {
 private readonly queued=new Map<string,string>()
 private readonly calls=new Map<string,ImageTurnSnapshot>()
 private ended=false
 private readonly seenUserIds=new Set<string>()
 constructor(public current:ImageTurnSnapshot,private readonly create:(id:string,text:string)=>ImageTurnSnapshot,knownUserIds:readonly string[]=[]){
  this.seenUserIds.add(current.id)
  for(const id of knownUserIds)this.seenUserIds.add(id)
 }
 getScopeId():string{return this.current.id}
 registerInputIdentity(id:string):void{this.seenUserIds.add(id)}
 enqueue(id:string,text:string):void{
  if(this.ended)throw new Error('Image user turn has ended')
  if(this.seenUserIds.has(id))throw new Error('Queued user message identity was already registered')
  this.seenUserIds.add(id);this.queued.set(id,text)
 }
 removeQueued(id:string):void{this.queued.delete(id)}
 interrupt():void{this.current.authorization.cancel()}
 consume(message:unknown):boolean{
  if(this.ended || !message || typeof message!=='object')return false
  const msg=message as Record<string,unknown>
  if(msg.type!=='user' || msg.isSynthetic || msg.parent_tool_use_id!==null)return false
  const content=(msg.message as {content?:unknown}|undefined)?.content
  if(Array.isArray(content) && content.some(block=>block && typeof block==='object' && (block as Record<string,unknown>).type==='tool_result'))return false
  const id=typeof msg.source_uuid==='string' ? msg.source_uuid : msg.uuid
  if(typeof id!=='string')return false
  const text=this.queued.get(id)
  if(text===undefined){this.seenUserIds.add(id);return false}
  const next=this.create(id,text)
  this.current.authorization.cancel()
  this.queued.delete(id)
  this.current=next
  return true
 }
 private forCall(id?:string):ImageTurnSnapshot{
  if(!id)return this.current
  const prior=this.calls.get(id)
  if(prior)return prior
  this.calls.set(id,this.current)
  return this.current
 }
 authorize(toolName:string,input:Record<string,unknown>,id?:string){return this.forCall(id).authorization.authorize(toolName,input,id)}
 approve(toolName:string,input:Record<string,unknown>,id?:string):void{this.forCall(id).authorization.approve(toolName,input,id)}
 cancel():void{this.ended=true;this.current.authorization.cancel();this.queued.clear()}
}

interface QueuedImageInjection {
 controller?:ImageTurnController
 id:string
 text:string
 send:()=>Promise<void>
 interrupt?:()=>Promise<boolean>
 onInterrupted?:()=>void
}
/** 登记和回滚绑定本次注入，重复 UUID 拒绝不会删除已有排队消息。 */
export async function injectQueuedImageMessage(options:QueuedImageInjection):Promise<void>{
 options.controller?.enqueue(options.id,options.text)
 try{
  if(options.interrupt && await options.interrupt()){
   options.controller?.interrupt()
   options.onInterrupted?.()
  }
  await options.send()
 }catch(error){options.controller?.removeQueued(options.id);throw error}
}
