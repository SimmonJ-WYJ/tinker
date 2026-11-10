/**
 * Preload · agent domain 片段
 *
 * Agent 相关顶层扁平方法：会话管理、队列消息、后台任务、工作区管理、
 * 工作区能力（MCP + Skill）、会话论文集、流式事件、权限系统、AskUser、
 * ExitPlanMode、lit-review / search-plan 响应、待处理请求、Agent Teams、
 * Agent 附件、文件系统操作、工作区文件变化通知。
 */
import { ipcRenderer, webUtils } from 'electron'
import { AGENT_IPC_CHANNELS, LITREVIEW_IPC_CHANNELS, SEARCH_PLAN_IPC_CHANNELS } from '@asci/shared'
import type { LitReviewPresentDirectionsResponse, SearchPlanConfirmResponse } from '@asci/shared'
import type {
  ZoteroOpenBatchImportPayload,
} from '@asci/shared'
import type {
  AgentSessionMeta,
  AgentMessage,
  SDKMessage,
  AgentSendInput,
  AgentStreamEvent,
  AgentStreamCompletePayload,
  AgentWorkspace,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  WorkspaceAttachDirectoryInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
  GlobalMcpConfig,
  SkillMeta,
  OtherWorkspaceSkillsGroup,
  WorkspaceCapabilities,
  PaperRecord,
  SessionPapersChangedEvent,
  SessionPapersLive,
  ListDirectoryResult,
  ListDirectoryOptions,
  FileSearchResult,
  PermissionResponse,
  ASCIPermissionMode,
  AgentEffort,
  AskUserResponse,
  ExitPlanModeResponse,
  AgentTeamData,
  ForkSessionInput,
  RewindSessionInput,
  RewindSessionResult,
  AgentMessageSearchResult,
  AgentQueueMessageInput,
  PendingRequestsSnapshot,
  ListRecentWorkspaceFilesInput,
  ListRecentWorkspaceFilesOutput,
  PreviewReadTextResult,
  PreviewParseNotebookResult,
  PreviewDownloadPdfInput,
  PreviewDownloadPdfResult,
  DownloadPdfLocalResult,
} from '@asci/shared'
import { subscribe } from '../helpers'

export interface AgentApi {
  // ===== Agent 会话管理相关 =====

  /** 获取 Agent 会话列表 */
  listAgentSessions: () => Promise<AgentSessionMeta[]>

  /** 创建 Agent 会话 */
  createAgentSession: (title?: string, channelId?: string, workspaceId?: string) => Promise<AgentSessionMeta>

  /** 获取或创建工作区下的草稿会话（复用空会话，避免堆积） */
  getOrCreateDraftAgentSession: (channelId?: string, workspaceId?: string) => Promise<AgentSessionMeta>

  /** 获取 Agent 会话消息 */
  getAgentSessionMessages: (id: string) => Promise<AgentMessage[]>

  /** 获取 Agent 会话 SDKMessage（Phase 4 新格式） */
  getAgentSessionSDKMessages: (id: string) => Promise<SDKMessage[]>

  /** 更新 Agent 会话标题 */
  updateAgentSessionTitle: (id: string, title: string) => Promise<AgentSessionMeta>

  /** 删除 Agent 会话 */
  deleteAgentSession: (id: string) => Promise<void>

  /** 切换 Agent 会话置顶状态 */
  togglePinAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 切换 Agent 会话归档状态 */
  toggleArchiveAgentSession: (id: string) => Promise<AgentSessionMeta>

  /** 搜索 Agent 会话消息内容 */
  searchAgentSessionMessages: (query: string) => Promise<AgentMessageSearchResult[]>

  /** 分叉 Agent 会话 */
  forkAgentSession: (input: ForkSessionInput) => Promise<AgentSessionMeta>

  /** 快照回退（同一会话内回退到指定点，恢复文件 + 截断对话） */
  rewindSession: (input: RewindSessionInput) => Promise<RewindSessionResult>

  /** 发送 Agent 消息 */
  sendAgentMessage: (input: AgentSendInput) => Promise<void>

  /** 中止 Agent 执行 */
  stopAgent: (sessionId: string) => Promise<void>

  // ===== Agent 队列消息 =====

  /** 流式追加发送 Agent 消息（Agent 运行中） */
  queueAgentMessage: (input: AgentQueueMessageInput) => Promise<string>

  // ===== Agent 后台任务管理 =====

  /** 获取任务输出 */
  getTaskOutput: (input: GetTaskOutputInput) => Promise<GetTaskOutputResult>

  /** 停止任务 */
  stopTask: (input: StopTaskInput) => Promise<void>

  // ===== Agent 工作区管理相关 =====

  /** 获取 Agent 工作区列表 */
  listAgentWorkspaces: () => Promise<AgentWorkspace[]>

  /** 创建 Agent 工作区；sourceSlug 给定时继承其 MCP 配置 */
  createAgentWorkspace: (name: string, sourceSlug?: string) => Promise<AgentWorkspace>

  /** 更新 Agent 工作区 */
  updateAgentWorkspace: (id: string, updates: { name: string }) => Promise<AgentWorkspace>

  /** 删除 Agent 工作区 */
  deleteAgentWorkspace: (id: string) => Promise<void>

  /** 重排工作区顺序 */
  reorderAgentWorkspaces: (orderedIds: string[]) => Promise<AgentWorkspace[]>

  // ===== 工作区能力（MCP + Skill） =====

  /** 获取工作区能力摘要 */
  getWorkspaceCapabilities: (workspaceSlug: string) => Promise<WorkspaceCapabilities>

  /** 获取全局 MCP 配置 */
  getGlobalMcpConfig: () => Promise<GlobalMcpConfig>

  /** 保存全局 MCP 配置 */
  saveGlobalMcpConfig: (config: GlobalMcpConfig) => Promise<void>

  /** 订阅全局 MCP 配置变化事件 */
  onMcpGlobalChanged: (callback: () => void) => () => void

  /** 测试 MCP 服务器连接 */
  testMcpServer: (name: string, entry: import('@asci/shared').McpServerEntry) => Promise<{ success: boolean; message: string }>

  /** 获取工作区 Skill 列表（含活跃和不活跃） */
  getWorkspaceSkills: (workspaceSlug: string) => Promise<SkillMeta[]>

  /** 获取工作区 Skills 目录绝对路径 */
  getWorkspaceSkillsDir: (workspaceSlug: string) => Promise<string>

  /** 删除工作区 Skill */
  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => Promise<void>

  /** 切换工作区 Skill 启用/禁用 */
  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => Promise<void>

  /** 按 category 批量切换工作区 Skill 启用/禁用 */
  batchToggleSkillsByCategory: (
    req: import('@asci/shared').BatchToggleSkillsByCategoryInput,
  ) => Promise<import('@asci/shared').BatchToggleSkillsByCategoryResult>

  /** 获取其他工作区的 Skill 列表 */
  getOtherWorkspaceSkills: (currentSlug: string) => Promise<OtherWorkspaceSkillsGroup[]>

  /** 从其他工作区导入 Skill */
  importSkillFromWorkspace: (targetSlug: string, sourceSlug: string, skillSlug: string) => Promise<SkillMeta>

  /** 从源工作区同步更新已导入的 Skill */
  updateSkillFromSource: (targetSlug: string, skillSlug: string) => Promise<SkillMeta>

  /** 列出会话的论文检索记录（按 ts 倒序） */
  listSessionPapers: (sessionId: string) => Promise<{ records: PaperRecord[]; filePath: string }>

  /**
   * 订阅 session 论文集变化（live 检索进度 / canonical 正式落盘）。
   * 渲染侧应按 event.sessionId 过滤。返回清理函数。
   */
  onSessionPapersChanged: (callback: (event: SessionPapersChangedEvent) => void) => () => void

  /** 读取 session 的检索流式进度快照（retrieve 进行中才有；无/过期/损坏 → null） */
  getSessionPapersLive: (sessionId: string) => Promise<SessionPapersLive | null>

  /**
   * 订阅"打开 Zotero 批量导入对话框"事件（由 asci-zotero MCP 工具触发）。
   * 渲染侧应按 payload.sessionId 过滤后再勾选 recordKeys。返回清理函数。
   */
  onZoteroOpenBatchImport: (callback: (payload: ZoteroOpenBatchImportPayload) => void) => () => void

  /** 订阅 Agent 流式事件（返回清理函数） */
  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => () => void

  /** 订阅 Agent 流式完成事件 */
  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => () => void

  /** 订阅 Agent 流式错误事件 */
  onAgentStreamError: (callback: (data: { sessionId: string; startedAt?: number; error: string }) => void) => () => void

  /** 订阅 Agent 标题自动更新事件 */
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => () => void

  // ===== Agent 权限系统 =====

  /** 响应权限请求 */
  respondPermission: (response: PermissionResponse) => Promise<void>

  /** 获取工作区权限模式 */
  getPermissionMode: (workspaceSlug: string) => Promise<ASCIPermissionMode>

  /** 设置工作区权限模式 */
  setPermissionMode: (workspaceSlug: string, mode: ASCIPermissionMode) => Promise<void>

  /** 获取工作区推理深度 */
  getReasoningEffort: (workspaceSlug: string) => Promise<AgentEffort>

  /** 设置工作区推理深度 */
  setReasoningEffort: (workspaceSlug: string, effort: AgentEffort) => Promise<void>

  // ===== AskUserQuestion 交互式问答 =====

  /** 响应 AskUser 请求 */
  respondAskUser: (response: AskUserResponse) => Promise<void>

  // ===== ExitPlanMode 计划审批 =====

  /** 响应 ExitPlanMode 请求 */
  respondExitPlanMode: (response: ExitPlanModeResponse) => Promise<void>

  /** 响应 lit-review present_directions 请求（spec §5.4 Turn 1）*/
  respondLitReviewPresentDirections: (response: LitReviewPresentDirectionsResponse) => Promise<void>

  /** 响应检索方案确认请求（issue #435）*/
  respondSearchPlan: (response: SearchPlanConfirmResponse) => Promise<void>

  /** 获取所有待处理的交互请求快照（渲染进程重载后恢复状态） */
  getPendingRequests: () => Promise<PendingRequestsSnapshot>

  // ===== Agent Teams 数据 =====

  /** 获取 Team 聚合数据（团队配置 + 任务列表 + 收件箱） */
  getAgentTeamData: (sdkSessionId: string) => Promise<AgentTeamData | null>

  /** 读取 Teammate 输出文件内容 */
  getAgentOutput: (filePath: string) => Promise<string>

  // ===== 工作区文件变化通知 =====

  onCapabilitiesChanged: (callback: () => void) => () => void
  onWorkspaceFilesChanged: (callback: () => void) => () => void

  // ===== Agent 附件 =====

  /** 保存文件到 Agent session 工作目录 */
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => Promise<AgentSavedFile[]>

  /** 保存文件到工作区文件目录 */
  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => Promise<AgentSavedFile[]>

  /** 列出工作区最近 N 个文件（左侧 Sidebar 项目文件面板使用） */
  listRecentWorkspaceFiles: (input: ListRecentWorkspaceFilesInput) => Promise<ListRecentWorkspaceFilesOutput>

  /** 获取工作区文件目录路径 */
  getWorkspaceFilesPath: (workspaceSlug: string) => Promise<string>

  /** 打开文件夹选择对话框 */
  openFolderDialog: () => Promise<{ path: string; name: string } | null>

  /** 附加外部目录到工作区（所有会话可访问） */
  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 移除工作区的附加目录 */
  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => Promise<string[]>

  /** 获取工作区附加目录列表 */
  getWorkspaceDirectories: (workspaceSlug: string) => Promise<string[]>

  // ===== Agent 文件系统操作 =====

  /** 获取 session 工作路径 */
  getAgentSessionPath: (workspaceId: string, sessionId: string) => Promise<string | null>

  /** 列出目录内容 */
  listDirectory: (dirPath: string, options?: ListDirectoryOptions) => Promise<ListDirectoryResult>

  /** 删除文件/目录 */
  deleteFile: (filePath: string) => Promise<void>

  /** 用系统默认应用打开文件 */
  openFile: (filePath: string) => Promise<void>

  /** 在系统文件管理器中显示文件 */
  showInFolder: (filePath: string) => Promise<void>

  /** 在新窗口中预览文件 */
  previewFile: (filePath: string) => Promise<void>

  /** 手动解析综述 HTML 的 cite/q → 落 evidence_refs / evidence_set；dev 测试按钮用 */
  reviewReparseCitations: (bodyPath: string) => Promise<{
    reviewId: string
    refCount: number
    paperCount: number
    evidenceSetId: string | null
    refsMissingPaper: number[]
    citesUnresolved: number[]
    papersNotInDb: string[]
    replacedExisting: boolean
  }>

  /** 获取文件元信息（大小、是否目录） */
  statFile: (filePath: string) => Promise<{ size: number; isDirectory: boolean }>

  /** 读取文本文件内容（支持截断上限） */
  previewOpenHtml: (filePath: string) => Promise<string>
  previewReadText: (filePath: string, maxBytes?: number) => Promise<PreviewReadTextResult>

  /** 读取文件为 base64 字符串 */
  previewReadBinary: (filePath: string) => Promise<string>

  /** 解析 Jupyter Notebook 为结构化单元格 */
  previewParseNotebook: (filePath: string) => Promise<PreviewParseNotebookResult>

  /** 解析 Office 文档为纯文本 */
  previewParseOffice: (filePath: string) => Promise<string>

  /** 下载论文 PDF 到本地缓存（供右栏预览） */
  previewDownloadPdf: (input: PreviewDownloadPdfInput) => Promise<PreviewDownloadPdfResult>

  /** 下载论文 PDF 到系统下载文件夹（用户可见，下载后在访达定位） */
  downloadPdfLocal: (input: PreviewDownloadPdfInput) => Promise<DownloadPdfLocalResult>

  /** 重命名文件/目录 */
  renameFile: (filePath: string, newName: string) => Promise<void>

  /** 移动文件/目录到目标目录 */
  moveFile: (filePath: string, targetDir: string) => Promise<void>

  /** 列出附加目录内容（无工作区路径限制） */
  listAttachedDirectory: (dirPath: string) => Promise<ListDirectoryResult>

  /** 用系统默认应用打开附加目录文件（无工作区路径限制） */
  openAttachedFile: (filePath: string) => Promise<void>

  /** 在文件管理器中显示附加目录文件（无工作区路径限制） */
  showAttachedInFolder: (filePath: string) => Promise<void>

  /** 重命名附加目录文件/目录（无工作区路径限制） */
  renameAttachedFile: (filePath: string, newName: string) => Promise<void>

  /** 移动附加目录文件/目录（无工作区路径限制） */
  moveAttachedFile: (filePath: string, targetDir: string) => Promise<void>

  /** 检查路径类型（文件 or 目录），用于拖拽检测 */
  checkPathsType: (paths: string[]) => Promise<{ directories: string[]; files: string[] }>

  /** 获取拖拽文件的本地路径（替代已废弃的 File.path） */
  getPathForFile: (file: File) => string

  /** 搜索工作区文件（用于 @ 引用，支持附加目录） */
  searchWorkspaceFiles: (rootPath: string, query: string, limit?: number, additionalPaths?: string[]) => Promise<FileSearchResult>
}

export const agentApi: AgentApi = {
  // Agent 会话管理
  listAgentSessions: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SESSIONS)
  },

  createAgentSession: (title?: string, channelId?: string, workspaceId?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_SESSION, title, channelId, workspaceId)
  },

  getOrCreateDraftAgentSession: (channelId?: string, workspaceId?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_OR_CREATE_DRAFT_SESSION, channelId, workspaceId)
  },

  getAgentSessionMessages: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_MESSAGES, id)
  },

  getAgentSessionSDKMessages: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SDK_MESSAGES, id)
  },

  updateAgentSessionTitle: (id: string, title: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_TITLE, id, title)
  },

  deleteAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SESSION, id)
  },

  togglePinAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_PIN, id)
  },

  toggleArchiveAgentSession: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE, id)
  },

  searchAgentSessionMessages: (query: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_MESSAGES, query)
  },

  forkAgentSession: (input: ForkSessionInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.FORK_SESSION, input)
  },

  rewindSession: (input: RewindSessionInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.REWIND_SESSION, input)
  },

  sendAgentMessage: (input: AgentSendInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEND_MESSAGE, input)
  },

  stopAgent: (sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_AGENT, sessionId)
  },

  // Agent 队列消息
  queueAgentMessage: (input: AgentQueueMessageInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.QUEUE_MESSAGE, input)
  },

  // Agent 后台任务管理
  getTaskOutput: (input: GetTaskOutputInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_TASK_OUTPUT, input)
  },

  stopTask: (input: StopTaskInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.STOP_TASK, input)
  },

  // Agent 工作区管理
  listAgentWorkspaces: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_WORKSPACES)
  },

  createAgentWorkspace: (name: string, sourceSlug?: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CREATE_WORKSPACE, name, sourceSlug)
  },

  updateAgentWorkspace: (id: string, updates: { name: string }) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.UPDATE_WORKSPACE, id, updates)
  },

  deleteAgentWorkspace: (id: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_WORKSPACE, id)
  },

  reorderAgentWorkspaces: (orderedIds: string[]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.REORDER_WORKSPACES, orderedIds)
  },

  // 工作区能力（MCP + Skill）
  getWorkspaceCapabilities: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_CAPABILITIES, workspaceSlug)
  },

  getGlobalMcpConfig: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_MCP_CONFIG)
  },

  saveGlobalMcpConfig: (config: GlobalMcpConfig) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG, config)
  },

  onMcpGlobalChanged: (callback: () => void) => {
    return subscribe(AGENT_IPC_CHANNELS.MCP_GLOBAL_CHANGED, callback)
  },

  testMcpServer: (name: string, entry: import('@asci/shared').McpServerEntry) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TEST_MCP_SERVER, name, entry) as Promise<{ success: boolean; message: string }>
  },

  getWorkspaceSkills: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS, workspaceSlug)
  },

  getWorkspaceSkillsDir: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SKILLS_DIR, workspaceSlug)
  },

  deleteWorkspaceSkill: (workspaceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_SKILL, workspaceSlug, skillSlug)
  },

  toggleWorkspaceSkill: (workspaceSlug: string, skillSlug: string, enabled: boolean) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.TOGGLE_SKILL, workspaceSlug, skillSlug, enabled)
  },

  batchToggleSkillsByCategory: (
    req: import('@asci/shared').BatchToggleSkillsByCategoryInput,
  ): Promise<import('@asci/shared').BatchToggleSkillsByCategoryResult> => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.BATCH_TOGGLE_SKILL_BY_CATEGORY, req)
  },

  getOtherWorkspaceSkills: (currentSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS, currentSlug)
  },

  importSkillFromWorkspace: (targetSlug: string, sourceSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE,
      targetSlug,
      sourceSlug,
      skillSlug,
    )
  },

  updateSkillFromSource: (targetSlug: string, skillSlug: string) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE,
      targetSlug,
      skillSlug,
    )
  },

  listSessionPapers: (sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_SESSION_PAPERS, sessionId) as Promise<{
      records: PaperRecord[]
      filePath: string
    }>
  },

  onSessionPapersChanged: (callback: (event: SessionPapersChangedEvent) => void) => {
    return subscribe(AGENT_IPC_CHANNELS.SESSION_PAPERS_CHANGED, callback)
  },

  getSessionPapersLive: (sessionId: string) => {
    return ipcRenderer.invoke(
      AGENT_IPC_CHANNELS.GET_SESSION_PAPERS_LIVE,
      sessionId,
    ) as Promise<SessionPapersLive | null>
  },

  onAgentStreamEvent: (callback: (event: AgentStreamEvent) => void) => {
    return subscribe(AGENT_IPC_CHANNELS.STREAM_EVENT, callback)
  },

  onZoteroOpenBatchImport: (callback: (payload: ZoteroOpenBatchImportPayload) => void) => {
    return subscribe(AGENT_IPC_CHANNELS.ZOTERO_OPEN_BATCH_IMPORT, callback)
  },

  onAgentStreamComplete: (callback: (data: AgentStreamCompletePayload) => void) => {
    return subscribe(AGENT_IPC_CHANNELS.STREAM_COMPLETE, callback)
  },

  onAgentStreamError: (callback: (data: { sessionId: string; startedAt?: number; error: string }) => void) => {
    return subscribe(AGENT_IPC_CHANNELS.STREAM_ERROR, callback)
  },

  // 标题自动更新通知
  onAgentTitleUpdated: (callback: (data: { sessionId: string; title: string }) => void) => {
    return subscribe(AGENT_IPC_CHANNELS.TITLE_UPDATED, callback)
  },

  // Agent 权限系统
  respondPermission: (response: PermissionResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.PERMISSION_RESPOND, response)
  },

  getPermissionMode: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_PERMISSION_MODE, workspaceSlug)
  },

  setPermissionMode: (workspaceSlug: string, mode: ASCIPermissionMode) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SET_PERMISSION_MODE, workspaceSlug, mode)
  },

  getReasoningEffort: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_REASONING_EFFORT, workspaceSlug)
  },

  setReasoningEffort: (workspaceSlug: string, effort: AgentEffort) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SET_REASONING_EFFORT, workspaceSlug, effort)
  },

  // AskUserQuestion 交互式问答
  respondAskUser: (response: AskUserResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ASK_USER_RESPOND, response)
  },

  // ExitPlanMode 计划审批
  respondExitPlanMode: (response: ExitPlanModeResponse) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND, response)
  },

  // lit-review present_directions (spec §5.4 Turn 1 ChoiceCard)
  respondLitReviewPresentDirections: (response: LitReviewPresentDirectionsResponse) => {
    return ipcRenderer.invoke(LITREVIEW_IPC_CHANNELS.RESPOND, response)
  },

  // lit-search present_search_plan 检索方案确认 (issue #435)
  respondSearchPlan: (response: SearchPlanConfirmResponse) => {
    return ipcRenderer.invoke(SEARCH_PLAN_IPC_CHANNELS.RESPOND, response)
  },

  // 待处理请求恢复
  getPendingRequests: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS)
  },

  // Agent Teams 数据
  getAgentTeamData: (sdkSessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_TEAM_DATA, sdkSessionId)
  },

  getAgentOutput: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_AGENT_OUTPUT, filePath)
  },

  // 工作区文件变化通知
  onCapabilitiesChanged: (callback: () => void) => {
    return subscribe(AGENT_IPC_CHANNELS.CAPABILITIES_CHANGED, callback)
  },

  onWorkspaceFilesChanged: (callback: () => void) => {
    return subscribe(AGENT_IPC_CHANNELS.WORKSPACE_FILES_CHANGED, callback)
  },

  // Agent 附件
  saveFilesToAgentSession: (input: AgentSaveFilesInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION, input)
  },

  saveFilesToWorkspaceFiles: (input: AgentSaveWorkspaceFilesInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE, input)
  },

  listRecentWorkspaceFiles: (input: ListRecentWorkspaceFilesInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_RECENT_WORKSPACE_FILES, input) as Promise<ListRecentWorkspaceFilesOutput>
  },

  getWorkspaceFilesPath: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH, workspaceSlug)
  },

  openFolderDialog: () => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG)
  },

  attachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY, input)
  },

  detachWorkspaceDirectory: (input: WorkspaceAttachDirectoryInput) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY, input)
  },

  getWorkspaceDirectories: (workspaceSlug: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES, workspaceSlug)
  },

  // Agent 文件系统操作
  getAgentSessionPath: (workspaceId: string, sessionId: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.GET_SESSION_PATH, workspaceId, sessionId)
  },

  listDirectory: (dirPath: string, options?: ListDirectoryOptions) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_DIRECTORY, dirPath, options)
  },

  deleteFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.DELETE_FILE, filePath)
  },

  openFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_FILE, filePath)
  },

  showInFolder: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_IN_FOLDER, filePath)
  },

  previewFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_FILE, filePath)
  },

  reviewReparseCitations: (bodyPath: string) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.REVIEW_REPARSE_CITATIONS, bodyPath),

  statFile: (filePath) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.STAT_FILE, filePath),

  previewOpenHtml: (filePath) => ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_OPEN_HTML, filePath),
  previewReadText: (filePath, maxBytes) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_READ_TEXT, filePath, maxBytes),

  previewReadBinary: (filePath) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_READ_BINARY, filePath),

  previewParseNotebook: (filePath) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_PARSE_NOTEBOOK, filePath),

  previewParseOffice: (filePath) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_PARSE_OFFICE, filePath),

  previewDownloadPdf: (input) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.PREVIEW_DOWNLOAD_PDF, input),

  downloadPdfLocal: (input) =>
    ipcRenderer.invoke(AGENT_IPC_CHANNELS.DOWNLOAD_PDF_LOCAL, input),

  renameFile: (filePath: string, newName: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_FILE, filePath, newName)
  },

  moveFile: (filePath: string, targetDir: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_FILE, filePath, targetDir)
  },

  listAttachedDirectory: (dirPath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY, dirPath)
  },

  openAttachedFile: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.OPEN_ATTACHED_FILE, filePath)
  },

  showAttachedInFolder: (filePath: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER, filePath)
  },

  renameAttachedFile: (filePath: string, newName: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE, filePath, newName)
  },

  moveAttachedFile: (filePath: string, targetDir: string) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE, filePath, targetDir)
  },

  checkPathsType: (paths: string[]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE, paths)
  },

  getPathForFile: (file: File) => {
    return webUtils.getPathForFile(file)
  },

  searchWorkspaceFiles: (rootPath: string, query: string, limit = 20, additionalPaths?: string[]) => {
    return ipcRenderer.invoke(AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES, rootPath, query, limit, additionalPaths)
  },
}
