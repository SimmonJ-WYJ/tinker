import { describe, expect, it } from 'bun:test'
import { toConversationType } from './conversation-type.ts'

describe('toConversationType', () => {
  it('lit-search 映射为 search（检索）', () => {
    expect(toConversationType('lit-search')).toBe('search')
  })

  it('lit-review 映射为 review（综述）', () => {
    expect(toConversationType('lit-review')).toBe('review')
  })

  it('未知能力包 id 归 other（其他）', () => {
    expect(toConversationType('user-custom-pack')).toBe('other')
  })

  it('无粘滞能力包（undefined）归 other（其他）', () => {
    expect(toConversationType(undefined)).toBe('other')
  })
})
