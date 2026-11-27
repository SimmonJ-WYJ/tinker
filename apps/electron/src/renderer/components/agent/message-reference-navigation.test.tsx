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

test('返回时引用卡重新挂载，只聚焦原消息内同一张图的定位按钮', async () => {
  await setAppLanguage('en')
  function Cards({ revision }: { revision: number }): React.ReactElement {
    const navigation = useMessageReferenceNavigation()
    return <>{['other', 'origin'].map(id => <div key={id} data-message-id={id} tabIndex={-1}>
      <div data-image-edit-reference="same-image">
        <button>Reuse</button>
        <button key={revision} data-reference-source-link onClick={e => navigation?.jump('source', e.currentTarget)}>{id}</button>
      </div>
    </div>)}</>
  }
  const tree = (revision: number) => <StickToBottom>
    <MessageReferenceNavigation sessionId="session-a" targets={[{ groupId: 'group-source', sourceIds: ['source'] }]}>
      <StickToBottom.Content><div data-message-id="group-source" tabIndex={-1}>Original</div><Cards revision={revision} /></StickToBottom.Content>
    </MessageReferenceNavigation>
  </StickToBottom>
  const view = render(tree(1))
  const trigger = screen.getByRole('button', { name: 'origin' })
  fireEvent.click(trigger)
  expect(document.activeElement === view.container.querySelector('[data-message-id="group-source"]')).toBe(true)
  view.rerender(tree(2))
  expect(trigger.isConnected).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Return to reading position' }))
  expect(document.activeElement === screen.getByRole('button', { name: 'origin' })).toBe(true)
})

test('有两个可见行自称同一来源时不选择第一个或改变阅读位置', () => {
  const view = render(<StickToBottom><MessageReferenceNavigation sessionId="session-a" targets={[{ groupId: 'collision', sourceIds: ['source'] }]}>
    <StickToBottom.Content><div data-message-id="collision" tabIndex={-1}>A</div>
      <div data-message-id="collision" tabIndex={-1}>B</div><Actions />
    </StickToBottom.Content>
  </MessageReferenceNavigation></StickToBottom>)
  const trigger = screen.getByRole('button', { name: 'Jump' })
  trigger.focus()
  fireEvent.click(trigger)
  expect(view.container.querySelectorAll('[data-reference-highlighted]')).toHaveLength(0)
  expect(document.activeElement === trigger).toBe(true)
})
