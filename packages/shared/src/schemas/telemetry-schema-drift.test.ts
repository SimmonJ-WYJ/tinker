/**
 * JSON Schema drift 守门（issue #427 T-5）
 *
 * 断言 schema/telemetry/*.schema.json（tracked，审计事实源）与
 * telemetry-signals.ts 的 Zod 定义同步。改了 Zod 没跑
 * `bun run gen:telemetry-schema` 时本测试失败。
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  generateTelemetrySchemas,
  serializeSchema,
  TELEMETRY_SCHEMA_DIR,
} from '../../scripts/gen-telemetry-schema.ts'

describe('telemetry schema drift', () => {
  const schemas = generateTelemetrySchemas()

  test('5 类信号 + 隐式反馈 + 封皮，每类独立文件', () => {
    expect(Object.keys(schemas).sort()).toEqual([
      'error-event',
      'implicit-feedback',
      'model-choice',
      'signal-envelope',
      'task-structure',
      'tool-usage',
      'workspace-structure',
    ])
  })

  for (const name of Object.keys(generateTelemetrySchemas())) {
    test(`schema/telemetry/${name}.schema.json 与 Zod 定义同步`, () => {
      const onDisk = readFileSync(join(TELEMETRY_SCHEMA_DIR, `${name}.schema.json`), 'utf-8')
      expect(onDisk).toBe(serializeSchema(schemas[name]))
    })
  }
})
