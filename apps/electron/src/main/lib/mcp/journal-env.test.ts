import { describe, it, expect } from 'bun:test'
import { buildJournalMcpEnv } from './journal-env.ts'

describe('buildJournalMcpEnv', () => {
  it('有 token：注入 token 与派生的 /journal base URL', () => {
    const env = buildJournalMcpEnv('tok-1', 'https://asci-test.opensci.io/')
    expect(env).toEqual({
      PAPER_SEARCH_MCP_JOURNAL_ACCESS_TOKEN: 'tok-1',
      PAPER_SEARCH_MCP_JOURNAL_BASE_URL: 'https://asci-test.opensci.io/journal',
    })
  })

  it('base URL 缺尾斜杠时也能正确拼接', () => {
    const env = buildJournalMcpEnv('tok-1', 'http://localhost:6060')
    expect(env.PAPER_SEARCH_MCP_JOURNAL_BASE_URL).toBe('http://localhost:6060/journal')
  })

  it('无 token（未登录）：返回空对象，不注入任何 journal env', () => {
    expect(buildJournalMcpEnv(null, 'https://asci-test.opensci.io/')).toEqual({})
    expect(buildJournalMcpEnv('', 'https://asci-test.opensci.io/')).toEqual({})
  })
})
