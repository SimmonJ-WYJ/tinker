import { test, expect } from 'bun:test'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveSessionAttachments } from './agent-session-attachments.ts'
import type { AttachmentDirectories } from './agent-session-attachments.ts'
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'tinker-attachments-'))
 const directories: AttachmentDirectories = {
  getSession: id => id === 'independent' ? {} : id === 'project' ? {workspaceId:'p1'} : undefined,
  getWorkspace: id => id === 'p1' ? {slug:'real-project'} : undefined,
  getProjectPath: (slug,id) => join(root,slug,id),
  getDefaultPath: id => join(root,'independent',id),
 }
 return {root,directories,cleanup:()=>rmSync(root,{recursive:true,force:true})}
}
test('独立附件使用默认会话目录，PNG/PDF字节与引用路径保留且同名不覆盖',()=>{
 const f=fixture();try {
  const bytes=Buffer.from([0,137,80,78,71,255])
  const result=saveSessionAttachments({sessionId:'independent',files:[{filename:'中文 图片.png',data:bytes.toString('base64')},{filename:'中文 图片.png',data:Buffer.from('%PDF').toString('base64')}]},f.directories)
  expect(result.map(file=>file.filename)).toEqual(['中文 图片.png','中文 图片-1.png'])
  expect(result[0]!.targetPath).toBe(join(f.root,'independent','independent','中文 图片.png'))
  expect(readFileSync(result[0]!.targetPath)).toEqual(bytes)
  expect(readFileSync(result[1]!.targetPath).toString()).toBe('%PDF')
 }finally{f.cleanup()}
})
test('项目目录由会话归属决定，不信任前端传来的其他slug',()=>{
 const f=fixture();try{
  const result=saveSessionAttachments({sessionId:'project',workspaceSlug:'wrong-project',files:[{filename:'document.pdf',data:'JVBERg=='}]},f.directories)
  expect(result[0]!.targetPath).toBe(join(f.root,'real-project','project','document.pdf'))
  expect(existsSync(join(f.root,'wrong-project'))).toBe(false)
 }finally{f.cleanup()}
})
test('未知会话与整批非法文件名在任何写入前被拒绝',()=>{
 const f=fixture();try{
  for(const name of ['../escape','/absolute','..','a/b','a\\b','C:escape','nul\0name']) {
   expect(()=>saveSessionAttachments({sessionId:'independent',files:[{filename:'valid.pdf',data:'eA=='},{filename:name,data:'eA=='}]},f.directories)).toThrow()
   expect(existsSync(join(f.root,'independent'))).toBe(false)
  }
  for(const id of ['unknown','','../escape']) expect(()=>saveSessionAttachments({sessionId:id,files:[]},f.directories)).toThrow()
 }finally{f.cleanup()}
})
test('写入失败向上抛出，已有文件及待发送数据不被修改',()=>{
 const f=fixture();try{
  const input={sessionId:'independent',files:[{filename:'x.pdf',data:'eA=='}]}
  const original=JSON.stringify(input)
  expect(()=>saveSessionAttachments(input,{...f.directories,getDefaultPath:()=>'/dev/null/unwritable'})).toThrow()
  expect(JSON.stringify(input)).toBe(original)
 }finally{f.cleanup()}
})
