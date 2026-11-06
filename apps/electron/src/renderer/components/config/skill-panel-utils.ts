/**
 * 配置页 Skill 板块纯函数：来源派生 / 反向索引 / 过滤 / 显示名解析。
 * 不依赖 React，便于单测。来源两类（系统内置 / 来自能力包）由能力包 skillRefs
 * 交叉引用派生（PRD §199：importSource 是内部机制，不暴露为来源）。
 */
import type { AgentWorkspace, CapabilityPackListItem, SkillMeta } from '@asci/shared'

export type SkillSource = 'builtin' | 'capability-package'

/**
 * 把工作区 id（currentAgentWorkspaceIdAtom 持有的是 id，非 slug）解析为 slug。
 * Skill IPC（getWorkspaceSkills / toggleWorkspaceSkill）按 slug 定位磁盘目录，
 * 直接传 id 会落到不存在的目录返回空列表。配置页为全局视图，无活动会话（id 为 null）
 * 或 id 不在列表时回退首个（默认）工作区，保证始终展示默认工作区的 Skill。
 */
export function resolveWorkspaceSlug(
  workspaceId: string | null,
  workspaces: AgentWorkspace[],
): string | null {
  const matched = workspaceId ? workspaces.find((w) => w.id === workspaceId) : undefined
  return (matched ?? workspaces[0])?.slug ?? null
}

/** 构建 skillSlug → 引用它的能力包 packId[] 反向索引（仅计 manifest 有效的包） */
export function buildSkillRefIndex(packs: CapabilityPackListItem[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const pack of packs) {
    if (!pack.manifestValid) continue
    for (const slug of pack.skillRefs) {
      const list = index.get(slug)
      if (list) list.push(pack.packId)
      else index.set(slug, [pack.packId])
    }
  }
  return index
}

/** 被任一能力包引用 → 来自能力包；否则系统内置 */
export function deriveSkillSource(slug: string, refIndex: Map<string, string[]>): SkillSource {
  return refIndex.has(slug) ? 'capability-package' : 'builtin'
}

export type StatusFilter = 'all' | 'enabled' | 'disabled'
export type SourceFilter = 'all' | SkillSource

export interface SkillFilters {
  search: string
  source: SourceFilter
  status: StatusFilter
}

/** 应用搜索 + 来源 + 状态过滤；搜索匹配 slug / name / description，大小写不敏感 */
export function filterSkills(
  skills: SkillMeta[],
  refIndex: Map<string, string[]>,
  filters: SkillFilters,
): SkillMeta[] {
  const q = filters.search.trim().toLowerCase()
  return skills.filter((s) => {
    if (filters.status === 'enabled' && !s.enabled) return false
    if (filters.status === 'disabled' && s.enabled) return false
    if (filters.source !== 'all' && deriveSkillSource(s.slug, refIndex) !== filters.source) return false
    if (q) {
      const hay = `${s.slug} ${s.name} ${s.description ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** UI 显示名：nameI18n[lang] 优先，回退到英文 name */
export function resolveSkillName(skill: SkillMeta, lang: 'zh' | 'en'): string {
  return skill.nameI18n?.[lang] ?? skill.name
}
