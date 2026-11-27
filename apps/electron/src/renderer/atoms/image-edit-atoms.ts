/** 图片编辑草稿按会话隔离；选择仅回填引用，不会发起网络或生成。 */
import { atom } from 'jotai'
import type { ImageVersion } from '@/components/agent/image-versions'
export interface SelectedImageVersion extends ImageVersion {imageId:string;previewSrc:string;displayName?:string;sourceAttachmentPath?:string}
export const imageEditDraftsAtom=atom(new Map<string,SelectedImageVersion>())

/** 旧请求完成不能清掉用户后来选择的新版本或其他会话草稿。 */
export function clearImageEditDraft(drafts: Map<string,SelectedImageVersion>, sessionId: string, imageId: string): Map<string,SelectedImageVersion> {
 if(drafts.get(sessionId)?.imageId!==imageId) return drafts
 const next=new Map(drafts);next.delete(sessionId);return next
}

/** 发送时消费本次选择；失败时由独立恢复快照还原，不等待网络/模型完成。 */
export function consumeImageEditDraft(drafts: Map<string,SelectedImageVersion>, sessionId: string, selected: SelectedImageVersion): Map<string,SelectedImageVersion> {
 return drafts.get(sessionId) === selected ? clearImageEditDraft(drafts,sessionId,selected.imageId) : drafts
}
