import { expect, test } from 'bun:test'
import { selectImageModel } from './image-routing.ts'
const choices = [
 {channelId:'a',model:'private-fast',maxReferences:0,quality:0},
 {channelId:'b',model:'private-quality',maxReferences:4,quality:10},
]
test('复杂任务按声明选择，多图过滤，手动指定不能被替换', () => {
 expect(selectImageModel(choices,{referenceCount:2,complex:true}).model).toBe('private-quality')
 expect(selectImageModel(choices,{referenceCount:0,complex:true,model:'private-fast'}).model).toBe('private-fast')
 expect(()=>selectImageModel(choices,{referenceCount:2,model:'private-fast'})).toThrow()
 expect(()=>selectImageModel(choices,{referenceCount:0,model:'unavailable'})).toThrow()
})
test('继续修改优先父图模型，同名跨渠道明确指定，不静默降级', () => {
 expect(selectImageModel(choices,{referenceCount:0,parent:{channelId:'a',model:'private-fast'}}).channelId).toBe('a')
 expect(()=>selectImageModel(choices,{referenceCount:1,parent:{channelId:'x',model:'gone'}})).toThrow()
 expect(selectImageModel(choices,{referenceCount:0,parent:{channelId:'x',model:'gone'},channelId:'b'}).channelId).toBe('b')
})
