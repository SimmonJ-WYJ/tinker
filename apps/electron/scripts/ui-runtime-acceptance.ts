/** 仅 numeric loopback 的合成 provider；启动独立 Electron 和自己的临时数据根。 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync,realpathSync,writeFileSync,mkdirSync,openSync,fsyncSync,closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve,dirname } from 'node:path'
const [electron,outputArg,binaryArg] = process.argv.slice(2)
if(!electron||!outputArg||!binaryArg) throw new Error('usage: bun ui-runtime-acceptance.ts ELECTRON OUTPUT RUST_BINARY')
const output=resolve(outputArg);mkdirSync(output,{recursive:true})
const root=realpathSync(mkdtempSync(join(tmpdir(),'tinker-desktop-preview-')))
interface CapturedRequest {messages:{role:string;content:string}[];model:string;reasoning_effort:string}
const requests:CapturedRequest[]=[]
const server=createServer(async(req,res)=>{
 let body='';for await(const chunk of req) body+=chunk.toString()
 const parsed=JSON.parse(body) as {messages:{role:string;content:string}[];model:string;reasoning_effort:string}
 requests.push(parsed)
 const input=parsed.messages.at(-1)?.content??''
 if(input.includes('FAIL')) {
  res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'Partial failure 你好🌱'}}]})+'\n\n');
  await new Promise(r=>setTimeout(r,150));res.end('data: {broken\n\n');return
 }
 res.writeHead(200,{'content-type':'text/event-stream'})
 res.write('data: '+JSON.stringify({choices:[{delta:{content:'你好🌱 '}}]})+'\n\n')
 await new Promise(r=>setTimeout(r,input.includes('SLOW')?3000:450))
 res.write('data: '+JSON.stringify({choices:[{delta:{content:'Rust formal UI response.'}}]})+'\n\n')
 res.end('data: [DONE]\n\n')
})
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
const address=server.address();if(!address||typeof address==='string')throw new Error('QA_BIND')
writeFileSync(join(root,'preview.json'),JSON.stringify({version:1,kind:'tinker-rust-preview',root}),{mode:0o600})
writeFileSync(join(root,'profiles.json'),JSON.stringify([{profileId:'local',label:'Synthetic local',configRevision:'r1',protocol:'openai-chat',models:[{modelId:'model/a',label:'Synthetic A',supportedEfforts:['high']},{modelId:'model/b',label:'Synthetic B',supportedEfforts:['high']}],endpoint:`http://127.0.0.1:${address.port}/v1/chat/completions`,key:'synthetic-secret'}]),{mode:0o600})
for(const path of [join(root,'preview.json'),join(root,'profiles.json'),root,dirname(root)]) {const fd=openSync(path,'r');try{fsyncSync(fd)}finally{closeSync(fd)}}
console.log('[隔离根]',root)
let result=0
for(const phase of ['first','reopen']) {
 const child=spawn(electron,[resolve('apps/electron/dist/ui-runtime-acceptance.cjs')],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:'en_US.UTF-8',TINKER_DESKTOP_RUNTIME:'rust-preview',TINKER_DESKTOP_ROOT:root,TINKER_DESKTOP_BINARY:realpathSync(binaryArg),TINKER_DESKTOP_PROFILES:join(root,'profiles.json'),ASCI_CONFIG_HOME:join(root,'electron-compat'),TINKER_QA_OUTPUT:output,TINKER_QA_PHASE:phase},stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',(chunk:Buffer)=>{process.stdout.write(chunk);if(chunk.toString().includes('[草稿恢复无请求]')){console.log('[恢复时HTTP请求数]',requests.length);if(requests.length!==3)result=1}})
 child.stderr.on('data',(chunk:Buffer)=>process.stderr.write(chunk))
 const timeout=setTimeout(()=>child.kill(),60000)
 const status=await new Promise<number|null>(r=>child.on('exit',r))
 clearTimeout(timeout)
 if(status!==0){result=status??1;break}
 await new Promise(r=>setTimeout(r,300))
}
server.closeAllConnections();server.close()
writeFileSync(join(output,'ui-runtime-http.json'),JSON.stringify(requests,null,2))
console.log('[HTTP请求数]',requests.length)
if(result===0 && (requests.length!==5 || requests.some(r=>r.reasoning_effort!=='high') || requests[0]?.model!=='model/a' || requests[1]?.model!=='model/b' || JSON.stringify(requests.map(r=>r.messages.length))!=='[1,3,5,5,5]')) result=1
process.exitCode=result
