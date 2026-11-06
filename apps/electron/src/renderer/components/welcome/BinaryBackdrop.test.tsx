import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { BinaryBackdrop } from './BinaryBackdrop'
afterEach(cleanup)
test('字符过渡播放一次，结束后移除，再次挂载可以重播', () => {
 const first = render(<BinaryBackdrop />)
 const layer = first.container.querySelector('.binary-backdrop')!
 expect(layer.getAttribute('aria-hidden')).toBe('true')
 fireEvent.animationEnd(layer)
 expect(first.container.querySelector('.binary-backdrop')).toBeNull()
 first.unmount()
 const second = render(<BinaryBackdrop />)
 expect(second.container.querySelector('.binary-backdrop')).not.toBeNull()
})
