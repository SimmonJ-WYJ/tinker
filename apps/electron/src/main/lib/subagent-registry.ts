/**
 * SubagentRegistry —— 注册中心的接口与类型。
 *
 * Phase 1 仅承载 subagent 注册项；Phase 2 扩展为 discriminated union：
 *   subagent | skill | mcp
 *
 * 关键约束（north-star §三-3 A2 + sdk-orchestrator-subagents-spec §三 C1）：
 *  - 注册项含来源元数据 source ∈ { 'builtin' | 'capability-pack' | 'user-config' }
 *  - capability-pack 来源时 packId 必须非空
 *  - 命名空间按 kind 独立维护：同 kind 内同名冲突按 source 优先级；不同 kind 同名不冲突
 *  - snapshot() 一次性产出 SDK 可直接消费的 { agents } 字典（仅含 subagent kind）
 *  - Skill / MCP 不进 SDK options.agents —— 各走各自现有管道
 *  - 任一子 Agent 的 tools 字段禁止含 'Task' / 'Agent'（C1：子 Agent 不能再生子 Agent）
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk'
import { isSubagentToolUse } from '@asci/shared'

export type RegistryEntrySource = 'builtin' | 'capability-pack' | 'user-config'

/** 共用基础字段 */
interface RegistryEntryBase {
  /** 注册项名 — 在同 kind 内唯一；跨 kind 可同名 */
  name: string
  /** 来源 */
  source: RegistryEntrySource
  /** 能力包 ID — source === 'capability-pack' 时必填 */
  packId?: string
}

/** 子 Agent 注册项（Phase 1 兼容） */
export interface SubagentRegistryEntry extends RegistryEntryBase {
  kind: 'subagent'
  /** SDK AgentDefinition（含 description / prompt / tools / model 等） */
  def: AgentDefinition
  /**
   * subAgentRefs（仅 source === 'capability-pack' 的 scenario Agent 有意义）
   *
   * 能力包 manifest 声明的"我推荐主 Agent 派给我这些子 Agent 协作"集合（spec §5.3 PLAN 派活基础）。
   * 注入到主 Agent system prompt 作为路由信号；不强制约束，主 Agent 仍持最终派活权。
   */
  subAgentRefs?: string[]
  /**
   * 角色（仅 source === 'capability-pack' 必填，其他来源忽略）：
   *  - 'scenario'：能力包的场景 Agent — 主 Agent 直接派活的对象；SubagentStop 时写 D2 sticky + emit pack.taskCompleted
   *  - 'worker'：能力包自带的 worker SubAgent（spec §4.2 sub-agents/）— 仅在 PLAN 派活中协作，不触发 sticky / 事件
   *
   * 用于 `pack-task-completed-hook` 的 lookup 在 SubagentStop 上区分"场景 Agent 收口"和"worker
   * 中途完成"两种语义。spec §3.1 #9 明确 pack.taskCompleted 只覆盖前者。
   */
  role?: 'scenario' | 'worker'
}

/** Skill 注册项（Phase 2 新增）— 仅元数据镜像，完整 SKILL.md 走 system prompt */
export interface SkillRegistryEntry extends RegistryEntryBase {
  kind: 'skill'
  /** Skill 在 frontmatter 中的 slug */
  slug: string
  /** Skill 类别（document / utility / ...） */
  category?: string
}

/** MCP 注册项（Phase 2 新增）— 仅元数据镜像，options.mcpServers 走 composeMcpServers */
export interface McpRegistryEntry extends RegistryEntryBase {
  kind: 'mcp'
  /** MCP 类型（stdio / url 等） */
  type: string
  /** 是否内建（与 composeMcpServers.isBuiltin 一致） */
  isBuiltin?: boolean
}

/** 所有注册项类型的 discriminated union */
export type RegistryEntry = SubagentRegistryEntry | SkillRegistryEntry | McpRegistryEntry

/** 注册项种类 */
export type RegistryEntryKind = RegistryEntry['kind']

export interface SubagentRegistrySnapshot {
  /** 仅含 subagent kind — 直接喂 SDK options.agents */
  agents: Record<string, AgentDefinition>
}

export interface SubagentRegistry {
  /** 注册一条 entry；同 kind 内冲突按命名空间策略处理；不同 kind 同名不冲突 */
  register(entry: RegistryEntry): void
  /** 按 predicate 取消注册（跨 kind 均生效） */
  unregister(predicate: (entry: RegistryEntry) => boolean): void
  /**
   * 枚举注册项（按 kind / source / packId 过滤）。
   * 不传 filter 或空 filter 时返回所有 kind 的全部注册项。
   */
  list(filter?: {
    kind?: RegistryEntryKind
    source?: RegistryEntrySource
    packId?: string
  }): readonly RegistryEntry[]
  /**
   * 按 name 取一项。
   * - 传 `{ kind }`：精确定位该 kind 下的 entry
   * - 不传 `{ kind }`：name 全集只有 0 或 1 个匹配时返回（兼容 Phase 1）；多 kind 同名时抛错
   */
  get(name: string, opts?: { kind: RegistryEntryKind }): RegistryEntry | null
  /**
   * 产出 SDK 可消费的 snapshot。仅含 subagent kind。
   *
   * **注意：返回的 def 对象按引用透传，调用方禁止修改**（如改 .tools 数组）— 会污染 registry 持有的同一引用。
   */
  snapshot(): SubagentRegistrySnapshot
}

// ─── 内存实现 ───────────────────────────────────────────────────────────────

/** store 的 key = `kind:name`，让跨 kind 同名不冲突 */
const storeKey = (kind: RegistryEntryKind, name: string): string => `${kind}:${name}`

/** 命名空间优先级表（数字越小优先级越高） */
const SOURCE_PRIORITY: Record<RegistryEntrySource, number> = {
  builtin: 0,
  'user-config': 1,
  'capability-pack': 2,
}

export function createInMemorySubagentRegistry(): SubagentRegistry {
  // key 为 `kind:name`，值为对应 RegistryEntry
  const store = new Map<string, RegistryEntry>()

  const validateEntry = (entry: RegistryEntry): void => {
    // capability-pack 来源对所有 kind 都必须提供 packId
    if (entry.source === 'capability-pack' && !entry.packId) {
      throw new Error(
        `SubagentRegistry: capability-pack 来源必须提供 packId（name=${entry.name}）`,
      )
    }
    // 以下约束仅对 subagent kind 生效
    if (entry.kind === 'subagent') {
      // 名称不能与 SDK 内置 general-purpose 同名
      if (entry.name === 'general-purpose') {
        throw new Error(`SubagentRegistry: 子 Agent 名禁与 SDK 内置 'general-purpose' 同名`)
      }
      // C1 红线：子 Agent tools 不能含 Task / Agent
      const tools = entry.def.tools ?? []
      for (const tool of tools) {
        if (isSubagentToolUse({ name: tool })) {
          throw new Error(
            `SubagentRegistry: C1 红线 — 子 Agent tools 不能含 Task / Agent（name=${entry.name}, tool=${tool}）`,
          )
        }
      }
    }
  }

  return {
    register(entry) {
      validateEntry(entry)
      const key = storeKey(entry.kind, entry.name)
      const existing = store.get(key)
      if (!existing) {
        store.set(key, entry)
        return
      }
      // 同 kind 内冲突策略：两个 capability-pack 同名 → 直接抛错
      if (existing.source === 'capability-pack' && entry.source === 'capability-pack') {
        throw new Error(
          `SubagentRegistry: kind=${entry.kind} name="${entry.name}" 已被 capability-pack "${existing.packId}" 注册；` +
            `后激活的 pack "${entry.packId}" 失败`,
        )
      }
      const existingP = SOURCE_PRIORITY[existing.source]
      const incomingP = SOURCE_PRIORITY[entry.source]
      if (incomingP < existingP) {
        // 新来的优先级更高 → 覆盖（例：builtin 覆盖 user-config）
        console.warn(
          `[SubagentRegistry] kind=${entry.kind} name="${entry.name}" 覆盖：${existing.source} → ${entry.source}`,
        )
        store.set(key, entry)
      } else {
        // 现有优先级更高或相同 → 保留现有，忽略新注册
        console.warn(
          `[SubagentRegistry] kind=${entry.kind} name="${entry.name}" 冲突：保留 ${existing.source}，忽略新注册的 ${entry.source}`,
        )
      }
    },
    unregister(predicate) {
      for (const [key, entry] of store.entries()) {
        if (predicate(entry)) store.delete(key)
      }
    },
    list(filter) {
      const all = Array.from(store.values())
      return all.filter((e) => {
        if (filter?.kind && e.kind !== filter.kind) return false
        if (filter?.source && e.source !== filter.source) return false
        if (filter?.packId && e.packId !== filter.packId) return false
        return true
      })
    },
    get(name, opts): RegistryEntry | null {
      // 有 kind 参数 → 精确定位
      if (opts?.kind) {
        return store.get(storeKey(opts.kind, name)) ?? null
      }
      // 无 kind → 扫全集，0 个返 null，1 个返该 entry，>1 个（跨 kind 同名）抛错
      const matches = Array.from(store.values()).filter((e) => e.name === name)
      if (matches.length === 0) return null
      if (matches.length === 1) return matches[0] as RegistryEntry
      throw new Error(
        `SubagentRegistry.get('${name}') 存在 ${matches.length} 个不同 kind 的 entry，必须传 { kind } 明确指定`,
      )
    },
    snapshot() {
      // snapshot 仅产出 subagent kind，Skill / MCP 各走各自管道
      const agents: Record<string, AgentDefinition> = {}
      for (const e of store.values()) {
        if (e.kind === 'subagent') agents[e.name] = e.def
      }
      return { agents }
    },
  }
}
