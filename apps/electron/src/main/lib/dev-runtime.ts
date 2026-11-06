/**
 * 主进程 dev 运行时判定（CLAUDE.md 主进程 dev 门控约定）
 *
 * ASCI_DEV=1 显式覆盖 → app.isPackaged（未打包 = dev）；
 * 非 Electron 环境（bun test 单测）安全侧判为 dev。
 * 语义与 config-paths.ts 的目录判定一致，但用途不同：这里回答
 * "该不该发真实网络/初始化线上 SDK"，config-paths 回答 "数据落哪个目录"。
 */
export function isDevRuntime(): boolean {
  if (process.env.ASCI_DEV === '1') return true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    return !app.isPackaged
  } catch {
    return true
  }
}

/**
 * 是否允许真实上报（PostHog / Sentry / 自进化端点共用门控）。
 *
 * 打包产物恒允许；dev 默认即放行（默认真实上报，便于联调）。两个开关：
 *   1. env ASCI_TELEMETRY_FORCE_SEND=1（CI / 命令行临时，强制放行）
 *   2. settings.telemetryDevForceSend（设置→数据采集 的 dev 开关，重启生效）：
 *      未设置（undefined）按默认开放行；仅显式 false 才在 dev 下回落只写本地。
 * 打包产物不依赖二者（isDevRuntime()=false 本就允许）。
 *
 * settings-service 懒加载：非 Electron 环境（bun test）或读取失败时安全回落 false。
 */
export function isRealSendAllowed(): boolean {
  if (!isDevRuntime()) return true
  if (process.env.ASCI_TELEMETRY_FORCE_SEND === '1') return true
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSettings } = require('./settings-service.ts') as typeof import('./settings-service.ts')
    // 默认开：未设置视为开启，仅显式关闭（false）才在 dev 下只写本地不发网络
    return getSettings().telemetryDevForceSend !== false
  } catch {
    return false
  }
}
