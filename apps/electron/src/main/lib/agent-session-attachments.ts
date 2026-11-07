/** 会话附件落盘：目录由已存在会话的归属决定，独立会话沿用 Agent 的默认 cwd。 */
import { join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { AgentSaveFilesInput, AgentSavedFile } from '@asci/shared'
export interface AttachmentDirectories {
 getSession: (id: string) => {workspaceId?: string} | null | undefined
 getWorkspace: (id: string) => {slug: string} | null | undefined
 getProjectPath: (slug: string, sessionId: string) => string
 getDefaultPath: (sessionId: string) => string
}
export function saveSessionAttachments(input: AgentSaveFilesInput, directories: AttachmentDirectories): AgentSavedFile[] {
 if (!input || typeof input.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.sessionId) || !Array.isArray(input.files)) throw new Error('Invalid attachment request')
 const session=directories.getSession(input.sessionId)
 if (!session) throw new Error('Attachment session not found')
 // 先整批检查，避免后面的非法文件导致前面已经写入。
 for(const file of input.files) {
  if (!file || typeof file.filename !== 'string' || !file.filename || file.filename === '.' || file.filename === '..' || /[\\/\0]/.test(file.filename) || /^[A-Za-z]:/.test(file.filename) || typeof file.data !== 'string') throw new Error('Invalid attachment filename or data')
 }
 const workspace=session.workspaceId ? directories.getWorkspace(session.workspaceId) : undefined
 if (session.workspaceId && !workspace) throw new Error('Attachment workspace not found')
 const directory=workspace ? directories.getProjectPath(workspace.slug,input.sessionId) : directories.getDefaultPath(input.sessionId)
 mkdirSync(directory,{recursive:true})
 return input.files.map(file=>{
  const dot=file.filename.lastIndexOf('.')
  const base=dot>0 ? file.filename.slice(0,dot) : file.filename
  const extension=dot>0 ? file.filename.slice(dot) : ''
  let filename=file.filename;let counter=1
  while(existsSync(join(directory,filename))) filename=`${base}-${counter++}${extension}`
  const targetPath=join(directory,filename)
  // 排他创建也防止检查后被另一个写入者抢占时覆盖内容。
  writeFileSync(targetPath,Buffer.from(file.data,'base64'),{flag:'wx'})
  return {filename,targetPath}
 })
}
