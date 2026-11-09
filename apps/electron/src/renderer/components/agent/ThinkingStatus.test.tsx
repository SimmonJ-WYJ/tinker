import * as React from 'react'
import {afterEach,expect,test} from 'bun:test'
import {render,cleanup} from '@testing-library/react'
import {StickToBottom} from 'use-stick-to-bottom'
import {ContentBlock} from './ContentBlock.tsx'
import type {SDKContentBlock} from '@asci/shared'
afterEach(cleanup)
const block:SDKContentBlock={type:'thinking',thinking:'Synthetic reasoning',signature:'synthetic'}
test('思考标题流动高光代替闪烁，历史标题不残留高光',()=>{
 const view=render(<StickToBottom><ContentBlock block={block} allMessages={[]} isStreaming /></StickToBottom>)
 expect(view.container.querySelector('.agent-status-text[data-active="true"]')).not.toBeNull()
 expect(view.container.querySelector('.animate-pulse')).toBeNull()
 view.rerender(<StickToBottom><ContentBlock block={block} allMessages={[]} isStreaming={false} /></StickToBottom>)
 expect(view.container.querySelector('.agent-status-text[data-active="true"]')).toBeNull()
})
