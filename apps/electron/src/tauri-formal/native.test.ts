import { expect, test } from 'bun:test'
import { isWindowDragTarget } from './native.ts'
test('WebKit 不支持 app-region 属性时仍按原正式 CSS 类拖拽，交互元素和浮层不拖拽', () => {
  const root = document.createElement('div'); root.className = 'titlebar-drag-region'
  const label = document.createElement('span'); root.append(label)
  expect(isWindowDragTarget(label)).toBe(true)
  const button = document.createElement('button'); root.append(button)
  expect(isWindowDragTarget(button)).toBe(false)
  const popover = document.createElement('div'); popover.setAttribute('role', 'dialog'); root.append(popover)
  expect(isWindowDragTarget(popover)).toBe(false)
  label.className = 'titlebar-no-drag'; expect(isWindowDragTarget(label)).toBe(false)
})
