import * as React from 'react'
import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { StickToBottom } from 'use-stick-to-bottom'
import { MessageReferenceNavigation, useMessageReferenceNavigation } from './message-reference-navigation.tsx'
import { setAppLanguage } from '@/lib/i18n'

afterEach(cleanup)
function Actions(): React.ReactElement {
  const navigation = useMessageReferenceNavigation()
  return <><button onClick={event => navigation?.jump('source', event.currentTarget)}>Jump</button><button disabled={!navigation?.hasSource('missing')}>Missing</button></>
}
test('定位真实消息，高亮可解除，返回阅读位置，重复点击不制造额外返回层', async () => {
  await setAppLanguage('en')
  const view = render(<StickToBottom><MessageReferenceNavigation sessionId="session-a" targets={[{ groupId: 'group-source', sourceIds: ['source'] }]}><StickToBottom.Content><div data-message-id="group-source" tabIndex={-1}>Original</div><div data-message-id="reply"><Actions /></div></StickToBottom.Content></MessageReferenceNavigation></StickToBottom>)
  expect(screen.getByRole('button', { name: 'Missing' })).toBeDisabled()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Jump' })) })
  expect(view.container.querySelector('[data-reference-highlighted="true"]')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Return to reading position' })).toBeInTheDocument()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Jump' })); fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' })) })
  expect(screen.queryByRole('button', { name: 'Return to reading position' })).toBeNull()
  expect(view.container.querySelector('[data-reference-highlighted="true"]')).toBeNull()
})
