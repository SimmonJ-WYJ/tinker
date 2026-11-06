/**
 * RuntimeBootstrapper —— 把 4 工具 runtime payload 从 .app 内拷到用户目录
 *
 * 关键定位：installer（macOS .pkg / Windows NSIS exe）把 runtime payload 嵌入
 *   - macOS: <ASCI.app>/Contents/Resources/runtimes/
 *   - Windows: <Install>/resources/runtimes/
 *
 * 但 RuntimeProvisioner 期望的目录是用户目录（macOS:
 *   ~/Library/Application Support/ASCI/runtimes/，Windows: %APPDATA%/ASCI/runtimes/）。
 * 之间需要一次首启拷贝。
 *
 * 与 spec § 2 偏差说明：
 *   spec 设想 multi-component .pkg 把 payload 直接放置到用户目录。但 electron-builder
 *   的 mac/win target 不支持 multi-component（payload + .app 必须同一目标）。务实选择
 *   是把 payload 嵌入 .app，首启拷贝（与 spec § 2"零网络一次到位"目标本质一致 —— 无
 *   用户操作、无网络，仅多几秒拷贝）。
 *
 * 状态机：idle → copying → ready / error
 * 幂等：已存在 stamp 文件且版本匹配 → 直接 ready，0 拷贝
 * 升级：stamp 与当前 ASCI 版本不一致 → 删除旧 runtimes/ 重拷
 *
 * 注意：本类 only 处理 runtimes/ 子树。`~/.asci/` 用户数据（含 python/skills/）
 * 完全不动 —— 它们独立存在于另一个目录，与 runtimes/ 互不影响。
 */

import { EventEmitter } from 'node:events'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { errMsg, getCurrentPlatformArch } from '@asci/shared'
import { getRuntimesRoot, getRuntimeStampPath, getPaperSearchPackageDir } from './paths.ts'

export type RuntimeBootstrapPhase = 'idle' | 'copying' | 'ready' | 'error'

export type RuntimeBootstrapErrorCode =
  | 'RESOURCES_MISSING'
  | 'COPY_FAILED'
  | 'CHMOD_FAILED'
  | 'STAMP_WRITE_FAILED'

export interface RuntimeBootstrapStatus {
  phase: RuntimeBootstrapPhase
  code?: RuntimeBootstrapErrorCode
  message?: string
}

interface RuntimeBootstrapperOptions {
  /**
   * runtime payload 的源目录的父目录。
   * - 打包模式：process.resourcesPath（含 runtimes/ 子目录由 electron-builder
   *   extraResources 配置放入）
   * - 开发模式：项目根的 apps/electron/dist/runtimes/<platform-arch>/ 的父目录
   *   （即 apps/electron/dist/runtimes/），让 dev 也能跑通"拷贝 + verify"链路
   */
  resourcesPath: string
  /** 当前 ASCI 版本，与 .version 文件做精确字符串匹配 */
  asciVersion: string
}

/**
 * 从 resourcesPath 计算 runtime payload 源目录。
 *
 * 两种布局：
 * - **打包模式**：electron-builder 的 extraResources 已把 dist/runtimes/<arch>/ 的
 *   *内容* 平展拷贝到 .app/Contents/Resources/runtimes/{node,git,uv,python}
 *   → 直接用 `<resources>/runtimes`
 * - **dev 模式**：build:runtimes 输出 apps/electron/dist/runtimes/<platform-arch>/{...}
 *   → 用 `<resources>/runtimes/<platform-arch>`
 *
 * 自动嗅探：先看 platform-arch 子目录是否存在 + 含 uv binary，是则用 dev 布局；
 * 否则退回 packaged 布局。
 */
function getSourceRuntimesDir(resourcesPath: string): string {
  const flat = join(resourcesPath, 'runtimes')
  const archSub = join(flat, getCurrentPlatformArch())
  const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv'
  if (existsSync(join(archSub, uvName))) return archSub
  return flat
}

/**
 * 计算 paper-search-mcp Python 包的源目录。
 *
 * - 打包模式：.app/Contents/Resources/paper-search-mcp/（root 只读）
 * - dev 模式：app.getAppPath()/dist 同辈的 resources/paper-search-mcp/（开发者源码树）
 *   走 `<resources>/../resources/paper-search-mcp` —— resourcesPath = dist 时退一层
 */
function getSourcePaperSearchMcpDir(resourcesPath: string): string | null {
  // 打包模式：<Resources>/paper-search-mcp 直接存在
  const packaged = join(resourcesPath, 'paper-search-mcp')
  if (existsSync(packaged)) return packaged
  // dev 模式：resourcesPath = .../apps/electron/dist；源码在 .../apps/electron/resources/paper-search-mcp
  const devSrc = join(resourcesPath, '..', 'resources', 'paper-search-mcp')
  if (existsSync(devSrc)) return devSrc
  return null
}

export class RuntimeBootstrapper extends EventEmitter {
  private status: RuntimeBootstrapStatus = { phase: 'idle' }
  private inflight: Promise<RuntimeBootstrapStatus> | null = null

  constructor(private readonly opts: RuntimeBootstrapperOptions) {
    super()
  }

  getStatus(): RuntimeBootstrapStatus {
    return this.status
  }

  /** 触发 bootstrap（幂等：进行中复用同一 promise；ready 立即返回） */
  bootstrap(): Promise<RuntimeBootstrapStatus> {
    if (this.status.phase === 'ready') return Promise.resolve(this.status)
    if (this.inflight) return this.inflight
    this.inflight = this.runBootstrap().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async runBootstrap(): Promise<RuntimeBootstrapStatus> {
    try {
      // 已就位 + 版本匹配 → no-op
      if (this.isAlreadyBootstrapped()) {
        return this.setStatus({ phase: 'ready' })
      }

      const src = getSourceRuntimesDir(this.opts.resourcesPath)
      if (!existsSync(src)) {
        return this.setError(
          'RESOURCES_MISSING',
          `runtime payload 不存在: ${src}（installer 未正确嵌入或 dev 未跑 build:runtimes）`,
        )
      }

      this.setStatus({ phase: 'copying' })

      const dest = getRuntimesRoot()
      // Existing virtualenvs may point at the legacy interpreter path. Keep an
      // installed Python/uv when upgrading to the lazy payload; never replace
      // a working interpreter with a shell wrapper underneath an old venv.
      if (existsSync(join(src, '.optional-python')) && existsSync(dest)) {
        for (const entry of readdirSync(dest)) {
          if (entry !== 'python' && entry !== 'uv') rmSync(join(dest, entry), { recursive: true, force: true })
        }
        for (const entry of readdirSync(src)) {
          if ((entry === 'python' || entry === 'uv') && existsSync(join(dest, entry))) continue
          cpSync(join(src, entry), join(dest, entry), { recursive: true })
        }
      } else {
        if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
        mkdirSync(dirname(dest), { recursive: true })
        cpSync(src, dest, { recursive: true })
      }

      // chmod +x 兜底（cpSync 通常保留权限位，但 macOS 偶有丢失）
      if (process.platform !== 'win32') {
        try {
          spawnSync('chmod', ['-R', '755', dest], { stdio: 'ignore', timeout: 10000 })
        } catch {
          // chmod 失败不阻塞首启：runtime 已就绪，仅记录 warning
          console.warn('[RuntimeBootstrapper] chmod -R 755 失败（不阻塞）')
        }
      }

      // 同步拷贝 paper-search-mcp Python 包到用户目录（与 runtimes/ 同辈）
      // 原因：包源在 .app 内只读，uv run --extra mcp 需要在包目录创建 .venv
      // 必须把它放到用户可写目录。失败不阻塞 runtime 就绪，只记 warning。
      //
      // 升级保留 .venv：版本变更时只替换 Python 源文件，保留 uv 首次运行后写入的
      // .venv/，避免每次 app 升级后第一次 spawn 都要联网重装（断网会失败）。
      try {
        const psSrc = getSourcePaperSearchMcpDir(this.opts.resourcesPath)
        if (psSrc) {
          const psDest = getPaperSearchPackageDir()
          mkdirSync(psDest, { recursive: true })
          // 删除 psDest 中除 .venv 外所有项（含被新版本删除的旧文件）
          for (const entry of readdirSync(psDest)) {
            if (entry === '.venv') continue
            rmSync(join(psDest, entry), { recursive: true, force: true })
          }
          // 拷贝新源文件；源里不含 .venv，故 cpSync 不会覆盖已保留的 .venv/
          cpSync(psSrc, psDest, { recursive: true })
        } else {
          console.warn('[RuntimeBootstrapper] paper-search-mcp 源目录未找到（dev 与 packaged 布局均不命中）')
        }
      } catch (err) {
        console.warn('[RuntimeBootstrapper] paper-search-mcp 拷贝失败（不阻塞）:', errMsg(err))
      }

      // 写版本 stamp
      try {
        writeFileSync(getRuntimeStampPath(), this.opts.asciVersion, 'utf-8')
      } catch (err) {
        return this.setError('STAMP_WRITE_FAILED', errMsg(err))
      }

      return this.setStatus({ phase: 'ready' })
    } catch (err) {
      return this.setError('COPY_FAILED', errMsg(err))
    }
  }

  /** 检测目标 runtimes/ 是否已就位且 stamp 版本匹配 */
  private isAlreadyBootstrapped(): boolean {
    const stamp = getRuntimeStampPath()
    if (!existsSync(stamp)) return false
    try {
      // Preview builds can share the app version. Migrate the runtime contract
      // even then, otherwise a legacy Python failure would still block Node.
      const optionalSource = existsSync(join(getSourceRuntimesDir(this.opts.resourcesPath), '.optional-python'))
      if (optionalSource && !existsSync(join(getRuntimesRoot(), '.optional-python'))) return false
      return readFileSync(stamp, 'utf-8').trim() === this.opts.asciVersion
    } catch {
      return false
    }
  }

  private setStatus(next: RuntimeBootstrapStatus): RuntimeBootstrapStatus {
    this.status = next
    this.emit('status', next)
    return next
  }

  private setError(code: RuntimeBootstrapErrorCode, message: string): RuntimeBootstrapStatus {
    return this.setStatus({ phase: 'error', code, message })
  }
}
