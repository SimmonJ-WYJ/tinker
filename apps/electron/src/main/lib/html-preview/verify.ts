import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { htmlPreviewServer, inside } from './server'
import { isScopedProjectEdit } from '../scoped-edit-permission'
export interface HtmlCheckInput { path:string; actions?:{selector:string;count?:number;type?:"click"|"fill"|"press";value?:string;key?:string}[]; observe?:string[]; screenshot?:boolean }
export async function verifyProjectHtml(cwd:string,input:HtmlCheckInput) {
 const {resolve}=await import('node:path')
 const root=await realpath(cwd);const file=resolve(root,input.path)
 if(!isScopedProjectEdit('Write',{file_path:file},root) || !inside(root,await realpath(file)))throw new Error('HTML verification is restricted to ordinary files in this project')
 if((input.actions?.length??0)>12 || (input.observe?.length??0)>12)throw new Error('At most 12 actions and observations')
 for(const a of input.actions??[])if(!a.selector || a.selector.length>256 || !Number.isInteger(a.count??1) || (a.count??1)<1 || (a.count??1)>5)throw new Error('Invalid action')
 for(const a of input.actions??[]) {
  if(a.type && !['click','fill','press'].includes(a.type))throw new Error('Unsupported action')
  if(a.type==='fill' && (typeof a.value!=='string' || a.value.length>4000))throw new Error('Fill requires bounded text')
  if(a.type==='press' && !['Enter','Tab','Escape','ArrowUp','ArrowDown','Space'].includes(a.key??''))throw new Error('Unsupported key')
 }
 const url=await htmlPreviewServer.open(file)
 const {BrowserWindow,session}=await import('electron')
 const partition=session.fromPartition(`asci-html-check-${randomUUID()}`)
 const prefix=url.slice(0,url.lastIndexOf('/')+1)
 partition.setPermissionRequestHandler((_wc,_p,callback)=>callback(false))
 partition.setPermissionCheckHandler(()=>false)
 partition.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!(details.url.startsWith(prefix)||details.url.startsWith('data:text/html,'))}))
 const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{session:partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}})
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}))
 const errors:string[]=[]
 win.webContents.on('console-message',(event)=>{
  if(event.level==='error' && errors.length<8)errors.push(event.message.slice(0,500))
 })
 let timer:ReturnType<typeof setTimeout>|undefined
 try {
  return await Promise.race([
   (async()=>{
    await win.loadURL('data:text/html,'+encodeURIComponent(`<iframe style="width:100%;height:100%;border:0" sandbox="allow-scripts" src="${url}"></iframe>`))
    const frame=win.webContents.mainFrame.frames[0]
    if(!frame)throw new Error('Preview frame did not load')
    const observe=input.observe??[]
    const snapshot=()=>frame.executeJavaScript(`(() => { const selectors=${JSON.stringify(observe)}; return {title:document.title, observations:selectors.map(selector=>({selector,text:document.querySelector(selector)?.textContent?.slice(0,2000)??null,value:document.querySelector(selector)?.value??null,checked:document.querySelector(selector)?.checked??null})),buttons:[...document.querySelectorAll('button')].slice(0,20).map(b=>({text:b.textContent?.slice(0,200),disabled:b.disabled}))}; })()`)
    const before=await snapshot();const steps=[]
    for(const a of input.actions??[]){
     if(a.type==='fill') {
      await frame.executeJavaScript(`(() => {const el=document.querySelector(${JSON.stringify(a.selector)});if(!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))throw new Error('Fill target must be an input or textarea');if(el.type==='file'||el.type==='password')throw new Error('Sensitive input is not supported');el.focus();const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(a.value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
     } else if(a.type==='press') {
      await frame.executeJavaScript(`(() => {const el=document.querySelector(${JSON.stringify(a.selector)});if(!el)throw new Error('Key target unavailable');el.focus();})()`)
      if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3')
      const key=a.key==='Space'?' ':a.key!
      const codes:Record<string,number>={Enter:13,Tab:9,Escape:27,ArrowUp:38,ArrowDown:40,Space:32}
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key,code:a.key,windowsVirtualKeyCode:codes[a.key!],...(a.key==='Enter'?{text:'\r'}:{})})
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key,code:a.key,windowsVirtualKeyCode:codes[a.key!]})
     } else {
      await frame.executeJavaScript(`(() => {const el=document.querySelector(${JSON.stringify(a.selector)});if(!el || typeof el.click!=='function')throw new Error('Click target unavailable');for(let i=0;i<${a.count??1};i++)el.click();})()`)
     }
     // 等事件处理和下一帧绘制完成后再读取状态。
     await frame.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
     steps.push({selector:a.selector,after:await snapshot()})
    }
    const screenshot=input.screenshot?(await win.webContents.capturePage()).toPNG().toString('base64'):undefined
    return {path:input.path,before,steps,errors,screenshot,verification:'Actual Chromium page load and requested input, key and DOM click actions in the same isolated frame used by preview. No external network or Node access. A screenshot is included only when requested; no pixel-level visual assertions or persistence across app restarts are verified.'}
   })(),
   new Promise<never>((_ok,no)=>{timer=setTimeout(()=>no(new Error('HTML verification timed out after 15 seconds')),15000)}),
  ])
 } finally {if(timer)clearTimeout(timer);if(!win.isDestroyed())win.destroy();partition.webRequest.onBeforeRequest(null);await partition.clearStorageData()}
}
