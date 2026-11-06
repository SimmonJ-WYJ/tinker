import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep, isAbsolute } from 'node:path'

export const PREVIEW_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const MIME: Record<string,string> = {'.html':'text/html','.htm':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2'}
const protectedPart = /^(?:\..*|credentials.*|secrets?.*|auth[-.].*|AGENTS\.md|CLAUDE\.md)$/i
export function inside(root:string,path:string) { const r=relative(root,path); return r!== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r) }

/** Anonymous renderer frames get a distinct origin, never the app's CSP or preload. */
export class HtmlPreviewServer {
 private server?: Server
 private origin = ''
 private starting?: Promise<void>
 private pages = new Map<string,{root:string;file:string;opened:number}>()
 private paths = new Map<string,string>()
 async open(filePath:string) {
  const file=await realpath(filePath)
  if(!/\.html?$/i.test(file) || !(await stat(file)).isFile())throw new Error('Select a local HTML file')
  if((await stat(file)).size>5*1024*1024)throw new Error('HTML preview exceeds 5 MB')
  await (this.starting ??= this.start())
  let token=this.paths.get(file)
  if(!token || !this.pages.has(token)) {
   token=randomBytes(24).toString('hex')
   if(this.pages.size>=64) {const first=this.pages.keys().next().value;if(first)this.pages.delete(first)}
   this.pages.set(token,{root:dirname(file),file,opened:Date.now()});this.paths.set(file,token)
  }
  this.pages.get(token)!.opened=Date.now()
  return `${this.origin}/${token}/index.html`
 }
 private async start() {
  const server=createServer(async(req,res)=>{
   const fail=(status:number)=>{res.writeHead(status,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Preview unavailable')}
   if(req.method!=='GET')return fail(405)
   if(req.headers.host!==new URL(this.origin).host)return fail(403)
   try {
    const parts=decodeURIComponent(new URL(req.url??'/',this.origin).pathname).split('/').filter(Boolean)
    const token=parts.shift()??'';const page=this.pages.get(token)
    if(!page || Date.now()-page.opened>3600000)return fail(404)
    if(!parts.length || parts.some(p=>protectedPart.test(p) || p==='..' || p.includes('\\') || p.includes('\0')))return fail(403)
    const requested=parts.join('/')==='index.html'?page.file:resolve(page.root,...parts)
    const file=await realpath(requested)
    if(!inside(page.root,file))return fail(403)
    const mime=MIME[extname(file).toLowerCase()];if(!mime)return fail(403)
    const info=await stat(file);if(!info.isFile() || info.size>5*1024*1024)return fail(413)
    const content=await readFile(file)
    res.writeHead(200,{'Content-Type':mime+'; charset=utf-8','Content-Security-Policy':PREVIEW_CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'})
    res.end(content)
   } catch {fail(404)}
  })
  this.server=server
  await new Promise<void>((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{const a=server.address();if(!a||typeof a==='string')return no(new Error('Preview startup failed'));this.origin=`http://127.0.0.1:${a.port}`;server.unref();ok()})})
 }
 async close() {await new Promise<void>(ok=>this.server?this.server.close(()=>ok()):ok());this.server=undefined;this.starting=undefined;this.pages.clear();this.paths.clear()}
}
export const htmlPreviewServer = new HtmlPreviewServer()
