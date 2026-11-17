import {expect,test} from 'bun:test'
import {createQueueFrames} from './queue-frames.ts'
import type {StreamEnvelope} from './protocol.ts'
const frame=(index:number,text:string,requestId='a'):StreamEnvelope=>({version:1,generation:'g',deliverySequence:index+1,channel:'agent:stream:event',payload:{sessionId:'s',requestId,payload:{kind:'asci_event',event:{type:'native_chain_snapshot_part',snapshotId:requestId,index,count:2,executions:index===0?[{text}]:[],final:index===1?{type:'native_chain_snapshot',chainId:requestId}:null}}}})
test('UTF8 frame bytes and aggregate staging stay bounded; no partial publication and terminal/reset cleanup',()=>{
 const f=createQueueFrames();expect(f.accept(frame(0,'你好🌱'))).toBeUndefined();expect(f.retainedBytes).toBeGreaterThan(0)
 const result=f.accept(frame(1,''));expect(result?.payload.payload).toMatchObject({event:{executions:[{text:'你好🌱'}]}});expect(f.retainedBytes).toBe(0)
 expect(()=>f.accept(frame(0,'🌱'.repeat(1_100_000)))).toThrow();expect(f.retainedBytes).toBe(0)
 f.accept(frame(0,'old'));f.clear('s');expect(f.retainedBytes).toBe(0)
 f.accept(frame(0,'old'));const terminal={...frame(1,''),channel:'agent:stream:complete',payload:{sessionId:'s',requestId:'a'}};f.accept(terminal);expect(f.retainedBytes).toBe(0)
 f.accept(frame(0,'old'));f.accept(frame(0,'new','b'));expect(f.accept(frame(1,'','b'))?.payload.requestId).toBe('b')
 f.accept(frame(0,'old'));f.clear();expect(f.retainedBytes).toBe(0)
})
