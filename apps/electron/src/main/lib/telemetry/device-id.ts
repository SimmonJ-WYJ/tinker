/**
 * 匿名设备标识（ADR-011）
 *
 * 本地生成 UUID 持久化在 ~/.asci/telemetry/device-id.json，作为
 * PostHog distinct_id 与自进化信号封皮的 deviceId。不含任何用户信息。
 *
 * #420 OPENSCI 登录落地后：登录成功时调用 PostHog identify()/alias()
 * 把该 deviceId 的历史事件合并到账户 uid，本文件保持不变（设备级标识）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getTelemetryDeviceIdPath } from '../config-paths.ts'

interface DeviceIdFile {
  deviceId: string
  createdAt: string
}

let _cached: string | undefined

/** 读取（或首次生成）匿名 deviceId，进程内缓存 */
export function getDeviceId(): string {
  if (_cached) return _cached
  const path = getTelemetryDeviceIdPath()
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<DeviceIdFile>
      if (typeof parsed.deviceId === 'string' && parsed.deviceId) {
        _cached = parsed.deviceId
        return _cached
      }
    } catch {
      // 文件损坏 → 重新生成（旧 deviceId 不可恢复，行为数据断链可接受）
    }
  }
  const file: DeviceIdFile = { deviceId: randomUUID(), createdAt: new Date().toISOString() }
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf-8')
  _cached = file.deviceId
  return _cached
}

/** 仅测试用：清掉进程内缓存（配合 ASCI_CONFIG_HOME 测试隔离） */
export function resetDeviceIdCacheForTest(): void {
  _cached = undefined
}
