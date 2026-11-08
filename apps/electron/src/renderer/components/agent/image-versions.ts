/** 图片版本元数据只取自宿主生图工具结果，路径仍由附件桥接验证。 */
import type { SDKMessage, SDKAssistantMessage, SDKToolUseBlock } from '@asci/shared'
import { findToolResultInMessages } from './tool-result-lookup'
export interface ImageVersion {
 sourceMessageId?: string
 imageId?: string
 baseImageId?: string
 model?: string
 channelName?: string
 referenceCount?: number
 generatedImage: {localPath:string;filename:string;mediaType:string}
}
export function parseImageVersion(result?:string):ImageVersion|null {
 try {
  const data=JSON.parse(result??'{}') as ImageVersion
  const image=data.generatedImage
  if(!image || typeof image.localPath!=='string' || !/^[\w-]+\/[\w-]+\.(png|jpeg|webp)$/.test(image.localPath) || !/^image\/(png|jpeg|webp)$/.test(image.mediaType) || typeof image.filename!=='string') return null
  const validId=(id:unknown):id is string=>typeof id==='string' && /^[\w-]{1,128}$/.test(id) && id!=='latest'
  return {generatedImage:image,imageId:validId(data.imageId)?data.imageId:undefined,baseImageId:validId(data.baseImageId)?data.baseImageId:undefined,model:typeof data.model==='string'?data.model:undefined,channelName:typeof data.channelName==='string'?data.channelName:undefined,referenceCount:typeof data.referenceCount==='number'?data.referenceCount:undefined}
 } catch {return null}
}
export function collectImageVersions(messages:SDKMessage[]):ImageVersion[] {
 const versions=new Map<string,ImageVersion>()
 for(const message of messages) {
  if(message.type!=='assistant') continue
  const blocks=(message as SDKAssistantMessage).message?.content
  if(!Array.isArray(blocks)) continue
  for(const block of blocks) {
   if(block.type!=='tool_use' || block.name!=='mcp__asci-image__generate_image') continue
   const result=findToolResultInMessages((block as SDKToolUseBlock).id,messages)
   if(result?.isError) continue
   const version=parseImageVersion(result?.result)
   if(version?.imageId && !versions.has(version.imageId)) versions.set(version.imageId,{...version, sourceMessageId: (message as SDKAssistantMessage).uuid})
  }
 }
 return [...versions.values()]
}
