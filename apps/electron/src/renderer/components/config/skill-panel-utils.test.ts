import { test, expect } from 'bun:test'
import type { AgentWorkspace, CapabilityPackListItem, SkillMeta } from '@asci/shared'
import {
  buildSkillRefIndex,
  deriveSkillSource,
  filterSkills,
  resolveSkillName,
  resolveWorkspaceSlug,
} from './skill-panel-utils.ts'

function workspace(id: string, slug: string): AgentWorkspace {
  return { id, name: slug, slug, createdAt: 0, updatedAt: 0 }
}

function pack(packId: string, skillRefs: string[]): CapabilityPackListItem {
  return {
    packId,
    version: '1.0.0',
    scenarioAgentName: 'agent',
    description: '',
    skillRefs,
    mcpRefs: [],
    manifestValid: true,
  }
}

test('buildSkillRefIndex 将 skillSlug 映射到引用它的包列表', () => {
  const idx = buildSkillRefIndex([pack('lit-search', ['web-search', 'pdf-read']), pack('lit-review', ['pdf-read'])])
  expect(idx.get('web-search')).toEqual(['lit-search'])
  expect(idx.get('pdf-read')).toEqual(['lit-search', 'lit-review'])
  expect(idx.get('unknown')).toBeUndefined()
})

test('buildSkillRefIndex 跳过 manifest 校验失败的包', () => {
  const bad = { ...pack('broken', ['x']), manifestValid: false }
  const idx = buildSkillRefIndex([bad])
  expect(idx.get('x')).toBeUndefined()
})

test('deriveSkillSource：被引用为 capability-package，否则 builtin', () => {
  const idx = buildSkillRefIndex([pack('lit-search', ['web-search'])])
  expect(deriveSkillSource('web-search', idx)).toBe('capability-package')
  expect(deriveSkillSource('skill-creator', idx)).toBe('builtin')
})

function skill(slug: string, partial: Partial<SkillMeta> = {}): SkillMeta {
  return { slug, name: slug, enabled: true, ...partial }
}

test('filterSkills 按状态过滤', () => {
  const skills = [skill('a', { enabled: true }), skill('b', { enabled: false })]
  const idx = new Map<string, string[]>()
  expect(filterSkills(skills, idx, { search: '', source: 'all', status: 'enabled' }).map(s => s.slug)).toEqual(['a'])
  expect(filterSkills(skills, idx, { search: '', source: 'all', status: 'disabled' }).map(s => s.slug)).toEqual(['b'])
})

test('filterSkills 按来源过滤', () => {
  const skills = [skill('web-search'), skill('skill-creator')]
  const idx = buildSkillRefIndex([pack('lit-search', ['web-search'])])
  expect(filterSkills(skills, idx, { search: '', source: 'capability-package', status: 'all' }).map(s => s.slug)).toEqual(['web-search'])
  expect(filterSkills(skills, idx, { search: '', source: 'builtin', status: 'all' }).map(s => s.slug)).toEqual(['skill-creator'])
})

test('filterSkills 搜索匹配 slug / name / 描述（大小写不敏感）', () => {
  const skills = [skill('pdf-read', { name: 'PDF Reader', description: 'reads pdfs' }), skill('web', { name: 'Web' })]
  const idx = new Map<string, string[]>()
  expect(filterSkills(skills, idx, { search: 'PDF', source: 'all', status: 'all' }).map(s => s.slug)).toEqual(['pdf-read'])
  expect(filterSkills(skills, idx, { search: 'reads', source: 'all', status: 'all' }).map(s => s.slug)).toEqual(['pdf-read'])
})

test('resolveSkillName 优先 nameI18n[lang]，回退 name', () => {
  const s = skill('x', { name: 'Web Search', nameI18n: { zh: '网页搜索', en: 'Web Search' } })
  expect(resolveSkillName(s, 'zh')).toBe('网页搜索')
  expect(resolveSkillName(s, 'en')).toBe('Web Search')
  expect(resolveSkillName(skill('y', { name: 'Only' }), 'zh')).toBe('Only')
})

test('resolveWorkspaceSlug 把工作区 id 映射到 slug（不能直接返回 id）', () => {
  const wss = [workspace('75d2531c-uuid', 'default'), workspace('id-b', 'biology')]
  expect(resolveWorkspaceSlug('75d2531c-uuid', wss)).toBe('default')
  expect(resolveWorkspaceSlug('id-b', wss)).toBe('biology')
})

test('resolveWorkspaceSlug：id 为 null 时回退首个（默认）工作区 slug — 配置页全局视图无活动会话也可用', () => {
  const wss = [workspace('id-a', 'default'), workspace('id-b', 'biology')]
  expect(resolveWorkspaceSlug(null, wss)).toBe('default')
})

test('resolveWorkspaceSlug：id 不在列表时回退首个工作区', () => {
  const wss = [workspace('id-a', 'default')]
  expect(resolveWorkspaceSlug('unknown-id', wss)).toBe('default')
})

test('resolveWorkspaceSlug：无工作区返回 null', () => {
  expect(resolveWorkspaceSlug('any', [])).toBeNull()
  expect(resolveWorkspaceSlug(null, [])).toBeNull()
})
