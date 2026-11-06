/** 图片编辑草稿按会话隔离；选择仅回填引用，不会发起网络或生成。 */
import { atom } from 'jotai'
import type { ImageVersion } from '@/components/agent/image-versions'
export interface SelectedImageVersion extends ImageVersion {imageId:string;previewSrc:string}
export const imageEditDraftsAtom=atom(new Map<string,SelectedImageVersion>())

/** 旧请求完成不能清掉用户后来选择的新版本或其他会话草稿。 */
export function clearImageEditDraft(drafts: Map<string,SelectedImageVersion>, sessionId: string, imageId: string): Map<string,SelectedImageVersion> {
 if(drafts.get(sessionId)?.imageId!==imageId) return drafts
 const next=new Map(drafts);next.delete(sessionId);return next
}
