import { beforeEach, describe, expect, it } from 'bun:test'
import { createInMemorySubagentRegistry } from './subagent-registry.ts'
import type { SubagentRegistry, SubagentRegistryEntry } from './subagent-registry.ts'

const mkEntry = (overrides: Partial<SubagentRegistryEntry> = {}): SubagentRegistryEntry => ({
  kind: 'subagent',
  name: 'mock-x',
  source: 'builtin',
  def: { description: 'mock', prompt: 'You are mock-x.' },
  ...overrides,
})

describe('SubagentRegistry', () => {
  describe('register / list / get', () => {
    let r: SubagentRegistry
    beforeEach(() => {
      r = createInMemorySubagentRegistry()
    })

    it('注册一条后 list() 返回 1 条', () => {
      r.register(mkEntry())
      expect(r.list()).toHaveLength(1)
    })

    it('list({ source: "builtin" }) 按来源过滤', () => {
      r.register(mkEntry({ name: 'a', source: 'builtin' }))
      r.register(mkEntry({ name: 'b', source: 'user-config' }))
      expect(r.list({ source: 'builtin' })).toHaveLength(1)
      expect(r.list({ source: 'user-config' })).toHaveLength(1)
    })

    it('list({ packId }) 按能力包 ID 过滤', () => {
      r.register(mkEntry({ name: 'a', source: 'capability-pack', packId: 'pack-1' }))
      r.register(mkEntry({ name: 'b', source: 'capability-pack', packId: 'pack-2' }))
      expect(r.list({ packId: 'pack-1' })).toHaveLength(1)
    })

    it('get(name) 命中返回 entry，未命中返回 null', () => {
      r.register(mkEntry({ name: 'a' }))
      expect(r.get('a')?.name).toBe('a')
      expect(r.get('nope')).toBeNull()
    })

    it('unregister(predicate) 按谓词移除', () => {
      r.register(mkEntry({ name: 'a' }))
      r.register(mkEntry({ name: 'b' }))
      r.unregister((e) => e.name === 'a')
      expect(r.list().map((e) => e.name)).toEqual(['b'])
    })

    it('capability-pack 来源但缺 packId 时 register 抛错', () => {
      expect(() => r.register(mkEntry({ source: 'capability-pack' }))).toThrow(/packId/i)
    })

    it('unregister 删除后可再次 register 同名 entry', () => {
      r.register(mkEntry({ name: 'a', source: 'builtin' }))
      r.unregister((e) => e.name === 'a')
      expect(r.get('a')).toBeNull()
      expect(() => r.register(mkEntry({ name: 'a', source: 'user-config' }))).not.toThrow()
      expect(r.get('a')?.source).toBe('user-config')
    })

    it('list({}) 空 filter 等价于 list() 无参', () => {
      r.register(mkEntry({ name: 'a', source: 'builtin' }))
      r.register(mkEntry({ name: 'b', source: 'user-config' }))
      expect(r.list({})).toEqual(r.list())
    })
  })

  describe('snapshot', () => {
    let r: SubagentRegistry
    beforeEach(() => {
      r = createInMemorySubagentRegistry()
    })

    it('snapshot().agents 的 key 集 = list({ kind: subagent }) 的 name 集', () => {
      r.register(mkEntry({ name: 'a' }))
      r.register(mkEntry({ name: 'b' }))
      const snap = r.snapshot()
      expect(Object.keys(snap.agents).sort()).toEqual(['a', 'b'])
    })

    it('snapshot().agents[name] === entry.def（按引用透传）', () => {
      const def = { description: 'd', prompt: 'p' }
      r.register(mkEntry({ name: 'a', def }))
      expect(r.snapshot().agents['a']).toBe(def)
    })
  })

  describe('命名空间冲突策略', () => {
    let r: SubagentRegistry
    beforeEach(() => {
      r = createInMemorySubagentRegistry()
    })

    it('同名 builtin × user-config → builtin 胜出', () => {
      r.register(mkEntry({ name: 'a', source: 'builtin', def: { description: 'b', prompt: 'B' } }))
      r.register(mkEntry({ name: 'a', source: 'user-config', def: { description: 'u', prompt: 'U' } }))
      expect(r.get('a')?.source).toBe('builtin')
    })

    it('同名 builtin × capability-pack → builtin 胜出', () => {
      r.register(mkEntry({ name: 'a', source: 'builtin' }))
      r.register(mkEntry({ name: 'a', source: 'capability-pack', packId: 'p' }))
      expect(r.get('a')?.source).toBe('builtin')
    })

    it('同名 user-config × capability-pack → user-config 胜出', () => {
      r.register(mkEntry({ name: 'a', source: 'capability-pack', packId: 'p' }))
      r.register(mkEntry({ name: 'a', source: 'user-config' }))
      expect(r.get('a')?.source).toBe('user-config')
    })

    it('同名 capability-pack × capability-pack → 后激活的失败（抛错）', () => {
      r.register(mkEntry({ name: 'a', source: 'capability-pack', packId: 'p1' }))
      expect(() =>
        r.register(mkEntry({ name: 'a', source: 'capability-pack', packId: 'p2' })),
      ).toThrow(/已被.*p1.*p2/)
    })
  })

  describe('C1 红线：子 Agent tools 不能含 Task / Agent', () => {
    let r: SubagentRegistry
    beforeEach(() => {
      r = createInMemorySubagentRegistry()
    })

    it('tools 含 "Task" 时 register 抛错', () => {
      expect(() =>
        r.register(mkEntry({ def: { description: 'd', prompt: 'p', tools: ['Read', 'Task'] } })),
      ).toThrow(/C1/i)
    })

    it('tools 含 "Agent" 时 register 抛错', () => {
      expect(() =>
        r.register(mkEntry({ def: { description: 'd', prompt: 'p', tools: ['Agent'] } })),
      ).toThrow(/C1/i)
    })

    it('tools 不含 Task / Agent 时正常注册', () => {
      expect(() =>
        r.register(mkEntry({ def: { description: 'd', prompt: 'p', tools: ['Read', 'Bash'] } })),
      ).not.toThrow()
    })
  })
})
