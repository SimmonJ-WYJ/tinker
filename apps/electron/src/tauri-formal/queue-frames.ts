/** 分帧只缓存有限权威投影；整组完整后才向原 renderer 原子发布。 */
import type { StreamEnvelope } from './protocol.ts'
interface Stage {id:string;next:number;count:number;bytes:number;executions:unknown[];requestId:unknown;sessionId:string}
const MAX_BYTES=16*1024*1024
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength
export function createQueueFrames() {
  const stages=new Map<string,Stage>()
  let retained=0
  function clear(session?:string) {
    if(session===undefined){stages.clear();retained=0;return}
    for(const [id,stage] of stages)if(stage.sessionId===session){retained-=stage.bytes;stages.delete(id)}
  }
  function clearIdentity(id:string) {const old=stages.get(id);if(old)retained-=old.bytes;stages.delete(id)}
  return {
    clear,
    get retainedBytes(){return retained},
    accept(envelope:StreamEnvelope):StreamEnvelope|undefined {
      const sid=envelope.payload.sessionId
      const identity=JSON.stringify([sid,envelope.payload.requestId])
      const payload=envelope.payload.payload as {kind?:string;event?:Record<string,unknown>}|undefined
      const event=payload?.event
      if(event?.type!=='native_chain_snapshot_part') {clearIdentity(identity);return envelope}
      const size=bytes(envelope)
      const {snapshotId,index,count,executions}=event
      if(size>4*1024*1024 || typeof snapshotId!=='string' || !Number.isInteger(index) || !Number.isInteger(count) || typeof count!=='number' || count<2 || count>129 || !Array.isArray(executions)){clear(sid);throw {code:'invalidReply'}}
      if(index===0) {
        clearIdentity(identity)
        if(stages.size>=128)throw {code:'historyLimit'}
        stages.set(identity,{id:snapshotId,next:0,count,bytes:0,executions:[],requestId:envelope.payload.requestId,sessionId:sid})
      }
      const stage=stages.get(identity)
      if(!stage || stage.id!==snapshotId || stage.next!==index || stage.count!==count || stage.requestId!==envelope.payload.requestId){clear(sid);throw {code:'invalidReply'}}
      if(retained+size>MAX_BYTES){clear(sid);throw {code:'historyLimit'}}
      stage.next++;stage.bytes+=size;retained+=size;stage.executions.push(...executions)
      if(stage.next<count)return undefined
      const final=event.final
      if(!final || typeof final!=='object' || !('type' in final) || final.type!=='native_chain_snapshot'){clear(sid);throw {code:'invalidReply'}}
      const result={...envelope,payload:{...envelope.payload,payload:{kind:'asci_event',event:{...final,executions:stage.executions}}}}
      clearIdentity(identity);return result
    },
  }
}
