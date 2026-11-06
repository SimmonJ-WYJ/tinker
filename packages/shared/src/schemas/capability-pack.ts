/**
 * Capability Pack Manifest schema —— A3 契约四要素 + Proposal 副产品占位（Phase 3）。
 *
 * 4 红线：
 *   1. 能力包不允许改 Master Orchestrator system prompt（schema strict() 拦未知字段如 masterPrompt）
 *   2. scenario agent name 不与 SDK 内置 'general-purpose' 同名 + kebab-case
 *   3. scenario agent prompt 必须英文（heuristic: 拒绝 CJK 字符）—— prompt 已切到独立 .md 文件
 *      （spec §4.2 / §6.1 物理目录形态），CJK 检查从 schema 转到 loader 的读文件后；
 *      schema 仅校验 `promptPath` 形态（非空 + 以 .md 结尾）。
 *   4. scenario agent tools 不含 'Task' / 'Agent'（C1 子 Agent 不能再生子 Agent）
 *
 * Proposal 副产品（capabilities.proposals[]）schema 提供占位，但 Phase 3 不实现 Proposal 产出流程
 * （依赖 north-star §一-A Proposal 基础设施，目前未落地）。
 */
import { z } from 'zod'
import { isSubagentToolUse } from '../utils/subagent-tool-name.ts'

const KEBAB_CASE = /^[a-z][a-z0-9-]*[a-z0-9]$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+)?$/

/**
 * 共享 SubAgent 定义 schema —— scenario agent 与 worker subagent 同形：
 *   name + description + promptPath（.md）+ tools + 可选 model。
 *
 * 应用红线 2 / 4（name ≠ general-purpose；tools 不含 Task/Agent）；
 * 红线 3（CJK）由 loader 读 promptPath 后做，schema 看不到字符串内容。
 */
const SubAgentDefinitionSchema = z
  .object({
    name: z.string().regex(KEBAB_CASE, 'name 必须 kebab-case (^[a-z][a-z0-9-]*[a-z0-9]$)'),
    description: z.string().min(1, 'description 必填'),
    // 相对 manifest.json 所在目录的 .md 文件路径（spec §6.1 形态）；
    // 文件内容由 loader 读取并做 CJK 红线检查（红线 3 已从 schema 搬到 loader）。
    promptPath: z
      .string()
      .min(1, 'promptPath 必填')
      .regex(/\.md$/, 'promptPath 必须以 .md 结尾（spec §4.2 / §6.1 物理目录形态）'),
    // tools 真正可选（不 default 空数组）：
    //   - 缺省 → SDK 解读为 "inherit all tools from parent"（AgentDefinition.tools? 注释明示）
    //   - `[]`  → SDK 解读为空白名单（零工具）
    //   - `[...]` → 显式 allowlist
    // 写成 default([]) 会让"不写 tools"被静默改成"零工具"，与 SDK 默认语义相反。
    tools: z.array(z.string()).optional(),
    // skills 直通 AgentDefinition.skills（SDK 0.2.x）：声明后，仅这些已发现的 Skill 会被加载进
    // 这个 worker subAgent 自己的（隔离）system prompt —— subAgent 默认不带任何 Skill，必须显式 opt-in。
    // 用途：让某个 worker 在它自己的上下文里 `Skill(<name>)` 跑一份重型 Skill（如综述 body-writer），
    // 这样 Skill 生成的大体量产物（如整篇综述 HTML）留在 worker 上下文、不回灌主循环，显著降低主上下文压缩概率。
    // 缺省 → 该 subAgent 不加载任何 Skill（与 SDK 默认一致）。
    skills: z.array(z.string()).optional(),
    model: z.enum(['haiku', 'sonnet', 'opus']).optional(),
  })
  .strict()
  .refine(
    (v) => v.name !== 'general-purpose',
    { message: 'name 禁与 SDK 内置 "general-purpose" 同名（红线 2）', path: ['name'] },
  )
  .refine(
    // A0b 双名收敛：用 isSubagentToolUse 统一判定（同 SUBAGENT_TOOL_NAMES 来源），
    // 避免后续 SDK 再加别名时本处漏改。tools 缺省时无需检查（继承父级，父级已无 Task/Agent）。
    (v) => !v.tools || !v.tools.some((t) => isSubagentToolUse({ name: t })),
    { message: 'tools 不能含 "Task"/"Agent"（红线 4 / C1 — 子 Agent 不能再生子 Agent）', path: ['tools'] },
  )

const ProposalCapabilitySchema = z
  .object({
    kind: z.enum(['citation-relation', 'evidence-set']),
    trigger: z.string().min(1),
    reasoningTemplate: z.string().min(1),
  })
  .strict()

/**
 * Phase 3 唯一允许的 UI framework；Phase 4 评估扩展可插拔机制。
 * 注：实际 RightPanel 已迁移到动态多 tab（见 renderer/atoms/right-panel-tabs.ts），
 * 'conversation-and-artifact' 保留作为 schema 历史值，对应"主对话 + 右侧多 tab"渲染模式。
 */
const UiFrameworkSchema = z.enum(['conversation-and-artifact'])

export const CapabilityPackManifest = z
  .object({
    packId: z.string().min(1, 'packId 必填且非空'),
    version: z.string().regex(SEMVER, 'version 必须 semver 形态 (x.y.z 或 x.y.z-pre)'),
    scenarioAgent: SubAgentDefinitionSchema,
    skillRefs: z.array(z.string().min(1)).default([]),
    mcpRefs: z.array(z.string().min(1)).default([]),
    /**
     * subAgents: 能力包自带的 worker SubAgent 定义集合（spec §4.2 sub-agents/）。
     *
     * 每个 worker 与 scenarioAgent 同形（name / description / promptPath / tools / model）。
     * 由 loader 与 scenarioAgent 同步落 registry（source='capability-pack'，同 packId）。
     * 主 Agent prompt 注入"当此场景 Agent 被激活时，PLAN 派活的 SubAgent 应来自这个白名单"，
     * registry entry 的 subAgentRefs 字段从 `subAgents.map(s => s.name)` 派生。
     */
    subAgents: z.array(SubAgentDefinitionSchema).default([]),
    uiFramework: UiFrameworkSchema,
    proposals: z.array(ProposalCapabilitySchema).optional(),
    /**
     * summaryI18n: 面向用户的一句话能力摘要（配置页只读总览展示用）。
     * 与 scenarioAgent.description（写给 LLM 的路由 prompt）分离——后者技术性、英文、给 Agent；
     * 前者给用户。可选；UI 取 summaryI18n[lang] ?? description 回退。仅 UI 展示，不注入 prompt。
     */
    summaryI18n: z
      .object({ zh: z.string().optional(), en: z.string().optional() })
      .optional(),
  })
  .strict()  // 红线 1: 拒绝未知字段（masterPrompt 等）

export type CapabilityPackManifestType = z.infer<typeof CapabilityPackManifest>
export type CapabilityPackManifestInput = z.input<typeof CapabilityPackManifest>
