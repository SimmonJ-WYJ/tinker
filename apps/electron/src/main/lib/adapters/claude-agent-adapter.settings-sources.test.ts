/**
 * 子项 2 守门:防止 settingSources 重新引入 'user' 级别配置
 *
 * 背景:'user' 级会让 Claude Agent SDK 读到用户系统全局 ~/.claude/CLAUDE.md
 * 和 ~/.claude/settings.json,污染 ASCI 自己的 system prompt 与工具白名单。
 * 行为级 mock SDK 成本高,这里用源码契约测试做最小托底,改回 ['user', ...] 即报错。
 */

import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ADAPTER_PATH = join(import.meta.dir, 'claude-agent-adapter.ts')

test("claude-agent-adapter 的 settingSources 默认 project，允许精简请求显式关闭", () => {
  const src = readFileSync(ADAPTER_PATH, 'utf-8')

  // 抓出所有 settingSources: [...] 字面赋值
  const matches = [...src.matchAll(/settingSources:\s*(?:options\.settingSources\s*\?\?\s*)?\[([^\]]*)\]/g)]
  expect(matches.length).toBeGreaterThan(0)

  for (const m of matches) {
    const items = m[1]
      .split(',')
      .map((s) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean)
    expect(items).toEqual(['project'])
    expect(items).not.toContain('user')
    expect(items).not.toContain('local')
  }
})
