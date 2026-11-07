import { expect,test } from 'bun:test'
import {consumeImageEditDraft,type SelectedImageVersion} from './image-edit-atoms'
import {captureSendDraft} from './send-recovery-atoms'
const image:SelectedImageVersion={imageId:'v1',previewSrc:'fixture',generatedImage:{localPath:'s/image.png',filename:'image.png',mediaType:'image/png'}}
test('发送立即清除编辑标签，失败恢复快照仍持有精确版本',()=>{
 const drafts=new Map([['s',image]])
 const recovery=captureSendDraft({text:'edit',html:'',files:[],mentions:[],image},new Map())
 expect(consumeImageEditDraft(drafts,'s',image).has('s')).toBe(false)
 expect(recovery.image).toBe(image)
 expect(drafts.get('s')).toBe(image)
})
test('旧发送不能清除同 ID 的新选择或其他会话',()=>{
 const newer={...image};const drafts=new Map([['s',newer],['other',image]])
 expect(consumeImageEditDraft(drafts,'s',image)).toBe(drafts)
 expect(consumeImageEditDraft(drafts,'other',image).get('s')).toBe(newer)
})
