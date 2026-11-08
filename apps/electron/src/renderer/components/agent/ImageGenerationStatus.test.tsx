import * as React from 'react'
import { afterEach, expect, test } from 'bun:test'
import { render, cleanup, screen } from '@testing-library/react'
import type { SDKMessage, SDKToolUseBlock } from '@asci/shared'
import { ImageGenerationStatus } from './ImageGenerationStatus.tsx'
import { setAppLanguage } from '@/lib/i18n'
afterEach(cleanup)
const calls: SDKToolUseBlock[] = ['a', 'b'].map(id => ({ type: 'tool_use', id, name: 'mcp__asci-image__generate_image', input: {} }))
const result = (id: string, failed: boolean): SDKMessage => ({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: failed ? 'Synthetic failure' : JSON.stringify({ imageId: id, generatedImage: { localPath: `session-a/${id}.png`, filename: `${id}.png`, mediaType: 'image/png' } }) }] } })
test.each([
  { messages: [result('a', false)], streaming: true, stopped: false, title: 'Generating image' },
  { messages: [result('a', false)], streaming: false, stopped: true, title: 'Image generation stopped' },
  { messages: [result('a', false)], streaming: false, stopped: false, title: 'Image generation incomplete' },
  { messages: [result('a', false), result('b', true)], streaming: false, stopped: false, title: 'Some images generated' },
  { messages: [result('a', true), result('b', true)], streaming: false, stopped: false, title: 'Image generation failed' },
  { messages: [result('a', false), result('b', false)], streaming: false, stopped: false, title: 'Image generated' },
])('多调用结果保持准确状态：$title', async ({ messages, streaming, stopped, title }) => {
  await setAppLanguage('en')
  render(<ImageGenerationStatus calls={calls} allMessages={[...messages]} streaming={streaming} stopped={stopped}>Tool details</ImageGenerationStatus>)
  expect(screen.getByText(title)).toBeInTheDocument()
})
