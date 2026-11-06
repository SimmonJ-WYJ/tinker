import {request} from 'node:http'
import {test,expect} from 'bun:test'
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {HtmlPreviewServer} from './server'
const fetch=(url:string|URL,options:{method?:string}={})=>new Promise<{status:number;headers:{get:(key:string)=>string|undefined}}>((ok,no)=>{const q=request(url,{method:options.method??'GET'},r=>{r.resume();ok({status:r.statusCode??0,headers:{get:(key)=>r.headers[key] as string|undefined}})});q.on('error',no);q.end()})
test('isolated preview serves scripts and local assets without app CSP or filesystem escape',async()=>{
 const root=await mkdtemp(join(tmpdir(),'html-preview-'));const h=new HtmlPreviewServer()
 try{
  await writeFile(join(root,'index.html'),'<button>+</button><script>document.querySelector("button").onclick=()=>document.body.dataset.count=1</script>')
  await writeFile(join(root,'style.css'),'body{color:red}');await writeFile(join(root,'.env'),'SECRET');await symlink('/etc/hosts',join(root,'escape.js'))
  const url=await h.open(join(root,'index.html'));const r=await fetch(url)
  expect(r.status).toBe(200);expect(r.headers.get('content-security-policy')).toContain("script-src 'self' 'unsafe-inline'")
  expect(r.headers.get('content-security-policy')).toContain("connect-src 'none'")
  expect((await fetch(new URL('style.css',url))).status).toBe(200)
  expect((await fetch(new URL('.env',url))).status).toBe(403)
  expect((await fetch(new URL('escape.js',url))).status).toBe(403)
  expect((await fetch(url,{method:'POST'})).status).toBe(405)
  expect((await fetch(url.replace(/\/[a-f0-9]{48}\//,'/unknown/'))).status).toBe(404)
 }finally{await h.close();await rm(root,{recursive:true,force:true})}
})
