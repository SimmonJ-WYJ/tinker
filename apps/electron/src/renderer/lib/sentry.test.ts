/**
 * renderer Sentry：HMR Fast-Refresh 失同步噪音识别（用于 dev 联调下 beforeSend 丢弃）
 */
import { describe, expect, test } from 'bun:test'
import { isHmrReconcilerNoise } from './sentry.ts'

describe('isHmrReconcilerNoise', () => {
  test('识别 removeChild NotFoundError（HMR 噪音）', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'NotFoundError',
            value:
              "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
          },
        ],
      },
    }
    expect(isHmrReconcilerNoise(event)).toBe(true)
  })

  test('识别 insertBefore NotFoundError（HMR 噪音）', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'NotFoundError',
            value:
              "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
          },
        ],
      },
    }
    expect(isHmrReconcilerNoise(event)).toBe(true)
  })

  test('放行真实业务异常（非 NotFoundError）', () => {
    const event = {
      exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] },
    }
    expect(isHmrReconcilerNoise(event)).toBe(false)
  })

  test('放行无 "not a child" 文案的 NotFoundError', () => {
    const event = {
      exception: { values: [{ type: 'NotFoundError', value: 'something else' }] },
    }
    expect(isHmrReconcilerNoise(event)).toBe(false)
  })

  test('空 event 安全返回 false', () => {
    expect(isHmrReconcilerNoise({})).toBe(false)
  })
})
