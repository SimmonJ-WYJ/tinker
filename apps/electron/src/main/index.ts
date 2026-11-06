import { getCandidateRoot, isTinkerCandidate } from './lib/candidate-profile'
import { closeChannelBridges } from './lib/channel-endpoint.ts'
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, shell } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { watch as fsWatch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { getSettings } from './lib/settings-service'
import { createAuthDeeplinkHandler } from './lib/auth-deeplink.ts'
import { createGoogleAuthTokenStore } from './lib/auth-token-store.ts'
import { createGoogleAuthClient } from './lib/auth-google-client.ts'
import { AuthService } from './lib/auth-service.ts'
import { registerAuthIpc } from './ipc.ts'
import { getConfigDir, isLoginEnabled } from './lib/config-paths.ts'

if (isTinkerCandidate()) app.setPath('userData', join(getCandidateRoot(app.getPath('appData')), 'chromium'))

// 处理 EPIPE 错误：当 stdout/stderr 管道被关闭时（如 electronmon 重启），忽略写入错误
// 这在开发环境热重载时经常发生，不影响应用功能
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  throw err
})

// 清理本地环境中的 ANTHROPIC_* 变量，防止干扰应用的认证流程
// Electron 桌面应用通过渠道系统管理 API Key，不应受终端环境变量影响
// 注意：此操作必须在 initializeRuntime()（loadShellEnv）之前执行
for (const key of Object.keys(process.env)) {
  if (key.startsWith('ANTHROPIC_')) {
    delete process.env[key]
  }
}

// 开发期 Vite + React Refresh 必需 `unsafe-eval`，Electron 会在 DevTools 打印
// "Insecure Content-Security-Policy" 警告。生产打包时由 vite.config.ts 的
// productionCspPlugin 注入严格 CSP，不会有该问题；仅在未打包时屏蔽噪音警告。
if (!app.isPackaged) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

import { initSentryMain } from './lib/telemetry/sentry-init'
import { telemetryService } from './lib/telemetry/telemetry-service'
import { TELEMETRY_EVENTS } from '@asci/shared'

// Sentry 崩溃上报尽早初始化（app ready 前），覆盖启动期异常；
// dev 模式 / DSN 缺省时内部 noop（ADR-011）
initSentryMain(app.getVersion())

// 注册进程级崩溃诊断（render/child-process-gone + uncaught/unhandledRejection）：
// 尽早注册以覆盖启动期异常；崩溃落盘 ~/.asci/crash-logs/ 并转发 Sentry（issue #459）
registerProcessCrashDiagnostics()

import { createApplicationMenu } from './menu'
import { registerIpcHandlers } from './ipc'
import { createTray, destroyTray, rebuildTrayMenu } from './tray'
import { setLanguage as setMainLanguage, onLanguageChange } from './lib/i18n-main'
import { initializeRuntime } from './lib/runtime-init'
import { initObjectStore, getDb } from './lib/objects/object-store.ts'
import { backfillLegacyEvidenceSetWorkspace } from './lib/evidence-set-service.ts'
import { seedDefaultSkills, seedDefaultCapabilityPacks, getGlobalMcpPath } from './lib/config-paths'
import { AGENT_IPC_CHANNELS, windowBgColor } from '@asci/shared'
import {
  registerProcessCrashDiagnostics,
  registerWebContentsCrashDiagnostics,
} from './lib/crash-diagnostics.ts'
import { upgradeDefaultSkillsInWorkspaces, pruneRetiredDefaultSkills, ensureDefaultWorkspace } from './lib/agent-workspace-manager'
import { gcNoWorkspaceFallbackOrphans } from './lib/agent-session-manager'
import { migrateWorkspaceMcpToGlobal } from './lib/mcp/migration.ts'
import { ensureGlobalMcpFile, isRecentSelfWrite } from './lib/mcp/global-config.ts'
import { stopAllAgents, bindAuthServiceToOrchestrator } from './lib/agent-service'
import { initAutoUpdater, cleanupUpdater } from './lib/updater/auto-updater'
import { startWorkspaceWatcher, stopWorkspaceWatcher } from './lib/workspace-watcher'
import { startSessionPapersWatcher, stopSessionPapersWatcher } from './lib/session-papers-watcher'
import { getIsQuitting, setQuitting } from './lib/app-lifecycle'
import { createQuickTaskWindow, toggleQuickTaskWindow, destroyQuickTaskWindow } from './lib/quick-task-window'
import { registerGlobalShortcut, unregisterAllGlobalShortcuts } from './lib/global-shortcut-service'
import { loadRendererWindow, shouldUseViteDevServer } from './lib/renderer-loader'
import {
  startZoteroPdfAutoTrigger,
  stopZoteroPdfAutoTrigger,
  triggerZoteroPdfDiff,
} from './lib/zotero-pdf-trigger'
import { startZoteroPdfParserWorker, stopZoteroPdfParserWorker } from './lib/zotero-pdf-parser/index'
import {
  startZoteroArticleGeneratorWorker,
  stopZoteroArticleGeneratorWorker,
} from './lib/zotero-article-generator/index'
import {
  startZoteroEmbeddingIndexWorker,
  stopZoteroEmbeddingIndexWorker,
} from './lib/zotero-embedding-index/index'

/** macOS 平台标记：vibrancy/visualEffectState/hiddenInset 等仅 macOS 有效，需平台门控 */
const IS_MAC = process.platform === 'darwin'

let mainWindow: BrowserWindow | null = null

// Auth deeplink handler：模块级引用，供 second-instance 事件读取（仅 LOGIN_ENABLED 时赋值）
let authDeeplinkHandler: ReturnType<typeof createAuthDeeplinkHandler> | null = null

let mcpGlobalWatcher: FSWatcher | null = null
const MCP_DEBOUNCE_MS = 300

/** 获取主窗口实例（供其他模块使用） */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/**
 * 检查窗口是否在可用显示器范围内
 * 处理外接显示器断开后窗口位于不可见区域的情况
 */
function ensureWindowOnScreen(win: BrowserWindow): void {
  const bounds = win.getBounds()
  const displays = screen.getAllDisplays()
  // 检查窗口中心点是否在任一显示器范围内
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const isOnScreen = displays.some((display) => {
    const { x, y, width, height } = display.workArea
    return centerX >= x && centerX <= x + width && centerY >= y && centerY <= y + height
  })
  if (!isOnScreen) {
    // 窗口不在任何屏幕内，移动到主显示器居中位置
    const primary = screen.getPrimaryDisplay()
    const { x, y, width, height } = primary.workArea
    win.setBounds({
      x: x + Math.round((width - bounds.width) / 2),
      y: y + Math.round((height - bounds.height) / 2),
      width: bounds.width,
      height: bounds.height,
    })
    console.log('[窗口] 窗口已重新定位到主显示器')
  }
}

/** 显示并聚焦主窗口，确保窗口在可见区域；若窗口已销毁则重新创建 */
export function showAndFocusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  ensureWindowOnScreen(mainWindow)
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/**
 * Get the appropriate app icon path for the current platform
 */
function getIconPath(): string {
  // resources 在 build:resources 阶段被复制到 dist/ 下，与 main.cjs 同级
  const resourcesDir = join(__dirname, 'resources')

  if (process.platform === 'darwin') {
    return join(resourcesDir, 'icon.icns')
  } else if (process.platform === 'win32') {
    return join(resourcesDir, 'icon.ico')
  } else {
    return join(resourcesDir, 'icon.png')
  }
}

function startGlobalMcpWatcher(win: BrowserWindow): void {
  // UI 保存路径已在 saveGlobalMcpConfig 内直接广播，watcher 仅服务"用户用外部编辑器
  // 改 mcp.json"这一类事件，并在 grace 窗口内忽略 self-write 引发的回声。
  // 启动前 ensure 文件存在，否则 fsWatch 直接 ENOENT 导致外部编辑永远没有 watcher。
  const path = getGlobalMcpPath()
  try {
    ensureGlobalMcpFile()
  } catch (err) {
    console.warn('[全局 MCP 监听] 初始化空 mcp.json 失败，跳过 watcher:', err)
    return
  }
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  try {
    mcpGlobalWatcher = fsWatch(path, () => {
      if (win.isDestroyed()) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (win.isDestroyed()) return
        // 自身刚写过，saveGlobalMcpConfig 已直接广播，这次回声忽略
        if (isRecentSelfWrite()) return
        win.webContents.send(AGENT_IPC_CHANNELS.MCP_GLOBAL_CHANGED)
      }, MCP_DEBOUNCE_MS)
    })
    console.log('[全局 MCP 监听] 已启动:', path)
  } catch (err) {
    console.warn('[全局 MCP 监听] 启动失败:', err)
  }
}

function stopGlobalMcpWatcher(): void {
  if (mcpGlobalWatcher) {
    mcpGlobalWatcher.close()
    mcpGlobalWatcher = null
    console.log('[全局 MCP 监听] 已停止')
  }
}

ipcMain.on('window:chrome-state', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  event.returnValue = { platform: process.platform, fullscreen: win?.isFullScreen() ?? false }
})

function createWindow(): void {
  const iconPath = getIconPath()
  const iconExists = existsSync(iconPath)

  if (!iconExists) {
    console.warn('App icon not found at:', iconPath)
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    icon: iconExists ? iconPath : undefined,
    show: false, // Don't show until ready
    // 始终给一个不透明底色：窗口创建早于渲染主题就绪，缺它时 Windows GPU
    // 合成层会透出桌面（issue #459 半透明症状）。亮/暗取自 tokens.css --background。
    backgroundColor: windowBgColor(nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // 以下为 macOS-only 选项：vibrancy/visualEffectState 在 Windows 无效，且
    // 与缺省 backgroundColor 叠加会放大透明风险，故平台门控仅 macOS 应用（issue #459）。
    ...(IS_MAC
      ? {
          titleBarStyle: 'hiddenInset' as const, // macOS style
          trafficLightPosition: { x: 18, y: 18 },
          vibrancy: 'under-window' as const, // macOS glass effect
          visualEffectState: 'active' as const,
        }
      : {}),
  })

  // 加载渲染进程。默认加载构建产物，只有显式开发模式连接 Vite。
  if (shouldUseViteDevServer()) {
    loadRendererWindow(mainWindow)
    mainWindow.webContents.openDevTools()
  } else {
    loadRendererWindow(mainWindow)
  }

  // 窗口就绪后最大化显示
  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })

  // 拦截页面内导航，外部链接用系统浏览器打开，防止 Electron 窗口被覆盖
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许开发模式下的 Vite HMR 热重载
    if (shouldUseViteDevServer() && url.startsWith('http://localhost:')) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
  })

  // 拦截 window.open / target="_blank" 链接
  const publishChromeState = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:chrome-changed', { platform: process.platform, fullscreen: mainWindow.isFullScreen() })
  }
  mainWindow.on('enter-full-screen', publishChromeState)
  mainWindow.on('leave-full-screen', publishChromeState)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 点击关闭按钮时隐藏到 tray 而不是退出（mac + win 一致）
  // mac 上额外 app.hide() 类似 Cmd+H，确保 Dock 图标点击时 activate 事件
  // 被 trigger；Win 上 tray 已经够明显，不需要额外 hide app
  mainWindow.on('close', (event) => {
    if (!getIsQuitting()) {
      event.preventDefault()
      mainWindow?.hide()
      if (process.platform === 'darwin') {
        app.hide()
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 注册 asci:// 自定义协议（必须在 app.whenReady 前）—— 仅 LOGIN_ENABLED 时注册（默认开，dev:skip-login 关）
// macOS/Linux 使用 open-url 事件；Windows/Linux 通过 argv 注入 deep link
if (isLoginEnabled() && !isTinkerCandidate()) {
  if (process.defaultApp && process.argv.length >= 2 && process.argv[1]) {
    app.setAsDefaultProtocolClient('asci', process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('asci')
  }
}

// 单实例锁：防止用户重复启动 ASCI 出现多份进程
// 第二个实例 requestSingleInstanceLock 失败 → 立即 app.quit()
// 主实例监听 'second-instance' → show + focus 主窗口，让用户感觉「点开就回到原来」
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // 登录启用时：Windows / Linux 的 deep link URL 通过 argv 传入
    if (isLoginEnabled()) {
      const url = argv.find((a) => a.startsWith('asci://'))
      if (url && authDeeplinkHandler) authDeeplinkHandler.handle(url)
    }
    showAndFocusMainWindow()
  })
}

app.whenReady().then(async () => {
  // 初始化运行时环境（Shell 环境 + Bun + Git 检测）
  // 必须在其他初始化之前执行，确保环境变量正确加载
  await initializeRuntime()

  // 初始化 0.2 北极星核心对象 SQLite 存储（~/.asci/objects.db）
  // fail-fast：DB 起不来直接抛，主进程不应在没有持久层的状态下运行
  initObjectStore()

  // 主进程 i18n：从设置文件读取语言偏好（renderer 同源），驱动后续 menu/tray 文案
  try {
    const initialLang = getSettings().language
    if (initialLang === 'en' || initialLang === 'zh') setMainLanguage(initialLang)
  } catch (err) {
    console.warn('[主进程 i18n] 初始化失败，使用默认 en:', err)
  }

  // 同步默认 Skills 模板到 ~/.asci/default-skills/
  seedDefaultSkills()

  // 清理已退役的 default Skills（default-skills 目录 + 各工作区残留副本）
  pruneRetiredDefaultSkills()

  // 升级所有工作区中版本过旧的默认 Skills
  upgradeDefaultSkillsInWorkspaces()

  // 确保默认工作区存在
  const defaultWorkspace = ensureDefaultWorkspace()

  // issue #457：把 002 迁移落成无归属（workspace_id=''）的历史证据集回填到默认 workspace，
  // 用户切到默认项目仍能看到历史证据集。幂等：无 '' 行时 noop。必须在 ensureDefaultWorkspace 之后。
  try {
    backfillLegacyEvidenceSetWorkspace(getDb(), defaultWorkspace.id)
  } catch (err) {
    console.warn('[启动] 历史证据集 workspace 回填失败（不阻断启动）:', err)
  }

  // 一次性迁移：per-workspace mcp.json → 全局 ~/.asci/mcp.json（幂等，已迁移则 noop）
  migrateWorkspaceMcpToGlobal()

  // 同步首发能力包（lit-search 等）到 ~/.asci/capability-packs/（spec §5）
  // 已存在则保留用户版本，不覆盖；缺失才从 bundle 复制
  seedDefaultCapabilityPacks()

  // GC：清理 _no-workspace 兜底沙箱里的孤儿 session 目录
  // 兜底路径在 deleteAgentSession 时不会被对称清理（只清绑定了 workspaceId 的 session），
  // sessionId 是 uuid 不复用，孤儿目录是确定的，可在启动期统一回收。
  try {
    gcNoWorkspaceFallbackOrphans()
  } catch (err) {
    console.warn('[启动] 清理 _no-workspace 孤儿目录失败:', err)
  }

  // Create application menu
  const menu = createApplicationMenu()
  Menu.setApplicationMenu(menu)

  // 语言变更后重建 menu/tray，让 macOS 应用菜单与系统托盘菜单同步切语
  onLanguageChange(() => {
    Menu.setApplicationMenu(createApplicationMenu())
    rebuildTrayMenu()
  })

  // Register IPC handlers
  registerIpcHandlers()

  // 遥测统一汇集服务初始化（consent 地域默认解析 + deviceId）+ 应用启动事件
  try {
    telemetryService.init()
    telemetryService.track({
      event: TELEMETRY_EVENTS.APP_LAUNCHED,
      props: {
        appVersion: app.getVersion(),
        platform: process.platform,
        uiLocale: getSettings().language,
      },
    })
  } catch (err) {
    console.warn('[遥测] 初始化失败（不影响应用启动）:', err)
  }

  // ─── Auth 服务初始化 ───────────────────────────────────────
  // 仅 LOGIN_ENABLED 时构造 + 注册（默认开，dev:skip-login 关）；关时 auth 通道完全不注册
  if (isLoginEnabled()) {
    // deeplink handler 先创建占位（deps 中 authService 用闭包引用延迟绑定）
    let authService: AuthService | null = null
    authDeeplinkHandler = createAuthDeeplinkHandler({
      onOAuthCallback: (pendingId, code, state, error) =>
        authService
          ? authService.oauthCompleteFromCallback(pendingId, code, state, error)
          : Promise.resolve(),
      sendToRenderer: (event) => authService?.getSendDeeplinkRoute()(event),
      notifyOAuthError: (msg) => authService?.getNotifyOAuthError()(msg),
    })

    authService = new AuthService({
      tokenStore: createGoogleAuthTokenStore(),
      googleClient: createGoogleAuthClient(),
      deeplink: authDeeplinkHandler,
      mainWindow: () => mainWindow,
      // 埋点账户归属（#420）：登录成功 → 按 uid identify + person 属性；登出/失效 → 回落匿名。
      // 只传 uid / institution / field(discipline) / 登录源，绝不传 email/姓名/头像（红线）。
      onAuthStateChanged: (event) => {
        try {
          if (event.type === 'login-success' || event.type === 'user-updated') {
            telemetryService.identifyUser(event.user.uid, {
              institution: event.user.institution,
              discipline: event.user.field,
              signupMethod: event.user.linkedProviders?.[0],
            })
            if (event.type === 'login-success') {
              telemetryService.track({
                event: TELEMETRY_EVENTS.LOGIN_COMPLETED,
                props: { signupMethod: event.user.linkedProviders?.[0] },
              })
            }
          } else if (
            event.type === 'logout' ||
            event.type === 'session-expired' ||
            event.type === 'account-deleted'
          ) {
            // account-deleted：停止 uid 归属；服务端负责真正删 PostHog 行为数据
            telemetryService.clearUser()
          }
        } catch (err) {
          console.warn('[遥测] 账户归属处理失败（不影响登录）:', err)
        }
      },
    })

    // 注册 16 条 auth / oauth IPC 通道
    registerAuthIpc(authService)

    // journal 检索源需要 OPENSCI access token：把 AuthService 接线进 agent orchestrator。
    bindAuthServiceToOrchestrator(authService)

    // 启动恢复：若缓存中已登录，补一次 identify 让本次会话事件归属到账户
    void authService.getCurrentUser().then((r) => {
      if (r.ok && r.value) {
        telemetryService.identifyUser(r.value.uid, {
          institution: r.value.institution,
          discipline: r.value.field,
          signupMethod: r.value.linkedProviders?.[0],
        })
      }
    }).catch(() => { /* 恢复失败不影响启动 */ })

    // macOS open-url 监听（Windows/Linux 走 second-instance argv）
    app.on('open-url', (event, url) => {
      event.preventDefault()
      authDeeplinkHandler?.handle(url)
    })
  }

  // Set dock icon on macOS only in dev. Packaged apps should use Info.plist/.icns
  // so Finder, Launchpad, and Dock use the same cached bundle icon.
  if (process.platform === 'darwin' && app.dock && !app.isPackaged) {
    const dockIconPath = join(__dirname, 'resources/icon.png')
    if (existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
    }
  }

  // Create system tray icon
  createTray()

  // Create main window (will be shown when ready)
  createWindow()

  if (mainWindow) {
    // 注册主窗 webContents 崩溃诊断（render-process-gone / unresponsive，issue #459）
    registerWebContentsCrashDiagnostics(mainWindow)
    // 启动工作区文件监听（Agent Skills + 文件浏览器自动刷新）
    startWorkspaceWatcher(mainWindow)
    startGlobalMcpWatcher(mainWindow)
  }

  // 启动 session 论文集监听（检索流式进度 + 正式落盘推送，替代渲染侧轮询）
  startSessionPapersWatcher()

  // Zotero PDF：启动 parser worker → 注册自动触发层（仅 listener，不启心跳）→ startup diff
  // 启动时跑一次 diff，成功（first-baseline / diff）会自动激活 60s 心跳；失败保持 dormant
  // 等 focus/activate/manual 重新连上。详见 lib/zotero-pdf-trigger.ts 状态机注释。
  try {
    if (getSettings().zoteroEnabled && mainWindow) {
      const pdfTriggerWindow = mainWindow  // 闭包内 narrow 非 null
      void (async () => {
        await startZoteroPdfParserWorker()              // 先扫 snapshot 把 pending 入队
        await startZoteroArticleGeneratorWorker()       // 段落总结增强：开关开时启动并扫描入队
        startZoteroEmbeddingIndexWorker()               // 向量索引：评估开关开时启动并扫描入队
        startZoteroPdfAutoTrigger(pdfTriggerWindow)     // 注册 listener（mode=dormant）
        await triggerZoteroPdfDiff('startup')           // 跑 diff，成功后状态机切到 active 并启心跳
      })().catch(err => {
        console.warn('[Zotero PDF] 启动时初始化失败（不影响应用启动）:', err)
      })
    }
  } catch (err) {
    console.warn('[Zotero PDF] 启动时初始化失败（不影响应用启动）:', err)
  }

  // 生产环境下初始化自动更新
  if (app.isPackaged && mainWindow && !isTinkerCandidate()) {
    initAutoUpdater(mainWindow)
  }

  // 预创建快速任务窗口（隐藏状态，首次唤起秒开）
  createQuickTaskWindow()

  // 注册全局快捷键
  registerGlobalShortcut('quick-task', toggleQuickTaskWindow)
  registerGlobalShortcut('show-main-window', showAndFocusMainWindow)

  app.on('activate', () => {
    // 直接检查 mainWindow 引用，避免 getAllWindows() 包含 DevTools 等其他窗口导致误判
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow()
    } else {
      // 窗口已存在但可能被隐藏（macOS 关闭按钮 = hide），重新显示
      showAndFocusMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 非 macOS：关闭所有窗口时退出应用
  // macOS：保持应用运行（可通过 tray 或 Dock 重新打开）
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  // 标记正在退出，让 close 事件不再阻止关闭
  setQuitting()

  closeChannelBridges()
  // 中止所有活跃的 Agent 子进程
  stopAllAgents()
  // 清理更新器定时器
  cleanupUpdater()
  // 停止工作区文件监听
  stopWorkspaceWatcher()
  // 停止全局 mcp.json 文件监听
  stopGlobalMcpWatcher()
  // 停止 session 论文集监听
  stopSessionPapersWatcher()
  // 停止 Zotero PDF 自动触发层（清 interval + 解绑 listener）
  stopZoteroPdfAutoTrigger()
  // 停止 Zotero PDF 解析 worker（in-flight 任务自然完成）
  stopZoteroPdfParserWorker()
  // 停止 article 生成器 worker
  stopZoteroArticleGeneratorWorker()
  // 停止向量索引 worker
  stopZoteroEmbeddingIndexWorker()
  // 注销全局快捷键
  unregisterAllGlobalShortcuts()
  // 销毁快速任务窗口
  destroyQuickTaskWindow()
  // Clean up system tray before quitting
  destroyTray()
  // 清空遥测发送队列（fire-and-forget，不阻塞退出）
  void telemetryService.shutdown()
})
