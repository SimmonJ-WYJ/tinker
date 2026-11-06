import { test, expect, beforeEach } from 'bun:test'
import {
  suppressCapabilityToasts,
  isCapabilityToastSuppressed,
  __resetCapabilityToastSuppressForTest,
} from './capability-toast-suppress.ts'

beforeEach(() => {
  __resetCapabilityToastSuppressForTest()
})

test('默认未抑制', () => {
  expect(isCapabilityToastSuppressed()).toBe(false)
})

test('调用后在窗口期内被抑制', () => {
  suppressCapabilityToasts(50)
  expect(isCapabilityToastSuppressed()).toBe(true)
})

test('窗口期结束后自动解除', async () => {
  suppressCapabilityToasts(20)
  expect(isCapabilityToastSuppressed()).toBe(true)
  await new Promise((r) => setTimeout(r, 40))
  expect(isCapabilityToastSuppressed()).toBe(false)
})

test('多次调用取较远的截止时间，不会被较短调用覆盖', () => {
  suppressCapabilityToasts(2000)
  suppressCapabilityToasts(20)
  expect(isCapabilityToastSuppressed()).toBe(true)
})
