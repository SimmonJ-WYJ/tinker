/** 真实列表组合回归：Stop 已触发但后端尚未回传完成时，live 消息不再冒充运行。 */
import * as React from 'react'
import {afterEach,expect,test} from 'bun:test'
import {render,cleanup} from '@testing-library/react'
import {Provider,createStore} from 'jotai'
import type {SDKMessage} from '@asci/shared'
import {AgentMessages} from './AgentMessages.tsx'
import {TooltipProvider} from '@/components/ui/tooltip'
const persisted:SDKMessage[]=[{type:'user',uuid:'user',parent_tool_use_id:null,message:{content:[{type:'text',text:'Create a synthetic image'}]}}]
const live:SDKMessage[]=[{type:'assistant',uuid:'assistant',parent_tool_use_id:null,message:{content:[{type:'tool_use',id:'pending-image',name:'mcp__asci-image__generate_image',input:{prompt:'Synthetic'}}]}}]
afterEach(cleanup)
test('保留 live 消息也按真实 streaming=false 显示 stopped，继续运行时显示 generating',()=>{
 const store=createStore()
 const tree=(streaming:boolean)=><Provider store={store}><TooltipProvider><AgentMessages sessionId="synthetic-stop" messages={[]} messagesLoaded persistedSDKMessages={persisted} liveMessages={live} streaming={streaming} stoppedByUser={!streaming}/></TooltipProvider></Provider>
 const view=render(tree(true))
 expect(view.container.querySelector('[data-image-task-state="generating"]')).not.toBeNull()
 view.rerender(tree(false))
 expect(view.container.querySelector('[data-image-task-state="stopped"]')).not.toBeNull()
 expect(view.container.querySelector('[data-image-task-state="generating"]')).toBeNull()
})
