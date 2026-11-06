/**
 * seedSkillsToRegistry — 把当前工作区的 SkillMeta[] reseed 到 Registry 作为 'skill' kind 元数据镜像（A2 phase2）。
 *
 * **不替换** Skill 的实际加载路径 —— 完整 SKILL.md 文本仍由 system prompt 的
 * `<available_skills>` 块注入；本 seed 仅做"Registry 可枚举元数据"。
 *
 * **reseed 模式**：调用时先 unregister 全部现有 'skill' kind entry，再注册新一批；
 * 'subagent' / 'mcp' 不受影响。每次 Agent session 启动调一次即可。
 *
 * 仅注册 enabled === true 的 Skill；禁用的不进 Registry。
 */

import type { SkillMeta } from '@asci/shared'
import type { SubagentRegistry } from './subagent-registry.ts'

export function seedSkillsToRegistry(
  registry: SubagentRegistry,
  skills: readonly SkillMeta[],
): void {
  registry.unregister((e) => e.kind === 'skill')
  for (const skill of skills) {
    if (!skill.enabled) continue
    registry.register({
      kind: 'skill',
      name: skill.slug,
      source: 'user-config',
      slug: skill.slug,
      category: skill.category,
    })
  }
}
