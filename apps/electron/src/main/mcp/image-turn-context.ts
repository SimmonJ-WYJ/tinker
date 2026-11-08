/** 只收集宿主本会话可上传的真实附件，不授予项目目录隐式外发权限。 */
import { readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ImageAssets } from './image-assets.ts'
import { readImageReferences } from './image-reference.ts'

interface SessionImageFiles { sessionDirectory: string; userMessages: readonly string[]; currentUserMessage?: string }
export function readSessionImageScope(sessionId: string, directory: string, attached?: SessionImageFiles): {referenceImageIds:string[];referenceImagePaths:string[];latestImageId?:string;hasCurrentImageAttachment:boolean} {
 const paths=new Set<string>()
 const checkedAttachments=new Set<string>()
 let hasCurrentImageAttachment=false
 for(const entry of readdirSync(directory,{withFileTypes:true})) {
  if(!entry.isFile() || !/\.(?:png|jpe?g|webp)$/i.test(entry.name)) continue
  const path=join(directory,entry.name)
  try {
   readImageReferences([path],[directory])
   paths.add(path); paths.add(`${sessionId}/${entry.name}`)
  }catch { /* 缺失、伪装、过大或越界文件均不取得自动外发授权。 */ }
 }
 // UI 上传入口返回的有限文件列表，必须仍位于宿主确定的本会话沙箱。
 // 历史 user 消息只提供引用集合，绝不参与当前回合意图判断。
 if(attached) for(const message of attached.userMessages) {
  for(const path of attachedImagePaths(message)) {
   if(checkedAttachments.has(path)) {
    if(paths.has(path) && message===attached.currentUserMessage)hasCurrentImageAttachment=true
    continue
   }
   checkedAttachments.add(path)
   try {
    readImageReferences([path],[attached.sessionDirectory])
    paths.add(path)
    if(message===attached.currentUserMessage)hasCurrentImageAttachment=true
   }catch { /* 伪造的标签不能把其他会话或项目文件加入本回合。 */ }
  }
 }
 const referenceImageIds=new ImageAssets(directory).list().filter(asset=>asset.available && paths.has(join(directory,asset.filename))).map(asset=>asset.id)
 return {referenceImageIds,referenceImagePaths:[...paths],latestImageId:referenceImageIds.at(-1),hasCurrentImageAttachment}
}

/** 这里只解析候选路径；调用方必须与宿主验证后的图片集合求交。 */
export function attachedImagePaths(message: string): string[] {
 const paths: string[] = []
 for(const block of message.matchAll(/<attached_files>\s*([\s\S]*?)<\/attached_files>/g)) {
  for(const line of block[1]!.split('\n')) {
   const path=line.match(/^-\s+.+?:\s+(.+)$/)?.[1]?.trim()
   if(path && isAbsolute(path))paths.push(path)
  }
 }
 return paths
}
