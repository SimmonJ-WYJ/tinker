/**
 * agent-orchestrator 源代码不变量测试
 *
 * 用源码字符串包含断言守门关键修复 — 比 mock electron 启动整个 orchestrator 简单且稳定。
 */

import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ORCHESTRATOR_PATH = join(import.meta.dir, 'agent-orchestrator.ts')

test('maxTurns 未配置时 fallback 到 DEFAULT_AGENT_MAX_TURNS（issue #140 #1 — 防止 SDK 默认无上限循环）', () => {
  const src = readFileSync(ORCHESTRATOR_PATH, 'utf-8')
  // 必须从 shared 导入硬上限常量
  expect(src).toContain('DEFAULT_AGENT_MAX_TURNS')
  // fallback 必须是常量而非 undefined（否则 SDK 不设上限，可能死循环）
  expect(src).toMatch(/agentMaxTurns\s*>\s*0[\s\S]{0,80}DEFAULT_AGENT_MAX_TURNS/)
  // 不应再有 `...(maxTurns != null && { maxTurns })` 这种"可选传入"模式
  expect(src).not.toContain('maxTurns != null && { maxTurns }')
})

test('prepareSessionNotFoundRecovery 清空 queryOptions.resumeSessionAt（issue #83 path 3）', () => {
  const src = readFileSync(ORCHESTRATOR_PATH, 'utf-8')
  // 断言 recovery 方法存在
  const methodStart = src.indexOf('private prepareSessionNotFoundRecovery(')
  expect(methodStart).toBeGreaterThan(0)
  // 截取方法体（到下一个匹配缩进的 '  }' 结束）
  // 注意：此启发式依赖 prepareSessionNotFoundRecovery 方法体内无类方法级缩进的嵌套 '}'。
  // 若未来该方法内新增类方法缩进的 try/catch/if 块，需要改成更稳健的边界检测。
  const methodEnd = src.indexOf('\n  }', methodStart)
  expect(methodEnd).toBeGreaterThan(methodStart)
  const methodBody = src.slice(methodStart, methodEnd)
  // 断言两个清理动作都在方法体内 — 防止未来 refactor 把它们拆出去
  expect(methodBody).toContain('queryOptions.resumeSessionId = undefined')
  expect(methodBody).toContain('queryOptions.resumeSessionAt = undefined')
})
