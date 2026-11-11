/** 隔离预览只复用正式 renderer/preload，不加载旧主进程或启动外部服务。 */
import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { isPreviewResourceAllowed } from './resources.ts'
import type { DesktopPreviewConfig } from './config.ts'
import { DesktopClient } from './client.ts'
import { DesktopRouter } from './router.ts'
import { registerDesktopRuntimeIpc } from '../../ipc/desktop-runtime.ts'
import { registerPreviewPlatform } from './platform.ts'
export async function startDesktopPreview(config:DesktopPreviewConfig):Promise<BrowserWindow> {
  app.setPath('userData',join(config.root,'chromium'))
  await app.whenReady()
  // renderer 只读取打包资源；包括字体、遥测在内的网络请求全部阻断。
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    callback({cancel:!isPreviewResourceAllowed(details.url,__dirname)})
  })
  const client = new DesktopClient(config)
  const router = new DesktopRouter(client,config)
  try {
    await client.request('runtime.describe',{})
    registerDesktopRuntimeIpc(router)
    await registerPreviewPlatform(router,config)
    const win = new BrowserWindow({width:1400,height:900,minWidth:1024,minHeight:720,backgroundColor:'#ffffff',titleBarStyle:'hiddenInset',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}})
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}))
    win.webContents.on('will-navigate',event=>event.preventDefault())
    app.once('before-quit',()=>client.close())
    app.on('window-all-closed',()=>app.quit())
    await win.loadFile(join(__dirname,'renderer','index.html'))
    return win
  } catch { client.close(); throw new Error('DESKTOP_PREVIEW_START') }
}
