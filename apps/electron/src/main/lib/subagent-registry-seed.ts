/**
 * seedBuiltinSubagents — 把项目内置科研小队一次性 seed 进 SubagentRegistry。
 *
 * 检索链：searcher · citation-explorer（打分自 #745 起下沉为 score_window 确定性工具，非子 Agent）
 * 综述链：reader · synthesizer · fact-checker
 *
 * 设计意图：buildBuiltinAgents 仍是"返回 AgentDefinition 字典"的纯函数（agent-prompt-builder
 * 的测试还在用它）；本函数把字典展开为 RegistryEntry[] 并依次 register，让 builtin 与
 * capability-pack / user-config 走同一个 Registry 路径。
 */

import { buildBuiltinAgents } from './agent-prompt-builder.ts'
import type { AppLocale } from './agent-prompt-builder.ts'
import type { SubagentRegistry } from './subagent-registry.ts'

export interface SeedBuiltinSubagentsOptions {
  claudeAvailable: boolean
  language: AppLocale
}

export function seedBuiltinSubagents(
  registry: SubagentRegistry,
  opts: SeedBuiltinSubagentsOptions,
): void {
  const agents = buildBuiltinAgents(opts.claudeAvailable, opts.language)
  for (const [name, def] of Object.entries(agents)) {
    registry.register({
      kind: 'subagent',
      name,
      source: 'builtin',
      def,
    })
  }
}
