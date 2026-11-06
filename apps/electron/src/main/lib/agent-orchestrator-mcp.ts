/**
 * AgentOrchestrator MCP 服务器配置构建
 *
 * 从 agent-orchestrator.ts 拆出的工作区 MCP 组装逻辑（buildMcpServers）。
 * 原方法读取的实例状态（eventBus / authService / isPythonRuntimeReady）改为显式函数入参，
 * 其余逻辑纯搬迁、行为字节级一致。
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { AGENT_IPC_CHANNELS, isKeywordSearchEnabled, isVectorModeEnabled } from '@asci/shared'
import { PythonSkillVenvManager } from './python/python-skill-venv-manager.ts'
import { createUvSpawnInvoker } from './python/uv-spawn-invoker.ts'
import { createAsciPythonMcpServer } from '../mcp/asci-python-tool.ts'
import { getDefaultSkillsDir, getZoteroWikiDir, getConfigDir, getConfigEnvForChildren, getAgentWorkspacePath } from './config-paths.ts'
import { getRuntimeProvisioner } from './runtime/runtime-provisioner.ts'
import { composeMcpServers } from './mcp/global-config.ts'
import { createPapersRgMcpServer } from '../mcp/papers-rg-tool.ts'
import { loadEmbeddingConfig } from './zotero-embedding-index/config.ts'
import { semanticSearchPapers } from './zotero-embedding-index/index.ts'
import { createAsciZoteroMcpServer } from '../mcp/zotero-import-tool.ts'
import { createLitReviewSdkMcpServer } from './litreview-sdk-mcp.ts'
import { createResearchGapSdkMcpServer } from './research-gap-sdk-mcp.ts'
import { createSearchPlanSdkMcpServer } from './search-plan-sdk-mcp.ts'
import { buildJournalMcpEnv } from './mcp/journal-env.ts'
import { getAsciServerBaseUrl } from './auth-opensci-client.ts'
import type { AgentEventBus } from './agent-event-bus'
import type { AuthService } from './auth-service.ts'
import { buildPathWithBundledPrefix } from './agent-orchestrator-sdk-env.ts'
import { preparePaperSearchRuntime } from './mcp/runtime-scope.ts'
import { ensurePaperSearchVenvSynced } from './paper-search-integration.ts'

/**
 * 构建工作区 MCP 服务器配置
 *
 * @param deps 原实例状态依赖：事件总线、登录态服务、Python runtime 就绪标志
 */
export async function buildMcpServers(
  deps: {
    eventBus: AgentEventBus
    authService: AuthService | null
    isPythonRuntimeReady: boolean
    includeScientificServices?: boolean
  },
  workspaceSlug: string | undefined,
  sessionId?: string,
  scoring?: { model: string; baseUrl: string; apiKey: string },
): Promise<Record<string, Record<string, unknown>>> {
  const { eventBus, authService, isPythonRuntimeReady } = deps
  const mcpServers: Record<string, Record<string, unknown>> = {}

  // 注入 in-process Python 工具（不依赖 workspaceSlug；每次新建实例避免单例冻结路径）
  // 仅在 Python runtime 已激活就绪时注入；否则该工具暂时缺席（避免 uv 调用 ENOENT）
  if (isPythonRuntimeReady) {
    mcpServers['asci-python'] = createAsciPythonMcpServer({
      venvManager: new PythonSkillVenvManager({
        skillsRootDir: getDefaultSkillsDir(),
        interpreterPath: getRuntimeProvisioner().getPythonInterpreter(),
        uv: createUvSpawnInvoker({ uvBinPath: getRuntimeProvisioner().getUvBin() }),
      }),
    }) as unknown as Record<string, unknown>
  }

  // 注入 in-process Papers Ripgrep 工具（不依赖 workspaceSlug；wiki 是全局 Zotero 解析输出目录）
  // 默认走 @vscode/ripgrep 自带的 rg 二进制，可通过 ASCI_RG_BIN 覆盖
  // 检索模式（zotero-embedding.json mode）三档每会话判定一次，便于 A/B 评估：
  //   vector → 仅 papers_semantic_search；papers-rg → 仅 papers_search_keywords；both → 两者
  //   （papers_read_* 深读工具三档都注册）
  const retrievalMode = loadEmbeddingConfig().mode
  mcpServers['papers-rg'] = createPapersRgMcpServer({
    wikiDir: getZoteroWikiDir(),
    keywordSearch: isKeywordSearchEnabled(retrievalMode),
    ...(isVectorModeEnabled(retrievalMode) ? { semanticSearch: semanticSearchPapers } : {}),
  }) as unknown as Record<string, unknown>

  // 注入 in-process asci-zotero 工具：把对话内"批量加入 Zotero"意图路由到既有 UI 链路
  // （SessionPapersPanel + ZoteroBatchLinkDialog）；仅 sessionId 存在时挂上才有意义
  if (sessionId) {
    mcpServers['asci-zotero'] = createAsciZoteroMcpServer({
      sessionId,
      sendOpenBatchImport: (payload) => {
        // 延迟 import 避免与 main/index.ts 形成循环
        import('../index').then(({ getMainWindow }) => {
          const win = getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send(AGENT_IPC_CHANNELS.ZOTERO_OPEN_BATCH_IMPORT, payload)
          }
        }).catch((err) => {
          console.warn('[asci-zotero] send IPC failed:', err)
        })
      },
    }) as unknown as Record<string, unknown>
  }

  // 注入 in-process litreview 工具：lit-review Turn 1 present_directions ChoiceCard 入口（spec §5.4）
  // 仅当 sessionId 已知时挂上 —— 工具 handler 闭包持 sessionId，与 ExitPlanMode/AskUser 异步等待模式对称
  if (sessionId) {
    mcpServers['litreview'] = createLitReviewSdkMcpServer(
      sessionId,
      (request) => {
        eventBus.emit(sessionId, {
          kind: 'asci_event',
          event: { type: 'litreview_present_directions_request', request },
        })
      },
    ) as unknown as Record<string, unknown>

    // 注入 in-process researchgap 工具：研究空白对照表产出 present_research_gap_table（0.4 Epic 1，fire-and-forget）
    mcpServers['researchgap'] = createResearchGapSdkMcpServer(
      sessionId,
      (table) => {
        eventBus.emit(sessionId, {
          kind: 'asci_event',
          event: { type: 'research_gap_table', table },
        })
      },
    ) as unknown as Record<string, unknown>

    // 注入 in-process searchplan 工具：lit-search 检索方案确认 present_search_plan（issue #435）
    mcpServers['searchplan'] = createSearchPlanSdkMcpServer(
      sessionId,
      (request) => {
        eventBus.emit(sessionId, {
          kind: 'asci_event',
          event: { type: 'search_plan_request', request },
        })
      },
    ) as unknown as Record<string, unknown>
  }

  if (!workspaceSlug) return mcpServers

  // 全局 MCP（用户自定义 + 内建 zotero/ocr/asr/paper-search）—— composeMcpServers 已合并好
  const composed = composeMcpServers()
  for (const [name, entry] of Object.entries(composed)) {
    if (!entry.enabled) continue
    const sdkEntry: Record<string, unknown> = { type: entry.type }
    if (entry.type === 'stdio') {
      sdkEntry.command = entry.command
      if (entry.args) sdkEntry.args = entry.args
      // 注入 bundled PATH 前缀，确保内建 zotero/ocr/asr 与用户 stdio MCP 都用 bundled
      // node/uv，而不是依赖系统 nvm/PATH。已显式给 PATH 的 entry.env 也会被刷新前缀。
      const baseEnv = entry.env ?? {}
      const injectedPath = buildPathWithBundledPrefix(baseEnv.PATH ?? process.env.PATH)
      const mergedEnv: Record<string, string> = { ...baseEnv }
      if (injectedPath) mergedEnv.PATH = injectedPath
      if (Object.keys(mergedEnv).length > 0) sdkEntry.env = mergedEnv
    } else {
      sdkEntry.url = entry.url
      if (entry.headers) sdkEntry.headers = entry.headers
    }
    if (entry.timeout != null) sdkEntry.startup_timeout_sec = entry.timeout
    mcpServers[name] = sdkEntry
  }

  // 内建注入：workspace_papers MCP（只读两工具，供综述类 skill 使用）
  // 放在用户 mcp.json 条目之后，若用户自定义同名条目则优先生效（Object.assign 语义）
  if (!mcpServers.workspace_papers) {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    const serverCjs = join(base, 'workspace-papers-mcp', 'server.cjs')
    if (existsSync(serverCjs)) {
      const injectedPath = buildPathWithBundledPrefix(process.env.PATH)
      mcpServers.workspace_papers = {
        type: 'stdio',
        command: 'node',
        args: [serverCjs],
        // ASCI_DEV 透传：保持与 zotero/ocr/asr 一致的 dev/prod 目录隔离，
        // 防止子进程内任何 require('config-paths') 链路回落到 .asci。
        env: {
          ...(injectedPath && { PATH: injectedPath }),
          ...getConfigEnvForChildren(),
          ASCI_WORKSPACE_DIR: getAgentWorkspacePath(workspaceSlug),
        },
        required: false,
        startup_timeout_sec: 15,
      }
    } else {
      console.warn(`[Agent 编排] workspace-papers MCP server.cjs 未找到: ${serverCjs}（需先运行 build:workspace-papers-mcp）`)
    }
  }

  // 内建注入：pdf_parser MCP（并行解析 PDF → 工作区 parsed-papers/{itemKey}.txt，供综述类 skill 使用）
  if (!mcpServers.pdf_parser) {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    const serverCjs = join(base, 'pdf-parser-mcp', 'server.cjs')
    if (existsSync(serverCjs)) {
      const injectedPath = buildPathWithBundledPrefix(process.env.PATH)
      mcpServers.pdf_parser = {
        type: 'stdio',
        command: 'node',
        args: [serverCjs],
        env: {
          ...(injectedPath && { PATH: injectedPath }),
          ASCI_WORKSPACE_DIR: getAgentWorkspacePath(workspaceSlug),
        },
        required: false,
        startup_timeout_sec: 15,
      }
    } else {
      console.warn(`[Agent 编排] pdf-parser MCP server.cjs 未找到: ${serverCjs}（需先运行 build:pdf-parser-mcp）`)
    }
  }

  // 动态注入 ASCI_SESSION_ID + ASCI_CONFIG_DIR 到 paper-search MCP，
  // 使其感知当前会话和正确的配置目录（fix #75）
  await preparePaperSearchRuntime(mcpServers, { scientific: deps.includeScientificServices !== false, hasSession: Boolean(sessionId) }, ensurePaperSearchVenvSynced)
  if (sessionId && mcpServers['paper-search']) {
    // spawn 前串行预同步 .venv：spawn 参数用 `--no-sync`（见 builtin-mcp-resolver），
    // 故必须先保证 venv 就绪。幂等——进程内只真正同步一次，并发会话共享同一 promise。
    const psEntry = mcpServers['paper-search']
    const existingEnv = (psEntry.env ?? {}) as Record<string, string>
    // journal 检索源：登录态下注入 OPENSCI token + /journal base URL；未登录返回空、不激活。
    const journalToken = (await authService?.getValidAccessToken()) ?? null
    const journalEnv = buildJournalMcpEnv(journalToken, getAsciServerBaseUrl())
    psEntry.env = {
      ...existingEnv,
      ASCI_SESSION_ID: sessionId,
      ASCI_CONFIG_DIR: getConfigDir(),
      ...journalEnv,
      // 打分渠道（#745 scorer 下沉）：score_window 工具内部判分需调模型，经 env 注入与主
      // Agent 同源的渠道（model/baseUrl/key），不新增配置面；judge 走 Anthropic-compat HTTP。
      ...(scoring && {
        ASCI_SCORING_MODEL: scoring.model,
        ASCI_SCORING_BASE_URL: scoring.baseUrl,
        ASCI_SCORING_API_KEY: scoring.apiKey,
      }),
    }
  }

  if (Object.keys(mcpServers).length > 0) {
    console.log(`[Agent 编排] 已加载 ${Object.keys(mcpServers).length} 个 MCP 服务器`)
  }

  return mcpServers
}
