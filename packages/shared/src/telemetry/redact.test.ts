/**
 * 脱敏测试（issue #416 T-1 验收：payload 无邮箱、IP 脱敏、路径用户名段替换）
 */
import { describe, expect, test } from 'bun:test'
import {
  redactDeep,
  redactErrorMessage,
  redactText,
  redactTextWithMatches,
  redactDeepWithMatches,
  formatPromptPlaceholder,
  formatRedactionPlaceholder,
  scrubSentryEvent,
} from './redact.ts'

describe('redactText - 路径用户名段', () => {
  test('macOS 路径', () => {
    expect(redactText('Error at /Users/alice/projects/app.ts:42')).toBe(
      'Error at /Users/<USER>/projects/app.ts:42',
    )
  })

  test('Linux 路径', () => {
    expect(redactText('/home/bob/.config/asci/settings.json')).toBe(
      '/home/<USER>/.config/asci/settings.json',
    )
  })

  test('Windows 反斜杠路径', () => {
    expect(redactText('at C:\\Users\\Charlie\\AppData\\app.js')).toBe(
      'at C:\\Users\\<USER>\\AppData\\app.js',
    )
  })

  test('Windows 正斜杠路径', () => {
    expect(redactText('file C:/Users/dave/code/x.ts')).toBe('file C:/Users/<USER>/code/x.ts')
  })

  test('多行堆栈全部替换', () => {
    const stack = [
      'Error: boom',
      '    at foo (/Users/alice/app/main.ts:1:1)',
      '    at bar (/Users/alice/app/lib.ts:2:2)',
    ].join('\n')
    const out = redactText(stack)
    expect(out).not.toContain('alice')
    expect(out.match(/<USER>/g)?.length).toBe(2)
  })

  test('路径末尾无后续段也替换', () => {
    expect(redactText('cwd: /Users/alice')).toBe('cwd: /Users/<USER>')
  })
})

describe('redactText - 邮箱与 IP', () => {
  test('邮箱', () => {
    expect(redactText('user alice@example.com reported')).toBe('user <EMAIL> reported')
  })

  test('IPv4', () => {
    expect(redactText('connect to 192.168.1.100 failed')).toBe('connect to <IP> failed')
  })

  test('IPv6 完整形态', () => {
    expect(redactText('addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334 x')).toBe('addr <IP> x')
  })

  test('IPv6 压缩形态', () => {
    expect(redactText('addr 2001:db8::8a2e:370:7334 x')).toBe('addr <IP> x')
  })

  test('时间戳不被 IPv6 误伤', () => {
    expect(redactText('at 12:30:45 something')).toBe('at 12:30:45 something')
  })
})

describe('redactText - 幂等与组合', () => {
  test('已脱敏文本再过一遍不变（幂等）', () => {
    const once = redactText('alice@example.com at /Users/alice from 10.0.0.1')
    expect(redactText(once)).toBe(once)
  })

  test('路径 + 邮箱 + IP 混合', () => {
    const out = redactText('crash /Users/alice/x.log by bob@x.io from 10.0.0.1')
    expect(out).toBe('crash /Users/<USER>/x.log by <EMAIL> from <IP>')
  })
})

describe('redactDeep', () => {
  test('嵌套对象与数组中的字符串全部脱敏', () => {
    const out = redactDeep({
      msg: 'fail for alice@example.com',
      frames: [{ file: '/Users/alice/a.ts' }, { file: 'C:\\Users\\bob\\b.ts' }],
      count: 3,
      ok: null,
    })
    expect(out.msg).toBe('fail for <EMAIL>')
    expect(out.frames[0]?.file).toBe('/Users/<USER>/a.ts')
    expect(out.frames[1]?.file).toBe('C:\\Users\\<USER>\\b.ts')
    expect(out.count).toBe(3)
    expect(out.ok).toBeNull()
  })

  test('循环引用不爆栈', () => {
    interface Cyc {
      name: string
      self?: Cyc
    }
    const obj: Cyc = { name: '/Users/alice/x' }
    obj.self = obj
    const out = redactDeep(obj)
    expect(out.name).toBe('/Users/<USER>/x')
    expect(out.self).toBe('<CIRCULAR>' as unknown as Cyc)
  })
})

describe('redactErrorMessage', () => {
  test('脱敏 + 超长截断', () => {
    const out = redactErrorMessage(`boom /Users/alice/x ${'y'.repeat(600)}`)
    expect(out).not.toContain('alice')
    expect(out.length).toBeLessThanOrEqual(481)
    expect(out.endsWith('…')).toBe(true)
  })
})

// ==================== #710 安全边界新增原语 ====================

describe('#710 占位符 formatter', () => {
  test('formatPromptPlaceholder 取 hash 前 16', () => {
    expect(formatPromptPlaceholder({ promptId: 'master', version: 'v7', hash: 'abcd1234efgh5678ZZZZ' })).toBe(
      '[[PROMPT:sha256:abcd1234efgh5678@v7]]',
    )
  })
  test('formatRedactionPlaceholder 带/不带 hash', () => {
    expect(formatRedactionPlaceholder('tool-payload', 'deadbeef')).toBe('[[REDACTED:tool-payload:deadbeef]]')
    expect(formatRedactionPlaceholder('query')).toBe('[[REDACTED:query]]')
  })
})

describe('#710 redactTextWithMatches', () => {
  test('凭证值形态 → [[REDACTED:credential]] + 命中记录', () => {
    const r = redactTextWithMatches('use Bearer sk-abcdefghij0123456789 now')
    expect(r.value).not.toContain('sk-abcdefghij0123456789')
    expect(r.value).toContain('[[REDACTED:credential]]')
    expect(r.redactionMatches.some((m) => m.category === 'credential')).toBe(true)
  })
  test('家目录 + 邮箱：值与 redactText 同口径，记 home-path/pii', () => {
    const r = redactTextWithMatches('/Users/alice/x by a@b.io')
    expect(r.value).toBe('/Users/<USER>/x by <EMAIL>')
    expect(r.redactionMatches.map((m) => m.category).sort()).toEqual(['home-path', 'pii'])
  })
  test('无敏感内容 → 原样 + 空命中', () => {
    const r = redactTextWithMatches('plain text 123')
    expect(r.value).toBe('plain text 123')
    expect(r.redactionMatches).toEqual([])
  })
})

describe('#710 redactDeepWithMatches - 键名命中', () => {
  test('敏感键值整体脱敏 + env 键归 env-value + 点号路径', () => {
    const r = redactDeepWithMatches({
      api_key: 'ASCI_CANARY_SECRET_TOKEN_710',
      nested: { ANTHROPIC_API_KEY: 'x' },
      keep: 'ok',
    })
    expect(r.value.api_key).toBe('[[REDACTED:credential]]')
    expect(r.value.nested.ANTHROPIC_API_KEY).toBe('[[REDACTED:credential]]')
    expect(r.value.keep).toBe('ok')
    expect(r.redactionMatches.some((m) => m.category === 'env-value')).toBe(true)
    expect(r.redactionMatches.some((m) => m.path === 'api_key')).toBe(true)
  })
  test('循环引用不爆栈', () => {
    interface Cyc {
      token: string
      self?: Cyc
    }
    const o: Cyc = { token: 'x' }
    o.self = o
    const r = redactDeepWithMatches(o)
    expect(r.value.token).toBe('[[REDACTED:credential]]')
    expect(r.value.self).toBe('<CIRCULAR>' as unknown as Cyc)
  })

  // 回归：键名含 token/secret 子串但语义无关的**数值/布尔**指标不得被脱敏
  // （totalTokens 曾被子串正则误判为凭证 → 数字变占位符字符串 → PostHog 类型 MISMATCH）。
  test('含 token 子串的数值键不被脱敏（totalTokens 回归）', () => {
    const r = redactDeepWithMatches({
      totalTokens: 37841,
      numTokens: 1024,
      passwordChanged: true,
    })
    expect(r.value.totalTokens).toBe(37841)
    expect(r.value.numTokens).toBe(1024)
    expect(r.value.passwordChanged).toBe(true)
    expect(r.redactionMatches).toEqual([])
  })

  // 整词/分段匹配：accessToken/access_token 命中段 token；totalTokens 命中段 tokens 不命中
  test('键名整词匹配：真凭证键命中、形近键放行', () => {
    const r = redactDeepWithMatches({
      accessToken: 'abc',
      access_token: 'def',
      apiKey: 'ghi',
      tokenizer: 'bpe', // 段 [tokenizer] ≠ token，放行
      authorName: 'jkl', // 段 [author,name]，放行
    })
    expect(r.value.accessToken).toBe('[[REDACTED:credential]]')
    expect(r.value.access_token).toBe('[[REDACTED:credential]]')
    expect(r.value.apiKey).toBe('[[REDACTED:credential]]')
    expect(r.value.tokenizer).toBe('bpe')
    expect(r.value.authorName).toBe('jkl')
  })
})

describe('#710 旧 API 零回归（防重构漂移）', () => {
  test('redactText 既有行为逐字不变', () => {
    expect(redactText('crash /Users/alice/x.log by bob@x.io from 10.0.0.1')).toBe(
      'crash /Users/<USER>/x.log by <EMAIL> from <IP>',
    )
  })
})

// #710 脱敏测试 fixture：故意构造的假凭证（非真钥），用变量引用而非 secret 形状字面串，避免 gitleaks 误判。
const CANARY_SECRET = 'ASCI_CANARY_SECRET_TOKEN_710'
describe('#710 scrubSentryEvent 凭证感知（P0-7）', () => {
  test('删 user/request + 凭证键值脱敏 + PII 路径脱敏', () => {
    const ev = scrubSentryEvent({
      message: 'boom at /Users/alice/x',
      user: { id: 'x' },
      request: { url: 'y' },
      extra: { api_key: CANARY_SECRET, note: 'ok' },
    })
    expect('user' in ev).toBe(false)
    expect('request' in ev).toBe(false)
    expect(JSON.stringify(ev)).not.toContain(CANARY_SECRET)
    expect((ev.extra as { api_key: string }).api_key).toBe('[[REDACTED:credential]]')
    expect((ev.extra as { note: string }).note).toBe('ok')
    expect((ev as { message: string }).message).toContain('<USER>')
  })
})
