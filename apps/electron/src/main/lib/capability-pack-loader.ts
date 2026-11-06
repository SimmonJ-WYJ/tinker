/**
 * loadCapabilityPacks —— 发现 + 解析 + 校验 + 注册能力包到 Registry（A3 phase3）。
 *
 * 流程：
 *  1. reseed: unregister 所有 source === 'capability-pack' 的 entry（让旧 pack 卸载）
 *  2. 扫 `packsDir` 子目录
 *  3. 每个 pack 目录读 `manifest.json` → zod `safeParse()`（红线 1/2/4 在 schema 层）
 *  4. 解析 `scenarioAgent.promptPath` 与每个 `subAgents[i].promptPath` 指向的 .md 文件
 *     （spec §4.2 / §6.1 物理目录形态：`scenario/system-prompt.md` + `sub-agents/{name}.md`）；
 *     依次做红线 3 CJK heuristic + 模板占位符展开；任一失败 → warn + 跳过本包（原子性）
 *  5. 校验通过 pack：
 *     a. scenarioAgent → SubagentRegistryEntry（.md 内容末尾追加 Output Language section）
 *        registry entry 的 subAgentRefs 从 manifest.subAgents 名字派生
 *     b. 每个 worker subAgent → SubagentRegistryEntry（同 packId / source='capability-pack'）
 *     c. skillRefs → 每条 SkillRegistryEntry { kind: 'skill', source: 'capability-pack', packId, slug }
 *     d. mcpRefs → 每条 McpRegistryEntry { kind: 'mcp', source: 'capability-pack', packId, type: 'stdio' }
 *  6. 单个 pack 校验失败 / 路径出错 / Registry 注册冲突 → console.warn 跳过，不阻止其他 pack
 *
 * **不实现**：Proposal 副产品产出（依赖 north-star §一-A，Phase 3 descope）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CapabilityPackManifest, isClaudeFamilyEnabled, hasAnyEnabledClaudeModel } from '@asci/shared'
import type { CapabilityPackManifestType, PaperSearchEnvConfig, Channel, ClaudeModelFamily } from '@asci/shared'
import type { AgentMcpServerSpec } from '@anthropic-ai/claude-agent-sdk'
import { buildSubAgentOutputLanguageSection, expandPromptTemplates } from './agent-prompt-builder.ts'
import { getCapabilityPacksDir } from './config-paths.ts'
import type { AppLocale } from './agent-prompt-builder.ts'
import type { SubagentRegistry } from './subagent-registry.ts'

/** CJK heuristic（红线 3）：平假名 / 片假名 / 中日韩统一表意 / 韩文。SubAgent prompt 不允许出现。 */
const CJK_REGEX = /[぀-ゟ゠-ヿ一-鿿가-힯]/

/** 子 Agent model 别名未激活的提示信息（onModelNotice 回调入参） */
export interface ModelNoticeInfo {
  agentName: string
  alias: ClaudeModelFamily
  /** family-fallback：已回退到此具体 id；no-claude-activated：lead 兜底 id（可能为空） */
  fallbackModelId: string
  reason: 'family-fallback' | 'no-claude-activated'
}

/** paper-search MCP 的 mcpRef 名 —— 用作"本包做论文检索"的门控信号（与 BUILTIN_MCP_RESERVED_NAMES 内一致）。 */
const PAPER_SEARCH_MCP_REF = 'paper-search'

/**
 * 把当前 key 配置情况渲染成英文"运行时数据源可用性"块，注入到检索类 scenario Agent
 * 的 system prompt。
 *
 * 背景：lit-search 的 source-discipline 把 `semantic` 是否纳入挂在"是否配置了
 * `PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY`"上，但 planner 是 LLM、看不到主进程环境变量，
 * 于是永远走 fast-path、semantic 从不被选。本块把"key 配没配"这一运行时事实显式喂给 planner，
 * 让那条规则真正可执行。reseed 模式下每轮 query 重新读取，故反映当前配置。
 *
 * 仅渲染 source-discipline 真正条件化的 key-gated 源（当前为 semantic）；未配置时也明确写出
 * "not configured"，避免 planner 误以为"没提到=可用"。
 */
export function buildPaperSourceAvailabilityBlock(env: PaperSearchEnvConfig): string {
  const semanticConfigured = Boolean(env.semantic_scholar_api_key)
  const semanticLine = semanticConfigured
    ? '- Semantic Scholar (`semantic`): CONFIGURED ✓ — add it to `sources` for in-domain queries per the Source-list discipline.'
    : '- Semantic Scholar (`semantic`): not configured — leave `semantic` out of `sources` entirely.'
  return [
    '## Optional paper-source availability (runtime — this session)',
    '',
    'This is the authoritative, real-time status of key-gated optional paper sources for THIS session. Use it to resolve the "only when … API key is configured" conditions in the Source-list discipline — do NOT guess from memory or assume a key is absent.',
    '',
    semanticLine,
  ].join('\n')
}

/** 读 promptPath 指向的 .md、做红线 3 CJK 检查、展开模板占位符；任一失败返回 reason 给 caller 拼 warn 文案（不抛错，单包跳过不拖垮整批）。同时供 scenarioAgent 与 worker subAgent 使用。 */
function resolvePromptFile(
  packDir: string,
  promptPath: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  const absPath = join(packDir, promptPath)
  let content: string
  try {
    content = readFileSync(absPath, 'utf-8')
  } catch (err) {
    return { ok: false, reason: `读 promptPath 失败 (${absPath}): ${err instanceof Error ? err.message : String(err)}` }
  }
  if (content.trim().length === 0) {
    return { ok: false, reason: `promptPath 内容为空 (${absPath})` }
  }
  if (CJK_REGEX.test(content)) {
    return { ok: false, reason: `promptPath 含 CJK 字符（红线 3 — SubAgent prompt 必须英文；${absPath}）` }
  }
  const expanded = expandPromptTemplates(content)
  if (!expanded.ok) {
    return { ok: false, reason: `${expanded.reason}（${absPath}）` }
  }
  return { ok: true, content: expanded.content }
}

export interface LoadCapabilityPacksOptions {
  /** 覆盖默认的 ~/.asci/capability-packs/ 目录（测试用） */
  packsDir?: string
  /** 用户语言 — scenarioAgent prompt 末尾追加 Output Language section */
  language: AppLocale
  /**
   * 当前 lead 模型是否为 Claude 系列（orchestrator 按 effectiveModelId.includes('claude') 计算）。
   *
   * manifest 里 scenarioAgent / subAgents 声明的 `model` 是 Claude 别名（haiku/sonnet/opus）。
   * lead 为非 Claude（deepseek/kimi 等）时，把这些 Claude 别名透传给 claude binary
   * 子进程会触发模型解析错配 → 子 Agent 发出空参数 tool call（如 `retrieve({})`）。
   * 因此非 Claude lead 下**丢弃所有 model 别名**，让子 Agent 继承 lead 模型。
   *
   * 缺省视为 true（向后兼容；测试默认 Claude lead）。
   */
  claudeAvailable?: boolean
  /**
   * 当前 lead 渠道（来自 getChannelById）。用于校验子 Agent model 别名家族是否有"已激活"
   * 的具体模型（channel.models[].enabled）。不提供 → 跳过激活校验，按 #632 后行为透传别名。
   */
  channel?: Channel | null
  /**
   * 已 reconcile 的 lead 模型具体 id（agent-orchestrator 的 effectiveModelId，必为激活模型）。
   * 当子 Agent 别名家族未激活时作为回退目标。不提供 → 不回退（透传原别名）。
   */
  leadModelId?: string
  /**
   * 子 Agent 别名家族未激活时的提示回调（用于上层发用户提示）。同一 (agentName, alias) 每次 load 只触发一次。
   * - reason='family-fallback'：家族未激活但有其它激活 Claude 模型，已回退到 fallbackModelId。
   * - reason='no-claude-activated'：channel 零激活 Claude 模型（极罕见；lead 为 Claude 时几乎不可能）。
   */
  onModelNotice?: (info: ModelNoticeInfo) => void
  /**
   * master 已合成的全局 MCP 配置（来自 buildMcpServers / composeMcpServers）。
   * loader 把 manifest.mcpRefs 内的 string 名按此 dict lookup 展开成完整
   * `{ [name]: McpServerConfig }` 形式，作为 AgentMcpServerSpec 注入到 scenarioAgent.def.mcpServers。
   * 不提供 → 不注入 mcpServers 字段（SDK 默认继承父级），保持向后兼容与测试便利。
   */
  globalMcpServers?: Record<string, Record<string, unknown>>
  /**
   * 当前 paper-search 的 key 配置（来自 loadPaperSearchEnv()）。
   * 提供 → loader 为引用 `paper-search` MCP 的检索类 pack 在 scenario prompt 末尾注入
   * "运行时数据源可用性"块（buildPaperSourceAvailabilityBlock），把"semantic key 配没配"
   * 这一运行时事实喂给 planner，使其 source-discipline 规则可执行（否则 planner 看不到环境变量、
   * 永远走 fast-path、semantic 从不被选）。
   * 不提供（测试 / 无检索包会话） → 不注入，按"未配置"语义对待。
   */
  paperSearchEnv?: PaperSearchEnvConfig
}

/**
 * 从 `packsDir`（默认 `~/.asci/capability-packs/`）扫描子目录，
 * 读取并校验每个 pack 的 `manifest.json`，将合规 pack 注册到 Registry。
 *
 * 每次调用都是 reseed 模式：先清除所有 source === 'capability-pack' 的 entry，
 * 再重新加载，确保 pack 目录变化后 Registry 保持一致。
 */
export async function loadCapabilityPacks(
  registry: SubagentRegistry,
  opts: LoadCapabilityPacksOptions,
): Promise<void> {
  const packsDir = opts.packsDir ?? getCapabilityPacksDir()

  // 1. reseed: 清掉所有 capability-pack 来源
  registry.unregister((e) => e.source === 'capability-pack')

  // 别名回退提示去重：同一 (agentName, alias) 每次 load 只对上层回调一次
  const notifiedFallback = new Set<string>()

  // 2. 发现 pack 目录
  let dirEntries: string[]
  try {
    dirEntries = readdirSync(packsDir)
  } catch {
    // packsDir 不存在 → 静默返回
    return
  }

  for (const entry of dirEntries) {
    const packDir = join(packsDir, entry)
    let isDir = false
    try { isDir = statSync(packDir).isDirectory() } catch { continue }
    if (!isDir) continue

    const manifestPath = join(packDir, 'manifest.json')
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      console.warn(`[CapabilityPackLoader] 读 manifest 失败：${manifestPath}`, err)
      continue
    }

    const parsed = CapabilityPackManifest.safeParse(raw)
    if (!parsed.success) {
      console.warn(`[CapabilityPackLoader] manifest 校验失败：${manifestPath}`, parsed.error.issues)
      continue
    }

    // 能力包恒为启用（Codex 风不可禁用，#414 CP-6）：校验通过即注册，无启停门控。

    // 解析 scenarioAgent.promptPath → .md 文件内容（spec §4.2 / §6.1 物理目录形态）
    // + 红线 3（CJK heuristic）+ 模板占位符展开。失败 → warn + 跳过本包。
    const scenarioResolution = resolvePromptFile(packDir, parsed.data.scenarioAgent.promptPath)
    if (!scenarioResolution.ok) {
      console.warn(`[CapabilityPackLoader] scenario prompt 解析失败：packId=${parsed.data.packId} — ${scenarioResolution.reason}`)
      continue
    }

    // 解析每个 worker subAgent 的 .md（spec §4.2 sub-agents/{name}.md）。
    // 原子性：任一 worker 失败 → 整个包跳过（PLAN 派活依赖 worker 存在，缺一则运行时 dispatch 出错）。
    const workerPrompts: Array<{ name: string; content: string }> = []
    let workerFailure = false
    for (const sa of parsed.data.subAgents) {
      const r = resolvePromptFile(packDir, sa.promptPath)
      if (!r.ok) {
        console.warn(`[CapabilityPackLoader] worker subAgent prompt 解析失败：packId=${parsed.data.packId}, name=${sa.name} — ${r.reason}`)
        workerFailure = true
        break
      }
      workerPrompts.push({ name: sa.name, content: r.content })
    }
    if (workerFailure) continue

    registerPack({
      registry,
      manifest: parsed.data,
      scenarioPrompt: scenarioResolution.content,
      workerPrompts,
      language: opts.language,
      globalMcpServers: opts.globalMcpServers,
      packDir,
      paperSearchEnv: opts.paperSearchEnv,
      claudeAvailable: opts.claudeAvailable ?? true,
      channel: opts.channel,
      leadModelId: opts.leadModelId,
      onModelNotice: opts.onModelNotice,
      notifiedFallback,
    })
  }
}

/**
 * 把 manifest.mcpRefs 内的 string 名按 globalMcpServers 展开成 SDK
 * AgentMcpServerSpec[] 形态（每个元素是 `{ [name]: McpServerConfig }` dict）。
 * 缺失 ref 跳过 + warn；globalMcpServers 不提供 → 返回空数组。
 */
function expandMcpRefs(
  packId: string,
  mcpRefs: readonly string[],
  globalMcpServers: Record<string, Record<string, unknown>> | undefined,
): AgentMcpServerSpec[] {
  if (!globalMcpServers) return []
  const expanded: AgentMcpServerSpec[] = []
  for (const ref of mcpRefs) {
    const config = globalMcpServers[ref]
    if (!config) {
      console.warn(`[CapabilityPackLoader] mcpRef "${ref}" 在 globalMcpServers 中找不到；跳过（packId=${packId}）`)
      continue
    }
    // buildMcpServers 在项目内有意 wide 化（Record<string, unknown>）以避免类型耦合；
    // 这里运行时形态与 SDK McpServerConfigForProcessTransport 一致，cast 安全。
    expanded.push({ [ref]: config } as AgentMcpServerSpec)
  }
  return expanded
}

/**
 * 读包目录下的 `bundled-mcp.json`（spec §4.2 能力包容器约定），返回包自带的 MCP
 * server 规格列表。文件不存在 / 解析失败 → 返回空数组，不阻塞包注册。
 *
 * 与 mcpRefs 的区别：
 *  - mcpRefs 引用**全局**已注册的 MCP（如 paper-search），由 globalMcpServers 字典查表
 *  - bundled-mcp.json 是包**自带**的 MCP 配置，spec §4.2 设计为包内独占（不进入全局表）
 *
 * Schema 约定（与 ~/.asci/mcp.json 一致）：
 *   { "servers": { "<name>": { "command": "...", "args": [...], ... }, ... } }
 *
 * 调用时机：registerPack 阶段，把 bundled 服务器与 expandMcpRefs 的结果合并后注入
 * scenarioAgent.def.mcpServers。
 */
function loadBundledMcpServers(packDir: string, packId: string): AgentMcpServerSpec[] {
  const bundledPath = join(packDir, 'bundled-mcp.json')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(bundledPath, 'utf-8'))
  } catch {
    return []
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.warn(`[CapabilityPackLoader] bundled-mcp.json 顶层必须是 object：packId=${packId}`)
    return []
  }
  const servers = (raw as { servers?: unknown }).servers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    console.warn(`[CapabilityPackLoader] bundled-mcp.json 必须含 servers 字段：packId=${packId}`)
    return []
  }
  const specs: AgentMcpServerSpec[] = []
  for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
    if (!config || typeof config !== 'object') {
      console.warn(`[CapabilityPackLoader] bundled-mcp server "${name}" 配置无效；跳过（packId=${packId}）`)
      continue
    }
    specs.push({ [name]: config } as AgentMcpServerSpec)
  }
  return specs
}

/**
 * 解析子 Agent（scenario / worker）最终注入 registry 的 model 值。
 *
 * - 非 Claude lead → undefined（沿用 #632：丢弃别名，继承 lead 模型）。
 * - 无声明别名 → undefined。
 * - Claude lead + 声明别名：
 *   - 别名家族已激活（channel.models 有 enabled 的同家族具体 id）→ 透传原别名。
 *   - 家族未激活但 channel 仍有其它激活 Claude 模型 → 回退到 leadModelId（具体 id，必激活），onModelNotice(reason='family-fallback')。
 *   - channel 零激活 Claude 模型 → onModelNotice(reason='no-claude-activated')，回退到 leadModelId（若有）否则 undefined。
 * - channel / leadModelId 缺省（测试或未传）→ 不做激活校验，透传原别名（向后兼容 #632 后行为）。
 */
function resolveAgentModel(args: {
  agentName: string
  alias: 'haiku' | 'sonnet' | 'opus' | undefined
  claudeAvailable: boolean
  channel: Channel | null | undefined
  leadModelId: string | undefined
  onModelNotice: ((info: ModelNoticeInfo) => void) | undefined
  notifiedFallback: Set<string>
}): string | undefined {
  const { agentName, alias, claudeAvailable, channel, leadModelId, onModelNotice, notifiedFallback } = args
  if (!claudeAvailable || !alias) return undefined
  // 未传 channel → 无从校验激活，保持 #632 后行为透传别名
  if (!channel) return alias
  if (isClaudeFamilyEnabled(channel, alias)) return alias

  // 同一 (agentName, alias) 每次 load 只提示一次
  const notifyKey = `${agentName}::${alias}`
  const notifyOnce = (info: ModelNoticeInfo) => {
    if (notifiedFallback.has(notifyKey)) return
    notifiedFallback.add(notifyKey)
    onModelNotice?.(info)
  }

  // 家族未激活但仍有其它激活 Claude 模型,且有 leadModelId → 回退到 lead 具体 id
  if (hasAnyEnabledClaudeModel(channel) && leadModelId) {
    notifyOnce({ agentName, alias, fallbackModelId: leadModelId, reason: 'family-fallback' })
    return leadModelId
  }
  // 仅家族未激活、但无 leadModelId 可回退 → 透传原别名（不至于丢 model）
  if (hasAnyEnabledClaudeModel(channel)) return alias

  // channel 零激活 Claude 模型
  notifyOnce({ agentName, alias, fallbackModelId: leadModelId ?? '', reason: 'no-claude-activated' })
  return leadModelId ?? undefined
}

/** 把一个已校验通过的 pack 全部注册到 registry：scenarioAgent + 所有 worker subAgent + skillRefs + mcpRefs。 */
function registerPack(opts: {
  registry: SubagentRegistry
  manifest: CapabilityPackManifestType
  scenarioPrompt: string
  workerPrompts: ReadonlyArray<{ name: string; content: string }>
  language: AppLocale
  globalMcpServers: Record<string, Record<string, unknown>> | undefined
  packDir: string
  paperSearchEnv: PaperSearchEnvConfig | undefined
  /** 非 Claude lead 下丢弃 manifest 的 Claude model 别名（见 LoadCapabilityPacksOptions.claudeAvailable）。 */
  claudeAvailable: boolean
  channel: Channel | null | undefined
  leadModelId: string | undefined
  onModelNotice: ((info: ModelNoticeInfo) => void) | undefined
  notifiedFallback: Set<string>
}): void {
  const { registry, manifest, scenarioPrompt, workerPrompts, language, globalMcpServers, packDir, paperSearchEnv, claudeAvailable, channel, leadModelId, onModelNotice, notifiedFallback } = opts
  const { packId, scenarioAgent, skillRefs, mcpRefs, subAgents } = manifest
  const outputLang = buildSubAgentOutputLanguageSection(language)

  // 检索类 pack（mcpRefs 引用 paper-search）→ 在 scenario prompt 注入运行时数据源可用性块，
  // 让 planner 知道 semantic key 配没配，从而能执行 source-discipline 里的条件化选源规则。
  // paperSearchEnv 缺省（测试 / 无注入）→ 不追加，prompt 形态与改动前一致。
  const scenarioPromptWithSources =
    paperSearchEnv && mcpRefs.includes(PAPER_SEARCH_MCP_REF)
      ? `${scenarioPrompt}\n\n${buildPaperSourceAvailabilityBlock(paperSearchEnv)}`
      : scenarioPrompt
  const mcpServerSpecs = [
    ...expandMcpRefs(packId, mcpRefs, globalMcpServers),
    ...loadBundledMcpServers(packDir, packId),
  ]
  // registry entry 的 subAgentRefs 从 manifest.subAgents 名字派生（master prompt 注入用）
  const subAgentRefs = subAgents.map((sa) => sa.name)

  // 子 Agent model 解析（claudeAvailable 门控 + 别名家族激活校验/回退），scenario 与 worker 共用。
  const resolveModel = (agentName: string, alias: 'haiku' | 'sonnet' | 'opus' | undefined): string | undefined =>
    resolveAgentModel({ agentName, alias, claudeAvailable, channel, leadModelId, onModelNotice, notifiedFallback })

  const scenarioModel = resolveModel(scenarioAgent.name, scenarioAgent.model)

  // 注册 scenarioAgent
  try {
    registry.register({
      kind: 'subagent',
      name: scenarioAgent.name,
      source: 'capability-pack',
      packId,
      role: 'scenario',
      def: {
        description: scenarioAgent.description,
        prompt: `${scenarioPromptWithSources}\n\n${outputLang}`,
        // tools 缺省 → 不传给 SDK，SDK 解读为继承父级全集（见 sdk.d.ts AgentDefinition.tools：
        // "If omitted, inherits all tools from parent"）。本层忠实透传 manifest 的 tools。
        // ⚠️ 想让 planner 真正收窄工具集（如 lit-search planner 全程不调工具、只为省掉继承来的
        // 全套 MCP 工具说明 ~3.8 万 token，见 #669）时，必须给一个【非空占位小工具】，不能写 `[]`：
        // SDK 只承诺"省略=继承全集"，对 `[]` 不作保证——实测 `[]` 会被当成"未设置→给全套"，白改。
        ...(scenarioAgent.tools !== undefined && { tools: scenarioAgent.tools }),
        // model 经 resolveModel 解析：非 Claude lead 丢弃别名继承 lead；Claude lead 下校验
        // 别名家族是否激活，未激活则回退到 lead 具体 id（见 resolveAgentModel）。
        ...(scenarioModel !== undefined && { model: scenarioModel }),
        // mcpRefs string 名展开为完整 dict，规避 SDK 对 string-form 引用的 lookup 不确定性。
        ...(mcpServerSpecs.length > 0 && { mcpServers: mcpServerSpecs }),
      },
      ...(subAgentRefs.length > 0 && { subAgentRefs }),
    })
  } catch (err) {
    console.warn(`[CapabilityPackLoader] 注册 scenarioAgent 失败：packId=${packId}`, err)
    return
  }

  // 注册 worker subAgents（spec §4.2 sub-agents/）— 与 scenarioAgent 同 packId / source
  // workerPrompts 已由 loadCapabilityPacks 主循环对 manifest.subAgents 每条 resolvePromptFile 后 push
  // （任一失败整包 continue），与 subAgents 一一对应；Map.get 必有值，故 `!` 断言。
  const workerPromptByName = new Map(workerPrompts.map((w) => [w.name, w.content]))
  for (const sa of subAgents) {
    const prompt = workerPromptByName.get(sa.name)!
    const workerModel = resolveModel(sa.name, sa.model)
    try {
      registry.register({
        kind: 'subagent',
        name: sa.name,
        source: 'capability-pack',
        packId,
        role: 'worker',
        def: {
          description: sa.description,
          prompt: `${prompt}\n\n${outputLang}`,
          ...(sa.tools !== undefined && { tools: sa.tools }),
          // skills 直通 AgentDefinition.skills：声明后这些已发现 Skill 加载进该 worker 自己的隔离上下文，
          // 让它能在 `Skill(<name>)` 里跑重型 Skill（如综述 body-writer）而产物不回灌主循环。
          ...(sa.skills !== undefined && { skills: sa.skills }),
          // 同上 scenarioAgent.model 的 resolveModel 解析（claudeAvailable 门控 + 激活校验/回退）。
          ...(workerModel !== undefined && { model: workerModel }),
        },
      })
    } catch (err) {
      console.warn(`[CapabilityPackLoader] 注册 worker subAgent 失败：packId=${packId}, name=${sa.name}`, err)
    }
  }

  // 注册 skillRefs
  for (const ref of skillRefs) {
    try {
      registry.register({
        kind: 'skill',
        name: ref,
        source: 'capability-pack',
        packId,
        slug: ref,
      })
    } catch (err) {
      console.warn(`[CapabilityPackLoader] 注册 skillRef 失败：packId=${packId}, ref=${ref}`, err)
    }
  }

  // 注册 mcpRefs
  for (const ref of mcpRefs) {
    try {
      registry.register({
        kind: 'mcp',
        name: ref,
        source: 'capability-pack',
        packId,
        type: 'stdio',
      })
    } catch (err) {
      console.warn(`[CapabilityPackLoader] 注册 mcpRef 失败：packId=${packId}, ref=${ref}`, err)
    }
  }
}
