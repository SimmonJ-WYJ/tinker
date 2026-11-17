/** 受管保存仅暂存私有密钥；公开回执和待重试请求只保留不透明引用。 */
import type { Channel, ChannelCreateInput, ChannelUpdateInput } from '@asci/shared'
interface Request {
  version: number
  channel: string
  args: unknown[]
  mutation: {mutationId:string;expectedRevision:number}
}
interface Reply {value:unknown; snapshot?:import('./protocol.ts').PlatformSnapshot}
interface Pending {intent:string; request:Request; staged:boolean}
const WRITES = new Set(['channel:create','channel:update','channel:delete'])
const UNCERTAIN = new Set(['runtimeUnavailable','transportTimeout','deadline','timeout','commandTimeout','staleGeneration','recoveryRequired','storeIo','vaultWriteUncertain','helperTimeout','helperUnavailable','hostUnavailable','hostClosed','invalidReply'])
export function createCredentialTransport(
  command:<T>(name:string,args:Record<string,unknown>)=>Promise<T>,
  revision:()=>number,
  fail:(code:string)=>Error,
){
  let channels = new Map<string,Channel>()
  let pending:Pending|undefined
  const identities = new WeakMap<object,string>()
  function identity(value:object):string {
    let id=identities.get(value)
    if(!id){id=crypto.randomUUID();identities.set(value,id)}
    return id
  }
  function observe(channel:string,value:unknown){
    if(channel==='channel:list' && Array.isArray(value))channels=new Map((value as Channel[]).map(c=>[c.id,c]))
  }
  function normalized(channel:string,args:unknown[]):{request:Request;secret:string;intent:string}{
    const mutation={mutationId:crypto.randomUUID(),expectedRevision:revision()}
    if(channel==='channel:delete')return {request:{version:1,channel,args,mutation},secret:'',intent:`delete:${String(args[0])}`}
    const input=(channel==='channel:create'?args[0]:args[1]) as ChannelCreateInput|ChannelUpdateInput
    if(!input || typeof input!=='object')throw fail('invalidParams')
    const old=channel==='channel:update'?channels.get(String(args[0])):undefined
    if(channel==='channel:update' && !old)throw fail('channelNotFound')
    const merged={...old,...input}
    const protocol=merged.provider==='custom-openai'?'openai-chat':merged.provider==='custom-anthropic'?'anthropic-messages':undefined
    if(!protocol)throw fail('unsupportedProvider')
    const secret=input.apiKey??''
    if(!secret && old && (merged.provider!==old.provider || merged.baseUrl?.replace(/\/+$/,'')!==old.baseUrl.replace(/\/+$/,'')))throw fail('credentialReplacementRequired')
    const spec={id:old?.id??crypto.randomUUID(),name:merged.name,protocol,baseUrl:merged.baseUrl,enabled:merged.enabled,models:merged.models?.map(m=>({modelId:m.id,label:m.name,supportedEfforts:m.supportedEfforts??[],enabled:m.enabled}))}
    return {request:{version:1,channel,args:[{channel:spec,credential:'keep'}],mutation},secret,intent:input.credentialIntentId??identity(input)}
  }
  return {
    handles:(channel:string)=>WRITES.has(channel),
    observe,
    guard(){if(pending)throw fail('mutationPending')},
    async invoke(channel:string,args:unknown[]):Promise<Reply>{
      const candidate=normalized(channel,args)
      if(pending && (pending.intent!==candidate.intent || pending.request.channel!==channel))throw fail('mutationPending')
      if(pending && !pending.staged)throw fail('stageUncertain')
      if(!pending){
        pending={intent:candidate.intent,request:candidate.request,staged:!candidate.secret}
        if(candidate.secret){
          try{
            const reply=await command<{value:Request}>('invoke',{channel:'channel:stage',args:[{request:candidate.request,secret:candidate.secret}]})
            pending.request=reply.value;pending.staged=true
          }catch(error){
            if(!UNCERTAIN.has(code(error)))pending=undefined
            throw error
          }
        }
      }
      const request=pending.request
      try{
        const reply=await command<Reply>('invoke',{channel:request.channel,args:request.args,mutation:request.mutation})
        pending=undefined
        if(channel==='channel:delete')channels.delete(String(args[0]))
        else if(reply.value && typeof reply.value==='object') {const c=reply.value as Channel;channels.set(c.id,c)}
        return reply
      }catch(error){
        if(!UNCERTAIN.has(code(error)))pending=undefined
        throw error
      }
    },
    dispose(){channels.clear();pending=undefined},
  }
}
function code(error:unknown):string{return error && typeof error==='object' && 'code' in error?String(error.code):'runtimeUnavailable'}
