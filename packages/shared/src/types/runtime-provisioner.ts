/**
 * RuntimeProvisioner 校验状态（替代 PythonRuntimeStatus 的"copying"语义）
 *
 * 见 docs/superpowers/specs/2026-05-06-bundled-runtimes-installer-design.md
 */

export type RuntimeProvisionerPhase = 'idle' | 'verifying' | 'ready' | 'error'

export type RuntimeProvisionerErrorCode =
  | 'STAMP_MISSING'
  | 'STAMP_MISMATCH'
  | 'BINARY_MISSING'
  | 'BINARY_NOT_EXECUTABLE'
  | 'BINARY_SPAWN_FAILED'
  | 'UNKNOWN'

export interface RuntimeProvisionerStatus {
  phase: RuntimeProvisionerPhase
  /** phase='error' 时的机器可读错误码 */
  code?: RuntimeProvisionerErrorCode
  /** phase='error' 时缺失或失败的 binary 名（如 ['uv', 'python']） */
  missing?: string[]
  /** phase='error' 时人类可读详情 */
  detail?: string
}

export const RUNTIME_PROVISIONER_IPC_CHANNELS = {
  GET_STATUS: 'runtime-provisioner:get-status',
  STATUS_CHANGED: 'runtime-provisioner:status-changed',
} as const

export type RuntimeProvisionerIpcChannel =
  typeof RUNTIME_PROVISIONER_IPC_CHANNELS[keyof typeof RUNTIME_PROVISIONER_IPC_CHANNELS]
