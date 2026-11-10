/** 仍由 Electron 提供的本地偏好/主题/项目元数据，全部位于已验证的 compat 根。 */
import { BrowserWindow, ipcMain } from 'electron'
import { AGENT_IPC_CHANNELS as A, IPC_CHANNELS, TELEMETRY_IPC_CHANNELS as T, isValidAgentEffort } from '@asci/shared'
import { SETTINGS_IPC_CHANNELS as S, THEME_IPC_CHANNELS, USER_PROFILE_IPC_CHANNELS } from '../../../types/index.ts'
import type { AppSettings } from '../../../types/index.ts'
import { getSettings, updateSettings } from '../settings-service.ts'
import { getUserProfile, updateUserProfile } from '../user-profile-service.ts'
import { resolveTheme, registerNativeThemeListener } from '../theme-service.ts'
import { getWorkspaceReasoningEffort, setWorkspaceReasoningEffort, getWorkspacePermissionMode, getWorkspaceAttachedDirectories } from '../agent-workspace-manager.ts'
import { setLanguage } from '../i18n-main.ts'
import { ONBOARDING_SPOTLIGHT_IPC_CHANNELS } from '../../../types/onboarding-spotlight.ts'
import { CONCEPT_SPOTLIGHT_IPC_CHANNELS } from '../../../types/concept-spotlight.ts'
import { registerSpotlightIpc } from '../../ipc/spotlight.ts'
import { unsupported } from './router.ts'
import { isPreviewWorkspace, initializePreviewWorkspace, listPreviewWorkspaces } from './workspace.ts'
import type { DesktopPreviewConfig } from './config.ts'
import type { DesktopRouter } from './router.ts'

export async function registerPreviewPlatform(router:DesktopRouter,config:DesktopPreviewConfig):Promise<void> {
  const channels = await router.channels()
  const settings = getSettings()
  if (!settings.agentChannelId) updateSettings({agentChannelId:channels[0]?.id,agentModelId:channels[0]?.models[0]?.id,agentChannelIds:channels.map(c=>c.id),telemetryConsent:{posthogEnabled:false,agentEvolutionEnabled:false}})
  initializePreviewWorkspace(config.compatHome)
  const broadcast = ():void => {
    for(const win of BrowserWindow.getAllWindows()) if(!win.isDestroyed()) win.webContents.send(THEME_IPC_CHANNELS.CHANGED,resolveTheme())
  }
  const update = (updates:Partial<AppSettings>):AppSettings => {
    const result = updateSettings(updates)
    if(result.language==='zh'||result.language==='en') setLanguage(result.language)
    broadcast(); return result
  }
  if(settings.language==='zh'||settings.language==='en') setLanguage(settings.language)
  ipcMain.removeHandler(S.GET)
  ipcMain.removeHandler(S.UPDATE)
  ipcMain.removeHandler(T.GET_CONSENT_STATE)
  ipcMain.removeHandler(T.TRACK)
  ipcMain.removeHandler(T.CAPTURE_SIGNAL)
  ipcMain.removeHandler(USER_PROFILE_IPC_CHANNELS.GET)
  ipcMain.removeHandler(USER_PROFILE_IPC_CHANNELS.UPDATE)
  ipcMain.removeHandler(IPC_CHANNELS.GET_RUNTIME_STATUS)
  ipcMain.handle(S.GET,()=>getSettings())
  ipcMain.handle(S.UPDATE,(_e,updates:Partial<AppSettings>)=>update(updates))
  ipcMain.on(S.UPDATE_SYNC,(e,updates:Partial<AppSettings>)=>{e.returnValue=update(updates)})
  ipcMain.on(THEME_IPC_CHANNELS.RESOLVE,e=>{e.returnValue=resolveTheme()})
  ipcMain.on(T.REAL_SEND_ALLOWED,e=>{e.returnValue=false})
  ipcMain.handle(T.GET_CONSENT_STATE,()=>({region:'unknown',defaultEnabled:false,posthogEnabled:false,agentEvolutionEnabled:false}))
  ipcMain.handle(T.TRACK,unsupported)
  ipcMain.handle(T.CAPTURE_SIGNAL,unsupported)
  ipcMain.on('window:chrome-state',e=>{e.returnValue={platform:process.platform,fullscreen:BrowserWindow.fromWebContents(e.sender)?.isFullScreen()??false}})
  ipcMain.handle(USER_PROFILE_IPC_CHANNELS.GET,()=>getUserProfile())
  ipcMain.handle(USER_PROFILE_IPC_CHANNELS.UPDATE,(_e,updates)=>updateUserProfile(updates))
  const replace = (channel:string,handler:Parameters<typeof ipcMain.handle>[1]):void => {ipcMain.removeHandler(channel);ipcMain.handle(channel,handler)}
  const workspace = (slug:string):string => {
    if(!isPreviewWorkspace(slug,config.compatHome,listPreviewWorkspaces(config.compatHome).map(w=>w.slug))) unsupported()
    return slug
  }
  replace(A.LIST_WORKSPACES,()=>listPreviewWorkspaces(config.compatHome))
  replace(A.GET_REASONING_EFFORT,(_e,slug:string)=>getWorkspaceReasoningEffort(workspace(slug)))
  replace(A.SET_REASONING_EFFORT,(_e,slug:string,effort)=>{if(!isValidAgentEffort(effort))unsupported();return setWorkspaceReasoningEffort(workspace(slug),effort)})
  replace(A.GET_PERMISSION_MODE,(_e,slug:string)=>getWorkspacePermissionMode(workspace(slug)))
  replace(A.GET_WORKSPACE_DIRECTORIES,(_e,slug:string)=>getWorkspaceAttachedDirectories(workspace(slug)))
  ipcMain.handle(IPC_CHANNELS.GET_RUNTIME_STATUS,()=>null)
  registerNativeThemeListener(broadcast)
  for(const channel of [...Object.values(ONBOARDING_SPOTLIGHT_IPC_CHANNELS),...Object.values(CONCEPT_SPOTLIGHT_IPC_CHANNELS)]) ipcMain.removeHandler(channel)
  registerSpotlightIpc()
}
