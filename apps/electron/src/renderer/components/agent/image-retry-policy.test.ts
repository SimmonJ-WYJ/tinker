import { expect, test } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import { latestTurnAttemptedImage } from './image-retry-policy.ts'
const message=(type:string,content:unknown)=>({type,message:{content}} as SDKMessage)
test('生图后即使有 tool_result 仍需人工复核；新用户轮次不误伤',()=>{
 const messages=[message('user',[{type:'text',text:'draw'}]),message('assistant',[{type:'tool_use',name:'mcp__asci-image__generate_image'}]),message('user',[{type:'tool_result',content:'timeout'}])]
 expect(latestTurnAttemptedImage(messages)).toBe(true)
 expect(latestTurnAttemptedImage([...messages,message('user',[{type:'text',text:'explain'}])])).toBe(false)
})
test('只读检查图片和普通聊天可保持原重试方式',()=>{
 expect(latestTurnAttemptedImage([message('user','hello'),message('assistant',[{type:'tool_use',name:'mcp__asci-image__inspect_image'}])])).toBe(false)
})
