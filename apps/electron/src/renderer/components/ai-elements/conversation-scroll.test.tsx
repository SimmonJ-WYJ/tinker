import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
const element = document.createElement('div')
Object.defineProperties(element, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } })
const stop = mock(() => {})
const scrollRef = { current: element }
const scroll = mock(() => {})
let atBottom = false
mock.module('use-stick-to-bottom', () => ({ StickToBottom: ({ children }: { children: React.ReactNode }) => children, useStickToBottomContext: () => ({ isAtBottom: atBottom, scrollToBottom: scroll, scrollRef, stopScroll: stop }) }))
const { ConversationScrollButton } = await import('./conversation')
afterEach(() => { cleanup(); atBottom = false; element.scrollTop = 0; scroll.mockClear(); stop.mockClear() })

test('非生成状态始终隐藏，生成结束立即隐藏', () => {
 const view = render(<ConversationScrollButton />)
 expect(screen.queryByRole('button')).toBeNull()
 view.rerender(<ConversationScrollButton generating />)
 expect(screen.getByRole('button')).toBeTruthy()
 view.rerender(<ConversationScrollButton generating={false} />)
 expect(screen.queryByRole('button')).toBeNull()
})

test('默认 Orb，悬停下箭头，离开恢复 Orb', () => {
 const view = render(<ConversationScrollButton generating />)
 expect(view.container.querySelector('[data-thinking-orb]')).not.toBeNull()
 expect(view.container.querySelector('.lucide-arrow-down')).toBeNull()
 fireEvent.mouseEnter(screen.getByRole('button'))
 expect(view.container.querySelector('[data-thinking-orb]')).toBeNull()
 expect(view.container.querySelector('.lucide-arrow-down')).not.toBeNull()
 fireEvent.mouseLeave(screen.getByRole('button'))
 expect(view.container.querySelector('[data-thinking-orb]')).not.toBeNull()
})

test('点击到最新后悬停上箭头，返回原阅读点，可再次往返', () => {
 element.scrollTop = 340
 const view = render(<ConversationScrollButton generating />)
 fireEvent.mouseEnter(screen.getByRole('button'))
 fireEvent.click(screen.getByRole('button'))
 expect(scroll).toHaveBeenCalledTimes(1)
 element.scrollTop = 1500
 atBottom = true
 view.rerender(<ConversationScrollButton generating />)
 expect(view.container.querySelector('.lucide-arrow-up')).not.toBeNull()
 fireEvent.mouseLeave(screen.getByRole('button'))
 expect(view.container.querySelector('[data-thinking-orb]')).not.toBeNull()
 fireEvent.mouseEnter(screen.getByRole('button'))
 fireEvent.click(screen.getByRole('button'))
 expect(stop).toHaveBeenCalledTimes(1)
 expect(element.scrollTop).toBe(340)
 atBottom = false
 view.rerender(<ConversationScrollButton generating />)
 expect(view.container.querySelector('.lucide-arrow-down')).not.toBeNull()
 fireEvent.click(screen.getByRole('button'))
 expect(scroll).toHaveBeenCalledTimes(2)
})

test('初始在底部隐藏；结束生成后不保留上次返回点', () => {
 atBottom = true
 const view = render(<ConversationScrollButton generating />)
 expect(screen.queryByRole('button')).toBeNull()
 atBottom = false
 element.scrollTop = 420
 view.rerender(<ConversationScrollButton generating />)
 fireEvent.click(screen.getByRole('button'))
 atBottom = true
 view.rerender(<ConversationScrollButton generating />)
 view.rerender(<ConversationScrollButton generating={false} />)
 view.rerender(<ConversationScrollButton generating />)
 expect(screen.queryByRole('button')).toBeNull()
})


test('鼠标点击获得焦点后移开，仍恢复 Orb', () => {
 const view = render(<ConversationScrollButton generating />)
 const button = screen.getByRole('button')
 fireEvent.mouseEnter(button)
 fireEvent.focus(button)
 fireEvent.click(button)
 fireEvent.mouseLeave(button)
 expect(view.container.querySelector('.lucide-arrow-down') === null).toBe(true)
 expect(view.container.querySelector('[data-thinking-orb]') !== null).toBe(true)
})
