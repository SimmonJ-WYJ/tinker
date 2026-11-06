/**
 * 双语 key 对齐测试
 *
 * 防止 zh/en 在某个命名空间下漏键或多键。任意一侧出现键差异都会让测试失败，
 * 提示开发者补齐缺失的翻译。
 */

import { test, expect } from 'bun:test'
import { defaultResources, I18N_NAMESPACES } from './index.ts'

/** 递归收集对象中所有的 leaf key（用 '.' 拼接） */
function collectKeys(obj: unknown, prefix = ''): Set<string> {
  const keys = new Set<string>()
  if (obj === null || typeof obj !== 'object') return keys
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const child of collectKeys(v, path)) keys.add(child)
    } else {
      keys.add(path)
    }
  }
  return keys
}

for (const ns of I18N_NAMESPACES) {
  test(`locale key parity: zh / en 在命名空间 "${ns}" 下键集一致`, () => {
    const enKeys = collectKeys(defaultResources.en[ns])
    const zhKeys = collectKeys(defaultResources.zh[ns])

    const onlyInEn = [...enKeys].filter((k) => !zhKeys.has(k)).sort()
    const onlyInZh = [...zhKeys].filter((k) => !enKeys.has(k)).sort()

    expect(onlyInEn, `命名空间 "${ns}"：zh 缺失以下键 ${JSON.stringify(onlyInEn)}`).toEqual([])
    expect(onlyInZh, `命名空间 "${ns}"：en 缺失以下键 ${JSON.stringify(onlyInZh)}`).toEqual([])
  })
}
