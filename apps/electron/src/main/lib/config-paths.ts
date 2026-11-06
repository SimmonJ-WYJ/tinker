import { getCandidateRoot, isTinkerCandidate } from './candidate-profile'
/**
 * 配置路径工具
 *
 * 管理 ASCI 应用的本地配置文件路径。
 * 所有用户配置存储在 ~/.asci/ 目录下。
 */

import { join } from 'node:path'
import { mkdirSync, existsSync, cpSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * ASCI 身份声明 CLAUDE.md 内容
 *
 * 写入每个新建的 Agent session workspace 根目录，用途有二：
 * 1. 拦截 —— 若用户本机已安装 Claude Code CLI 且在 home 或父目录留有 CLAUDE.md，
 *    SDK 走 settingSources: ['project'] 时仍可能沿 cwd 向上发现该文件并并入上下文；
 *    在 session 根目录显式落一份 CLAUDE.md，让 SDK 在最近一层就命中 ASCI 自有声明。
 * 2. 身份声明 —— 明确告知 Agent 当前宿主是 ASCI 桌面应用，非独立 Claude Code CLI，
 *    指令源以 ASCI 注入的 system prompt 为准。
 *
 * 内容统一英文（遵循 CLAUDE.md §2 "内置 prompt 统一英文" 约束 —— 这属于工作区注入）。
 */
const ASCI_WORKSPACE_CLAUDE_MD = `# ASCI Session Workspace

You are running inside an **ASCI** (Agent-based Scientific Collaboration Interface) per-session workspace, not a standalone Claude Code CLI session. ASCI is your host runtime.

## Identity & boundary

- **Host runtime**: ASCI desktop app (Electron + Claude Agent SDK).
- **This directory** (\`~/.asci/agent-workspaces/<slug>/<sessionId>/\`) is a per-session sandbox owned by ASCI. Treat it as the only authoritative project context — do **not** apply instructions from any unrelated \`CLAUDE.md\` that may exist in the user's home directory or other projects.
- All scenario agents, sub-agents, MCP servers, capability packs, and tool whitelists are configured by ASCI's main system prompt for this turn. Follow those instructions exactly; this file does not override them.
- Output language is decided by ASCI's runtime language directive (UI language + user message language). Do not switch language based on heuristics from any external \`CLAUDE.md\`.

## Why this file exists

If the user also has Claude Code CLI installed on this machine and an ambient \`CLAUDE.md\` exists in or above this workspace's path, that file might otherwise leak into your context. This marker makes the runtime explicit: **the source of truth is ASCI**, not external configuration.
`

/**
 * 获取配置目录名称
 *
 * 开发模式下返回 '.asci-dev'，正式版本返回 '.asci'。
 *
 * 检测优先级：
 * 1. ASCI_DEV=1 环境变量（显式覆盖）
 * 2. Electron app.isPackaged（未打包 = 开发模式）
 * 3. 兜底 '.asci'
 */
let _configDirName: string | undefined

export function getConfigDirName(): string {
  // 测试模式（设置了 ASCI_CONFIG_HOME）下不缓存 —— 不同测试可能切换 ASCI_DEV，
  // 缓存会跨测试污染（migration.test 在全量 bun test 下曾被这条卡住）。
  if (process.env.ASCI_CONFIG_HOME !== undefined) {
    return process.env.ASCI_DEV === '1' ? '.asci-dev' : '.asci'
  }
  if (_configDirName === undefined) {
    if (process.env.ASCI_DEV === '1') {
      _configDirName = '.asci-dev'
    } else {
      try {
        const { app } = require('electron')
        _configDirName = app.isPackaged ? '.asci' : '.asci-dev'
      } catch {
        _configDirName = '.asci'
      }
    }
    const mode = _configDirName === '.asci-dev' ? '开发模式' : '正式版本'
    console.log(`[配置] 配置目录: ~/${_configDirName}/（${mode}）`)
  }
  return _configDirName
}

/**
 * 解析 home 目录
 *
 * 优先用 ASCI_CONFIG_HOME 环境变量（测试隔离专用），否则用 os.homedir()。
 * 这是为了让单元测试能把所有 ~/.asci 路径重定向到临时目录，避免污染用户真实数据。
 * 生产环境不应该设 ASCI_CONFIG_HOME。
 */
function resolveHomeDir(): string {
  return process.env.ASCI_CONFIG_HOME ?? (isTinkerCandidate() ? getCandidateRoot(join(homedir(), 'Library', 'Application Support')) : homedir())
}

/**
 * 获取配置目录路径
 *
 * 开发模式返回 ~/.asci-dev/，正式版本返回 ~/.asci/。
 * 如果目录不存在则自动创建。
 */
export function getConfigDir(): string {
  const configDir = join(resolveHomeDir(), getConfigDirName())

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
    console.log(`[配置] 已创建配置目录: ${configDir}`)
  }

  return configDir
}

/**
 * 获取渠道配置文件路径
 *
 * @returns ~/.asci/channels.json
 */
export function getChannelsPath(): string {
  return join(getConfigDir(), 'channels.json')
}

/**
 * 获取对话索引文件路径
 *
 * @returns ~/.asci/conversations.json
 */
export function getConversationsIndexPath(): string {
  return join(getConfigDir(), 'conversations.json')
}

/**
 * 获取对话消息目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/conversations/
 */
export function getConversationsDir(): string {
  const dir = join(getConfigDir(), 'conversations')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建对话目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定对话的消息文件路径
 *
 * @param id 对话 ID
 * @returns ~/.asci/conversations/{id}.jsonl
 */
export function getConversationMessagesPath(id: string): string {
  return join(getConversationsDir(), `${id}.jsonl`)
}

/**
 * 获取输出反馈目录路径（助手输出 👍/👎 直观反馈采集；issue #477）
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/feedback/
 */
export function getOutputFeedbackDir(): string {
  const dir = join(getConfigDir(), 'feedback')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建输出反馈目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定 session 的输出反馈文件路径（append-only JSONL）
 *
 * @param sessionId Agent session id
 * @returns ~/.asci/feedback/{sessionId}.jsonl
 */
export function getOutputFeedbackPath(sessionId: string): string {
  return join(getOutputFeedbackDir(), `${sessionId}.jsonl`)
}

/**
 * 获取附件存储根目录
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/attachments/
 */
export function getAttachmentsDir(): string {
  const dir = join(getConfigDir(), 'attachments')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建附件目录: ${dir}`)
  }

  return dir
}

/**
 * 获取引用图谱缓存目录
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/citation-graph-cache/
 */
export function getCitationGraphCacheDir(): string {
  const dir = join(getConfigDir(), 'citation-graph-cache')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建引用图谱缓存目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定对话的附件目录
 *
 * 如果目录不存在则自动创建。
 *
 * @param conversationId 对话 ID
 * @returns ~/.asci/attachments/{conversationId}/
 */
export function getConversationAttachmentsDir(conversationId: string): string {
  const dir = join(getAttachmentsDir(), conversationId)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 解析附件相对路径为完整路径
 *
 * @param localPath 相对路径 {conversationId}/{uuid}.ext
 * @returns 完整路径 ~/.asci/attachments/{conversationId}/{uuid}.ext
 */
export function resolveAttachmentPath(localPath: string): string {
  return join(getAttachmentsDir(), localPath)
}

/**
 * 获取应用设置文件路径
 *
 * @returns ~/.asci/settings.json
 */
export function getSettingsPath(): string {
  return join(getConfigDir(), 'settings.json')
}

/**
 * 获取用户档案文件路径
 *
 * @returns ~/.asci/user-profile.json
 */
export function getUserProfilePath(): string {
  return join(getConfigDir(), 'user-profile.json')
}

/**
 * 获取代理配置文件路径
 *
 * @returns ~/.asci/proxy-settings.json
 */
export function getProxySettingsPath(): string {
  return join(getConfigDir(), 'proxy-settings.json')
}

/**
 * 获取记忆配置文件路径
 *
 * @returns ~/.asci/memory.json
 */
export function getMemoryConfigPath(): string {
  return join(getConfigDir(), 'memory.json')
}

/**
 * 获取 Chat 工具配置文件路径
 *
 * @returns ~/.asci/chat-tools.json
 */
export function getChatToolsConfigPath(): string {
  return join(getConfigDir(), 'chat-tools.json')
}

/** 核心对象 SQLite 数据库文件名（历史名 objects.db，已更名 asci.db） */
const ASCI_DB_FILENAME = 'asci.db'
const LEGACY_OBJECTS_DB_FILENAME = 'objects.db'

/**
 * 获取核心对象 SQLite 数据库路径
 *
 * 0.2 北极星核心对象（Paper / EvidenceRef / Note / EvidenceSet /
 * Proposal / Review）的持久化落盘文件。WAL 模式下会
 * 额外生成 `asci.db-wal` / `asci.db-shm` 两个 sidecar 文件，备份时需一并带走。
 *
 * @returns ~/.asci/asci.db
 */
export function getObjectsDbPath(): string {
  return join(getConfigDir(), ASCI_DB_FILENAME)
}

/**
 * 一次性把历史数据库文件 objects.db（含 -wal / -shm sidecar）改名为 asci.db。
 *
 * launch 后已有用户的库落在 objects.db；改名不能让他们丢数据，故启动时若
 * 目标 asci.db 不存在、而 objects.db 存在，则原子改名迁移（含 WAL/SHM sidecar）。
 * 已迁移（asci.db 存在）或全新安装（objects.db 不存在）→ noop。
 *
 * 必须在打开 DB（openDb）之前调用。
 */
export function migrateLegacyObjectsDbName(): void {
  const dir = getConfigDir()
  const target = join(dir, ASCI_DB_FILENAME)
  const legacy = join(dir, LEGACY_OBJECTS_DB_FILENAME)
  // 目标已存在（已迁移）或老文件不存在（全新安装）→ 无需迁移
  if (existsSync(target) || !existsSync(legacy)) return
  for (const suffix of ['', '-wal', '-shm']) {
    const from = legacy + suffix
    const to = target + suffix
    if (existsSync(from)) {
      try {
        renameSync(from, to)
      } catch (err) {
        console.warn(`[config-paths] 数据库改名失败 ${from} → ${to}（继续）:`, err)
      }
    }
  }
  console.log(`[config-paths] 历史数据库已改名：objects.db → asci.db`)
}

/**
 * 获取综述 HTML 文件存储目录
 *
 * Review 元数据落 SQLite，但 HTML 正文落独立文件（review HTML 可能很大，
 * 不适合塞行；同时方便用户直接打开 / 备份）。约定文件名为 `<id>.html`。
 * 目录不存在则自动创建。
 *
 * @returns ~/.asci/reviews/
 */
export function getReviewsDir(): string {
  const dir = join(getConfigDir(), 'reviews')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Review 目录: ${dir}`)
  }
  return dir
}

/**
 * 获取某个 Review 的正文文件路径。
 *
 * 由 review id 推导，不存 DB 列；如果未来要支持外部 / 自定义文件位置，
 * 在 reviews 表加 `body_path` 列覆盖此默认即可。
 *
 * 2026-05-21 起：默认扩展名从 `.html` 改为 `.md`。
 * 2026-05-21（v0.19.0）起：默认扩展名再改回 `.html` —— 真实综述链路
 * (literature-review-result skill v0.19.0+) 用 Write 工具落 HTML fragment。
 * 下游 UI 渲染由 ReviewHtmlRenderer 接 DOMPurify + KaTeX auto-render 处理。
 * 旧数据仍可能是 `.md`，read 端按 (html → md) 顺序兜底兼容。
 *
 * 调用方需要明确扩展名时传 `ext` 参数；默认 'html'。
 *
 * @returns ~/.asci/reviews/{id}.{ext}
 */
export function getReviewBodyPath(reviewId: string, ext: 'html' | 'md' = 'html'): string {
  return join(getReviewsDir(), `${reviewId}.${ext}`)
}

/**
 * 获取 Agent 会话索引文件路径
 *
 * @returns ~/.asci/agent-sessions.json
 */
export function getAgentSessionsIndexPath(): string {
  return join(getConfigDir(), 'agent-sessions.json')
}

/**
 * 获取 Agent 会话消息目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/agent-sessions/
 */
export function getAgentSessionsDir(): string {
  const dir = join(getConfigDir(), 'agent-sessions')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 会话目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定 Agent 会话的消息文件路径
 *
 * @param id 会话 ID
 * @returns ~/.asci/agent-sessions/{id}.jsonl
 */
export function getAgentSessionMessagesPath(id: string): string {
  return join(getAgentSessionsDir(), `${id}.jsonl`)
}

/**
 * 获取论文检索记录目录路径
 *
 * 每个会话的所有 paper-search 类 MCP 调用结果会被中间件拦截
 * 并追加到此目录下对应会话的 JSONL 文件中。
 * 刻意放在 Agent cwd 外，避免污染 Agent 上下文。
 *
 * @returns ~/.asci/agent-sessions-papers/
 */
export function getAgentSessionsPapersDir(): string {
  const dir = join(getConfigDir(), 'agent-sessions-papers')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建论文检索记录目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定会话的论文检索记录文件路径
 *
 * 文件采用 JSONL 格式，每行一条 PaperRecord。
 * session fork 后新 session 会使用新的 sessionId，自然得到独立文件。
 *
 * @param sessionId 会话 ID
 * @returns ~/.asci/agent-sessions-papers/{sessionId}.jsonl
 */
export function getSessionPapersPath(sessionId: string): string {
  return join(getAgentSessionsPapersDir(), `${sessionId}.jsonl`)
}

/**
 * 获取 Agent 会话诊断目录路径（issue #587 诊断埋点）
 *
 * 存放每个 session 的诊断 JSONL（如 "No such tool available" 哨兵事件）
 * 与 SDK 子进程 stderr 落盘文件。如果目录不存在则自动创建。
 *
 * @returns ~/.asci/agent-sessions-diagnostics/
 */
export function getAgentSessionsDiagnosticsDir(): string {
  const dir = join(getConfigDir(), 'agent-sessions-diagnostics')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 会话诊断目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定会话的诊断事件文件路径（append-only JSONL）
 *
 * @param sessionId 会话 ID
 * @returns ~/.asci/agent-sessions-diagnostics/{sessionId}.jsonl
 */
export function getSessionDiagnosticsPath(sessionId: string): string {
  return join(getAgentSessionsDiagnosticsDir(), `${sessionId}.jsonl`)
}

/**
 * 获取指定会话的 SDK 子进程 stderr 落盘路径
 *
 * MCP server（含 paper-search uv 子进程）的 stderr 经 SDK onStderr 回调
 * 汇入这里，便于偶发故障事后排查（此前只进 console，进程退出即丢）。
 *
 * @param sessionId 会话 ID
 * @returns ~/.asci/agent-sessions-diagnostics/{sessionId}.stderr.log
 */
export function getSessionStderrLogPath(sessionId: string): string {
  return join(getAgentSessionsDiagnosticsDir(), `${sessionId}.stderr.log`)
}

/**
 * 获取崩溃日志目录路径（issue #459 崩溃可观测性）
 *
 * 存放进程级 / 渲染级崩溃的 append-only JSONL，便于偶发崩溃事后排查
 * （此前崩溃只进 console，进程退出即丢，无法根因）。目录不存在则自动创建。
 * 注：单文件无轮转 —— 崩溃罕见、记录小，留全量利于事后诊断（如需上限后续再加）。
 *
 * @returns ~/.asci/crash-logs/
 */
export function getCrashLogsDir(): string {
  const dir = join(getConfigDir(), 'crash-logs')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建崩溃日志目录: ${dir}`)
  }

  return dir
}

/**
 * 获取崩溃事件落盘文件路径（append-only JSONL）
 *
 * @returns ~/.asci/crash-logs/crash.jsonl
 */
export function getCrashLogPath(): string {
  return join(getCrashLogsDir(), 'crash.jsonl')
}

/**
 * 获取 Python 字节码缓存前缀目录（issue #587）
 *
 * 注入 paper-search MCP 子进程的 PYTHONPYCACHEPREFIX：字节码缓存写到这里
 * 而非包目录 __pycache__/ —— 既不触发 dev 下 electronmon 监视重载（#542 的
 * 初衷），又保留缓存让冷启动不必每次全量重编译（PYTHONDONTWRITEBYTECODE 的副作用）。
 * 不自动创建 —— Python 进程首次写入时会自行 mkdir。
 *
 * @returns ~/.asci/cache/pycache/
 */
export function getPyCacheDir(): string {
  return join(getConfigDir(), 'cache', 'pycache')
}

/**
 * 获取 Agent 工作区索引文件路径
 *
 * @returns ~/.asci/agent-workspaces.json
 */
export function getAgentWorkspacesIndexPath(): string {
  return join(getConfigDir(), 'agent-workspaces.json')
}

/**
 * 获取 Agent 工作区根目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/agent-workspaces/
 */
export function getAgentWorkspacesDir(): string {
  const dir = join(getConfigDir(), 'agent-workspaces')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 工作区目录: ${dir}`)
  }

  return dir
}

/**
 * 获取指定 Agent 工作区的目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/
 */
export function getAgentWorkspacePath(slug: string): string {
  const dir = join(getAgentWorkspacesDir(), slug)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 工作区: ${dir}`)
  }

  return dir
}

/**
 * 获取指定工作区的 MCP 配置文件路径
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/mcp.json
 */
export function getWorkspaceMcpPath(slug: string): string {
  return join(getAgentWorkspacePath(slug), 'mcp.json')
}

/**
 * 获取全局 MCP 配置文件路径
 *
 * @returns ~/.asci/mcp.json（生产）或 ~/.asci-dev/mcp.json（dev）
 */
export function getGlobalMcpPath(): string {
  return join(getConfigDir(), 'mcp.json')
}

/**
 * 获取指定工作区的 Skills 目录路径
 *
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/skills/
 */
export function getWorkspaceSkillsDir(slug: string): string {
  const dir = join(getAgentWorkspacePath(slug), 'skills')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 获取工作区文件目录路径
 *
 * 工作区内所有会话可访问的文件存放于此。
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/workspace-files/
 */
export function getWorkspaceFilesDir(slug: string): string {
  const dir = join(getAgentWorkspacePath(slug), 'workspace-files')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 获取工作区不活跃 Skills 目录路径
 *
 * 禁用的 Skill 会被移动到此目录，Agent SDK 不会扫描该目录。
 * 如果目录不存在则自动创建。
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/skills-inactive/
 */
export function getInactiveSkillsDir(slug: string): string {
  const dir = join(getAgentWorkspacePath(slug), 'skills-inactive')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 获取默认 Skills 模板目录路径
 *
 * 新建工作区时自动复制此目录的内容到工作区 skills/ 下。
 *
 * @returns ~/.asci/default-skills/
 */
export function getDefaultSkillsDir(): string {
  const dir = join(getConfigDir(), 'default-skills')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 获取能力包用户安装目录
 *
 * 用户通过手工 / 未来 UI 把能力包放到这里；capability-pack-loader 启动时扫描 + zod 校验 + 注册到 Registry。
 * 能力包目录结构：~/.asci/capability-packs/{packId}/manifest.json（A3 phase3）
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/capability-packs/
 */
export function getCapabilityPacksDir(): string {
  const dir = join(getConfigDir(), 'capability-packs')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  return dir
}

/**
 * 从能力包 manifest.json 解析 version 字段
 * 无 version 字段或解析失败时返回 '0.0.0'（确保后续升级会触发）。
 */
export function parseCapabilityPackVersion(packDir: string): string {
  const manifestPath = join(packDir, 'manifest.json')
  if (!existsSync(manifestPath)) return '0.0.0'

  try {
    const content = readFileSync(manifestPath, 'utf-8')
    const parsed = JSON.parse(content) as { version?: unknown }
    if (typeof parsed.version === 'string' && parsed.version) {
      return parsed.version
    }
  } catch {
    // 解析失败视为最低版本
  }

  return '0.0.0'
}

/**
 * 从 app bundle 同步默认能力包到 ~/.asci/capability-packs/（spec §5 首发包分发）
 *
 * 打包模式下从 `process.resourcesPath/default-capability-packs/` 复制；
 * 开发模式下从源码 `default-capability-packs/` 目录复制。
 *
 * 策略（与 seedDefaultSkills 对齐）：
 *  - 目标不存在 → 复制内置版本
 *  - 目标已存在 → 比较 manifest.version，bundled 更新时覆盖
 *
 * **用户手改注意事项**：当用户在 ~/.asci/capability-packs/<pack>/ 内手改了
 * prompt 但未改 manifest.version，bundled 版本一旦升级（新 manifest.version
 * 数字更大），手改内容会被覆盖。如需冻结某个 pack 在用户版本，可把该 pack 的
 * manifest.version 改成高于 bundled 的值。issue #361 复测发现的"prompt 修复
 * 不到达老用户"根因就是之前这里只做首次安装、永不覆盖，导致 0.2.0 一直停在
 * 旧版本——现在升级到与 Skills 一致的 version-based 覆盖。
 */
export function seedDefaultCapabilityPacks(): void {
  const { app } = require('electron')
  const isDev = !app.isPackaged
  const bundledDir = app.isPackaged
    ? join(process.resourcesPath, 'default-capability-packs')
    : join(__dirname, '../default-capability-packs')

  if (!existsSync(bundledDir)) {
    console.log('[配置] 未找到内置 default-capability-packs 目录，跳过')
    return
  }

  const userDir = getCapabilityPacksDir()

  try {
    const entries = readdirSync(bundledDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const source = join(bundledDir, entry.name)
      const target = join(userDir, entry.name)

      if (!existsSync(target)) {
        // 缺失：直接复制
        cpSync(source, target, { recursive: true })
        console.log(`[配置] 已同步默认能力包: ${entry.name}`)
      } else {
        // 已存在：比较版本，bundled 更新时覆盖
        const bundledVer = parseCapabilityPackVersion(source)
        const existingVer = parseCapabilityPackVersion(target)

        // dev 模式（未打包）强制同步 git working tree：开发期改 prompt 但
        // 忘记 bump manifest.version 是常见操作，version-based 比较会让
        // 改动到不了运行时。这条 follow-up 来自 PR #380 端到端实测：
        // 7 个 commit 改 prompt 但 manifest.version 没动，导致改动在
        // `~/.asci-dev/capability-packs/lit-search/` 里一直停留在旧版本，
        // searcher 等子 Agent 跑的是旧 prompt。
        // packaged 模式仍走 version-based 升级，保护用户在 ~/.asci/ 里
        // 的手改不被静默覆盖（见上方"用户手改注意事项"段落）。
        if (isDev || compareSemver(bundledVer, existingVer) > 0) {
          cpSync(source, target, { recursive: true, force: true })
          const reason = isDev
            ? `dev 强制同步 (manifest.version=${bundledVer})`
            : `${existingVer} → ${bundledVer}`
          console.log(`[配置] 已同步默认能力包: ${entry.name} (${reason})`)
        }
      }
    }
  } catch (err) {
    console.warn('[配置] 同步默认能力包失败:', err)
  }
}

/**
 * 从 SKILL.md 的 YAML frontmatter 中解析 version 字段
 *
 * 无 version 字段时返回 '0.0.0'（确保旧 Skill 会被更新）。
 */
export function parseSkillVersion(skillDir: string): string {
  const skillMdPath = join(skillDir, 'SKILL.md')
  if (!existsSync(skillMdPath)) return '0.0.0'

  try {
    const content = readFileSync(skillMdPath, 'utf-8')
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fmMatch?.[1]) return '0.0.0'

    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
      if (key === 'version' && value) return value
    }
  } catch {
    // 解析失败视为最低版本
  }

  return '0.0.0'
}

/**
 * 比较两个 semver 版本字符串
 *
 * @returns 正数表示 a > b，0 表示相等，负数表示 a < b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 从 app bundle 同步默认 Skills 到 ~/.asci/default-skills/
 *
 * 打包模式下从 process.resourcesPath/default-skills 复制。
 * 开发模式下从源码 default-skills/ 目录复制。
 *
 * - 缺失的 Skill：直接复制
 * - 已存在的 Skill：比较 version，bundled 版本更新时覆盖
 */
export function seedDefaultSkills(): void {
  const { app } = require('electron')
  const bundledDir = app.isPackaged
    ? join(process.resourcesPath, 'default-skills')
    : join(__dirname, '../default-skills')

  if (!existsSync(bundledDir)) {
    console.log('[配置] 未找到内置 default-skills 目录，跳过')
    return
  }

  const userDir = getDefaultSkillsDir()

  try {
    const entries = readdirSync(bundledDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const source = join(bundledDir, entry.name)
      const target = join(userDir, entry.name)

      if (!existsSync(target)) {
        // 缺失的 Skill：直接复制
        cpSync(source, target, { recursive: true })
        console.log(`[配置] 已同步默认 Skill: ${entry.name}`)
      } else {
        // 已存在：比较版本，bundled 更新时覆盖
        const bundledVer = parseSkillVersion(source)
        const existingVer = parseSkillVersion(target)

        if (compareSemver(bundledVer, existingVer) > 0) {
          cpSync(source, target, { recursive: true, force: true })
          console.log(`[配置] 已升级默认 Skill: ${entry.name} (${existingVer} → ${bundledVer})`)
        }
      }
    }
  } catch (err) {
    console.warn('[配置] 同步默认 Skills 失败:', err)
  }
}

/**
 * 获取遥测数据目录（ADR-011）
 *
 * 存放匿名 deviceId 与本地 JSONL 缓冲（events.jsonl / signals.jsonl）。
 * dev 模式自动落 ~/.asci-dev/telemetry/，与正式数据隔离。
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/telemetry/
 */
export function getTelemetryDir(): string {
  const dir = join(getConfigDir(), 'telemetry')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取匿名设备标识文件路径
 *
 * @returns ~/.asci/telemetry/device-id.json
 */
export function getTelemetryDeviceIdPath(): string {
  return join(getTelemetryDir(), 'device-id.json')
}

/**
 * 获取微信配置文件路径
 *
 * @returns ~/.asci/wechat.json
 */
export function getWeChatConfigPath(): string {
  return join(getConfigDir(), 'wechat.json')
}

/**
 * 获取微信长轮询同步游标路径
 *
 * @returns ~/.asci/wechat-sync.json
 */
export function getWeChatSyncPath(): string {
  return join(getConfigDir(), 'wechat-sync.json')
}

/**
 * 获取钉钉配置文件路径
 *
 * @returns ~/.asci/dingtalk.json
 */
export function getDingTalkConfigPath(): string {
  return join(getConfigDir(), 'dingtalk.json')
}

/**
 * 获取飞书配置文件路径
 *
 * @returns ~/.asci/feishu.json
 */
export function getFeishuConfigPath(): string {
  return join(getConfigDir(), 'feishu.json')
}

/**
 * 获取飞书聊天绑定持久化路径
 *
 * @returns ~/.asci/feishu-bindings.json
 */
export function getFeishuBindingsPath(): string {
  return join(getConfigDir(), 'feishu-bindings.json')
}

/**
 * 获取某个飞书 Bot 的聊天绑定持久化路径
 *
 * @returns ~/.asci/feishu-bindings-{botId}.json
 */
export function getFeishuBotBindingsPath(botId: string): string {
  return join(getConfigDir(), `feishu-bindings-${botId}.json`)
}

/**
 * 获取指定 Agent 会话的工作路径
 *
 * 在工作区目录下创建以 sessionId 命名的子文件夹，
 * 作为该会话的独立 Agent cwd。如果目录不存在则自动创建。
 *
 * @param workspaceSlug 工作区 slug
 * @param sessionId 会话 ID
 * @returns ~/.asci/agent-workspaces/{slug}/{sessionId}/
 */
export function getAgentSessionWorkspacePath(workspaceSlug: string, sessionId: string): string {
  const dir = join(getAgentWorkspacePath(workspaceSlug), sessionId)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 会话工作目录: ${dir}`)
  }

  // 幂等地落 ASCI 身份 CLAUDE.md（拦截 ambient CLAUDE.md + 声明宿主身份）。
  // 仅在缺失时写入：用户/历史会话已有的文件不覆盖。
  const claudeMdPath = join(dir, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    try {
      writeFileSync(claudeMdPath, ASCI_WORKSPACE_CLAUDE_MD, 'utf-8')
    } catch (err) {
      console.warn(`[配置] 写入 ASCI 身份 CLAUDE.md 失败: ${claudeMdPath}`, err)
    }
  }

  return dir
}

/**
 * 兜底沙箱父目录（不存在不会自动创建）
 *
 * 仅返回路径用于 GC 等只读扫描场景；实际创建路径请走 getAgentDefaultSessionPath。
 *
 * @returns ~/.asci/agent-workspaces/_no-workspace/
 */
export function getNoWorkspaceFallbackRoot(): string {
  return join(getConfigDir(), 'agent-workspaces', '_no-workspace')
}

/**
 * 获取 Agent 兜底工作目录
 *
 * 当 Agent 启动时未绑定具体 workspace（workspaceId 缺失或解析失败）时，
 * 不能让 cwd 落到用户 home —— 否则：
 * 1. SDK 会读 ~/CLAUDE.md（若用户装过 Claude Code CLI 就会被并入上下文）
 * 2. SDK 还会写 ~/.claude/settings.json 污染用户 Claude Code 配置
 *
 * 用 ~/.asci/agent-workspaces/_no-workspace/<sessionId>/ 作为隔离沙箱，
 * 并写入与 session workspace 相同的 ASCI 身份 CLAUDE.md。
 *
 * 会话删除时该目录会变成孤儿（sessionId 是 uuid 不会复用），
 * 由启动期 GC 统一回收，见 agent-session-manager.ts `gcNoWorkspaceFallbackOrphans`。
 *
 * @returns ~/.asci/agent-workspaces/_no-workspace/{sessionId}/
 */
export function getAgentDefaultSessionPath(sessionId: string): string {
  const dir = join(getNoWorkspaceFallbackRoot(), sessionId)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Agent 兜底会话目录: ${dir}`)
  }

  const claudeMdPath = join(dir, 'CLAUDE.md')
  if (!existsSync(claudeMdPath)) {
    try {
      writeFileSync(claudeMdPath, ASCI_WORKSPACE_CLAUDE_MD, 'utf-8')
    } catch (err) {
      console.warn(`[配置] 写入 ASCI 身份 CLAUDE.md 失败: ${claudeMdPath}`, err)
    }
  }

  return dir
}

/**
 * 获取 SDK 隔离配置目录路径
 *
 * 用于设置 CLAUDE_CONFIG_DIR 环境变量，让 SDK 读取独立的配置文件，
 * 而不是用户的 ~/.claude.json，实现 ASCI 与 Claude Code CLI 的配置隔离。
 *
 * 如果目录不存在则自动创建。
 *
 * @returns ~/.asci/sdk-config/
 */
export function getSdkConfigDir(): string {
  const dir = join(getConfigDir(), 'sdk-config')

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 SDK 配置目录: ${dir}`)
  }

  return dir
}

/**
 * 获取 ASR 模型权重根目录
 *
 * @returns ~/.asci/cache/asr-weights/
 * 子目录 = 一个模型（如 sherpa-onnx-sense-voice-...-2024-07-17/）。
 * 不自动创建 —— 下载服务按需 mkdir。
 */
export function getAsrWeightsDir(): string {
  return join(getConfigDir(), 'cache', 'asr-weights')
}

/** OCR 识别结果缓存根目录：~/.asci/cache/ocr/（路径哈希布局） */
export function getOcrCacheDir(): string {
  return join(getConfigDir(), 'cache', 'ocr')
}

/** ASR 识别结果缓存根目录：~/.asci/cache/asr/ */
export function getAsrCacheDir(): string {
  return join(getConfigDir(), 'cache', 'asr')
}

/**
 * 获取指定工作区的论文索引文件路径
 *
 * 文件采用 JSONL 格式，每行一条 WorkspacePaperEntry。
 * 故意放在 workspace-files 之外，保持用户物理文件目录的纯净。
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/papers.jsonl
 */
export function getWorkspacePapersPath(slug: string): string {
  return join(getAgentWorkspacePath(slug), 'papers.jsonl')
}

/**
 * 获取指定工作区的论文 PDF 存储目录
 *
 * 论文下载后的 PDF 文件统一落到此目录。
 * 在 workspace-files 内，便于用户在 FileBrowser 直接看到、Git 管理、备份导出。
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/workspace-files/papers/
 */
export function getWorkspacePaperPdfsDir(slug: string): string {
  const dir = join(getWorkspaceFilesDir(slug), 'papers')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取指定工作区的论文长笔记目录
 *
 * 论文展开成长笔记后，markdown 文件落到此目录。
 *
 * @param slug 工作区 slug
 * @returns ~/.asci/agent-workspaces/{slug}/workspace-files/paper-notes/
 */
export function getWorkspacePaperNotesDir(slug: string): string {
  const dir = join(getWorkspaceFilesDir(slug), 'paper-notes')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * 获取 Zotero 集成相关数据目录
 *
 * 用于存放 Zotero PDF 快照等"非用户配置但属于 Zotero 集成的运行时数据"。
 *
 * @returns ~/.asci/zotero/
 */
export function getZoteroDir(): string {
  const dir = join(getConfigDir(), 'zotero')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Zotero 目录: ${dir}`)
  }
  return dir
}

/**
 * 获取 Zotero PDF 被动 diff 快照路径
 *
 * 由 zotero-pdf-diff.ts 读写：每次 diff 完成后整体覆盖。
 *
 * @returns ~/.asci/zotero/zotero-pdf-snapshot.json
 */
export function getZoteroPdfSnapshotPath(): string {
  return join(getZoteroDir(), 'zotero-pdf-snapshot.json')
}

/**
 * 获取 Zotero PDF 解析后的 markdown 输出目录
 *
 * 由 zotero-pdf-parser worker 写入：每个 PDF 解析后落 {attachmentKey}.md。
 *
 * @returns ~/.asci/zotero/wiki/
 */
export function getZoteroWikiDir(): string {
  const dir = join(getZoteroDir(), 'wiki')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建 Zotero wiki 目录: ${dir}`)
  }
  return dir
}

/**
 * 拼接单个 PDF 解析后的 markdown 文件路径
 *
 * @param attachmentKey Zotero attachment key
 * @returns ~/.asci/zotero/wiki/{attachmentKey}.md
 */
export function getZoteroWikiMdPath(attachmentKey: string): string {
  return join(getZoteroWikiDir(), `${attachmentKey}.md`)
}

/**
 * 拼接单个 PDF 段落总结增强版（article.md）的输出路径
 *
 * 由 zotero-article-generator worker 写入；与原始 .md 同目录、同 key、`.article.md` 后缀。
 *
 * @param attachmentKey Zotero attachment key
 * @returns ~/.asci/zotero/wiki/{attachmentKey}.article.md
 */
export function getZoteroWikiArticleMdPath(attachmentKey: string): string {
  return join(getZoteroWikiDir(), `${attachmentKey}.article.md`)
}

/**
 * 拼接单个 PDF 结构化解析（structured 链路）的输出路径
 *
 * 由设置页"生成结构化 TXT"按钮触发，独立于 lite worker 队列。
 * 内容是富格式（YAML frontmatter + OUTLINE + CONTENT + `<p id="pS_P">` 段落锚点），
 * 但用 `.txt` 后缀显式区分于 article-generator 消费的 `.md`。
 *
 * @param attachmentKey Zotero attachment key
 * @returns ~/.asci/zotero/wiki/{attachmentKey}.txt
 */
export function getZoteroWikiStructuredTxtPath(attachmentKey: string): string {
  return join(getZoteroWikiDir(), `${attachmentKey}.txt`)
}

/**
 * 段落总结增强（article 生成器）配置文件路径
 *
 * 持久化 ZoteroArticleConfig：开关、渠道、模型、并发、切片阈值。
 * 与 channels.json / settings.json 同级，落在 ~/.asci/ 根。
 *
 * @returns ~/.asci/zotero-article.json
 */
export function getZoteroArticleConfigPath(): string {
  return join(getConfigDir(), 'zotero-article.json')
}

/**
 * Zotero PDF 文献索引文件路径
 *
 * 由 zotero-pdf-parser/index-writer.ts 在 snapshot 任意变动后自动重写。
 * 内容是 ZoteroPdfWikiIndex（含文献元信息、abstract、md 路径）。
 *
 * @returns ~/.asci/zotero/wiki/index.json
 */
export function getZoteroWikiIndexPath(): string {
  return join(getZoteroWikiDir(), 'index.json')
}

/**
 * Zotero 文献向量索引库路径（sqlite-vec + FTS5）
 *
 * 定位是 wiki 语料的**可重建缓存**：不进 asci.db migration 序列，
 * 损坏 / 换嵌入模型时直接删除整库重建。
 * 由 zotero-embedding-index worker 写入，papers_semantic_search 工具读取。
 *
 * @returns ~/.asci/zotero/vector-index.db
 */
export function getZoteroVectorIndexPath(): string {
  return join(getZoteroDir(), 'vector-index.db')
}

/**
 * 本地推理模型权重根目录（嵌入模型等通用模型，区别于 ASR 专用 cache）
 *
 * 嵌入模型权重运行时下载到 {dir}/{modelId}/，不随应用打包。
 *
 * @returns ~/.asci/models/
 */
export function getEmbeddingModelsDir(): string {
  const dir = join(getConfigDir(), 'models')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    console.log(`[配置] 已创建本地模型目录: ${dir}`)
  }
  return dir
}

/**
 * 向量索引（语义检索）配置文件路径
 *
 * 持久化 ZoteroEmbeddingConfig：评估总开关、并发。
 * 与 zotero-article.json 同级，落在 ~/.asci/ 根。
 *
 * @returns ~/.asci/zotero-embedding.json
 */
export function getZoteroEmbeddingConfigPath(): string {
  return join(getConfigDir(), 'zotero-embedding.json')
}

/**
 * 返回需要透传给"由本进程 spawn 的 Node MCP 子进程"的环境变量，
 * 让它们解析到与父进程一致的 config 目录（.asci vs .asci-dev）。
 *
 * 背景：MCP 子进程是裸 Node 进程，`require('electron')` 拿不到真实 app 对象，
 * `getConfigDirName()` 走 catch 分支回落到 '.asci'，于是开发模式下子进程读
 * `~/.asci/...` 而父进程写 `~/.asci-dev/...`，wiki 索引读不到永远 miss。
 *
 * 用法：把返回值合并进给 spawn 的 env：
 *   const childEnv = { ...userEnv, ...getConfigEnvForChildren() }
 */
export function getConfigEnvForChildren(): Record<string, string> {
  return getConfigDirName() === '.asci-dev' ? { ASCI_DEV: '1' } : {}
}

/**
 * 全局登录开关：默认开启，仅 `bun run dev:skip-login` 经 shell env 注入
 * ASCI_SKIP_LOGIN=1 时关闭。
 *
 * 主进程可直接读 process.env（shell 继承），无需 Vite。普通 `bun run dev` 与
 * 打包产物均未设置该变量 → 默认 true。注意 ASCI_SKIP_LOGIN 仅存在于打包构建机 /
 * 开发者 shell，不会进入终端用户运行环境，故产物恒为登录开启。
 */
export function isLoginEnabled(): boolean {
  return process.env.ASCI_SKIP_LOGIN !== '1'
}
