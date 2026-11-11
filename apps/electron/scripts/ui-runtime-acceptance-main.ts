/** 独立 owned Electron 验收入口；只在测试 bundle 中执行 JS，不给产品新增 eval API。 */
import { app } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDesktopPreview } from '../src/main/lib/desktop-runtime/config.ts'
import { startDesktopPreview } from '../src/main/lib/desktop-runtime/bootstrap.ts'
const config = resolveDesktopPreview(process.env,app.isPackaged)
if(!config) throw new Error('QA_CONFIG')
const output = process.env.TINKER_QA_OUTPUT!
const wait = (ms:number):Promise<void>=>new Promise(resolve=>setTimeout(resolve,ms))
async function run():Promise<void> {
 const win = await startDesktopPreview(config!)
 win.webContents.on('console-message',(_event,_level,message)=>{console.log('[页面]',message.slice(0,500))})
 const evaluate = <T>(code:string):Promise<T>=>win.webContents.executeJavaScript(code)
 const until = async (code:string,label:string):Promise<void>=>{
   for(let i=0;i<120;i++){if(await evaluate<boolean>(code))return;await wait(100)}
   throw new Error('QA_TIMEOUT_'+label)
 }
 await until('!!document.querySelector("[contenteditable=true]") && document.body.innerText.includes("Synthetic")','composer')
 const effortRoundtrip=await evaluate<boolean>(`(async()=>{const workspace=(await window.electronAPI.listAgentWorkspaces())[0];if(!workspace)return false;await window.electronAPI.setReasoningEffort(workspace.slug,'low');if(await window.electronAPI.getReasoningEffort(workspace.slug)!=='low')return false;await window.electronAPI.setReasoningEffort(workspace.slug,'high');return await window.electronAPI.getReasoningEffort(workspace.slug)==='high'})()`)
 if(!effortRoundtrip)throw new Error('QA_WORKSPACE_EFFORT_ROUNDTRIP')
 console.log('[验收通过] 原 preload 工作区推理深度 low/high 往返')
 const send = async(text:string):Promise<void>=>{
   await evaluate('document.querySelector("[contenteditable=true]").focus()')
   win.webContents.insertText(text)
   await wait(100)
   await evaluate(`document.querySelector('[aria-label="Send message"]').click()`)
 }
 const phase=process.env.TINKER_QA_PHASE ?? 'first'
 if(phase==='reopen') {
   await until('document.body.innerText.includes("FIRST synthetic request")','reopen_history')
   const history=await evaluate<{type:string;uuid?:string}[]>('window.electronAPI.listAgentSessions().then(s=>window.electronAPI.getAgentSessionSDKMessages(s[0].id))')
   if(history.length!==11 || new Set(history.map(m=>m.uuid)).size!==11)throw new Error('QA_REOPEN_HISTORY')
   writeFileSync(join(output,'ui-runtime-reopened.png'),(await win.webContents.capturePage()).toPNG())
   console.log('[验收通过] 重开正式页面恢复11条稳定消息')
   await evaluate(`window.electronAPI.updateSettings({language:'zh',theme:'dark'})`);win.webContents.reload();
   await until('document.documentElement.classList.contains("dark") && document.body.innerText.includes("FIRST synthetic request")','dark_zh')
   await until('document.body.innerText.includes("新会话") || document.body.innerText.includes("项目")','zh_locale')
   await wait(800) // 等原消息入场动画稳定后留截图。
   writeFileSync(join(output,'ui-runtime-reopened-zh-dark.png'),(await win.webContents.capturePage()).toPNG())
   await evaluate(`window.electronAPI.updateSettings({language:'en',theme:'light'})`);win.webContents.reload();
   await until('!document.documentElement.classList.contains("dark") && document.body.innerText.includes("FIRST synthetic request")','light_en')
   console.log('[验收通过] 中文深色与英文浅色原页面')
   app.quit();return
 }
 await evaluate(`window.__qa={complete:[],events:[],errors:[]};window.electronAPI.onAgentStreamComplete(e=>window.__qa.complete.push(e));window.electronAPI.onAgentStreamEvent(e=>window.__qa.events.push(e));window.electronAPI.onAgentStreamError(e=>window.__qa.errors.push(e));true`)
 await send('FIRST synthetic request')
 await until('document.body.innerText.includes("你好🌱")','unicode_delta')
 writeFileSync(join(output,'ui-runtime-stream.png'),(await win.webContents.capturePage()).toPNG())
 await until('window.__qa.complete.length===1','first_complete')
 await wait(200)
 const sessions = await evaluate<{id:string}[]>('window.electronAPI.listAgentSessions()')
 if(sessions.length!==1)throw new Error('QA_SESSION_COUNT')
 const id=sessions[0]!.id
 const history=()=>evaluate<{type:string;uuid?:string;error?:unknown}[]>(`window.electronAPI.getAgentSessionSDKMessages(${JSON.stringify(id)})`)
 if((await history()).length!==2)throw new Error('QA_FIRST_HISTORY')
 const click = async(expression:string):Promise<void>=>{
   const p=await evaluate<{x:number;y:number}>(`(()=>{const r=(${expression}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
   win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p})
 }
 await click(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Synthetic A')`)
 await wait(200)
 console.log('[菜单诊断]',await evaluate('document.body.innerText'))
 await until('document.body.innerText.includes("Synthetic B")','model_menu')
 console.log('[模型菜单]',await evaluate('document.body.innerText'))
 await click(`[...document.querySelectorAll('[role="menuitem"],[role="option"],button')].find(e=>e.textContent?.includes('Synthetic B'))`)
 await wait(150)
 // 只替换本测试 renderer 的 Date，验证真实 nowMs 回拨；不改变系统时钟。
 await evaluate(`window.__qa.realDate=window.Date;window.__qa.rollback=window.__qa.complete[0].startedAt-60000;window.Date=new Proxy(window.Date,{construct(Target,args){return args.length?Reflect.construct(Target,args):new Target(window.__qa.rollback)},get(Target,key){return key==='now'?()=>window.__qa.rollback:Reflect.get(Target,key)}});true`)
 try {await send('SECOND synthetic request')} finally {await evaluate('window.Date=window.__qa.realDate;delete window.__qa.realDate;true')}

 await until('window.__qa.complete.length===2','second_complete')
 if(!await evaluate<boolean>('window.__qa.complete[1].startedAt < window.__qa.complete[0].startedAt && !!window.__qa.complete[0].requestId && !!window.__qa.complete[1].requestId && window.__qa.complete[0].requestId!==window.__qa.complete[1].requestId'))throw new Error('QA_ROLLBACK_IDENTITY')
 await until(`!document.querySelector('[aria-label="Stop generation"]')`,'rollback_complete_state')
 console.log('[验收通过] 真实renderer时钟回拨与独立requestId完成')
 await wait(200)
 if((await history()).length!==4)throw new Error('QA_SECOND_HISTORY')
 writeFileSync(join(output,'ui-runtime-two-turns.png'),(await win.webContents.capturePage()).toPNG())
 await send('FAIL synthetic request')
 await until('window.__qa.complete.length===3 && window.__qa.errors.length===1','failure')
 await wait(300)
 console.log('[失败状态]',await evaluate('document.body.innerText'))
 await until('document.body.innerText.includes("Restore draft")','recovery')
 if(!(await history())[5]?.error)throw new Error('QA_FAILURE_HISTORY')
 await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Restore draft').click()`)
 await until('document.querySelector("[contenteditable=true]").innerText.includes("FAIL synthetic request")','restored_draft')
 await wait(200)
 if((await history()).length!==6)throw new Error('QA_RESTORE_REPLAY')
 console.log('[草稿恢复无请求]')
 await evaluate(`document.querySelector('[contenteditable=true]').focus()`);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['meta']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['meta']});win.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'});
 await until('document.querySelector("[contenteditable=true]").innerText.trim()===""','clear_restored_draft')
 writeFileSync(join(output,'ui-runtime-failed.png'),(await win.webContents.capturePage()).toPNG())
 await send('SLOW cancellation request')
 await until('window.__qa.events.some(e=>e.payload.kind==="asci_event"&&e.payload.event.type==="text_delta"&&e.startedAt===window.__qa.events.at(-1).startedAt)','slow_delta')
 await send('QUEUED text stays in composer')
 await until('document.querySelector("[contenteditable=true]").innerText.includes("QUEUED text")','queue_preserved')
 if(!(await evaluate<string>('document.body.innerText')).includes('This operation is not available'))throw new Error('QA_QUEUE_ERROR')
 // 保留排队文本时按钮仍是 Send；先清空测试输入，再操作原停止按钮。
 await evaluate(`document.querySelector('[contenteditable=true]').focus()`);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['meta']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['meta']});win.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'});
 await until(`document.querySelector('[aria-label="Stop generation"]')!==null`,'stop_button');
 await evaluate(`document.querySelector('[aria-label="Stop generation"]').click()`)
 await until('window.__qa.complete.length===4','cancel_complete')
 if(!await evaluate<boolean>('window.__qa.complete[3].stoppedByUser'))throw new Error('QA_CANCEL_STATUS')
 await evaluate(`document.querySelector('[contenteditable=true]').focus()`)
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['meta']})
 win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['meta']})
 win.webContents.insertText('')
 await wait(100)
 await send('SLOW reload request')
 await wait(250)
 win.webContents.reload()
 await until('!!document.querySelector("[contenteditable=true]") && document.body.innerText.includes("SLOW reload request")','reload_user')
 await until(`document.querySelector('[aria-label="Stop generation"]')!==null`,'reload_running')
 writeFileSync(join(output,'ui-runtime-reloaded-stream.png'),(await win.webContents.capturePage()).toPNG())
 await until(`window.electronAPI.getAgentSessionSDKMessages(${JSON.stringify(id)}).then(m=>m.length===11)`,'reload_final')
 await wait(300)
 const final=await history()
 if(new Set(final.map(m=>m.uuid)).size!==11)throw new Error('QA_DUPLICATE_MESSAGES')
 console.log('[验收通过] 原UI两模型/Unicode/两轮/错误恢复/队列保留/取消/刷新流/终态去重')
 app.quit()
}
run().catch(error=>{console.error('[验收失败]',error);app.exit(1)})
