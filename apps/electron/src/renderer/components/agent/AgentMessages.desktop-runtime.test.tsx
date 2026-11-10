/** 真实正式消息列表消费 Rust 持久投影；不模拟第二套 UI。 */
import * as React from 'react'
import {afterEach,expect,test} from 'bun:test'
import {render,cleanup} from '@testing-library/react'
import {Provider,createStore} from 'jotai'
import type {DesktopTurn} from '@asci/shared'
import {AgentMessages} from './AgentMessages.tsx'
import {TooltipProvider} from '@/components/ui/tooltip'
import {projectHistory} from '../../../main/lib/desktop-runtime/projection.ts'
const turn:DesktopTurn={sessionId:'s',requestId:'r',profileId:'local',modelId:'model/a',userMessage:'Synthetic user',startedAt:123,effort:'high',runId:'r',userMessageId:'r-user',assistantMessageId:'r-assistant',configRevision:'v1',assistantMessage:'Partial 你好🌱',status:'failed',sequence:3,errorCode:'httpProtocol'}
afterEach(cleanup)
function view(turn:DesktopTurn) {
 const history=projectHistory([turn])
 return render(<Provider store={createStore()}><TooltipProvider><AgentMessages sessionId="s" messages={history.messages} messagesLoaded persistedSDKMessages={history.sdkMessages} streaming={false}/></TooltipProvider></Provider>)
}
test('failed partial output and localized terminal error are both visible after history reload',()=>{
 const v=view(turn)
 expect(v.container.textContent).toContain('Partial 你好🌱')
 expect(v.container.textContent).toContain('The Rust response could not finish')
 expect(v.container.textContent).not.toContain('httpProtocol')
})
test('cancel status survives history reload independently of session state',()=>{
 const v=view({...turn,status:'cancelled',errorCode:null})
 expect(v.container.textContent).toContain('Partial 你好🌱')
 expect(v.container.textContent).toMatch(/Aborted by user|中断/)
})
