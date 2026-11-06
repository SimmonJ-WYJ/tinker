/**
 * 运行时初始化协调器
 *
 * 负责协调所有运行时初始化逻辑，包括：
 * 1. Shell 环境加载（macOS）
 * 2. Node.js 运行时检测
 * 3. Bun 运行时检测
 * 4. Git 运行时检测
 * 5. Shell 环境检测（Windows - Git Bash / WSL）
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { RuntimeStatus, RuntimeInitOptions, ShellEnvironmentStatus } from '@asci/shared'
import { RUNTIME_PROVISIONER_IPC_CHANNELS, nowMs } from '@asci/shared'
import { loadShellEnv } from './shell-env'
import { detectNodeRuntime } from './node-detector'
import { detectBunRuntime } from './bun-finder'
import { detectGitRuntime, getGitRepoStatus } from './git-detector'
import { detectGitBash } from './git-bash-detector'
import { detectWsl } from './wsl-detector'
import {
  RuntimeProvisioner,
  setRuntimeProvisioner,
} from './runtime/runtime-provisioner.ts'
import { RuntimeBootstrapper } from './runtime/runtime-bootstrapper.ts'

/**
 * 解析 runtime payload 的源目录的父目录。
 *
 * - 打包模式：process.resourcesPath（含 runtimes/，由 electron-builder
 *   extraResources 配置放入 .app/Contents/Resources/runtimes/）
 * - 开发模式：app.getAppPath()/dist（apps/electron/dist）。
 *   RuntimeBootstrapper 嗅探 platform-arch 子目录布局自动适配 dev / packaged。
 *
 * 用 app.getAppPath() 而非 process.cwd()：electron 进程 cwd 取决于启动方式
 *   （bun run dev 通过 workspace filter 后 cwd=apps/electron），不可靠。
 *   app.getAppPath() 始终返回 package.json 所在目录。
 */
function resolveRuntimeResourcesPath(): string {
  if (app.isPackaged) return process.resourcesPath
  return join(app.getAppPath(), 'dist')
}

/**
 * 检测器在 RP 后台 bootstrap/verify 完成前跑完时，会返回 available=false +
 * error="RuntimeProvisioner 状态：idle|verifying|copying"。这不是真失败，仅
 * 是异步时序，几秒后 STATUS_CHANGED 推送 ready 即自动恢复。日志区分这两种
 * 情况：暖启动用 ⏳，真失败才用 ❌，避免开发者误以为 mac dev 跑不起来。
 */
const RP_PENDING_PATTERN = /RuntimeProvisioner 状态：(idle|verifying|copying)/

function formatBundledToolLog(
  available: boolean,
  version: string | null,
  error: string | null,
): string {
  if (available) return `✅ ${version}`
  if (error && RP_PENDING_PATTERN.test(error)) return `⏳ ${error}（后台就绪中，不影响开发）`
  return `❌ ${error}`
}

/** 运行时状态缓存 */
let runtimeStatusCache: RuntimeStatus | null = null

/** 初始化标志 */
let isInitialized = false

/**
 * RuntimeProvisioner 校验（不阻塞首屏；bootstrap 拷贝走后台）
 *
 * 时序契约：renderer 在 mount 时主动调一次 electronAPI.runtime.getStatus()
 * 拉当前快照，配合本函数对每个新窗口的 did-finish-load 回放最后一帧，
 * 共同保证启动期早帧不会因窗口尚未挂载而丢失。
 *
 * RP 单例同步注入（让 detector 拿到 phase=copying|verifying，UI 不抛错）；
 * bootstrap + verify 在后台 promise 链里跑，完成后 STATUS_CHANGED IPC 自动推送。
 * RP 就绪后回填 runtimeStatusCache 的 node/git 字段，让 AboutSettings 重新拉
 * getRuntimeStatus 时能看到 ready 后的版本号。
 */
function startRuntimeBootstrapAsync(): void {
  // 立即注入单例：detector 调到 RP 时返回 phase=idle 的 not-available 状态而非抛错
  const rp = new RuntimeProvisioner({ asciVersion: app.getVersion() })
  setRuntimeProvisioner(rp)
  rp.on('status', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send(RUNTIME_PROVISIONER_IPC_CHANNELS.STATUS_CHANGED, status)
    }
  })
  app.on('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return
      win.webContents.send(RUNTIME_PROVISIONER_IPC_CHANNELS.STATUS_CHANGED, rp.getStatus())
    })
  })

  // 后台跑：bootstrap（拷贝几百 MB，5-10s）→ verify（spawnSync 4 个 --version）
  void (async () => {
    try {
      const bootstrapper = new RuntimeBootstrapper({
        resourcesPath: resolveRuntimeResourcesPath(),
        asciVersion: app.getVersion(),
      })
      const bootstrapStatus = await bootstrapper.bootstrap()
      console.log(
        `[运行时初始化] RuntimeBootstrapper: ${bootstrapStatus.phase}` +
          (bootstrapStatus.code ? ` (${bootstrapStatus.code})` : ''),
      )

      const status = await rp.verify()
      console.log(
        `[运行时初始化] RuntimeProvisioner: ${status.phase}` +
          (status.code ? ` (${status.code})` : ''),
      )

      // 就绪后回填缓存的 node/git 字段（首次 detector 跑时 RP 还没 ready）
      if (status.phase === 'ready' && runtimeStatusCache) {
        const [nodeStatus, gitStatus] = await Promise.all([
          detectNodeRuntime(),
          detectGitRuntime(),
        ])
        runtimeStatusCache = { ...runtimeStatusCache, node: nodeStatus, git: gitStatus }
      }
    } catch (err) {
      console.error('[运行时初始化] RuntimeBootstrapper/Provisioner 异常：', err)
    }
  })()
}

/**
 * 初始化运行时环境
 *
 * 按顺序执行：
 * 1. loadShellEnv() - 加载 Shell 环境（仅 macOS 打包环境）
 * 2. detectNodeRuntime() - 检测 Node.js 运行时
 * 3. detectBunRuntime() - 检测 Bun 运行时
 * 4. detectGitRuntime() - 检测 Git 运行时
 * 5. detectShellEnvironment() - 检测 Shell 环境（仅 Windows）
 *
 * @param options - 初始化选项
 * @returns 运行时状态
 */
export async function initializeRuntime(options: RuntimeInitOptions = {}): Promise<RuntimeStatus> {
  const startTime = nowMs()
  console.log('[运行时初始化] 开始初始化运行时环境...')

  // 1. 加载 Shell 环境
  let envLoaded = false

  if (!options.skipEnvLoad) {
    try {
      const shellEnvResult = await loadShellEnv()
      envLoaded = shellEnvResult.success
    } catch (error) {
      console.error('[运行时初始化] Shell 环境加载失败:', error)
      envLoaded = false
    }
  }

  // 1.5 启动 RuntimeBootstrapper + RuntimeProvisioner 后台流程（不阻塞首屏）
  // RP 单例立即注入，让后续 detector 拿到 phase=idle 的 not-available 而非抛错；
  // bootstrap 拷贝（几百 MB，5-10s）跑后台。RP 就绪后回填 runtimeStatusCache 的
  // node/git 字段，AboutSettings 下次拉取时即可拿到 ready 后的版本号。
  startRuntimeBootstrapAsync()

  // 2. 检测 Node.js 运行时
  const nodeStatus = options.skipNodeDetection
    ? {
        available: false,
        path: null,
        version: null,
        error: '已跳过 Node.js 检测',
      }
    : await detectNodeRuntime()

  // 3. 检测 Bun 运行时
  const bunStatus = options.skipBunDetection
    ? {
        available: false,
        path: null,
        version: null,
        source: null,
        error: '已跳过 Bun 检测',
      }
    : await detectBunRuntime()

  // 4. 检测 Git 运行时
  const gitStatus = options.skipGitDetection
    ? {
        available: false,
        version: null,
        path: null,
        error: '已跳过 Git 检测',
      }
    : await detectGitRuntime()

  // 5. 检测 Shell 环境（仅 Windows 平台）
  let shellEnvironmentStatus: ShellEnvironmentStatus | undefined

  if (process.platform === 'win32' && !options.skipShellDetection) {
    try {
      const gitBashStatus = await detectGitBash()
      const wslStatus = await detectWsl()

      // 推荐策略：优先 Git Bash > WSL 2 > WSL 1
      let recommended: 'git-bash' | 'wsl' | null = null
      if (gitBashStatus.available) {
        recommended = 'git-bash'
      } else if (wslStatus.available) {
        recommended = 'wsl'
      }

      shellEnvironmentStatus = {
        gitBash: gitBashStatus,
        wsl: wslStatus,
        recommended,
      }

      console.log('[运行时初始化] Shell 环境检测完成:', {
        gitBash: gitBashStatus.available ? `✅ ${gitBashStatus.version}` : `❌ ${gitBashStatus.error}`,
        wsl: wslStatus.available
          ? `✅ WSL ${wslStatus.version} (${wslStatus.defaultDistro})`
          : `❌ ${wslStatus.error}`,
        recommended: recommended || '⚠️ 无可用环境',
      })
    } catch (error) {
      console.error('[运行时初始化] Shell 环境检测失败:', error)
    }
  }

  // 构建运行时状态
  const runtimeStatus: RuntimeStatus = {
    node: nodeStatus,
    bun: bunStatus,
    git: gitStatus,
    shell: shellEnvironmentStatus,
    envLoaded,
    initializedAt: nowMs(),
  }

  // 缓存状态
  runtimeStatusCache = runtimeStatus
  isInitialized = true

  const duration = nowMs() - startTime
  console.log(`[运行时初始化] 初始化完成 (耗时 ${duration}ms)`)
  console.log('[运行时初始化] 状态:', {
    node: formatBundledToolLog(nodeStatus.available, nodeStatus.version, nodeStatus.error),
    bun: bunStatus.available ? `✅ ${bunStatus.version} (${bunStatus.source})` : `⏭️  ${bunStatus.error}`,
    git: formatBundledToolLog(gitStatus.available, gitStatus.version, gitStatus.error),
    shell: shellEnvironmentStatus
      ? `${shellEnvironmentStatus.recommended ? '✅' : '⚠️'} ${shellEnvironmentStatus.recommended || '无可用环境'}`
      : '⏭️ 跳过（非 Windows）',
    envLoaded: envLoaded ? '✅' : '⚠️ 未加载或不需要',
  })

  return runtimeStatus
}

/**
 * 获取当前运行时状态
 *
 * @returns 运行时状态，如果未初始化返回 null
 */
export function getRuntimeStatus(): RuntimeStatus | null {
  return runtimeStatusCache
}

/**
 * 检查运行时是否已初始化
 *
 * @returns 是否已初始化
 */
export function isRuntimeInitialized(): boolean {
  return isInitialized
}

/**
 * 重新初始化运行时
 *
 * @param options - 初始化选项
 * @returns 新的运行时状态
 */
export async function reinitializeRuntime(options: RuntimeInitOptions = {}): Promise<RuntimeStatus> {
  isInitialized = false
  runtimeStatusCache = null
  return initializeRuntime(options)
}

// 重新导出子模块的函数，方便外部使用
export { getGitRepoStatus } from './git-detector'
export { detectNodeRuntime } from './node-detector'
export { detectBunRuntime } from './bun-finder'
export { loadShellEnv } from './shell-env'
