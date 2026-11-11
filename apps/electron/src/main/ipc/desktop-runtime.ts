/** 原 preload 的正式通道在预览中完整分流，未迁移能力明确拒绝。 */
import { ipcMain } from 'electron'
import * as Shared from '@asci/shared'
import { UPDATER_IPC_CHANNELS } from '../lib/updater/updater-types.ts'
import { t } from '../lib/i18n-main.ts'
import * as ElectronTypes from '../../types/index.ts'
import { AGENT_IPC_CHANNELS as A, CHANNEL_IPC_CHANNELS as C, DESKTOP_PREVIEW_STATUS_CHANNEL } from '@asci/shared'
import type { AgentSendInput } from '@asci/shared'
import { DesktopRouter, unsupported } from '../lib/desktop-runtime/router.ts'
export function registerDesktopRuntimeIpc(router: DesktopRouter):void {
  ipcMain.on(DESKTOP_PREVIEW_STATUS_CHANNEL,e=>{e.returnValue=true})
  // 缺省拒绝，而不是转入旧 SDK、凭据、附件、MCP 或文件操作。
  const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>()
  const groups = [...Object.entries(Shared),...Object.entries(ElectronTypes),['UPDATER_IPC_CHANNELS',UPDATER_IPC_CHANNELS] as const].filter(([name])=>name.endsWith('_IPC_CHANNELS')).map(([,value])=>value)
  for (const group of groups) if(group && typeof group==='object') for(const channel of Object.values(group)) if(typeof channel==='string') handlers.set(channel,unsupported)
  handlers.set(C.LIST,()=>router.channels())
  handlers.set(A.LIST_SESSIONS,()=>router.list())
  handlers.set(A.CREATE_SESSION,(_e,title?:string,profile?:string,workspace?:string)=>router.create(title,profile,workspace))
  handlers.set(A.GET_OR_CREATE_DRAFT_SESSION,(_e,profile?:string,workspace?:string)=>router.create('',profile,workspace,true))
  handlers.set(A.GET_MESSAGES,async (_e,id:string)=>(await router.history(id)).messages)
  handlers.set(A.GET_SDK_MESSAGES,async (e,id:string)=>{router.restoreStream(id,e.sender);return (await router.history(id)).sdkMessages})
  handlers.set(A.UPDATE_TITLE,(_e,id:string,title:string)=>router.update(id,{title}))
  handlers.set(A.TOGGLE_PIN,(_e,id:string)=>router.toggle(id,'pinned'))
  handlers.set(A.TOGGLE_ARCHIVE,(_e,id:string)=>router.toggle(id,'archived'))
  handlers.set(A.DELETE_SESSION,(_e,id:string)=>router.delete(id))
  handlers.set(A.SEND_MESSAGE,(e,input:AgentSendInput)=>router.send(input,e.sender))
  handlers.set(A.STOP_AGENT,(_e,id:string)=>router.stop(id))
  handlers.set(A.GET_SESSION_PATH,(_e,id:string)=>router.path(id))
  // 此运行时不执行工具，空交互请求和能力是实际能力状态。
  handlers.set(A.GET_PENDING_REQUESTS,()=>({permissions:[],askUsers:[],exitPlans:[]}))
  handlers.set(A.GET_CAPABILITIES,()=>({mcpServers:[],skills:[]}))
  handlers.set(A.GET_SKILLS,()=>[])
  handlers.set(A.GET_MCP_CONFIG,()=>({mcpServers:{}}))
  handlers.set(A.GET_TEAM_DATA,()=>null)
  for(const [channel,handler] of handlers) ipcMain.handle(channel,async(event,...args:unknown[])=>{
    try { return await handler(event,...args) } catch(error) {
      const message = error instanceof Error ? error.message : ''
      if(/^DESKTOP_[A-Z_]+$/.test(message)) throw new Error(t('errors.desktopRuntime.transport'))
      if(/^[a-z][A-Za-z0-9]{0,63}$/.test(message)) throw new Error(t('errors.desktopRuntime.invalid'))
      throw error
    }
  })
  ipcMain.handle('context:read',unsupported)
  ipcMain.handle('context:pins',unsupported)
}
