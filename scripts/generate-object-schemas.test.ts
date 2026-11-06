/**
 * O1 schema drift 守门测试（issue #419 / ADR-009）
 *
 * 断言"重新生成 ≡ 已提交"：packages/shared 的对象 TS 类型改动后，
 * 若忘记重跑 `bun scripts/generate-object-schemas.ts`，本测试在 CI 失败。
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateObjectSchemas, OBJECT_SCHEMAS, SCHEMA_OUT_DIR } from './generate-object-schemas.ts'

describe('O1 对象标准 schema drift 守门', () => {
  const generated = generateObjectSchemas()

  test('覆盖全部 7 个核心对象 + 导出包清单', () => {
    expect([...generated.keys()].sort()).toEqual(
      OBJECT_SCHEMAS.map((s) => s.fileName).sort(),
    )
  })

  for (const { typeName, fileName } of OBJECT_SCHEMAS) {
    test(`${typeName} schema 与已提交文件一致（漂移则重跑生成脚本）`, () => {
      const committed = readFileSync(join(SCHEMA_OUT_DIR, fileName), 'utf8')
      expect(generated.get(fileName)).toBe(committed)
    })
  }

  test('ObjectId 已降级为纯 string（brand 不进对外契约）', () => {
    for (const [, content] of generated) {
      expect(content).not.toContain('__brand')
    }
  })

  test('schema 语言中立：不输出任何 description（中文注释不混入对外契约）', () => {
    for (const [, content] of generated) {
      expect(content).not.toContain('"description"')
    }
  })
})
