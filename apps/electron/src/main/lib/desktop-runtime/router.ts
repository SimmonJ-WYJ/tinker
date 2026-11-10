/** 正式 IPC 的薄适配：身份、执行、历史和取消均由 Rust 管理。 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, lstatSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_IPC_CHANNELS, DESKTOP_RUNTIME_MAX_AGGREGATE_BYTES, nowMs } from '@asci/shared'
import type { AgentSendInput, Channel, AgentSessionMeta, DesktopTurn, DesktopParams } from '@asci/shared'
import { t } from '../i18n-main.ts'
import type { DesktopClient } from './client.ts'
import type { DesktopPreviewConfig } from './config.ts'
import { projectHistory, projectSession } from './projection.ts'
export interface DesktopSender { send: (channel: string, payload: unknown) => void; isDestroyed: () => boolean }
interface Active { resync?: boolean; requestId: string; promise: Promise<void>; sender: DesktopSender }
export function unsupported(): never { throw new Error(t('errors.desktopRuntime.unsupported')) }
const activeStatus = (turn: DesktopTurn): boolean => turn.status === 'queued' || turn.status === 'running'
export class DesktopRouter {
  private readonly active = new Map<string, Active>()
  constructor(private readonly client: DesktopClient, private readonly config: DesktopPreviewConfig) {}
  async channels(): Promise<Channel[]> {
    const { profiles } = await this.client.request('profiles.list', {})
    return profiles.map(p => ({ id: p.profileId, name: p.label, provider: p.protocol === 'anthropic-messages' ? 'custom-anthropic' : 'custom-openai', baseUrl: '', apiKey: '', models: p.models.map(m => ({ id:m.modelId, name:m.label, enabled:true })), enabled:true, createdAt:0, updatedAt:0 }))
  }
  async list(): Promise<AgentSessionMeta[]> { return (await this.client.request('sessions.list', {})).sessions.map(projectSession) }
  async create(title = '', profileId?: string, workspaceId?: string, reuseDraft = false): Promise<AgentSessionMeta> {
    const selected = profileId ?? (await this.channels())[0]?.id
    if (!selected) throw new Error(t('errors.desktopRuntime.invalid'))
    return projectSession(await this.client.request('sessions.create', { title, profileId:selected, workspaceId:workspaceId ?? null, reuseDraft }))
  }
  async update(sessionId: string, fields: Omit<DesktopParams['sessions.update'], 'sessionId'>): Promise<AgentSessionMeta> {
    return projectSession(await this.client.request('sessions.update', { sessionId, ...fields }))
  }
  async toggle(sessionId:string, field:'pinned'|'archived'):Promise<AgentSessionMeta> {
    const s = (await this.list()).find(s => s.id === sessionId)
    if (!s) throw new Error(t('errors.desktopRuntime.invalid'))
    return this.update(sessionId, { [field]:!s[field], ...(!s[field] ? { [field==='pinned'?'archived':'pinned']:false } : {}) })
  }
  async delete(sessionId: string): Promise<void> { await this.client.request('sessions.delete', { sessionId }) }
  async turns(sessionId:string): Promise<DesktopTurn[]> {
    let after = 0; let size = 0; const turns: DesktopTurn[] = []
    for (;;) {
      const page = await this.client.request('sessions.history', { sessionId, after, limit:32 })
      size += Buffer.byteLength(JSON.stringify(page))
      if (size > DESKTOP_RUNTIME_MAX_AGGREGATE_BYTES || page.turns.some(t => t.sessionId !== sessionId)) throw new Error('DESKTOP_LIMIT')
      turns.push(...page.turns)
      if (!page.hasMore) return turns
      if (page.nextAfter <= after) throw new Error('DESKTOP_PROTOCOL')
      after = page.nextAfter
    }
  }
  restoreStream(sessionId:string,sender:DesktopSender):void {
    const active = this.active.get(sessionId)
    if(active) { active.sender=sender; active.resync=true }
  }
  async history(sessionId:string): Promise<ReturnType<typeof projectHistory>> { const projected=projectHistory(await this.turns(sessionId));
    if(Buffer.byteLength(JSON.stringify(projected.sdkMessages))>DESKTOP_RUNTIME_MAX_AGGREGATE_BYTES || Buffer.byteLength(JSON.stringify(projected.messages))>DESKTOP_RUNTIME_MAX_AGGREGATE_BYTES) throw new Error('DESKTOP_LIMIT')
    return projected }
  async path(sessionId:string):Promise<string> {
    if (!(await this.list()).some(s=>s.id===sessionId)) throw new Error(t('errors.desktopRuntime.invalid'))
    const parent = join(this.config.root,'deliverables'); const path = join(parent,sessionId)
    for (const dir of [parent,path]) {
      mkdirSync(dir,{recursive:true,mode:0o700})
      if (lstatSync(dir).isSymbolicLink() || realpathSync(dir)!==dir) throw new Error('DESKTOP_PATH')
    }
    return path
  }
  async send(input:AgentSendInput, sender:DesktopSender):Promise<void> {
    this.validate(input)
    const startedAt = input.startedAt ?? nowMs()
    const requestId = input.requestId ?? (input.startedAt === undefined ? randomUUID() : createHash('sha256').update(`${input.sessionId}:${startedAt}`).digest('hex').slice(0,48))
    const current = this.active.get(input.sessionId)
    if(current?.requestId===requestId) {
      await this.client.request('chat.send',{requestId,sessionId:input.sessionId,profileId:input.channelId,modelId:input.modelId!,userMessage:input.userMessage,startedAt,effort:input.effort??null})
      return current.promise
    }
    if (current) return Promise.reject(new Error(t('errors.desktopRuntime.invalid')))
    const active: Active = { requestId, sender, promise:Promise.resolve() }
    this.active.set(input.sessionId,active)
    active.promise = this.execute(input, startedAt, active).finally(()=>{ if(this.active.get(input.sessionId)===active) this.active.delete(input.sessionId) })
    return active.promise
  }
  private validate(input:AgentSendInput):void {
    if (!input || typeof input !== 'object') unsupported()
    const allowed = new Set(['sessionId','userMessage','channelId','modelId','workspaceId','startedAt','requestId','taskMode','effort'])
    const emptyLists = new Set(['additionalDirectories','mentionedSkills','mentionedMcpServers','mentionedZoteroItems','mentionedZoteroCollections','zoteroAttachments','mentionedEvidenceSets'])
    for (const [key,value] of Object.entries(input)) {
      if (value === undefined || allowed.has(key)) continue
      if (emptyLists.has(key) && Array.isArray(value) && value.length === 0) continue
      unsupported()
    }
    if (/(?:^|\s)@(?:file|dir):\S|<attached_files>|<referenced_directory\b/.test(input.userMessage)) unsupported()
    if ((input.taskMode && input.taskMode !== 'search') || !input.modelId) unsupported()
  }
  private async execute(input:AgentSendInput,startedAt:number,active:Active):Promise<void> {
    const emit = (channel:string,payload:unknown):void => {
      if (this.active.get(input.sessionId)===active && !active.sender.isDestroyed()) active.sender.send(channel,payload)
    }
    let latestTurn:DesktopTurn|undefined
    try {
      let turn = await this.client.request('chat.send', {requestId:active.requestId,sessionId:input.sessionId,profileId:input.channelId,modelId:input.modelId!,userMessage:input.userMessage,startedAt,effort:input.effort ?? null})
      if (turn.sessionId!==input.sessionId || turn.requestId!==active.requestId || turn.startedAt!==startedAt) throw new Error('DESKTOP_PROTOCOL')
      latestTurn = turn
      const user = projectHistory([turn]).sdkMessages[0]!
      emit(AGENT_IPC_CHANNELS.STREAM_EVENT,{sessionId:input.sessionId,startedAt,payload:{kind:'sdk_message',message:user}})
      let afterSequence = 0
      while (activeStatus(turn)) {
        const page = await this.client.request('chat.events',{sessionId:input.sessionId,requestId:active.requestId,afterSequence,limit:128})
        if (page.turn.requestId!==active.requestId || page.turn.sessionId!==input.sessionId || page.turn.startedAt!==startedAt || page.nextAfterSequence < afterSequence || page.nextAfterSequence > page.turn.sequence) throw new Error('DESKTOP_PROTOCOL')
        latestTurn = page.turn
        const resync = active.resync === true
        if(resync) {
          emit(AGENT_IPC_CHANNELS.STREAM_EVENT,{sessionId:input.sessionId,startedAt,payload:{kind:'asci_event',event:{type:'text_snapshot',text:page.turn.assistantMessage,model:page.turn.modelId}}})
          active.resync=false
        }
        for (const event of page.events) {
          if (event.sequence <= afterSequence) throw new Error('DESKTOP_PROTOCOL')
          if (!resync && event.kind==='delta' && event.text) emit(AGENT_IPC_CHANNELS.STREAM_EVENT,{sessionId:input.sessionId,startedAt,payload:{kind:'asci_event',event:{type:'text_delta',text:event.text,turnId:turn.runId}}})
          afterSequence = event.sequence
        }
        // turn 是最新完整快照，可能领先当前事件页。恢复后从它的序号继续，
        // 不再追加已包含于快照的后续 backlog 页。
        afterSequence = resync ? page.turn.sequence : page.nextAfterSequence
        turn = page.turn
        // 同页 turn 已终结但还有分页时，仍读尽增量。
        if (page.hasMore && !resync) { turn = {...turn,status:'running'}; continue }
        if (activeStatus(turn)) await new Promise(resolve=>setTimeout(resolve,40))
      }
      const history = await this.history(input.sessionId)
      const final = projectHistory([turn]).sdkMessages[1]
      if(final) emit(AGENT_IPC_CHANNELS.STREAM_EVENT,{sessionId:input.sessionId,startedAt,payload:{kind:'sdk_message',message:final}})
      if(turn.status==='failed'||turn.status==='interrupted') emit(AGENT_IPC_CHANNELS.STREAM_ERROR,{sessionId:input.sessionId,startedAt,error:t('errors.desktopRuntime.failed')})
      emit(AGENT_IPC_CHANNELS.STREAM_COMPLETE,{sessionId:input.sessionId,startedAt,messages:history.messages,stoppedByUser:turn.status==='cancelled',resultSubtype:turn.status==='completed'?'success':'error_during_execution'})
      if(turn.status==='failed'||turn.status==='interrupted') throw new Error('DESKTOP_RESPONSE_FAILED')
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if(code==='DESKTOP_RESPONSE_FAILED') throw new Error(t('errors.desktopRuntime.failed'))
      if(latestTurn) {
        // 无法继续核对运行状态时终止拥有的 sidecar，不能留下不可见的执行。
        if(activeStatus(latestTurn)) this.client.close()
        const partial = projectHistory([{...latestTurn,...(activeStatus(latestTurn)?{status:'interrupted' as const,errorCode:'transportError'}:{})}]).sdkMessages[1]
        if(partial) emit(AGENT_IPC_CHANNELS.STREAM_EVENT,{sessionId:input.sessionId,startedAt,payload:{kind:'sdk_message',message:partial}})
      }
      const message = t(code.startsWith('DESKTOP_') ? 'errors.desktopRuntime.transport' : 'errors.desktopRuntime.invalid')
      emit(AGENT_IPC_CHANNELS.STREAM_ERROR,{sessionId:input.sessionId,startedAt,error:message})
      emit(AGENT_IPC_CHANNELS.STREAM_COMPLETE,{sessionId:input.sessionId,startedAt,resultSubtype:'error_during_execution'})
      // IPC reject 让原 UI 保留原始发送草稿。
      throw new Error(message)
    }
  }
  async stop(sessionId:string):Promise<void> {
    const current = this.active.get(sessionId)
    if(current) await this.client.request('chat.cancel',{sessionId,requestId:current.requestId})
  }
}
