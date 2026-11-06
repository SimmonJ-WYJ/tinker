/**
 * #414 验收（Codex 风开箱即用）：能力包默认启用、不可禁用、移除任一包不崩溃。
 *
 * 对应 PRD Epic 2 切片 2.1 验收：
 *  - CP-1 AC2：移除任一包后对应场景能力消失，但应用不崩溃
 *  - CP-6   ：能力包默认启用，无禁用入口（loader 不再有任何启停门控）
 *
 * 这里在 loader 层锚定行为：CP-6 的「不可禁用」体现在——即便残留旧版本的
 * `capability-pack-state.json`（把某包标 false），loader 也不再读取、包仍然注册。
 * 这正是删除启停机制后「老用户曾禁用的包升级后强制启用」的预期语义。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemorySubagentRegistry } from '../subagent-registry.ts'
import { loadCapabilityPacks } from '../capability-pack-loader.ts'

const DEFAULT_PACKS_DIR = join(__dirname, '..', '..', '..', '..', 'default-capability-packs')

let tmpRoot: string
let packsDir: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'asci-414-'))
  packsDir = join(tmpRoot, 'capability-packs')
  // 把仓库内置包拷到可变 tmp 目录，便于模拟「移除某包」
  cpSync(DEFAULT_PACKS_DIR, packsDir, { recursive: true })
})
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('#414 Codex 风开箱即用', () => {
  it('AC1：内置包均通过 loader 注册到 registry（走注册中心，无 hardcode）', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir, language: 'en' })
    const scenes = r
      .list({ source: 'capability-pack', kind: 'subagent' })
      .filter((e) => e.kind === 'subagent' && e.role === 'scenario')
      .map((e) => e.name)
      .sort()
    expect(scenes).toEqual(['lit-review', 'lit-search', 'research-gap'])
  })

  it('AC2：移除 lit-search 包后其场景能力消失，lit-review 仍在，且不抛', async () => {
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir, language: 'en' })
    expect(r.get('lit-search', { kind: 'subagent' })).not.toBeNull()

    // 移除 lit-search 包目录 → reload
    rmSync(join(packsDir, 'lit-search'), { recursive: true, force: true })
    await loadCapabilityPacks(r, { packsDir, language: 'en' })

    expect(r.get('lit-search', { kind: 'subagent' })).toBeNull()
    expect(r.list({ packId: 'lit-search' })).toHaveLength(0)
    // 其余包不受影响
    expect(r.get('lit-review', { kind: 'subagent' })).not.toBeNull()
  })

  it('CP-6：残留旧 capability-pack-state.json 把包标 false，loader 仍注册（不可禁用）', async () => {
    // 模拟老用户曾禁用 lit-search 的历史状态文件
    writeFileSync(
      join(tmpRoot, 'capability-pack-state.json'),
      JSON.stringify({ 'lit-search': false }),
      'utf-8',
    )
    const r = createInMemorySubagentRegistry()
    await loadCapabilityPacks(r, { packsDir, language: 'en' })
    // 启停门控已删除 → lit-search 仍然注册
    expect(r.get('lit-search', { kind: 'subagent' })).not.toBeNull()
  })
})
