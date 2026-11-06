/**
 * 匿名 deviceId 幂等测试（ADR-011）
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDeviceId, resetDeviceIdCacheForTest } from './device-id.ts'

let tempHome: string

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'asci-deviceid-test-'))
  process.env.ASCI_CONFIG_HOME = tempHome
  // 钉住配置目录为 .asci（防其他用例遗留 ASCI_DEV=1 导致目录分叉）
  process.env.ASCI_DEV = ''
  resetDeviceIdCacheForTest()
})

afterEach(() => {
  delete process.env.ASCI_CONFIG_HOME
  rmSync(tempHome, { recursive: true, force: true })
  resetDeviceIdCacheForTest()
})

describe('getDeviceId', () => {
  test('首次生成 UUID 并持久化，再次读取返回同一值', () => {
    const first = getDeviceId()
    expect(first).toMatch(/^[0-9a-f-]{36}$/)

    resetDeviceIdCacheForTest()
    expect(getDeviceId()).toBe(first)

    const onDisk = JSON.parse(
      readFileSync(join(tempHome, '.asci', 'telemetry', 'device-id.json'), 'utf-8'),
    ) as { deviceId: string }
    expect(onDisk.deviceId).toBe(first)
  })

  test('文件损坏时重新生成', () => {
    const path = join(tempHome, '.asci', 'telemetry')
    getDeviceId() // 先确保目录存在
    resetDeviceIdCacheForTest()
    writeFileSync(join(path, 'device-id.json'), 'not-json', 'utf-8')
    expect(getDeviceId()).toMatch(/^[0-9a-f-]{36}$/)
  })
})
