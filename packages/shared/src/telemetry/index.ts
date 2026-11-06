/**
 * 遥测领域模块 barrel —— 事件注册表 / consent 模型 / IPC 契约。
 * 信号 Zod schema 在 ../schemas/telemetry-signals.ts（与 schemas 目录惯例一致）。
 */
export * from './event-registry.ts'
export * from './conversation-type.ts'
export * from './consent.ts'
export * from './ipc.ts'
export * from './redact.ts'
