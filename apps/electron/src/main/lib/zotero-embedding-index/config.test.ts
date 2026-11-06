/**
 * 向量索引配置单测：检索模式三档 + 旧布尔 enabled 迁移 + 模式门控辅助函数。
 *
 * 用 ASCI_CONFIG_HOME 把 ~/.asci 重定向到临时目录隔离磁盘。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { isKeywordSearchEnabled, isVectorModeEnabled } from '@asci/shared'

import { loadEmbeddingConfig, resetEmbeddingConfigCache } from './config.ts'
import { getZoteroEmbeddingConfigPath } from '../config-paths.ts'

let prevHome: string | undefined
let tmp: string

function writeConfig(json: unknown): void {
  const p = getZoteroEmbeddingConfigPath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(json), 'utf-8')
  resetEmbeddingConfigCache()
}

beforeEach(() => {
  prevHome = process.env.ASCI_CONFIG_HOME
  tmp = mkdtempSync(`${tmpdir()}/asci-embed-cfg-`)
  process.env.ASCI_CONFIG_HOME = tmp
  resetEmbeddingConfigCache()
})

afterEach(() => {
  if (prevHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = prevHome
  resetEmbeddingConfigCache()
  rmSync(tmp, { recursive: true, force: true })
})

describe('模式门控辅助函数', () => {
  test('isVectorModeEnabled：vector / both 真，papers-rg 假', () => {
    expect(isVectorModeEnabled('vector')).toBe(true)
    expect(isVectorModeEnabled('both')).toBe(true)
    expect(isVectorModeEnabled('papers-rg')).toBe(false)
  })
  test('isKeywordSearchEnabled：papers-rg / both 真，vector 假', () => {
    expect(isKeywordSearchEnabled('papers-rg')).toBe(true)
    expect(isKeywordSearchEnabled('both')).toBe(true)
    expect(isKeywordSearchEnabled('vector')).toBe(false)
  })
})

describe('loadEmbeddingConfig — mode 解析与迁移', () => {
  test('缺文件 → 默认 both', () => {
    resetEmbeddingConfigCache()
    expect(loadEmbeddingConfig().mode).toBe('both')
  })

  test('新格式 mode 字段原样保留', () => {
    writeConfig({ mode: 'vector', concurrency: 1 })
    expect(loadEmbeddingConfig().mode).toBe('vector')
  })

  test('非法 mode → 回落默认 both', () => {
    writeConfig({ mode: 'nonsense', concurrency: 1 })
    expect(loadEmbeddingConfig().mode).toBe('both')
  })

  test('旧布尔 enabled:true → 迁移为 both', () => {
    writeConfig({ enabled: true, concurrency: 1 })
    expect(loadEmbeddingConfig().mode).toBe('both')
  })

  test('旧布尔 enabled:false → 迁移为 papers-rg', () => {
    writeConfig({ enabled: false, concurrency: 1 })
    expect(loadEmbeddingConfig().mode).toBe('papers-rg')
  })

  test('mode 优先于遗留 enabled', () => {
    writeConfig({ mode: 'vector', enabled: false })
    expect(loadEmbeddingConfig().mode).toBe('vector')
  })
})
