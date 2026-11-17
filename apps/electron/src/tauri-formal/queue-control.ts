/** 原生队列只串行确认，不在 renderer 调度执行；链完成由权威事件结算。 */
import type { ActiveRun } from './protocol.ts'
const MAX_REQUESTS = 128
const CHAIN_TIMEOUT_MS = MAX_REQUESTS * 130_000
export class NativeQueueError extends Error {
  constructor(readonly code: string, message: string, readonly queueAcknowledgmentUnknown = false) { super(message) }
}
interface Waiter { promise: Promise<void>; finish(error?: Error): void }
interface TerminalPayload {sessionId:string;requestId:string;resultSubtype:string;stoppedByUser:boolean}
interface ClosedChain {sessionId:string;chainId:string;closureReason:string|null}
interface Owner { chain: string; previous?: Owner; rejected?: boolean; completed?: boolean }
interface PendingStop { owner: Owner; promise: Promise<unknown>; reserved: boolean }
interface Lane { tail: Promise<unknown>; count: number; frozen: boolean; stops: Set<PendingStop>; reservedStop?: PendingStop }
export function createQueueControl(
  runs: ActiveRun[],
  invoke: (channel: string, args: unknown[], expectedChainId?: string) => Promise<unknown>,
  track: (promise: Promise<unknown>) => void,
  translate: (code: string) => string,
  timeoutMs = CHAIN_TIMEOUT_MS,
  terminal?: (payload: TerminalPayload) => void,
) {
  const owners = new Map<string, Owner>(runs.map(run => [run.sessionId, {chain:run.requestId}]))
  const lanes = new Map<string, Lane>()
  const waiters = new Map<string, Waiter>()
  const key = (sid: string, chain: string) => JSON.stringify([sid, chain])
  // 只有明确的准入拒绝可回滚；持久化/取消错误可能发生在收据同步之后。
  const definiteRejections=new Set(['invalidParams','invalidId','emptyInput','inputTooLarge','invalidTime','unsupported','unsupportedEffort','profileNotFound','modelNotFound','sessionNotFound','workspaceNotFound','workspaceMismatch','requestConflict','requestLimit','queueLimit','queuePayloadLimit','chainNotFound','chainClosed','staleQueue','runBusy','activeLimit','hostBusy','closing'])
  const uncertain = (error: unknown) => !(error instanceof NativeQueueError) || !definiteRejections.has(error.code)
  const unknown = () => new NativeQueueError('transportTimeout', translate('transportTimeout'), true)
  function freeze(sid:string) {const lane=lanes.get(sid);if(lane)lane.frozen=true}
  function terminalPayload(state:ClosedChain):TerminalPayload|undefined {
    if(!state.closureReason || !['completed','stop','failure','close','delete','recovered'].includes(state.closureReason))return
    return {sessionId:state.sessionId,requestId:state.chainId,resultSubtype:['failure','recovered'].includes(state.closureReason)?'error_during_execution':'success',stoppedByUser:['stop','delete'].includes(state.closureReason)}
  }
  function predecessor(owner: Owner | undefined, skipCompleted = true): Owner | undefined {
    while(owner && (owner.rejected || (skipCompleted && owner.completed)))owner=owner.previous
    return owner
  }
  function rejectOwner(sid: string, owner: Owner) {
    owner.rejected=true
    if(owners.get(sid)!==owner)return
    const previous=predecessor(owner.previous)
    if(previous)owners.set(sid,previous)
    else owners.delete(sid)
  }
  function enqueue(sid: string, action: () => Promise<unknown>, stopOwner?: Owner): Promise<unknown> {
    let lane = lanes.get(sid)
    if (!lane) {
      if (lanes.size >= MAX_REQUESTS) return Promise.reject(new NativeQueueError('hostBusy',translate('hostBusy')))
      lane = {tail:Promise.resolve(),count:0,frozen:false,stops:new Set()};lanes.set(sid,lane)
    }
    // 常规 FIFO 槽共 128 个（含 Stop），另保留一个安全 Stop 槽。
    if(stopOwner) {
      const target=predecessor(stopOwner,false)?.chain
      for(const stop of lane.stops)if(predecessor(stop.owner,false)?.chain===target)return stop.promise
      if(lane.count>=MAX_REQUESTS && lane.reservedStop) {
        // 停止无法入列时，先阻止尚未提交的 Begin/append，不能在 UI 停止后启动。
        lane.frozen=true
        return Promise.reject(new NativeQueueError('hostBusy',translate('hostBusy')))
      }
    } else if(lane.count>=MAX_REQUESTS || lane.frozen) {
      return Promise.reject(lane.frozen ? unknown() : new NativeQueueError('hostBusy',translate('hostBusy')))
    }
    const reserved=Boolean(stopOwner && lane.count>=MAX_REQUESTS)
    if(!reserved)lane.count++
    const current = lane
    const pending = current.tail.then(async () => {
      if (!stopOwner && current.frozen) throw unknown()
      try { return await action() } catch(error) { if (uncertain(error) || (error instanceof NativeQueueError && error.queueAcknowledgmentUnknown)) current.frozen=true;throw error }
    })
    const stop=stopOwner ? {owner:stopOwner,promise:pending,reserved} : undefined
    if(stop){current.stops.add(stop);if(reserved)current.reservedStop=stop}
    current.tail=pending.catch(()=>{}).finally(()=>{
      if(stop) {
        if(current.stops.delete(stop)) {
          if(stop.reserved){if(current.reservedStop===stop)current.reservedStop=undefined}
          else current.count--
        }
      } else current.count--
    })
    track(pending)
    return pending
  }
  function completion(sid: string, chain: string): Waiter {
    const identity=key(sid,chain)
    const existing=waiters.get(identity);if(existing)return existing
    let settle: (error?: Error) => void = () => {}
    const promise=new Promise<void>((resolve,reject)=>{settle=error=>error ? reject(error) : resolve()})
    const timer=setTimeout(()=>finish(unknown()),timeoutMs)
    function finish(error?: Error) { clearTimeout(timer);waiters.delete(identity);settle(error) }
    const waiter={promise,finish};waiters.set(identity,waiter)
    // 确认可能晚于终态；提前登记且保留 rejection handler。
    void promise.catch(()=>{})
    return waiter
  }
  return {
    async invoke(channel: string, args: unknown[]): Promise<unknown> {
      let input=args[0] as Record<string, unknown>
      if(channel!=='agent:stop' && input && typeof input==='object') {
        const field=channel==='agent:send-message' ? 'requestId' : 'uuid'
        if(input[field]===undefined) {input={...input,[field]:crypto.randomUUID()};args=[input]}
      }
      const sid=channel==='agent:stop' ? String(args[0]) : String(input.sessionId)
      const actionOwner=owners.get(sid)
      const chain=channel==='agent:send-message' ? String(input.requestId) : actionOwner?.chain
      if (!chain || chain==='undefined') throw new NativeQueueError('invalidParams',translate('invalidParams'))
      if(channel==='agent:send-message') {
        if(waiters.size>=MAX_REQUESTS && !waiters.has(key(sid,chain)))throw new NativeQueueError('hostBusy',translate('hostBusy'))
        const waiter=completion(sid,chain)
        const owner:Owner={chain,previous:actionOwner};owners.set(sid,owner)
        let submitted=false
        try {
          const acknowledgment=await enqueue(sid,async()=>{
            submitted=true
            try { return await invoke(channel,args,chain) }
            catch(error) {
              if(!uncertain(error))throw error
              freeze(sid)
              try {
                const proof=await invoke('agent:queue-state',[{sessionId:sid}],chain) as ClosedChain
                if(proof.sessionId!==sid || proof.chainId!==chain)throw unknown()
                return proof
              }catch{throw unknown()}
            }
          }) as {closureReason?:string|null}
          owner.previous=undefined
          const proof=terminalPayload({sessionId:sid,chainId:chain,closureReason:acknowledgment?.closureReason ?? null})
          if(proof) {
            if(terminal)terminal(proof)
            else waiter.finish(proof.resultSubtype==='success' ? undefined : new NativeQueueError('responseFailed',translate('responseFailed')))
          }
        }
        catch(error) {if(!submitted || !uncertain(error))rejectOwner(sid,owner);waiter.finish(error instanceof Error ? error : unknown());throw error}
        return waiter.promise
      }
      return enqueue(sid,async()=>{
        if(channel==='agent:stop') {
          // 保留点击时的归属；仅跳过已证明未提交/未接受的临时 Begin。
          const target=predecessor(actionOwner,false)?.chain
          if(!target)throw new NativeQueueError('invalidParams',translate('invalidParams'))
          try {return await invoke(channel,args,target)}catch(error){
            if(!uncertain(error))throw error
            freeze(sid)
            try {await invoke('agent:queue-state',[{sessionId:sid}],target)}catch{/* 只读核对仍不授予取消成功；保留冻结。 */}
            throw unknown()
          }
        }
        try {
          const receipt=await invoke(channel,args,chain) as {uuid?:string;chainId?:string;sessionId?:string}
          if(receipt.uuid!==input.uuid || receipt.chainId!==chain || receipt.sessionId!==sid) throw unknown()
          return receipt.uuid
        } catch(error) {
          if(!uncertain(error) && !(error instanceof NativeQueueError && error.queueAcknowledgmentUnknown))throw error
          freeze(sid)
          try {
            const state=await invoke('agent:queue-state',[{sessionId:sid,uuid:input.uuid}],chain) as {receipt?:{uuid?:string;chainId?:string;sessionId?:string}}
            if(state.receipt && state.receipt.uuid===input.uuid && state.receipt.chainId===chain && state.receipt.sessionId===sid)return input.uuid
          } catch { /* 无法证明未接受时保留原 UUID 和正文。 */ }
          throw unknown()
        }
      },channel==='agent:stop' ? actionOwner : undefined)
    },
    observe(channel: string, payload: {sessionId:string;[key:string]:unknown}) {
      if(typeof payload.requestId!=='string')return
      if(channel==='agent:stream:complete') {
        waiters.get(key(payload.sessionId,payload.requestId))?.finish(payload.resultSubtype==='success' || payload.stoppedByUser===true ? undefined : new NativeQueueError('responseFailed',translate('responseFailed')))
        const owner=owners.get(payload.sessionId)
        for(let candidate=owner;candidate;candidate=candidate.previous)if(candidate.chain===payload.requestId)candidate.completed=true
        if(owner?.chain===payload.requestId)owners.delete(payload.sessionId)
      }
    },
    restoreStates(states:ClosedChain[]):TerminalPayload[] {
      return states.flatMap(state=>{
        if(!waiters.has(key(state.sessionId,state.chainId)) && owners.get(state.sessionId)?.chain!==state.chainId)return []
        const proof=terminalPayload(state);return proof ? [proof] : []
      })
    },
    owner(sid:string) {return owners.get(sid)?.chain},
    restore(run: ActiveRun | null,expectedOwner?:string) {if(run && owners.get(run.sessionId)?.chain===expectedOwner)owners.set(run.sessionId,{chain:run.requestId})},
    dispose() {for(const waiter of [...waiters.values()])waiter.finish(unknown())},
  }
}
