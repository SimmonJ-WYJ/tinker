/**
 * Preload · core domain 片段
 *
 * 顶层扁平（非 Agent）方法：运行时、通用工具、渠道、附件、用户档案、
 * 数据导出、应用设置、遥测、主题、Onboarding / Concept Spotlight、代理配置、
 * 自动更新、GitHub Release、菜单转发、快速任务窗口。
 */
import type { PlatformTransport } from '../transport.ts'
import { IPC_CHANNELS, CHANNEL_IPC_CHANNELS, ATTACHMENT_IPC_CHANNELS, PROXY_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS, DATA_EXPORT_IPC_CHANNELS } from '@asci/shared'
import type { ExportMyDataResult } from '@asci/shared'
import { TELEMETRY_IPC_CHANNELS } from '@asci/shared'
import type {
  RuntimeStatus,
  GitRepoStatus,
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  FetchModelsInput,
  FetchModelsResult,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
  ProxyConfig,
  SystemProxyDetectResult,
  GitHubRelease,
  GitHubReleaseListOptions,
  TelemetryTrackRequest,
  TelemetryCaptureSignalRequest,
  TelemetryConsentState,
} from '@asci/shared'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS, THEME_IPC_CHANNELS } from '../../types/index.ts'
import type { UserProfile, AppSettings, QuickTaskSubmitInput, QuickTaskOpenSessionData, ResolvedTheme } from '../../types/index.ts'
import { QUICK_TASK_IPC_CHANNELS } from '../../types/index.ts'
import { ONBOARDING_SPOTLIGHT_IPC_CHANNELS } from '../../types/onboarding-spotlight.ts'
import type { OnboardingSpotlightState, SpotlightStep } from '../../types/onboarding-spotlight.ts'
import { CONCEPT_SPOTLIGHT_IPC_CHANNELS } from '../../types/concept-spotlight.ts'
import type { ConceptTourKey, ConceptSpotlightState } from '../../types/concept-spotlight.ts'
import { subscribe } from '../helpers.ts'

export interface CoreApi {
  getContextRecord: (sessionId: string) => Promise<import('@asci/shared').ContextRecord>
  saveContextPins: (sessionId: string, pins: import('@asci/shared').ContextPin[]) => Promise<import('@asci/shared').ContextRecord>

  getWindowChromeState: () => { platform: string; fullscreen: boolean }
  onWindowChromeChanged: (callback: (state: { platform: string; fullscreen: boolean }) => void) => () => void

  // ===== 运行时相关 =====

  /**
   * 获取运行时状态
   * @returns 运行时状态，包含 Bun、Git 等信息
   */
  getRuntimeStatus: () => Promise<RuntimeStatus | null>

  /**
   * 获取指定目录的 Git 仓库状态
   * @param dirPath - 目录路径
   * @returns Git 仓库状态
   */
  getGitRepoStatus: (dirPath: string) => Promise<GitRepoStatus | null>

  // ===== 通用工具 =====

  /** 在系统默认浏览器中打开外部链接 */
  openExternal: (url: string) => Promise<void>

  // ===== 渠道管理相关 =====

  /** 获取所有渠道列表（apiKey 保持加密态） */
  listChannels: () => Promise<Channel[]>

  /** 创建渠道（apiKey 为明文，主进程加密） */
  createChannel: (input: ChannelCreateInput) => Promise<Channel>

  /** 更新渠道 */
  updateChannel: (id: string, input: ChannelUpdateInput) => Promise<Channel>

  /** 删除渠道 */
  deleteChannel: (id: string) => Promise<void>

  /** 解密获取明文 API Key（仅在用户查看时调用） */
  decryptApiKey: (channelId: string) => Promise<string>

  /** 测试渠道连接 */
  testChannel: (channelId: string) => Promise<ChannelTestResult>

  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  testChannelDirect: (input: FetchModelsInput) => Promise<ChannelTestResult>

  /** 从供应商拉取可用模型列表（直接传入凭证，无需已保存渠道） */
  fetchModels: (input: FetchModelsInput) => Promise<FetchModelsResult>

  // ===== 附件管理相关 =====

  /** 保存附件到本地 */
  saveAttachment: (input: AttachmentSaveInput) => Promise<AttachmentSaveResult>

  /** 读取附件（返回 base64 字符串） */
  readAttachment: (localPath: string) => Promise<string>

  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  saveImageAs: (localPath: string, defaultFilename: string) => Promise<boolean>

  /** 保存应用内置资源文件到用户选择的位置（原生 Save As 对话框） */
  saveResourceFileAs: (resourceRelativePath: string, defaultFilename: string) => Promise<boolean>

  /** 删除附件 */
  deleteAttachment: (localPath: string) => Promise<void>

  /** 打开文件选择对话框 */
  openFileDialog: () => Promise<FileDialogResult>

  /** 提取附件文档的文本内容 */
  extractAttachmentText: (localPath: string) => Promise<string>

  // ===== 用户档案相关 =====

  /** 获取用户档案 */
  getUserProfile: () => Promise<UserProfile>

  /** 更新用户档案 */
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<UserProfile>

  // ===== 数据导出（DO-2）=====

  /** 一键导出全部本地研究数据为 zip 导出包（Save As → ajv 校验 → 落盘 → 定位文件） */
  exportMyData: () => Promise<ExportMyDataResult>

  // ===== 应用设置相关 =====

  /** 获取应用设置 */
  getSettings: () => Promise<AppSettings>

  /** 更新应用设置 */
  updateSettings: (updates: Partial<AppSettings>) => Promise<AppSettings>

  /** 同步更新应用设置（用于 beforeunload 场景） */
  updateSettingsSync: (updates: Partial<AppSettings>) => boolean

  // ===== 遥测（ADR-011 主进程统一汇集）=====

  /** 行为事件埋点投递（事件名必须取自 TELEMETRY_EVENTS 注册表常量） */
  telemetryTrack: (request: TelemetryTrackRequest) => Promise<void>

  /** 自进化隐式反馈信号投递（ts/deviceId 由主进程注入） */
  telemetryCaptureSignal: (request: TelemetryCaptureSignalRequest) => Promise<void>

  /** consent 运行时状态（地域默认 + 用户选择合成结果，数据采集 tab 用） */
  telemetryGetConsentState: () => Promise<TelemetryConsentState>

  /**
   * dev 联调逃生口：renderer 受 contextIsolation 读不到 process.env / settings，
   * 由 preload 启动期 sendSync 主进程的 isRealSendAllowed()（env || dev 开关）求值，
   * 供 renderer Sentry 在 vite dev 下也初始化以验证上报。dev 开关改动重启生效。
   */
  telemetryForceSend: boolean

  // ===== 主题 =====

  /** 同步获取当前解析的主题（{mode, isDark}）；preload 启动期使用，避免首帧白闪 */
  resolveTheme: () => ResolvedTheme

  /** 订阅主题变化（OS 系统偏好变更或用户切换设置时由主进程推送） */
  onThemeChanged: (callback: (state: ResolvedTheme) => void) => () => void

  // ===== Onboarding Spotlight 引导 =====

  /** 获取 spotlight 状态（老用户字段缺失返回 null） */
  getOnboardingSpotlight: () => Promise<OnboardingSpotlightState | null>

  /**
   * 应用启动时调用一次（App mount）：
   * 真·首次安装自动 start()，老用户升级保持 null，已有状态原样返回。
   */
  bootstrapOnboardingSpotlight: () => Promise<OnboardingSpotlightState | null>

  /** 启动 spotlight（首次完成基础引导后调） */
  startOnboardingSpotlight: () => Promise<OnboardingSpotlightState>

  /** 显式推进（气泡按钮"知道了" / 用户操作完成业务） */
  advanceOnboardingSpotlight: (opts: { from: SpotlightStep; fromSubStage: number }) => Promise<OnboardingSpotlightState>

  /** 仅跳过当前 substage（用于 2b 没装 Zotero） */
  skipOnboardingSpotlightSubStage: () => Promise<OnboardingSpotlightState>

  /** 标记 spotlight 完成（步骤 3 主动） */
  completeOnboardingSpotlight: () => Promise<OnboardingSpotlightState>

  /** 跳过整个 spotlight */
  skipOnboardingSpotlight: () => Promise<OnboardingSpotlightState>

  /** 重启 spotlight（头像菜单"重看引导"） */
  restartOnboardingSpotlight: () => Promise<OnboardingSpotlightState>

  /** 订阅 spotlight 状态变更，返回 unsubscribe */
  onOnboardingSpotlightChanged: (callback: (state: OnboardingSpotlightState) => void) => () => void

  /** Concept Spotlight: 获取全量 tour 状态 */
  getConceptSpotlightState: () => Promise<ConceptSpotlightState>
  startConceptSpotlight: (opts: { tour: ConceptTourKey }) => Promise<ConceptSpotlightState>
  advanceConceptSpotlight: (opts: { tour: ConceptTourKey; fromSubStage: number }) => Promise<ConceptSpotlightState>
  skipConceptSpotlight: (opts: { tour: ConceptTourKey }) => Promise<ConceptSpotlightState>
  completeConceptSpotlight: (opts: { tour: ConceptTourKey }) => Promise<ConceptSpotlightState>
  restartConceptSpotlight: (opts: { tour: ConceptTourKey }) => Promise<ConceptSpotlightState>
  onConceptSpotlightChanged: (callback: (state: ConceptSpotlightState) => void) => () => void

  // ===== 代理配置相关 =====

  /** 获取代理配置 */
  getProxySettings: () => Promise<ProxyConfig>

  /** 更新代理配置 */
  updateProxySettings: (config: ProxyConfig) => Promise<void>

  /** 检测系统代理 */
  detectSystemProxy: () => Promise<SystemProxyDetectResult>

  // ===== 版本检测相关（仅检测，不自动下载/安装） =====

  /** 更新 API */
  updater?: {
    checkForUpdates: () => Promise<void>
    getStatus: () => Promise<{
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      error?: string
    }>
    onStatusChanged: (callback: (status: {
      status: 'idle' | 'checking' | 'available' | 'not-available' | 'error'
      version?: string
      releaseNotes?: string
      error?: string
    }) => void) => () => void
  }

  // GitHub Release
  getLatestRelease: () => Promise<GitHubRelease | null>
  listReleases: (options?: GitHubReleaseListOptions) => Promise<GitHubRelease[]>
  getReleaseByTag: (tag: string) => Promise<GitHubRelease | null>

  /** 订阅菜单关闭标签页事件（Cmd+W 被菜单拦截后转发） */
  onMenuCloseTab: (callback: () => void) => () => void

  // ===== 快速任务窗口 =====

  /** 提交快速任务 */
  submitQuickTask: (input: QuickTaskSubmitInput) => Promise<void>
  /** 隐藏快速任务窗口 */
  hideQuickTask: () => Promise<void>
  /** 重新注册全局快捷键（设置变更后） */
  reregisterGlobalShortcuts: () => Promise<Record<string, boolean>>
  /** 订阅快速任务窗口聚焦事件 */
  onQuickTaskFocus: (callback: () => void) => () => void
  /** 订阅快速任务打开会话事件（主窗口接收，由渲染进程负责创建会话） */
  onQuickTaskOpenSession: (callback: (data: QuickTaskOpenSessionData) => void) => () => void
}

export function createCoreApi(transport: PlatformTransport): CoreApi {
  return {
    getContextRecord: (id) => transport.invoke('context:read', id),
    saveContextPins: (id, pins) => transport.invoke('context:pins', id, pins),
    getWindowChromeState: () => transport.readSync('window:chrome-state'),
    onWindowChromeChanged: (callback) => subscribe(transport, 'window:chrome-changed', callback),
    // 运行时
    getRuntimeStatus: () => {
      return transport.invoke(IPC_CHANNELS.GET_RUNTIME_STATUS)
    },

    getGitRepoStatus: (dirPath: string) => {
      return transport.invoke(IPC_CHANNELS.GET_GIT_REPO_STATUS, dirPath)
    },

    // 通用工具
    openExternal: (url: string) => {
      return transport.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url)
    },

    // 渠道管理
    listChannels: () => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.LIST)
    },

    createChannel: (input: ChannelCreateInput) => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.CREATE, input)
    },

    updateChannel: (id: string, input: ChannelUpdateInput) => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.UPDATE, id, input)
    },

    deleteChannel: (id: string) => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.DELETE, id)
    },

    decryptApiKey: (channelId: string) => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.DECRYPT_KEY, channelId)
    },

    testChannel: (channelId: string) => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.TEST, channelId)
    },

    testChannelDirect: (input: FetchModelsInput) => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.TEST_DIRECT, input)
    },

    fetchModels: (input: FetchModelsInput) => {
      return transport.invoke(CHANNEL_IPC_CHANNELS.FETCH_MODELS, input)
    },

    // 附件管理
    saveAttachment: (input: AttachmentSaveInput) => {
      return transport.invoke(ATTACHMENT_IPC_CHANNELS.SAVE_ATTACHMENT, input)
    },

    readAttachment: (localPath: string) => {
      return transport.invoke(ATTACHMENT_IPC_CHANNELS.READ_ATTACHMENT, localPath)
    },

    saveImageAs: (localPath: string, defaultFilename: string) => {
      return transport.invoke(ATTACHMENT_IPC_CHANNELS.SAVE_IMAGE_AS, localPath, defaultFilename)
    },

    saveResourceFileAs: (resourceRelativePath: string, defaultFilename: string) => {
      return transport.invoke(ATTACHMENT_IPC_CHANNELS.SAVE_RESOURCE_FILE_AS, resourceRelativePath, defaultFilename)
    },

    deleteAttachment: (localPath: string) => {
      return transport.invoke(ATTACHMENT_IPC_CHANNELS.DELETE_ATTACHMENT, localPath)
    },

    openFileDialog: () => {
      return transport.invoke(ATTACHMENT_IPC_CHANNELS.OPEN_FILE_DIALOG)
    },

    extractAttachmentText: (localPath: string) => {
      return transport.invoke(ATTACHMENT_IPC_CHANNELS.EXTRACT_ATTACHMENT_TEXT, localPath)
    },

    // 用户档案
    getUserProfile: () => {
      return transport.invoke(USER_PROFILE_IPC_CHANNELS.GET)
    },

    updateUserProfile: (updates: Partial<UserProfile>) => {
      return transport.invoke(USER_PROFILE_IPC_CHANNELS.UPDATE, updates)
    },

    // 数据导出（DO-2）
    exportMyData: () => {
      return transport.invoke(DATA_EXPORT_IPC_CHANNELS.EXPORT_MY_DATA)
    },

    // 应用设置
    getSettings: () => {
      return transport.invoke(SETTINGS_IPC_CHANNELS.GET)
    },

    updateSettings: (updates: Partial<AppSettings>) => {
      return transport.invoke(SETTINGS_IPC_CHANNELS.UPDATE, updates)
    },

    updateSettingsSync: (updates: Partial<AppSettings>) => {
      return transport.readSync(SETTINGS_IPC_CHANNELS.UPDATE_SYNC, updates)
    },

    // 遥测
    telemetryTrack: (request: TelemetryTrackRequest) => {
      return transport.invoke(TELEMETRY_IPC_CHANNELS.TRACK, request)
    },

    telemetryCaptureSignal: (request: TelemetryCaptureSignalRequest) => {
      return transport.invoke(TELEMETRY_IPC_CHANNELS.CAPTURE_SIGNAL, request)
    },

    telemetryGetConsentState: () => {
      return transport.invoke(TELEMETRY_IPC_CHANNELS.GET_CONSENT_STATE)
    },

    // dev 联调逃生口：启动期 sendSync 问主进程「是否允许真实上报」（env || dev 开关），
    // 比直接读 process.env 多覆盖了设置页的 dev 开关。
    telemetryForceSend: transport.readSync(TELEMETRY_IPC_CHANNELS.REAL_SEND_ALLOWED) === true,

    // 主题
    resolveTheme: () => {
      return transport.readSync(THEME_IPC_CHANNELS.RESOLVE) as ResolvedTheme
    },
    onThemeChanged: (callback: (state: ResolvedTheme) => void) => {
      return subscribe(transport, THEME_IPC_CHANNELS.CHANGED, callback)
    },

    // Onboarding Spotlight 引导
    getOnboardingSpotlight: () => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.GET) as Promise<OnboardingSpotlightState | null>
    },

    bootstrapOnboardingSpotlight: () => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.BOOTSTRAP) as Promise<OnboardingSpotlightState | null>
    },

    startOnboardingSpotlight: () => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.START) as Promise<OnboardingSpotlightState>
    },

    advanceOnboardingSpotlight: (opts: { from: SpotlightStep; fromSubStage: number }) => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.ADVANCE, opts) as Promise<OnboardingSpotlightState>
    },

    skipOnboardingSpotlightSubStage: () => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.SKIP_SUB_STAGE) as Promise<OnboardingSpotlightState>
    },

    completeOnboardingSpotlight: () => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.COMPLETE) as Promise<OnboardingSpotlightState>
    },

    skipOnboardingSpotlight: () => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.SKIP) as Promise<OnboardingSpotlightState>
    },

    restartOnboardingSpotlight: () => {
      return transport.invoke(ONBOARDING_SPOTLIGHT_IPC_CHANNELS.RESTART) as Promise<OnboardingSpotlightState>
    },

    onOnboardingSpotlightChanged: (callback: (state: OnboardingSpotlightState) => void) => {
      return subscribe(transport, ONBOARDING_SPOTLIGHT_IPC_CHANNELS.CHANGED, callback)
    },

    // Concept Spotlight 引导（证据集 / 论文 notes）
    getConceptSpotlightState: () =>
      transport.invoke(CONCEPT_SPOTLIGHT_IPC_CHANNELS.GET_STATE) as Promise<ConceptSpotlightState>,

    startConceptSpotlight: (opts) =>
      transport.invoke(CONCEPT_SPOTLIGHT_IPC_CHANNELS.START, opts) as Promise<ConceptSpotlightState>,

    advanceConceptSpotlight: (opts) =>
      transport.invoke(CONCEPT_SPOTLIGHT_IPC_CHANNELS.ADVANCE, opts) as Promise<ConceptSpotlightState>,

    skipConceptSpotlight: (opts) =>
      transport.invoke(CONCEPT_SPOTLIGHT_IPC_CHANNELS.SKIP, opts) as Promise<ConceptSpotlightState>,

    completeConceptSpotlight: (opts) =>
      transport.invoke(CONCEPT_SPOTLIGHT_IPC_CHANNELS.COMPLETE, opts) as Promise<ConceptSpotlightState>,

    restartConceptSpotlight: (opts) =>
      transport.invoke(CONCEPT_SPOTLIGHT_IPC_CHANNELS.RESTART, opts) as Promise<ConceptSpotlightState>,

    onConceptSpotlightChanged: (callback) => {
      return subscribe(transport, CONCEPT_SPOTLIGHT_IPC_CHANNELS.CHANGED, callback)
    },

    // 代理配置
    getProxySettings: () => {
      return transport.invoke(PROXY_IPC_CHANNELS.GET_SETTINGS)
    },

    updateProxySettings: (config: ProxyConfig) => {
      return transport.invoke(PROXY_IPC_CHANNELS.UPDATE_SETTINGS, config)
    },

    detectSystemProxy: () => {
      return transport.invoke(PROXY_IPC_CHANNELS.DETECT_SYSTEM)
    },

    // 自动更新（仅版本检测，不自动下载/安装）
    updater: {
      checkForUpdates: () => transport.invoke('updater:check'),
      getStatus: () => transport.invoke('updater:get-status'),
      onStatusChanged: (callback) => {
        return subscribe<Parameters<typeof callback>[0]>(transport, 'updater:status-changed', callback)
      },
    },

    // GitHub Release
    getLatestRelease: () => {
      return transport.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE)
    },

    listReleases: (options) => {
      return transport.invoke(GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES, options)
    },

    getReleaseByTag: (tag) => {
      return transport.invoke(GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG, tag)
    },

    onMenuCloseTab: (callback: () => void) => {
      return subscribe(transport, 'menu:close-tab', callback)
    },

    // ===== 快速任务窗口 =====

    submitQuickTask: (input: QuickTaskSubmitInput) => {
      return transport.invoke(QUICK_TASK_IPC_CHANNELS.SUBMIT, input)
    },

    hideQuickTask: () => {
      return transport.invoke(QUICK_TASK_IPC_CHANNELS.HIDE)
    },

    reregisterGlobalShortcuts: () => {
      return transport.invoke(QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS)
    },

    onQuickTaskFocus: (callback: () => void) => {
      return subscribe(transport, QUICK_TASK_IPC_CHANNELS.FOCUS, callback)
    },

    onQuickTaskOpenSession: (callback: (data: QuickTaskOpenSessionData) => void) => {
      return subscribe(transport, 'quick-task:open-session', callback)
    },
  }
}
