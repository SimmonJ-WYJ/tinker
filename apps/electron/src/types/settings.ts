/**
 * 应用设置类型
 *
 * 主题模式、IPC 通道等设置相关定义。
 */

import type { ASCIPermissionMode, AgentEffort, TelemetryConsentSettings } from '@asci/shared'
import type { OnboardingSpotlightState } from './onboarding-spotlight'
import type { ConceptSpotlightState } from './concept-spotlight'

/** 应用界面语言代码（与 locales/ 子目录名一致） */
export type AppLocale = 'en' | 'zh'

/** 应用主题模式：system 跟随 OS 偏好；light/dark 强制 */
export type AppTheme = 'system' | 'light' | 'dark'

/** 主题解析结果：mode 是用户偏好，isDark 是主进程基于 nativeTheme 解析的最终值 */
export interface ResolvedTheme {
  mode: AppTheme
  isDark: boolean
}

/** 通知音场景类型 */
export type NotificationSoundType = 'taskComplete' | 'permissionRequest' | 'exitPlanMode'

/** 可选通知音 ID */
export type NotificationSoundId = 'ding' | 'ding-dong' | 'discord' | 'done' | 'down-power' | 'food' | 'lite' | 'quiet' | 'none'

/** 各场景通知音配置 */
export interface NotificationSoundSettings {
  /** 任务完成 */
  taskComplete?: NotificationSoundId
  /** 权限审批（含 AskUser） */
  permissionRequest?: NotificationSoundId
  /** 计划审批 */
  exitPlanMode?: NotificationSoundId
}

/** 用户自定义快捷键覆盖（持久化到 settings.json） */
export interface ShortcutOverrides {
  [shortcutId: string]: {
    mac?: string
    win?: string
  }
}

/** 应用设置 */
export interface AppSettings {
  /** Agent 默认渠道 ID（仅限 Anthropic 渠道） — 当前选中的渠道 */
  agentChannelId?: string
  /** Agent 默认模型 ID */
  agentModelId?: string
  /** Agent 启用的渠道 ID 列表（多选，Switch 开关） */
  agentChannelIds?: string[]
  /** Agent 当前工作区 ID */
  agentWorkspaceId?: string
  /** 是否启用桌面通知 */
  notificationsEnabled?: boolean
  /** 是否启用通知提示音（阻塞 Hook 触发时播放） */
  notificationSoundEnabled?: boolean
  /** 各场景通知音选择 */
  notificationSounds?: NotificationSoundSettings
  /** 标签页持久化状态（重启恢复） */
  tabState?: PersistedTabSettings
  /** Agent 权限模式（全局默认，工作区级覆盖此值） */
  agentPermissionMode?: ASCIPermissionMode
  /** Agent 推理深度 */
  agentEffort?: AgentEffort
  /** Agent 最大预算（美元/次） */
  agentMaxBudgetUsd?: number
  /** Agent 最大轮次（0 或 undefined = SDK 默认） */
  agentMaxTurns?: number
  /** 自动归档天数（0 = 禁用，默认 7） */
  archiveAfterDays?: number
  /** 应用界面语言（默认 'en'，不做系统语言检测） */
  language?: AppLocale
  /** 应用主题模式（默认 'system'，跟随 OS 偏好） */
  theme?: AppTheme
  /** 发送消息快捷键模式：true = Cmd/Ctrl+Enter 发送，false(默认) = Enter 发送 */
  sendWithCmdEnter?: boolean
  /** 用户自定义快捷键覆盖 */
  shortcutOverrides?: ShortcutOverrides
  /** 是否启用 Zotero 集成 */
  zoteroEnabled?: boolean
  /** Zotero 数据目录自定义覆盖（默认走系统默认路径） */
  zoteroDataDir?: string
  /**
   * Zotero 加入弹窗的全局默认 destination（F39）。
   * 持久化形态为 sentinel 字符串（'__zotero_current__' / '__my_library__'）或
   * 8 字符 collection key；由 zotero-destination.ts 的 parseDest/serializeDest 处理。
   * 仅在没有 workspace 上下文（如 citation graph orphan）时使用；
   * 有 workspace 时优先看 zoteroLastCollectionKeyByWorkspace。
   */
  zoteroLastCollectionKey?: string
  /**
   * Zotero 加入弹窗的按工作区 destination 记忆（F39）。
   * 键 = workspace id，值 = 与 zoteroLastCollectionKey 同形态字符串。
   */
  zoteroLastCollectionKeyByWorkspace?: Record<string, string>
  /**
   * Zotero 可执行文件 / 应用 Bundle 自定义路径覆盖（默认空，按平台扫描常见目录）。
   * - macOS：`.app` 目录（如 `/Applications/Zotero.app` 或 `~/Setapp/Zotero.app`）
   * - Windows：`zotero.exe` 绝对路径
   * 设置后 `detectZoteroInstalled` 优先返回该路径，`launchZotero` 跳过 LaunchServices 直接 spawn。
   * Linux 不在支持范围。
   */
  zoteroInstallPath?: string
  /** 是否已消费过「首次连通自动启用 Zotero Agent 访问」的一次性触发 */
  zoteroAutoEnableConsumed?: boolean
  /**
   * Zotero 子能力：图片识别（OCR）开关。Zotero 启用后默认 true（PaddleOCR 模型已打包）。
   * 关闭则不在 capabilities/SDK 注入 ocr MCP，节省 spawn。
   */
  zoteroOcrEnabled?: boolean
  /**
   * Zotero 子能力：语音识别（ASR）开关。默认 false —— ASR 模型 ~1GB 需要用户主动下载。
   * 用户在 Zotero 设置页打开此开关时自动触发 startDownload；下载完后 asr MCP 可用。
   */
  zoteroAsrEnabled?: boolean
  /**
   * Zotero 设置页"高级"组用户记忆的展开状态（默认 false / 折叠）。
   * 注意：当自动展开条件命中（Zotero 未探测到 / 用户设过非空 installPath / dataDir）时，
   * UI 仍强制展开并覆盖此记忆，仅用于"全部默认状态下用户主动展开过"的场景。
   */
  zoteroAdvancedOpen?: boolean
  /** 项目文件面板展开状态（按工作区 ID 存储） */
  sidebarProjectFilesExpandedByWorkspace?: Record<string, boolean>
  /** Onboarding 上手清单状态（DEPRECATED — 已被 onboardingSpotlight 替代，仅保留以读取老数据不破坏） */
  onboardingChecklist?: unknown

  /** Onboarding Spotlight 引导状态（首次完成 OnboardingView 时初始化） */
  onboardingSpotlight?: OnboardingSpotlightState

  /** 概念引导 tour 状态（证据集 / 论文 notes，与 spotlight V2 独立） */
  conceptSpotlight?: ConceptSpotlightState

  /**
   * 遥测 consent（ADR-011）：PostHog 行为埋点 + 自进化信号两路独立开关。
   * undefined / 字段缺失 = 用户未显式选择，跟随地域默认
   * （GDPR 区默认关 opt-in，非 GDPR 区默认开 opt-out，无法判定按 GDPR 区）。
   */
  telemetryConsent?: TelemetryConsentSettings

  /**
   * dev 联调开关：dev 运行时（未打包）是否真实上报（绕过 dev 门控）。
   * 仅 dev 生效——打包产物本就上报，与此无关。**默认开**：未设置（undefined）即放行，
   * 仅显式 false 才在 dev 下回落只写本地。env ASCI_TELEMETRY_FORCE_SEND=1 可强制放行。
   * 改动重启后生效（sender / Sentry 在启动期初始化）。
   */
  telemetryDevForceSend?: boolean
}

/** 持久化的标签页状态 */
export interface PersistedTabSettings {
  tabs: Array<{
    id: string
    type: 'agent'
    sessionId: string
    title: string
    /** 归属工作区 ID（缺省 = 不归属任何工作区，各工作区可见；#458） */
    workspaceId?: string
  }>
  activeTabId: string | null
  /** 各工作区最后激活的 tab ID（切回工作区时还原；#458） */
  activeTabIdByWorkspace?: Record<string, string>
}

/** 设置 IPC 通道 */
export const SETTINGS_IPC_CHANNELS = {
  GET: 'settings:get',
  UPDATE: 'settings:update',
  UPDATE_SYNC: 'settings:update-sync',
} as const

/**
 * 主题 IPC 通道
 *
 * - RESOLVE：渲染进程 sync 调用，主进程返回 {mode, isDark}；preload 在启动时调用一次以避免首帧白闪
 * - CHANGED：主进程推送（nativeTheme 系统偏好变化或 settings.theme 被更新时），渲染进程订阅同步
 */
export const THEME_IPC_CHANNELS = {
  RESOLVE: 'theme:resolve',
  CHANGED: 'theme:changed',
} as const

/** 快速任务窗口 IPC 通道 */
export const QUICK_TASK_IPC_CHANNELS = {
  /** 提交快速任务（渲染进程 → 主进程） */
  SUBMIT: 'quick-task:submit',
  /** 隐藏快速任务窗口 */
  HIDE: 'quick-task:hide',
  /** 通知渲染进程聚焦输入框 */
  FOCUS: 'quick-task:focus',
  /** 重新注册全局快捷键（设置变更后） */
  REREGISTER_GLOBAL_SHORTCUTS: 'quick-task:reregister-global-shortcuts',
} as const

/** 快速任务提交输入 */
export interface QuickTaskSubmitInput {
  /** 任务文本内容 */
  text: string
  /** 目标模式（当前仅支持 agent） */
  mode: 'agent'
  /** 附件列表（base64 编码） */
  files?: QuickTaskFile[]
}

/** 快速任务附件 */
export interface QuickTaskFile {
  filename: string
  mediaType: string
  base64: string
  size: number
}

/** 主窗口接收的快速任务打开会话数据 */
export interface QuickTaskOpenSessionData {
  mode: 'agent'
  text: string
  files?: QuickTaskFile[]
}
