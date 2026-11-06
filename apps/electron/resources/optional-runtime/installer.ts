import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rm, rename, stat, readdir, chmod } from 'node:fs/promises'
import { join, isAbsolute, posix } from 'node:path'
import { gunzipSync } from 'node:zlib'
import * as tar from 'tar'

export interface Artifact { name: string; version: string; url: string; integrity: string; format: 'tgz' | 'gz' | 'runtime-tgz'; entrypoint?: string; prunePaths?: string[] }
export interface InstallOptions {
 root: string
 artifacts: Artifact[]
 fetcher?: (url: string, init?: RequestInit) => Promise<Response>
 maxBytes?: number
 onProgress?: (message: string) => void
}
const inflight = new Map<string, Promise<string>>()
const fingerprint = (artifacts: Artifact[]) => createHash('sha256').update(JSON.stringify({ layout: 2, artifacts })).digest('hex')
async function ready(root: string, id: string, artifacts: Artifact[]): Promise<boolean> {
 try {
  if ((await readFile(join(root,'ready.json'),'utf8')) !== id) return false
  for (const a of artifacts) await stat(a.format === 'gz' ? join(root,a.name) : a.format === 'runtime-tgz' ? join(root,a.name,a.entrypoint!) : join(root,'node_modules',a.name,'package.json'))
  return true
 } catch { return false }
}
export function installComponent(options: InstallOptions): Promise<string> {
 const key = `${options.root}:${fingerprint(options.artifacts)}`
 const existing=inflight.get(key); if(existing) return existing
 const promise=install(options).finally(()=>inflight.delete(key));inflight.set(key,promise);return promise
}
async function install(options: InstallOptions): Promise<string> {
 const {root,artifacts,onProgress}=options
 for(const a of artifacts) {
  if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(a.name) || a.name.includes('..') || (a.format==='gz' && a.name.includes('/'))) throw new Error('组件名称无效')
  if(a.format==='runtime-tgz' && (!a.entrypoint || isAbsolute(a.entrypoint) || a.entrypoint.includes('\\') || a.entrypoint.split('/').includes('..'))) throw new Error('组件入口路径无效')
  for(const path of a.prunePaths ?? []) if(isAbsolute(path) || path.includes('\\') || path.split('/').includes('..') || path===a.entrypoint) throw new Error('组件清理路径无效')
  if(new URL(a.url).protocol!=='https:' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(a.integrity)) throw new Error('组件下载清单无效')
 }
 const id=fingerprint(artifacts)
 if(await ready(root,id,artifacts)) return root
 await mkdir(join(root,'..'),{recursive:true,mode:0o700})
 const lock=`${root}.lock`, deadline=Date.now()+300_000
 // A lock shared by the main process and MCP subprocesses prevents partial installs.
 while(true) {
  try {await mkdir(lock,{mode:0o700});await writeFile(join(lock,'owner'),String(process.pid));break} catch(err) {
   if((err as NodeJS.ErrnoException).code!=='EEXIST') throw err
   try {
    const owner=Number(await readFile(join(lock,'owner'),'utf8'))
    if(Number.isSafeInteger(owner) && owner>0) {
     try {process.kill(owner,0)} catch(err) {if((err as NodeJS.ErrnoException).code==='ESRCH') {await rm(lock,{recursive:true,force:true});continue}}
    }
   } catch { /* A live installer may still be writing the owner file. */ }
   try {if(Date.now()-(await stat(lock)).mtimeMs>600_000) {await rm(lock,{recursive:true,force:true});continue}} catch {continue}
   if(await ready(root,id,artifacts)) return root
   if(Date.now()>deadline) throw new Error('组件下载仍在进行，请稍后重试')
   await new Promise(resolve=>setTimeout(resolve,100))
  }
 }
 const stage=`${root}.partial-${process.pid}-${Date.now()}`
 try {
  if(await ready(root,id,artifacts)) return root
  await mkdir(stage,{recursive:true,mode:0o700})
  for(const a of artifacts) {
   onProgress?.(`首次使用，正在下载本机组件：${a.name} ${a.version}`)
   const response=await (options.fetcher ?? fetch)(a.url,{signal:AbortSignal.timeout(120_000),redirect:'follow'})
   if(!response.ok) throw new Error(`组件下载失败（HTTP ${response.status}），请检查网络后重试`)
   const max=options.maxBytes ?? 256*1024*1024
   const chunks:Uint8Array[]=[];let count=0
   if(!response.body) throw new Error('组件下载内容为空，请重试')
   const reader=response.body.getReader()
   try {while(true) {const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>max)throw new Error('组件下载超出大小限制');chunks.push(value)}} finally {await reader.cancel().catch(()=>{})}
   const bytes=Buffer.concat(chunks)
   if(`sha512-${createHash('sha512').update(bytes).digest('base64')}`!==a.integrity) throw new Error('组件完整性校验失败，请重试')
   if(a.format==='gz') {
    await writeFile(join(stage,a.name),gunzipSync(bytes,{maxOutputLength:256*1024*1024}),{mode:0o755})
   } else {
    const archive=join(stage,'download.tgz');await writeFile(archive,bytes)
    let unpacked=0;let unsafe=false
    await tar.t({file:archive,strict:true,onReadEntry(entry) {
     const path=entry.path.replace(/\\/g,'/')
     unpacked+=entry.size
     const runtime=a.format==='runtime-tgz'
     const link=runtime && ['SymbolicLink','Link'].includes(entry.type)
     const linkTarget=entry.type==='Link' ? posix.resolve('/archive',entry.linkpath) : posix.resolve('/archive',posix.dirname(path),entry.linkpath ?? '')
     if(isAbsolute(path) || path.split('/').includes('..') || (!runtime && !path.startsWith('package/')) ||
       (!['File','Directory','OldFile'].includes(entry.type) && !link) ||
       (link && (!entry.linkpath || isAbsolute(entry.linkpath) || !linkTarget.startsWith('/archive/'))) || unpacked>512*1024*1024) unsafe=true
    }})
    if(unsafe) throw new Error('组件压缩包包含不安全的条目或大小超限')
    const target=a.format==='runtime-tgz' ? join(stage,a.name) : join(stage,'node_modules',a.name);await mkdir(target,{recursive:true})
    await tar.x({file:archive,cwd:target,strip:a.format==='runtime-tgz'?0:1,strict:true,noChmod:true,preservePaths:false})
    if(a.format==='runtime-tgz') {
     for(const path of a.prunePaths ?? []) await rm(join(target,path),{recursive:true,force:true})
     const entry=join(target,a.entrypoint!);await stat(entry);await chmod(entry,0o755)
    } else {
    const pkg=JSON.parse(await readFile(join(target,'package.json'),'utf8')) as {name:string;version:string}
    if(pkg.name!==a.name || pkg.version!==a.version) throw new Error('组件版本校验失败')
    }
    // npm's ONNX archive includes binaries for several operating systems.
    // Keep only this host; downloading an optional feature must not restore foreign binaries.
    if(a.name==='onnxruntime-node') {
     const binaryRoot=join(target,'bin','napi-v6')
     for(const platform of await readdir(binaryRoot)) {
      if(platform!==process.platform) await rm(join(binaryRoot,platform),{recursive:true,force:true})
      else for(const arch of await readdir(join(binaryRoot,platform))) if(arch!==process.arch) await rm(join(binaryRoot,platform,arch),{recursive:true,force:true})
     }
    }
    await rm(archive)
   }
  }
  await writeFile(join(stage,'ready.json'),id)
  await rm(root,{recursive:true,force:true})
  await rename(stage,root)
  onProgress?.('本机组件已就绪')
  return root
 } finally {await rm(stage,{recursive:true,force:true});await rm(lock,{recursive:true,force:true})}
}
