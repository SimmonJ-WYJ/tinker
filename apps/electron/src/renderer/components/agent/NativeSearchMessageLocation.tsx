import { useEffect } from 'react'
import { useAtomValue, useStore } from 'jotai'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { searchMessageTargetAtom } from '@/atoms/search-atoms'
import { nativeMessageIdentity } from '@/lib/native-message-identity'
import { getGroupId, type MessageGroup } from './SDKMessageRenderer'

/** 只在预览宿主消费搜索定位；先恢复原会话布局，再定位到包含匹配消息的渲染组。 */
export function NativeSearchMessageLocation({ sessionId, ready, groups }: {
  sessionId: string; ready: boolean; groups: MessageGroup[]
}): null {
  const target = useAtomValue(searchMessageTargetAtom)
  const store = useStore()
  const { scrollRef, stopScroll } = useStickToBottomContext()
  useEffect(() => {
    if (!ready || !target || target.sessionId !== sessionId) return
    const frame = requestAnimationFrame(() => {
      if (store.get(searchMessageTargetAtom) !== target) return
      const group = groups.find(item => {
        const messages = item.type === 'assistant-turn' ? item.assistantMessages : [item.message]
        return messages.some(message => (nativeMessageIdentity(message) ?? message.uuid) === target.messageId)
      })
      const id = group ? getGroupId(group) : target.messageId
      const message = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])
        .find(element => element.dataset.messageId === id)
      store.set(searchMessageTargetAtom, null)
      if (!message) return
      stopScroll()
      message.setAttribute('data-search-located', '')
      message.addEventListener('blur', () => message.removeAttribute('data-search-located'), { once: true })
      message.scrollIntoView({ block: 'center', behavior: 'instant' })
      message.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [groups, ready, scrollRef, sessionId, stopScroll, store, target])
  return null
}
