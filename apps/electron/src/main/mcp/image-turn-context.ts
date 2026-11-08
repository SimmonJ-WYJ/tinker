/** 只收集宿主本会话可上传的真实附件，不授予项目目录隐式外发权限。 */
import { readdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ImageAssets } from './image-assets.ts'
import { readImageReferences } from './image-reference.ts'

interface SessionImageFiles { sessionDirectory: string; userMessages: readonly string[] }
export function readSessionImageScope(sessionId: string, directory: string, attached?: SessionImageFiles): {referenceImageIds:string[];referenceImagePaths:string[];latestImageId?:string} {
 const paths=new Set<string>()
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
  for(const block of message.matchAll(/<attached_files>\s*([\s\S]*?)<\/attached_files>/g)) {
   for(const line of block[1]!.split('\n')) {
    const match=line.match(/^-\s+.+?:\s+(.+)$/)
    const path=match?.[1]?.trim()
    if(!path || !isAbsolute(path)) continue
    try {
     readImageReferences([path],[attached.sessionDirectory])
     paths.add(path)
    }catch { /* 伪造的标签不能把其他会话或项目文件加入本回合。 */ }
   }
  }
 }
 const referenceImageIds=new ImageAssets(directory).list().filter(asset=>asset.available && paths.has(join(directory,asset.filename))).map(asset=>asset.id)
 return {referenceImageIds,referenceImagePaths:[...paths],latestImageId:referenceImageIds.at(-1)}
}
