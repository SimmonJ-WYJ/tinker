import { test, expect, describe } from 'bun:test'
import type { SDKContentBlock, AgentSpeaker } from '@asci/shared'
import { groupExecutionSteps, type EnrichedBlock } from './group-execution-steps.ts'

const MASTER: AgentSpeaker = 'master'
const FOX: AgentSpeaker = { kind: 'scenario', name: '狐尼克' }
const EAGLE: AgentSpeaker = { kind: 'scenario', name: '鹰尼克' }

function think(): SDKContentBlock { return { type: 'thinking', thinking: 'x' } as SDKContentBlock }
function tool(id: string, name = 'Edit'): SDKContentBlock {
  return { type: 'tool_use', id, name, input: {} } as SDKContentBlock
}
function text(s = 'hi'): SDKContentBlock { return { type: 'text', text: s } as SDKContentBlock }
function todo(id: string): SDKContentBlock {
  return { type: 'tool_use', id, name: 'TodoWrite', input: {} } as SDKContentBlock
}
function enrich(blocks: SDKContentBlock[], speaker: AgentSpeaker = MASTER): EnrichedBlock[] {
  return blocks.map((block) => ({ block, speaker }))
}

describe('groupExecutionSteps', () => {
  test('≥2 个连续过程块（master）聚合成一个组', () => {
    const items = enrich([think(), tool('a'), tool('b')])
    const out = groupExecutionSteps(items, -1)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('group')
    if (out[0]!.kind === 'group') expect(out[0]!.steps).toHaveLength(3)
  })

  test('单个过程块退化为透传 block', () => {
    const items = enrich([tool('a')])
    const out = groupExecutionSteps(items, -1)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
  })

  test('最终回答(text)切断分组', () => {
    const items = enrich([think(), tool('a'), text(), tool('b'), tool('c')])
    const out = groupExecutionSteps(items, -1)
    // group(2) → block(text) → group(2)
    expect(out.map((x) => x.kind)).toEqual(['group', 'block', 'group'])
  })

  test('说话人切换切断分组：每个队友单独成组', () => {
    const items = [
      ...enrich([think(), tool('m1')], MASTER),
      ...enrich([tool('f1'), tool('f2')], FOX),
      ...enrich([tool('e1'), tool('e2')], EAGLE),
    ]
    const out = groupExecutionSteps(items, -1)
    expect(out.map((x) => x.kind)).toEqual(['group', 'group', 'group'])
    if (out[1]!.kind === 'group') expect(out[1]!.speaker).toEqual(FOX)
    if (out[2]!.kind === 'group') expect(out[2]!.speaker).toEqual(EAGLE)
  })

  test('首个 TodoBoard 块切断分组并作为卡片锚点透传；其余 TodoBoard 块透明不破组', () => {
    // 索引: 0 tool, 1 TodoWrite(first), 2 tool, 3 TodoWrite(non-first), 4 tool
    const items = enrich([tool('a'), todo('t1'), tool('b'), todo('t2'), tool('c')])
    const firstTaskIndex = 1
    const out = groupExecutionSteps(items, firstTaskIndex)
    // block(tool@0 单步) → block(card@1) → group(tool@2, tool@4)，TodoWrite@3 透明
    expect(out.map((x) => x.kind)).toEqual(['block', 'block', 'group'])
    if (out[2]!.kind === 'group') {
      expect(out[2]!.steps.map((s) => s.originalIndex)).toEqual([2, 4])
    }
  })

  test('隐藏工具（Read/Bash/Grep/Glob/Skill）从组中剔除且计数减少', () => {
    const items = enrich([think(), tool('a', 'Read'), tool('b', 'Edit'), tool('c', 'Bash')])
    const out = groupExecutionSteps(items, -1)
    // think + Edit 可见（2 步）成组；Read/Bash 透明剔除
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('group')
    if (out[0]!.kind === 'group') {
      expect(out[0]!.steps).toHaveLength(2)
      expect(out[0]!.steps.map((s) => (s.block as { name?: string }).name ?? s.block.type))
        .toEqual(['thinking', 'Edit'])
    }
  })

  test('隐藏步夹在可见步之间不破组', () => {
    const items = enrich([think(), tool('r', 'Read'), think()])
    const out = groupExecutionSteps(items, -1)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('group')
    if (out[0]!.kind === 'group') expect(out[0]!.steps).toHaveLength(2)
  })

  test('全隐藏工具 + 单思考 退化为单 block', () => {
    const items = enrich([think(), tool('r', 'Read')])
    const out = groupExecutionSteps(items, -1)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
  })

  test('孤立隐藏工具被完全移除', () => {
    const items = enrich([tool('r', 'Read')])
    expect(groupExecutionSteps(items, -1)).toEqual([])
  })

  test('整组全隐藏 → 块整个不渲染', () => {
    const items = enrich([tool('a', 'Read'), tool('b', 'Bash'), tool('c', 'Grep')])
    expect(groupExecutionSteps(items, -1)).toEqual([])
  })

  test('全隐藏组夹在 text 之间不留空壳', () => {
    const items = enrich([text(), tool('a', 'Bash'), tool('b', 'Read'), text()])
    const out = groupExecutionSteps(items, -1)
    expect(out.map((x) => x.kind)).toEqual(['block', 'block'])
  })

  test('空输入返回空', () => {
    expect(groupExecutionSteps([], -1)).toEqual([])
  })
})
