/**
 * Skill 默认启用策略
 *
 * 新建工作区时，哪些 category 的 skill 默认落在 skills/（启用）
 * 而非 skills-inactive/（禁用）。其它 category 一律默认禁用。
 *
 * 见 docs/superpowers/specs/2026-04-24-skill-categorized-toggle-design.md §2
 */

/** 新建工作区默认启用的 category 白名单（硬编码，测试友好） */
export const DEFAULT_ENABLED_CATEGORIES: readonly string[] = ['default', 'general']

/** 某 category 的 skill 是否应当在新工作区中默认启用 */
export function isCategoryEnabledByDefault(category: string | undefined | null): boolean {
  if (!category) return false
  return DEFAULT_ENABLED_CATEGORIES.includes(category)
}
