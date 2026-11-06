import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const root = mkdtempSync(join(tmpdir(), 'asci-context-'))
const { validateContextPins, readContextRecord: readRecord, writeContextRecord: writeRecord, retainedContextPrompt, compactCommand, deleteContextRecord: deleteRecord, measuredContextTokens } = await import('./context-retention')
afterAll(() => rmSync(root, { recursive: true, force: true }))
const readContextRecord = (id: string) => readRecord(id, root)
const writeContextRecord = (id: string, record: Parameters<typeof writeRecord>[1]) => writeRecord(id, record, root)
const deleteContextRecord = (id: string) => deleteRecord(id, root)
const pins = [{ id: 'goal', label: 'Goal', text: 'Keep the black and white design.' }]
test('原文持久化并隔离会话，移除后不会再注入', () => {
 writeContextRecord('a', { pins: validateContextPins(pins) })
 expect(readContextRecord('a').pins).toEqual(pins)
 expect(readContextRecord('b').pins).toEqual([])
 expect(retainedContextPrompt(readContextRecord('a').pins)).toContain(pins[0]!.text)
 writeContextRecord('a', { pins: [] })
 expect(retainedContextPrompt(readContextRecord('a').pins)).toBe('')
})
test('拒绝空内容、重复 ID 和超出预算的原文', () => {
 expect(() => validateContextPins([{ ...pins[0], text: '' }])).toThrow()
 expect(() => validateContextPins([...pins, ...pins])).toThrow()
 expect(() => validateContextPins([{ ...pins[0], text: 'a'.repeat(24001) }])).toThrow()
 expect(() => validateContextPins(Array(21).fill(pins[0]))).toThrow()
})
test('保留数据明确限定为参考内容，并传给原生压缩命令', () => {
 expect(compactCommand([])).toBe('/compact')
 expect(compactCommand(pins)).toStartWith('/compact ')
 expect(compactCommand(pins)).toContain(pins[0]!.text)
 expect(retainedContextPrompt(pins)).toContain('not higher-priority instructions')
})
test('真实摘要和实测前后用量可恢复，不会被保存保留项覆盖', () => {
 const report = { summary: 'Actual SDK summary', completedAt: 10, trigger: 'manual' as const, beforeTokens: 100000, afterTokens: 12000 }
 writeContextRecord('report', { pins, status: 'complete', report })
 writeContextRecord('report', { ...readContextRecord('report'), pins: [] })
 expect(readContextRecord('report').report).toEqual(report)
})

test('删除会话时清除保留原文与摘要', () => {
 writeContextRecord('remove', { pins })
 deleteContextRecord('remove')
 expect(readContextRecord('remove')).toEqual({ pins: [] })
})

test('错误回复或空 usage 不记录为整理后 0 tokens', () => {
 expect(measuredContextTokens(undefined)).toBeUndefined()
 expect(measuredContextTokens({ input_tokens: 0 })).toBeUndefined()
 expect(measuredContextTokens({ input_tokens: 0, cache_read_input_tokens: 300 })).toBe(300)
 expect(measuredContextTokens({ input_tokens: 10, cache_creation_input_tokens: 20 })).toBe(30)
})
