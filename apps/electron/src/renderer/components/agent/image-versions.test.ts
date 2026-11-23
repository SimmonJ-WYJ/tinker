import { expect, test } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import { collectImageVersions, parseImageVersion } from './image-versions'
const artifact={localPath:'session-1/image.png',filename:'image.png',mediaType:'image/png'}
test('拒绝外部附件路径与 latest 冒充稳定版本',()=>{
 expect(parseImageVersion(JSON.stringify({generatedImage:{...artifact,localPath:'https://example.test/image.png'}}))).toBeNull()
 expect(parseImageVersion(JSON.stringify({imageId:'latest',generatedImage:artifact}))?.imageId).toBeUndefined()
})
test('版本清单只认成功的宿主生图工具，保留确定父版本',()=>{
 const messages=[
  {type:'assistant',message:{content:[{type:'tool_use',id:'a',name:'mcp__asci-image__generate_image'},{type:'tool_use',id:'b',name:'Read'},{type:'tool_use',id:'c',name:'mcp__asci-image__generate_image'}]}},
  {type:'user',message:{content:[
   {type:'tool_result',tool_use_id:'a',content:JSON.stringify({imageId:'child',baseImageId:'parent',generatedImage:artifact})},
   {type:'tool_result',tool_use_id:'b',content:JSON.stringify({imageId:'untrusted',generatedImage:artifact})},
   {type:'tool_result',tool_use_id:'c',is_error:true,content:JSON.stringify({imageId:'failed',generatedImage:artifact})}
  ]}}
 ] as SDKMessage[]
 expect(collectImageVersions(messages).map(item=>[item.imageId,item.baseImageId])).toEqual([['child','parent']])
})

test('隔离预览可比较导入源图，普通 Electron 仍只收集生成结果', () => {
 const id = 'ref-' + 'a'.repeat(32)
 const reference = {imageId:id, localPath:'session-1/' + id + '.png', filename:id + '.png', mediaType:'image/png',displayName:'background.jpg'}
 const history:SDKMessage[]=[{type:'user',parent_tool_use_id:null,imageEditReference:reference}]
 expect(collectImageVersions(history)).toEqual([])
 expect(collectImageVersions(history,true)).toEqual([{imageId:id,generatedImage:{localPath:reference.localPath,filename:reference.filename,mediaType:reference.mediaType}}])
})
