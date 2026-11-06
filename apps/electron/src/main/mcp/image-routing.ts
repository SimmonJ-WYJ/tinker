/** 生图选路遵循明确选择、编辑连续性、声明能力；不把模型名字当作质量证明。 */
export interface ImageChoice { channelId: string; model: string; maxReferences?: number; quality?: number }
interface ImageSelection { referenceCount: number; complex?: boolean; model?: string; channelId?: string; parent?: {channelId:string;model:string} }
export function selectImageModel(choices: ImageChoice[], request: ImageSelection): ImageChoice {
 const explicit = Boolean(request.model || request.channelId)
 const target = !explicit && request.parent ? request.parent : request
 const matches = choices.filter(item => (!target.model || item.model === target.model) && (!target.channelId || item.channelId === target.channelId))
 const suitable = matches.filter(item => request.referenceCount <= (item.maxReferences ?? 4))
 if (!suitable.length) throw new Error('Requested image model is unavailable or does not support this reference count. No substitute was called.')
 return request.complex && !explicit && !request.parent
  ? [...suitable].sort((a,b)=>(b.quality ?? 0)-(a.quality ?? 0))[0]!
  : suitable[0]!
}
