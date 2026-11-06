import { expect, test } from 'bun:test'
import { clearImageEditDraft, type SelectedImageVersion } from './image-edit-atoms'
const selected=(id:string):SelectedImageVersion=>({imageId:id,previewSrc:'data:image/png;base64,fixture',generatedImage:{localPath:'session-1/image.png',filename:'image.png',mediaType:'image/png'}})
test('请求结束只清除对应引用，不清除更新版本或其他会话',()=>{
 const drafts=new Map([['one',selected('v1')],['two',selected('v2')]])
 expect(clearImageEditDraft(drafts,'one','old')).toBe(drafts)
 const next=clearImageEditDraft(drafts,'one','v1')
 expect(next.has('one')).toBe(false)
 expect(next.get('two')?.imageId).toBe('v2')
 expect(drafts.has('one')).toBe(true)
})
