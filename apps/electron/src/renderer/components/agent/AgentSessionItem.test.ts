import { describe, expect, it } from 'bun:test'
import { agentSessionItemClassName } from './AgentSessionItem.tsx'

describe('agentSessionItemClassName', () => {
  it('选中灰底内部横纵 padding 保持一致', () => {
    const cls = agentSessionItemClassName({ active: true, archived: false })
    const tokens = cls.split(/\s+/)

    expect(tokens).toContain('h-8')
    expect(tokens).toContain('p-2')
    expect(tokens).not.toContain('h-6')
    expect(tokens).not.toContain('h-7')
    expect(tokens).not.toContain('p-1')
    expect(tokens).not.toContain('px-1')
    expect(tokens).not.toContain('py-1')
    expect(tokens).not.toContain('px-3')
  })
})
