/**
 * 自进化信号 JSON Schema 生成脚本（issue #427 T-5）
 *
 * 由 src/schemas/telemetry-signals.ts 的 Zod 定义（事实源）生成
 * <repo 根>/schema/telemetry/*.schema.json（tracked，外部审计员不读源码
 * 即可还原可采集字段范围）。生成物与 Zod 的同步由
 * telemetry-schema-drift.test.ts 守门。
 *
 * 用法：bun run gen:telemetry-schema（packages/shared 下）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  SELF_EVOLUTION_SIGNAL_SCHEMAS,
  SignalEnvelope,
} from '../src/schemas/telemetry-signals.ts'

/** 输出目录：仓库根 schema/telemetry/ */
export const TELEMETRY_SCHEMA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../schema/telemetry',
)

/** 生成「文件名（不含扩展名）→ JSON Schema 对象」映射，供脚本与 drift 测试共用 */
export function generateTelemetrySchemas(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, schema] of Object.entries(SELF_EVOLUTION_SIGNAL_SCHEMAS)) {
    out[name] = z.toJSONSchema(schema, { target: 'draft-2020-12' })
  }
  out['signal-envelope'] = z.toJSONSchema(SignalEnvelope, { target: 'draft-2020-12' })
  return out
}

/** 序列化为稳定格式（2 空格缩进 + 末尾换行），保证生成幂等、diff 干净 */
export function serializeSchema(schema: unknown): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}

if (import.meta.main) {
  mkdirSync(TELEMETRY_SCHEMA_DIR, { recursive: true })
  const schemas = generateTelemetrySchemas()
  for (const [name, schema] of Object.entries(schemas)) {
    const file = join(TELEMETRY_SCHEMA_DIR, `${name}.schema.json`)
    writeFileSync(file, serializeSchema(schema), 'utf-8')
    console.log(`已生成 ${file}`)
  }
}
