/**
 * lit-review 离线契约测试：把 planner 工具集不变式固化下来，防止后续改动悄悄回退。
 *
 * 全部为静态文件读取 + 断言，无网络、无 loader、跑 < 100ms。
 *
 * 配合 default-capability-packs-load.test.ts（端到端 loader）形成双层守门：
 *  - loader 测试：保证 manifest 结构合法 + scenario/worker 都注册成功
 *  - 本测试：保证 scenarioAgent 的工具集恰为最小必需集，不漂回继承全集
 *
 * 背景（#688）：lit-review scenario agent 是 lightweight planner。它只 emit `## REVIEW PLAN`
 * 文本让主 Agent 派活，自己不 dispatch 子 Agent；4 个 turn 里唯一主动调用的工具是 Turn 1
 * Closing turn 的 present_directions（渲染 ChoiceCard），Turn 2 全程纯文本编排不调任何工具。
 * tools 缺省会被 SDK 当成"继承父级全集"→ 白读大量无关 MCP 工具说明（lit-search 同问题实测
 * ~3.8 万 token，见 #669/#672）。与 lit-search 不同：lit-search planner 全程不调工具、用
 * ['Glob'] 占位；lit-review planner 必须自调 present_directions，故最小集恰为这一个 MCP 工具，
 * 不能用空清单、不能用 Glob 占位（Glob 调不到 litreview in-process SDK MCP 工具）。
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PACK_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'default-capability-packs',
  'lit-review',
)
const MANIFEST = JSON.parse(readFileSync(join(PACK_DIR, 'manifest.json'), 'utf-8'))

describe('lit-review latency contract', () => {
  describe('Manifest', () => {
    it('scenarioAgent 工具集恰为 [present_directions]，不继承全套 MCP 工具说明（#688）', () => {
      // ⚠️ 不要删掉本字段 / 改回 [] / 改成 ['Glob']：
      //   - 删字段/省略 → SDK 当成"继承父级全集"，白读大量无关工具说明（本 issue 要修的就是这个）。
      //   - []        → SDK 对空数组不作保证，实测也被当成全集。
      //   - ['Glob']  → planner Turn 1 Closing 调不到 present_directions，ChoiceCard 渲染不出。
      const tools = (MANIFEST.scenarioAgent as { tools?: string[] }).tools
      expect(tools).toEqual(['mcp__litreview__present_directions'])
    })
    it('planner 红线：不派子 Agent、不含任何检索/阅读工具（#688）', () => {
      // planner 只 emit PLAN 让主 Agent 派活，dispatch 动作发生在主 Agent，不在 scenario agent →
      // 自身不得持有 Task / Agent；reader/triager/broadener 等检索/阅读是 worker subAgent 的活。
      const tools = (MANIFEST.scenarioAgent as { tools?: string[] }).tools ?? []
      expect(tools).not.toContain('Task')
      expect(tools).not.toContain('Agent')
      expect(tools.some((t) => t.startsWith('mcp__paper-search__'))).toBe(false)
      expect(tools.some((t) => t.startsWith('mcp__zotero__'))).toBe(false)
      expect(tools.some((t) => t.startsWith('mcp__papers-rg__'))).toBe(false)
      expect(tools.some((t) => t.startsWith('mcp__workspace_papers__'))).toBe(false)
    })
  })
})
