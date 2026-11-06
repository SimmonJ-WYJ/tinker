import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { writeFileSync as writeFileSyncFs, mkdirSync as mkdirSyncFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BatchToggleSkillsByCategoryResult } from '@asci/shared'
import { getConfigDirName } from './config-paths'

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-wsmgr-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

/** 在临时 HOME 下构造一个 default-skills 目录，写入指定 slug+category */
function makeDefaultSkill(slug: string, category: string | null): void {
  const dir = join(tmpHome, getConfigDirName(), 'default-skills', slug)
  mkdirSync(dir, { recursive: true })
  const frontmatter = category === null
    ? `---\nname: ${slug}\n---\n内容`
    : `---\nname: ${slug}\ncategory: ${category}\n---\n内容`
  writeFileSync(join(dir, 'SKILL.md'), frontmatter, 'utf-8')
}

test('createAgentWorkspace: 白名单 category 进 skills/，其它进 skills-inactive/', async () => {
  makeDefaultSkill('s-default', 'default')
  makeDefaultSkill('s-general', 'general')
  makeDefaultSkill('s-bio', 'biology')
  makeDefaultSkill('s-custom', null)  // frontmatter 无 category → fallback 'custom'

  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T1')

  const active = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills')
  const inactive = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills-inactive')

  expect(existsSync(join(active, 's-default'))).toBe(true)
  expect(existsSync(join(active, 's-general'))).toBe(true)
  expect(existsSync(join(inactive, 's-bio'))).toBe(true)
  expect(existsSync(join(inactive, 's-custom'))).toBe(true)

  // 反向断言：没跑到错误目录
  expect(existsSync(join(inactive, 's-default'))).toBe(false)
  expect(existsSync(join(active, 's-bio'))).toBe(false)
})

test('createAgentWorkspace: frontmatter 损坏的 default-skill 默认禁用', async () => {
  // 不带 frontmatter 分隔符的坏文件
  const dir = join(tmpHome, getConfigDirName(), 'default-skills', 's-broken')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), 'no frontmatter here', 'utf-8')

  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T-broken')

  const active = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills')
  const inactive = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills-inactive')

  // 回填的 'custom' 不在白名单 → 默认禁用
  expect(existsSync(join(inactive, 's-broken'))).toBe(true)
  expect(existsSync(join(active, 's-broken'))).toBe(false)
})

/** 手工在工作区的 skills/ 或 skills-inactive/ 下放一个 skill（绕过 createAgentWorkspace） */
function addSkillToWorkspace(
  slug: string,
  skillSlug: string,
  enabled: boolean,
  category: string,
): void {
  const base = join(
    tmpHome, getConfigDirName(), 'agent-workspaces', slug,
    enabled ? 'skills' : 'skills-inactive', skillSlug,
  )
  mkdirSyncFs(base, { recursive: true })
  writeFileSyncFs(
    join(base, 'SKILL.md'),
    `---\nname: ${skillSlug}\ncategory: ${category}\n---\n内容`,
    'utf-8',
  )
}

test('batchToggleByCategory: 全启 —— 该分类所有禁用项变启用', async () => {
  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T-batch-enable')
  // 在 skills-inactive 里造两条 biology
  addSkillToWorkspace(ws.slug, 'bio-a', false, 'biology')
  addSkillToWorkspace(ws.slug, 'bio-b', false, 'biology')

  const result: BatchToggleSkillsByCategoryResult =
    mod.batchToggleByCategory(ws.slug, 'biology', true)

  expect(result.moved.sort()).toEqual(['bio-a', 'bio-b'])
  expect(result.skipped).toEqual([])
  expect(result.failed).toEqual([])

  const active = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills')
  expect(existsSync(join(active, 'bio-a'))).toBe(true)
  expect(existsSync(join(active, 'bio-b'))).toBe(true)
})

test('batchToggleByCategory: 全禁 —— 该分类所有启用项变禁用', async () => {
  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T-batch-disable')
  addSkillToWorkspace(ws.slug, 'gen-a', true, 'general')
  addSkillToWorkspace(ws.slug, 'gen-b', true, 'general')

  const result = mod.batchToggleByCategory(ws.slug, 'general', false)

  expect(result.moved.sort()).toEqual(['gen-a', 'gen-b'])
  const inactive = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills-inactive')
  expect(existsSync(join(inactive, 'gen-a'))).toBe(true)
  expect(existsSync(join(inactive, 'gen-b'))).toBe(true)
})

test('batchToggleByCategory: 已处于目标态的 skill 进 skipped，不进 moved', async () => {
  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T-batch-skipped')
  // 一条已启用 + 一条已禁用，都 category=biology
  addSkillToWorkspace(ws.slug, 'bio-on', true, 'biology')
  addSkillToWorkspace(ws.slug, 'bio-off', false, 'biology')

  const result = mod.batchToggleByCategory(ws.slug, 'biology', true)

  expect(result.moved).toEqual(['bio-off'])
  expect(result.skipped).toEqual(['bio-on'])
  expect(result.failed).toEqual([])
})

test('batchToggleByCategory: 空分类返回 {moved:[], skipped:[], failed:[]}', async () => {
  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T-batch-empty')

  const result = mod.batchToggleByCategory(ws.slug, 'nonexistent-category', true)

  expect(result).toEqual({ moved: [], skipped: [], failed: [] })
})

test('batchToggleByCategory: onlySlugs 参数仅作用于指定 slug（撤销路径）', async () => {
  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T-batch-only')
  addSkillToWorkspace(ws.slug, 'bio-a', false, 'biology')
  addSkillToWorkspace(ws.slug, 'bio-b', false, 'biology')
  addSkillToWorkspace(ws.slug, 'bio-c', false, 'biology')

  const result = mod.batchToggleByCategory(ws.slug, 'biology', true, ['bio-a', 'bio-c'])

  expect(result.moved.sort()).toEqual(['bio-a', 'bio-c'])
  const active = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills')
  const inactive = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills-inactive')
  expect(existsSync(join(active, 'bio-a'))).toBe(true)
  expect(existsSync(join(active, 'bio-b'))).toBe(false)  // 未选中，保持禁用
  expect(existsSync(join(inactive, 'bio-b'))).toBe(true)
  expect(existsSync(join(active, 'bio-c'))).toBe(true)
})

// ===== pruneRetiredDefaultSkills =====

test('pruneRetiredDefaultSkills: 清掉 default-skills 与各工作区中所有退役 slug，保留无关 skill', async () => {
  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const retired: readonly string[] = mod.RETIRED_DEFAULT_SKILLS
  // 列表为空说明已无退役项，断言函数能安全返回即可
  if (retired.length === 0) {
    expect(() => mod.pruneRetiredDefaultSkills()).not.toThrow()
    return
  }

  const retiredSlug = retired[0]!
  const keepSlug = 's-keep'

  // 在 default-skills 下同时放退役项与无关项
  makeDefaultSkill(retiredSlug, 'general')
  makeDefaultSkill(keepSlug, 'general')

  // 创建工作区，让两者都被复制进 skills/
  const ws = mod.createAgentWorkspace('T-prune-active')
  // 再在 skills-inactive/ 手工放一份退役项，验证 inactive 也会清
  addSkillToWorkspace(ws.slug, retiredSlug, false, 'general')

  const defaultDir = join(tmpHome, getConfigDirName(), 'default-skills')
  const active = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills')
  const inactive = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills-inactive')

  // 前置条件：三处都存在退役项
  expect(existsSync(join(defaultDir, retiredSlug))).toBe(true)
  expect(existsSync(join(active, retiredSlug))).toBe(true)
  expect(existsSync(join(inactive, retiredSlug))).toBe(true)

  mod.pruneRetiredDefaultSkills()

  // 退役项三处都被清
  expect(existsSync(join(defaultDir, retiredSlug))).toBe(false)
  expect(existsSync(join(active, retiredSlug))).toBe(false)
  expect(existsSync(join(inactive, retiredSlug))).toBe(false)

  // 无关 skill 不动
  expect(existsSync(join(defaultDir, keepSlug))).toBe(true)
  expect(existsSync(join(active, keepSlug))).toBe(true)
})

test('parseSkillFrontmatter: 解析 nameI18n 子键映射（zh / en），缺失字段时不带 nameI18n', async () => {
  // 工作区放两个 skill：一个含 nameI18n，一个不含
  const mod = await import(`./agent-workspace-manager.ts?cachebust=${Date.now()}`)
  const ws = mod.createAgentWorkspace('T-i18n')
  const wsBase = join(tmpHome, getConfigDirName(), 'agent-workspaces', ws.slug, 'skills')

  // 含 nameI18n
  const dirA = join(wsBase, 's-i18n')
  mkdirSyncFs(dirA, { recursive: true })
  writeFileSyncFs(
    join(dirA, 'SKILL.md'),
    [
      '---',
      'name: search-papers',
      'description: Search academic papers',
      'category: default',
      'nameI18n:',
      '  zh: 搜索论文',
      '  en: Search Papers',
      '---',
      '内容',
    ].join('\n'),
    'utf-8',
  )

  // 不含 nameI18n
  const dirB = join(wsBase, 's-plain')
  mkdirSyncFs(dirB, { recursive: true })
  writeFileSyncFs(
    join(dirB, 'SKILL.md'),
    '---\nname: plain-skill\ncategory: default\n---\n内容',
    'utf-8',
  )

  const skills = mod.getWorkspaceSkills(ws.slug) as Array<{ slug: string; name: string; nameI18n?: { zh?: string; en?: string } }>
  const i18nSkill = skills.find((s) => s.slug === 's-i18n')
  const plainSkill = skills.find((s) => s.slug === 's-plain')

  expect(i18nSkill?.name).toBe('search-papers')
  expect(i18nSkill?.nameI18n?.zh).toBe('搜索论文')
  expect(i18nSkill?.nameI18n?.en).toBe('Search Papers')

  expect(plainSkill?.name).toBe('plain-skill')
  expect(plainSkill?.nameI18n).toBeUndefined()
})
