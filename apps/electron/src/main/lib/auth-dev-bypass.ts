/**
 * Dev bypass 门控 - spec §十一
 *
 * 三联触发：
 *   - !app.isPackaged（兜底：prod 包永不）
 *   - ASCI_AUTH_NO_BYPASS !== '1'（测试真实流程逃生口）
 *   - ASCI_DEV === '1'（主门控）
 *
 * 运行时禁用：dev 用户在 app 内 logout 后本进程不再 bypass；重启恢复。
 */

import { app } from 'electron'

function isDevBypassActive(): boolean {
  if (app.isPackaged) return false
  if (process.env.ASCI_AUTH_NO_BYPASS === '1') return false
  return process.env.ASCI_DEV === '1'
}

let runtimeDisabled = false

export function disableBypassForRuntime(): void {
  runtimeDisabled = true
}

export function shouldBypass(): boolean {
  return !runtimeDisabled && isDevBypassActive()
}

/** ASCI_NO_DEV_FIXTURE=1 完全禁用 fixture 种入（测试用）*/
export function isFixtureSeedingDisabled(): boolean {
  return process.env.ASCI_NO_DEV_FIXTURE === '1'
}
