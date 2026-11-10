import { readContextRecord, writeContextRecord, validateContextPins, deleteContextRecord } from '../lib/context-retention'
/**
 * Agent 会话 / 工作区 / 能力 / 消息 / 权限 IPC 处理器
 *
 * 汇集 Agent 会话 CRUD、工作区管理、工作区能力（MCP + Skill）、消息发送与排队、
 * 权限系统、AskUser / ExitPlanMode / lit-review / search-plan 交互回填、任务输出、
 * Agent Teams 数据、Agent 附件与文件目录管理相关的 IPC 通道，并挂载启动自动归档定时器。
 */

import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  AGENT_IPC_CHANNELS,
  ASCI_PERMISSION_MODE_ORDER,
  isValidAgentEffort,
  LITREVIEW_IPC_CHANNELS,
  SEARCH_PLAN_IPC_CHANNELS,
} from '@asci/shared'
import type {
  AgentSessionMeta,
  AgentMessage,
  AgentSendInput,
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
  WorkspaceCapabilities,
  PermissionResponse,
  ASCIPermissionMode,
  AgentEffort,
  AskUserResponse,
  ExitPlanModeResponse,
  LitReviewPresentDirectionsResponse,
  SearchPlanConfirmResponse,
  AgentTeamData,
  ForkSessionInput,
  RewindSessionInput,
  RewindSessionResult,
  SDKMessage,
} from '@asci/shared'
import { t as tMain } from '../lib/i18n-main'
import {
  listAgentSessions,
  createAgentSession,
  getOrCreateDraftAgentSession,
  getAgentSessionMeta,
  getAgentSessionMessages,
  getAgentSessionSDKMessages,
  updateAgentSessionMeta,
  deleteAgentSession,
  forkAgentSession,
  autoArchiveAgentSessions,
  searchAgentSessionMessages,
} from '../lib/agent-session-manager'
import { resolveArchiveDays } from '../lib/auto-archive-config.ts'
import { runAgent, stopAgent, saveFilesToAgentSession, saveFilesToWorkspaceFiles, isAgentSessionActive, queueAgentMessage, updateAgentPermissionMode, rewindAgentSession } from '../lib/agent-service'
import { detectIntentSwitch } from '../lib/detect-intent-switch.ts'
import { permissionService } from '../lib/agent-permission-service'
import { askUserService } from '../lib/agent-ask-user-service'
import { exitPlanService } from '../lib/agent-exit-plan-service'
import { litReviewDirectionsService } from '../lib/agent-litreview-directions-service'
import { searchPlanService } from '../lib/agent-search-plan-service'
import { getAgentTeamData, readAgentOutputFile } from '../lib/agent-team-reader'
import { listSessionPapers } from '../lib/paper-result-recorder'
import { listRecentWorkspaceFiles } from '../lib/workspace-recent-files'
import { getWorkspaceSkillsDir, getWorkspaceFilesDir } from '../lib/config-paths'
import {
  listAgentWorkspaces,
  createAgentWorkspace,
  updateAgentWorkspace,
  deleteAgentWorkspace,
  reorderAgentWorkspaces,
  ensureDefaultWorkspace,
  getAllWorkspaceSkills,
  getOtherWorkspaceSkills,
  getWorkspaceCapabilities,
  getAgentWorkspace,
  deleteWorkspaceSkill,
  importSkillFromWorkspace,
  updateSkillFromSource,
  toggleWorkspaceSkill,
  batchToggleByCategory,
  getWorkspacePermissionMode,
  setWorkspacePermissionMode,
  getWorkspaceReasoningEffort,
  setWorkspaceReasoningEffort,
  getWorkspaceAttachedDirectories,
  attachWorkspaceDirectory,
  detachWorkspaceDirectory,
} from '../lib/agent-workspace-manager'
import { getGlobalMcpConfig, saveGlobalMcpConfig } from '../lib/mcp/global-config.ts'
import { watchAttachedDirectory, unwatchAttachedDirectory } from '../lib/workspace-watcher'
import { getSettings } from '../lib/settings-service'

/** 注册 Agent 会话 / 工作区 / 能力 / 消息 / 权限 IPC 处理器 */
export function registerAgentSessionIpc(): void {
  ipcMain.handle('context:read', (_event, id: string) => readContextRecord(id))
  ipcMain.handle('context:pins', (_event, id: string, pins: unknown) => {
    const record = readContextRecord(id)
    return writeContextRecord(id, { ...record, pins: validateContextPins(pins) })
  })
  // ===== Agent 会话管理相关 =====

  // 获取 Agent 会话列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SESSIONS,
    async (): Promise<AgentSessionMeta[]> => {
      return listAgentSessions()
    }
  )

  // 创建 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_SESSION,
    async (_, title?: string, channelId?: string, workspaceId?: string): Promise<AgentSessionMeta> => {
      return createAgentSession(title, channelId, workspaceId)
    }
  )

  // 获取或创建工作区下的草稿会话（复用空会话，避免堆积）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_OR_CREATE_DRAFT_SESSION,
    async (_, channelId?: string, workspaceId?: string): Promise<AgentSessionMeta> => {
      return getOrCreateDraftAgentSession(channelId, workspaceId)
    }
  )

  // 获取 Agent 会话消息
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_MESSAGES,
    async (_, id: string): Promise<AgentMessage[]> => {
      return getAgentSessionMessages(id)
    }
  )

  // 获取 Agent 会话 SDKMessage（Phase 4 新格式）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SDK_MESSAGES,
    async (_, id: string): Promise<SDKMessage[]> => {
      return getAgentSessionSDKMessages(id)
    }
  )

  // 更新 Agent 会话标题
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_TITLE,
    async (_, id: string, title: string): Promise<AgentSessionMeta> => {
      return updateAgentSessionMeta(id, { title })
    }
  )

  // 删除 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SESSION,
    async (_, id: string): Promise<void> => {
      // 清理权限服务中该会话的白名单
      permissionService.clearSessionWhitelist(id)
      permissionService.clearSessionPending(id)
      // 清理 AskUser 服务中的待处理请求
      askUserService.clearSessionPending(id)
      // 清理 ExitPlanMode 服务中的待处理请求
      exitPlanService.clearSessionPending(id)
      // 清理检索方案确认服务中的待处理请求（issue #435）
      searchPlanService.clearSessionPending(id)
      deleteContextRecord(id)
      return deleteAgentSession(id)
    }
  )

  // 切换 Agent 会话置顶状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_PIN,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent 会话不存在: ${id}`)
      const newPinned = !current.pinned
      // 置顶时自动取消归档
      const updates: Partial<AgentSessionMeta> = { pinned: newPinned }
      if (newPinned && current.archived) {
        updates.archived = false
      }
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 切换 Agent 会话归档状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent 会话不存在: ${id}`)
      const newArchived = !current.archived
      // 归档时自动取消置顶
      const updates: Partial<AgentSessionMeta> = { archived: newArchived }
      if (newArchived && current.pinned) {
        updates.pinned = false
      }
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 搜索 Agent 会话消息内容
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_MESSAGES,
    async (_, query: string) => {
      return searchAgentSessionMessages(query)
    }
  )

  // 分叉 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.FORK_SESSION,
    async (_, input: ForkSessionInput): Promise<AgentSessionMeta> => {
      return forkAgentSession(input)
    }
  )

  // 快照回退（同一会话内回退到指定点）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REWIND_SESSION,
    async (_, input: RewindSessionInput): Promise<RewindSessionResult> => {
      return rewindAgentSession(
        input.sessionId,
        input.assistantMessageUuid,
      )
    }
  )

  // ===== Agent 工作区管理相关 =====

  // 确保默认工作区存在
  ensureDefaultWorkspace()

  // 获取 Agent 工作区列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_WORKSPACES,
    async (): Promise<AgentWorkspace[]> => {
      return listAgentWorkspaces()
    }
  )

  // 创建 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_WORKSPACE,
    async (_, name: string, sourceSlug?: string): Promise<AgentWorkspace> => {
      return createAgentWorkspace(name, sourceSlug)
    }
  )

  // 更新 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_WORKSPACE,
    async (_, id: string, updates: { name: string }): Promise<AgentWorkspace> => {
      return updateAgentWorkspace(id, updates)
    }
  )

  // 删除 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_WORKSPACE,
    async (_, id: string): Promise<void> => {
      return deleteAgentWorkspace(id)
    }
  )

  // 重排工作区顺序
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REORDER_WORKSPACES,
    async (_, orderedIds: string[]): Promise<AgentWorkspace[]> => {
      return reorderAgentWorkspaces(orderedIds)
    }
  )

  // ===== 工作区能力（MCP + Skill） =====

  // 获取工作区能力摘要
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_CAPABILITIES,
    async (_, workspaceSlug: string): Promise<WorkspaceCapabilities> => {
      return getWorkspaceCapabilities(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_MCP_CONFIG,
    async (): Promise<GlobalMcpConfig> => {
      return getGlobalMcpConfig()
    },
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG,
    async (_, config: GlobalMcpConfig): Promise<void> => {
      return saveGlobalMcpConfig(config)
    },
  )

  // 测试 MCP 服务器连接
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TEST_MCP_SERVER,
    async (_, name: string, entry: import('@asci/shared').McpServerEntry): Promise<{ success: boolean; message: string }> => {
      const { validateMcpServer } = await import('../lib/mcp-validator')
      const result = await validateMcpServer(name, entry)
      return {
        success: result.valid,
        message: result.valid
          ? tMain('errors.mcpTest.success')
          : (result.reason || tMain('errors.mcpTest.failed')),
      }
    }
  )

  // 获取工作区 Skill 列表（含活跃和不活跃，设置页 UI 用）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS,
    async (_, workspaceSlug: string): Promise<SkillMeta[]> => {
      return getAllWorkspaceSkills(workspaceSlug)
    }
  )

  // 获取工作区 Skills 目录绝对路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS_DIR,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceSkillsDir(workspaceSlug)
    }
  )

  // 删除工作区 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string): Promise<void> => {
      return deleteWorkspaceSkill(workspaceSlug, skillSlug)
    }
  )

  // 切换工作区 Skill 启用/禁用
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled)
    }
  )

  // 按 category 批量切换工作区 Skill 启用/禁用
  ipcMain.handle(
    AGENT_IPC_CHANNELS.BATCH_TOGGLE_SKILL_BY_CATEGORY,
    async (_, req: import('@asci/shared').BatchToggleSkillsByCategoryInput) => {
      return batchToggleByCategory(req.workspaceSlug, req.category, req.enable, req.onlySlugs)
    }
  )

  // 获取其他工作区的 Skill 列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS,
    async (_, currentSlug: string) => {
      return getOtherWorkspaceSkills(currentSlug)
    }
  )

  // 从其他工作区导入 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE,
    async (_, targetSlug: string, sourceSlug: string, skillSlug: string): Promise<SkillMeta> => {
      return importSkillFromWorkspace(targetSlug, sourceSlug, skillSlug)
    }
  )

  // 从源工作区同步更新已导入的 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE,
    async (_, targetSlug: string, skillSlug: string): Promise<SkillMeta> => {
      return updateSkillFromSource(targetSlug, skillSlug)
    }
  )

  // 列出工作区最近 N 个文件（左侧 Sidebar 项目文件面板使用）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_RECENT_WORKSPACE_FILES,
    async (_, input: import('@asci/shared').ListRecentWorkspaceFilesInput): Promise<import('@asci/shared').ListRecentWorkspaceFilesOutput> => {
      return listRecentWorkspaceFiles(input.workspaceSlug, input.limit)
    }
  )

  // 列出指定会话的论文检索记录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SESSION_PAPERS,
    async (_, sessionId: string) => {
      return listSessionPapers(sessionId)
    }
  )

  // 读取指定会话的检索流式进度快照（retrieve 进行中才有；无/过期 → null）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SESSION_PAPERS_LIVE,
    async (_, sessionId: string) => {
      const { readSessionPapersLive } = await import('../lib/session-papers-live')
      return readSessionPapersLive(sessionId)
    }
  )

  // 发送 Agent 消息（触发 Agent SDK 流式响应）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEND_MESSAGE,
    async (event, input: AgentSendInput): Promise<void> => {
      // A4 phase4: 启发式判断意图切换，命中则清空 sticky
      const intentResult = detectIntentSwitch(input.userMessage)
      if (intentResult.shouldClearSticky && input.sessionId) {
        try {
          updateAgentSessionMeta(input.sessionId, { stickyCapabilityPackId: undefined })
          console.log(`[IPC] 清 sticky: matched=${intentResult.matchedRule}, sessionId=${input.sessionId}`)
        } catch (err) {
          console.warn('[IPC] 清 sticky 失败', err)
        }
      }
      try {
        await runAgent(input, event.sender)
      } finally {
        const context = readContextRecord(input.sessionId)
        if (context.status === 'working') writeContextRecord(input.sessionId, { ...context, status: 'failed', error: 'No compaction summary was returned. Please retry.' })
      }
    }
  )

  // 中止 Agent 执行
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_AGENT,
    async (_, sessionId: string): Promise<void> => {
      stopAgent(sessionId)
    }
  )

  // ===== Agent 队列消息 =====

  // 排队发送消息
  ipcMain.handle(
    AGENT_IPC_CHANNELS.QUEUE_MESSAGE,
    async (event, input: import('@asci/shared').AgentQueueMessageInput): Promise<string> => {
      return queueAgentMessage(input, event.sender)
    }
  )

  // ===== Agent 后台任务管理 =====

  // 获取任务输出（保留接口，供未来扩展）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_TASK_OUTPUT,
    async (_, input: GetTaskOutputInput): Promise<GetTaskOutputResult> => {
      try {
        // TODO: 实现通过 SDK 的 TaskOutput 获取任务输出
        console.warn('[IPC] GET_TASK_OUTPUT: 当前版本暂未实现，返回空输出')
        return {
          output: '',
          isComplete: false,
        }
      } catch (error) {
        console.error('[IPC] 获取任务输出失败:', error)
        throw error
      }
    }
  )

  // ===== Agent 权限系统 =====

  // 响应权限请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PERMISSION_RESPOND,
    async (event, response: PermissionResponse): Promise<void> => {
      const { requestId, behavior, alwaysAllow } = response
      const sessionId = permissionService.respondToPermission(requestId, behavior, alwaysAllow)

      // 发送 permission_resolved 事件给渲染进程
      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'asci_event', event: { type: 'permission_resolved', requestId, behavior } },
        })
      }
    }
  )

  // 停止任务
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_TASK,
    async (_, input: StopTaskInput): Promise<void> => {
      try {
        if (input.type === 'shell') {
          console.warn('[IPC] STOP_TASK: Shell 任务停止功能待实现')
        } else {
          console.warn('[IPC] STOP_TASK: Agent 任务暂不支持单独停止')
        }
      } catch (error) {
        console.error('[IPC] 停止任务失败:', error)
        throw error
      }
    }
  )

  // 获取工作区权限模式
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PERMISSION_MODE,
    async (_, workspaceSlug: string): Promise<ASCIPermissionMode> => {
      return getWorkspacePermissionMode(workspaceSlug)
    }
  )

  // 设置工作区权限模式（同时更新运行中的活跃 session）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_PERMISSION_MODE,
    async (_, workspaceSlug: string, mode: ASCIPermissionMode): Promise<void> => {
      const validModes = new Set<string>(ASCI_PERMISSION_MODE_ORDER)
      if (!validModes.has(mode)) {
        throw new Error(`无效的权限模式: ${mode}`)
      }
      // 持久化到工作区配置
      setWorkspacePermissionMode(workspaceSlug, mode)
      // 同步更新该工作区下所有运行中的 session
      const sessions = listAgentSessions()
      for (const session of sessions) {
        if (!session.workspaceId || !isAgentSessionActive(session.id)) continue
        const sessionWs = getAgentWorkspace(session.workspaceId)
        if (sessionWs?.slug === workspaceSlug) {
          updateAgentPermissionMode(session.id, mode).catch((err) => {
            console.warn(`[IPC] 运行中权限模式切换失败: sessionId=${session.id}`, err)
          })
        }
      }
    }
  )

  // 获取工作区推理深度
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_REASONING_EFFORT,
    async (_, workspaceSlug: string): Promise<AgentEffort> => {
      return getWorkspaceReasoningEffort(workspaceSlug)
    }
  )

  // 设置工作区推理深度（仅落盘，下次 sendMessage 透传生效，无需热更新运行中 session）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_REASONING_EFFORT,
    async (_, workspaceSlug: string, effort: AgentEffort): Promise<void> => {
      if (!isValidAgentEffort(effort)) {
        throw new Error(`无效的推理深度: ${effort}`)
      }
      setWorkspaceReasoningEffort(workspaceSlug, effort)
    }
  )

  // ===== AskUserQuestion 交互式问答 =====

  // 响应 AskUser 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ASK_USER_RESPOND,
    async (event, response: AskUserResponse): Promise<void> => {
      const { requestId, answers } = response
      const sessionId = askUserService.respondToAskUser(requestId, answers)

      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'asci_event', event: { type: 'ask_user_resolved', requestId } },
        })
      }
    }
  )

  // ===== lit-review present_directions（spec §5.4 Turn 1 ChoiceCard）=====

  // 响应 lit-review present_directions 请求（renderer → main 回填用户选择）
  ipcMain.handle(
    LITREVIEW_IPC_CHANNELS.RESPOND,
    async (event, response: LitReviewPresentDirectionsResponse): Promise<void> => {
      const result = litReviewDirectionsService.respondPresentDirections({ requestId: response.requestId, choice: 'cancel' })
      if (result) {
        // 通知 renderer：请求已被本地 service 处理（resolved 流转给 SDK tool handler）
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId: result.sessionId,
          payload: { kind: 'asci_event', event: { type: 'litreview_present_directions_resolved', requestId: response.requestId } },
        })
      }
    }
  )

  // ===== lit-search present_search_plan 检索方案确认（issue #435）=====

  // 响应检索方案确认请求（renderer → main 回填用户操作）
  ipcMain.handle(
    SEARCH_PLAN_IPC_CHANNELS.RESPOND,
    async (event, response: SearchPlanConfirmResponse): Promise<void> => {
      const result = searchPlanService.respondConfirm({ requestId: response.requestId, choice: 'cancel' })
      if (result) {
        // 通知 renderer：请求已被本地 service 处理（resolved 流转给 SDK tool handler）
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId: result.sessionId,
          payload: { kind: 'asci_event', event: { type: 'search_plan_resolved', requestId: response.requestId } },
        })
      }
    }
  )

  // ===== ExitPlanMode 计划审批 =====

  // 响应 ExitPlanMode 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND,
    async (event, response: ExitPlanModeResponse): Promise<void> => {
      const result = exitPlanService.respondToExitPlanMode(response)

      if (result) {
        const { sessionId, targetMode } = result

        // 通知渲染进程请求已处理
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'asci_event', event: { type: 'exit_plan_mode_resolved', requestId: response.requestId } },
        })

        // 如果用户选择了新的权限模式，通知渲染进程更新 UI
        if (targetMode) {
          const meta = getAgentSessionMeta(sessionId)
          if (meta?.workspaceId) {
            const ws = getAgentWorkspace(meta.workspaceId)
            if (ws) {
              setWorkspacePermissionMode(ws.slug, targetMode)
            }
          }
          event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
            sessionId,
            payload: { kind: 'asci_event', event: { type: 'permission_mode_changed', mode: targetMode } },
          })
          console.log(`[IPC] ExitPlanMode 权限模式切换: ${targetMode}`)
        }
      }
    }
  )

  // ===== 待处理请求恢复 =====

  // 获取所有待处理的交互请求快照（渲染进程重载后恢复状态）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS,
    async (): Promise<import('@asci/shared').PendingRequestsSnapshot> => {
      return {
        permissions: permissionService.getPendingRequests(),
        askUsers: askUserService.getPendingRequests(),
        exitPlans: exitPlanService.getPendingRequests(),
      }
    }
  )

  // ===== Agent Teams 数据 =====

  // 获取 Team 聚合数据（团队配置 + 任务列表 + 收件箱）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_TEAM_DATA,
    async (_, sdkSessionId: string): Promise<AgentTeamData | null> => {
      return getAgentTeamData(sdkSessionId)
    }
  )

  // 读取 Teammate 输出文件内容
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_AGENT_OUTPUT,
    async (_, filePath: string): Promise<string> => {
      return readAgentOutputFile(filePath)
    }
  )

  // ===== Agent 附件 =====

  // 保存文件到 Agent session 工作目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_FILES_TO_SESSION,
    async (_, input: AgentSaveFilesInput): Promise<AgentSavedFile[]> => {
      return saveFilesToAgentSession(input)
    }
  )

  // 保存文件到工作区文件目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_FILES_TO_WORKSPACE,
    async (_, input: AgentSaveWorkspaceFilesInput): Promise<AgentSavedFile[]> => {
      return saveFilesToWorkspaceFiles(input)
    }
  )

  // 获取工作区文件目录路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_FILES_PATH,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceFilesDir(workspaceSlug)
    }
  )

  // 打开文件夹选择对话框
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FOLDER_DIALOG,
    async (): Promise<{ path: string; name: string } | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!win) return null

      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: tMain('chrome.dialog.selectFolder'),
      })

      if (result.canceled || result.filePaths.length === 0) return null

      const folderPath = result.filePaths[0]!
      const name = folderPath.split('/').filter(Boolean).pop() || 'folder'
      return { path: folderPath, name }
    }
  )

  // 附加外部目录到工作区（所有会话可访问）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ATTACH_WORKSPACE_DIRECTORY,
    async (_, input: WorkspaceAttachDirectoryInput): Promise<string[]> => {
      const updated = attachWorkspaceDirectory(input.workspaceSlug, input.directoryPath)
      watchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  // 移除工作区的附加目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DETACH_WORKSPACE_DIRECTORY,
    async (_, input: WorkspaceAttachDirectoryInput): Promise<string[]> => {
      const updated = detachWorkspaceDirectory(input.workspaceSlug, input.directoryPath)
      unwatchAttachedDirectory(input.directoryPath)
      return updated
    }
  )

  // 获取工作区附加目录列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_DIRECTORIES,
    async (_, workspaceSlug: string): Promise<string[]> => {
      return getWorkspaceAttachedDirectories(workspaceSlug)
    }
  )

  // 启动时自动归档 + 每 24 小时定期检查
  const runAutoArchive = (): void => {
    try {
      const settings = getSettings()
      const days = resolveArchiveDays(settings)
      if (days > 0) {
        const archivedSessions = autoArchiveAgentSessions(days)
        if (archivedSessions > 0) {
          console.log(`[自动归档] 已归档 ${archivedSessions} 个 Agent 会话`)
        }
      }
    } catch (error) {
      console.error('[自动归档] 自动归档失败:', error)
    }
  }

  runAutoArchive()
  setInterval(runAutoArchive, 24 * 60 * 60 * 1000)
}
