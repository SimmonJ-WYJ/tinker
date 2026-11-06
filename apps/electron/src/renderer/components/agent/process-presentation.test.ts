import {test,expect} from 'bun:test'
import {processPresentation} from './process-presentation'
import type {SDKContentBlock} from '@asci/shared'
const b=(block:unknown)=>({block:block as SDKContentBlock})
test('coding keeps one activity timeline and separates final response from preparation and thinking',()=>{
 const blocks=[b({type:'thinking',thinking:'private'}),b({type:'text',text:'prepare'}),b({type:'tool_use',id:'write',name:'Write',input:{}}),b({type:'text',text:'check'}),b({type:'tool_use',id:'verify',name:'mcp__asci-project__verify_html',input:{}}),b({type:'thinking',thinking:'private'}),b({type:'text',text:'done'})]
 const p=processPresentation(blocks,true)
 expect(p.records.map(x=>x.block.type)).toEqual(['text','tool_use','text','tool_use'])
 expect(p.answer).toEqual([blocks[6]!])
 expect(processPresentation(blocks,false).answer).toEqual(blocks)
})
test('thinking before the first tool does not generate extra thinking rows or swallow text',()=>{
 const text=b({type:'text',text:'Starting your task'})
 const p=processPresentation([b({type:'thinking',thinking:'private'}),text],true)
 expect(p.answer).toEqual([text]);expect(p.records).toEqual([])
})
