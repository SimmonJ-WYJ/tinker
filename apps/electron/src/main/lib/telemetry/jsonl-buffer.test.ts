/**
 * JSONL 缓冲轮转与上限测试（ADR-011 本地缓冲策略）
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlBuffer } from './jsonl-buffer.ts'

let tempHome: string

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'asci-telemetry-test-'))
  process.env.ASCI_CONFIG_HOME = tempHome
  // 钉住配置目录为 .asci（防其他用例遗留 ASCI_DEV=1 导致目录分叉）
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  delete process.env.ASCI_CONFIG_HOME
  rmSync(tempHome, { recursive: true, force: true })
})

describe('JsonlBuffer', () => {
  test('追加写入，每行一条 JSON', () => {
    const buf = new JsonlBuffer('events.jsonl')
    buf.append({ event: 'a', n: 1 })
    buf.append({ event: 'b', n: 2 })
    const lines = readFileSync(buf.path, 'utf-8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!)).toEqual({ event: 'a', n: 1 })
  })

  test('超过 maxBytes 触发轮转，最旧被删除', () => {
    const buf = new JsonlBuffer('events.jsonl', { maxBytes: 100, maxRotations: 2 })
    // 每条 ~60 字节，写多条触发多次轮转
    for (let i = 0; i < 12; i++) {
      buf.append({ event: 'padding-padding-padding-padding-padding', i })
    }
    const dir = join(tempHome, '.asci', 'telemetry')
    expect(existsSync(join(dir, 'events.jsonl'))).toBe(true)
    expect(existsSync(join(dir, 'events.1.jsonl'))).toBe(true)
    expect(existsSync(join(dir, 'events.2.jsonl'))).toBe(true)
    // 不会产生超出 maxRotations 的文件
    expect(existsSync(join(dir, 'events.3.jsonl'))).toBe(false)
  })
})
