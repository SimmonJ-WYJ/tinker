/**
 * agent-prompt-builder 不变量测试
 *
 * 确保 Alpha 阶段 ASCI 科研 Agent 定位不被意外回退。
 * 测试策略：key token 断言（包含/不包含关键字符串），不做 snapshot。
 *
 * 注：issue #54 把内置 prompt 统一为英文；以下断言全部按英文 token 比对。
 */

import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-prompt-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

test('模块可被导入（脚手架）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}`)
  expect(typeof mod.buildSystemPrompt).toBe('function')
  expect(typeof mod.buildBuiltinAgents).toBe('function')
  expect(typeof mod.buildDynamicContext).toBe('function')
})

test('共享证据契约符号被导出可复用', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-contract-exports`)
  expect(mod.EVIDENCE_REQUIRED_BY_STATUS).toBeDefined()
  expect(mod.SOURCE_TYPES).toBeDefined()
  expect(mod.STATUS_LABELS).toBeDefined()
  expect(mod.RED_LINES).toBeDefined()
  expect(mod.STATUS_FLOW).toBeDefined()
  expect(mod.AUDIT_CHECKLIST).toBeDefined()
  expect(typeof mod.renderEvidenceSchema).toBe('function')
  expect(typeof mod.renderRedLines).toBe('function')
})

test('renderEvidenceSchema — 默认 quote 规则为 ≤80 CJK 短摘，不含 bucket', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-schema-default`)
  const schema = mod.renderEvidenceSchema('read')
  expect(schema).toContain('≤25 words or ≤80 CJK chars')
  expect(schema).not.toContain('≤240 CJK chars')
  expect(schema).not.toContain('bucket')
})

test('renderEvidenceSchema litreview variant — quote 规则对齐 <q> 契约（≤240 CJK + 单连续 span + 保留源语言）且含 bucket', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-schema-litreview`)
  const schema = mod.renderEvidenceSchema('read', 'litreview')
  // ≤240 CJK + 单连续 span + 保留源语言（与 literature-review-result skill 的 <q> 完全对齐）
  expect(schema).toContain('≤240 CJK chars')
  expect(schema).toContain('SINGLE CONTIGUOUS span')
  expect(schema).toContain('PRESERVE THE SOURCE LANGUAGE')
  // 不再使用全局短摘规则
  expect(schema).not.toContain('≤25 words or ≤80 CJK chars')
  // bucket 字段进入 fields 行 + 单列规则
  expect(schema).toContain('bucket')
  expect(schema).toContain('deep-read | abstract-only | insufficient')
  // source_id 契约（reader / skimmer 不再各手写一遍；硅默失败点的唯一真相源）
  expect(schema).toContain('PARENT Zotero item key')
  expect(schema).toContain('NEVER use the attachmentKey')
})

test('expandPromptTemplates — {{evidenceSchema:read,litreview}} 展开为 litreview 综述档规则', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-expand-litreview`)
  const out = mod.expandPromptTemplates('READER:\n{{evidenceSchema:read,litreview}}\nEND')
  expect(out.ok).toBe(true)
  if (out.ok) {
    expect(out.content).toContain('≤240 CJK chars')
    expect(out.content).toContain('SINGLE CONTIGUOUS span')
    expect(out.content).toContain('bucket')
    expect(out.content).toContain('required_for_read:')
  }
})

test('expandPromptTemplates — {{evidenceSchema:read}} 无 variant 仍走默认短摘规则', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-expand-default`)
  const out = mod.expandPromptTemplates('{{evidenceSchema:read}}')
  expect(out.ok).toBe(true)
  if (out.ok) {
    expect(out.content).toContain('≤25 words or ≤80 CJK chars')
    expect(out.content).not.toContain('≤240 CJK chars')
    expect(out.content).not.toContain('bucket')
  }
})

test('expandPromptTemplates — 未知 evidenceSchema variant 返回 ok:false 并报错', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-expand-bad-variant`)
  const out = mod.expandPromptTemplates('{{evidenceSchema:read,bogus}}')
  expect(out.ok).toBe(false)
  if (!out.ok) {
    expect(out.reason).toContain('variant')
  }
})

test('expandPromptTemplates — 非法 status 仍按原逻辑报错（variant 不干扰）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-expand-bad-status`)
  const out = mod.expandPromptTemplates('{{evidenceSchema:bogus,litreview}}')
  expect(out.ok).toBe(false)
  if (!out.ok) {
    expect(out.reason).toContain('未知 status')
  }
})



test('buildSystemPrompt 使用 Tinker 通用 Agent 身份', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-id`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain('Tinker Agent')
  expect(prompt).not.toContain('I refer to myself as ASCI')
  expect(prompt).toContain('Alpha')
  expect(prompt).toContain('general-purpose assistant')
  expect(prompt).not.toContain('I am the ASCI research Agent')
  expect(prompt).toContain('not the default identity')
})

test('buildSystemPrompt 包含 Alpha 主业（论文检索 + 文献综述）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-mission`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).toContain('paper retrieval')
  expect(prompt).toContain('literature review')
  expect(prompt).toContain('never hallucinate')
})

test('buildSystemPrompt 包含三原则（全面/准确/不幻想）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-princ`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).toContain('Comprehensive')
  expect(prompt).toContain('Accurate')
  expect(prompt).toContain('No hallucination')
})

test('buildSystemPrompt 包含能力与边界（接单声明句式）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-bound`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).toContain('Capabilities and Boundaries')
  expect(prompt).toContain('Accept non-literature tasks directly')
  expect(prompt).not.toContain('during Alpha my strongest area is paper retrieval and review')
})

test('buildSystemPrompt 读论文优先 papers-rg（结构化解析 + 关键词取证）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-readpref`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).toContain('Reading papers (prefer papers-rg)')
  // 关键词取证路径 + 结构化导航工具都要被点名
  expect(prompt).toContain('mcp__papers-rg__papers_search_keywords')
  expect(prompt).toContain('mcp__papers-rg__papers_read_context')
  expect(prompt).toContain('mcp__papers-rg__papers_read_outline')
  expect(prompt).toContain('mcp__papers-rg__papers_read_article_section')
  // itemKey → paperId 直通 + zotero 全文仅作回落
  expect(prompt).toContain('The `paperId` IS the Zotero attachment `key`')
  expect(prompt).toContain('Fall back to `zotero_read_attachment`')
})

test('buildSystemPrompt Section 5 — 我的团队（3 人小队 + body-writer 为 skill，非 SubAgent）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-team`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain('My Team')
  expect(prompt).toContain('searcher')
  expect(prompt).toContain('reader')
  expect(prompt).toContain('fact-checker')
  // synthesizer 已退役：review body 由 literature-review-result skill 生产，团队不再有 synthesizer SubAgent
  expect(prompt).toContain('3 SubAgents')
  expect(prompt).toContain('literature-review-result')
  expect(prompt).not.toContain('### ✍️ synthesizer')
  expect(prompt).toContain('Agents define role / responsibility')
  expect(prompt).toContain('Skills supply capabilities')
})

test('buildSystemPrompt Section 5 — 主 Agent 编排说明包含状态机流转和回流边', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-status-flow`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain(mod.STATUS_FLOW)
  expect(prompt).toContain('candidate → read')
  expect(prompt).toContain('read → cited')
  expect(prompt).toContain('cited → verified | disputed | rejected')
  expect(prompt).toContain('Any rejected: delivery is blocked')
  expect(prompt).toContain('Any disputed: do NOT adjudicate')
  expect(prompt).toContain('AskUserQuestion')
})

test('buildSystemPrompt Section 5 — claudeAvailable=false 下的分叉正确', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-nonclaudeteam`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
    claudeAvailable: false,
  })
  expect(prompt).toContain('inherit the lead Agent')
  expect(prompt).not.toContain('haiku')
  expect(prompt).not.toContain('sonnet')
})

test('buildSystemPrompt — 综述阶段禁止补充检索硬规则（综述 turn 内不得 reroute lit-search / searcher）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-review-no-retrieval`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain('No retrieval during a review')
  expect(prompt).toContain('do **NOT** dispatch `lit-search`')
})

test('buildSystemPrompt Section 6 — 工作区（会话文件 + .context/ + 论文索引 + 交付语）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-ws`)
  const prompt = mod.buildSystemPrompt({
    workspaceName: 'Literature Survey Project',
    workspaceSlug: 'lit-research',
    sessionId: 'test-session-123',
    permissionMode: 'default',
  })
  // 会话文件区
  expect(prompt).toContain('Session Files')
  // .context/
  expect(prompt).toContain('.context/')
  expect(prompt).toContain('note.md')
  expect(prompt).toContain('todo.md')
  // 论文索引（需要显式调用落地工具）
  expect(prompt).toContain('paper panel')
  expect(prompt).toContain('mcp__paper-search__process_search_results')
  // 报数硬规则（issue #140 #5）— S4 红线 + verbatim quote display_count
  expect(prompt).toContain('S4 When reporting how many papers')
  expect(prompt).toContain('verbatim quote the `display_count`')
  // 交付语规则
  expect(prompt).toContain('@')  // 提示用户 @ 引用
  // 工作区名
  expect(prompt).toContain('Literature Survey Project')
  expect(prompt).toContain('lit-research')
})

test('buildSystemPrompt — 不再出现旧开发导向文案', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-nodev1`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).not.toContain('通用AI助手')
  expect(prompt).not.toContain('通用 AI 助手')
  expect(prompt).not.toContain('code-reviewer')
  expect(prompt).not.toContain('代码库探索')
})

test('buildSystemPrompt Section 7 — 反幻觉红线 R1-R5 + S1 + S2 + S3', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-rline`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).toContain('Anti-hallucination Red Lines')
  for (const mark of ['R1', 'R2', 'R3', 'R4', 'R5', 'S1', 'S2', 'S3']) {
    expect(prompt).toContain(mark)
  }
  expect(prompt).toContain('fabricate references')
  expect(prompt).toContain('training memory')
  expect(prompt).toContain('no match')
})

test('buildSystemPrompt Section 9 — 工具使用剔除开发者黑话', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-nodev2`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  // 保留：基础工具规范
  expect(prompt).toContain('Read')
  expect(prompt).toContain('Glob')
  expect(prompt).toContain('Grep')
  // 剔除：开发者黑话
  expect(prompt).not.toContain('破坏性操作')
  expect(prompt).not.toContain('先搜后写')
  expect(prompt).not.toContain('rm、git push')
  expect(prompt).not.toContain('bug')
  expect(prompt).not.toContain('代码审查')
  expect(prompt).not.toContain('代码重构')
})

test('buildSystemPrompt Section 10 — Skills 优先协议保留', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-skills`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).toContain('Skills-First Protocol')
  expect(prompt).toContain('available_skills')
})

test('buildSystemPrompt Section 11 — 计划模式 plan 分叉', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-plan`)
  const planPrompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'plan',
  })
  expect(planPrompt).toContain('Plan Mode')
  expect(planPrompt).toContain('.context/plan/')
  expect(planPrompt).toContain('ExitPlanMode')

  const normalPrompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(normalPrompt).toContain('Plan-mode file path')
  expect(normalPrompt).not.toContain('You are currently in plan mode')
})

test('buildSystemPrompt — 占位文字已被替换', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-placeholder`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).not.toContain('临时占位')
  expect(prompt).not.toContain('TODO')
})

test('buildSystemPrompt — 章节按新顺序呈现（身份 → 使命 → 三原则 → 能力边界 → 团队 → 工作区 → 反幻觉 → 不确定性 → 工具 → Skills → 计划 → Output Language）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-order`)
  const prompt = mod.buildSystemPrompt({
    workspaceName: 'Order Test',
    workspaceSlug: 'order-test',
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  const idxOf = (s: string) => prompt.indexOf(s)

  const identityIdx = idxOf('# Tinker Agent · Alpha')
  const missionIdx = idxOf('## Mission')
  const principlesIdx = idxOf('## Three Principles')
  const capabilitiesIdx = idxOf('## Capabilities and Boundaries')
  const teamIdx = idxOf('## My Team')
  const workspaceIdx = idxOf('## Workspace')
  const redlineIdx = idxOf('## Anti-hallucination Red Lines')
  const uncertaintyIdx = idxOf('## Handling Uncertainty')
  const toolsIdx = idxOf('## Tool Usage')
  const skillsIdx = idxOf('## Skills-First Protocol')
  const outputLangIdx = idxOf('## Output Language')

  // 全部找到
  for (const i of [identityIdx, missionIdx, principlesIdx, capabilitiesIdx, teamIdx, workspaceIdx, redlineIdx, uncertaintyIdx, toolsIdx, skillsIdx, outputLangIdx]) {
    expect(i).toBeGreaterThan(-1)
  }

  // 顺序递增
  expect(identityIdx).toBeLessThan(missionIdx)
  expect(missionIdx).toBeLessThan(principlesIdx)
  expect(principlesIdx).toBeLessThan(capabilitiesIdx)
  expect(capabilitiesIdx).toBeLessThan(teamIdx)
  expect(teamIdx).toBeLessThan(workspaceIdx)
  expect(workspaceIdx).toBeLessThan(redlineIdx)
  expect(redlineIdx).toBeLessThan(uncertaintyIdx)
  expect(uncertaintyIdx).toBeLessThan(toolsIdx)
  expect(toolsIdx).toBeLessThan(skillsIdx)
  expect(skillsIdx).toBeLessThan(outputLangIdx)
})

test('RED_LINES.S3 — 0 命中 / 字段错配显式汇报红线已注册', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-s3-redline`)
  expect(mod.RED_LINES.S3).toBeDefined()
  expect(mod.RED_LINES.S3).toContain('S3')
  expect(mod.RED_LINES.S3).toContain('no match')
  expect(mod.RED_LINES.S3).toContain('core-field mismatch')
  expect(mod.RED_LINES.S3).toContain('Approximate match (non-exact)')
  expect(mod.RED_LINES.S3).toContain('pad with')
})

test('buildSystemPrompt — 彻底去除开发者黑话清单', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-blacklist`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  const blacklist = [
    '通用AI助手',
    '通用 AI 助手',
    '破坏性操作',
    '先搜后写',
    'bug',
    '代码审查',
    '代码重构',
    'code-reviewer',
    '代码库探索',
    '技术调研',
    '架构模式',
    '编码规范',
    'rm、git push',
  ]
  for (const black of blacklist) {
    expect(prompt).not.toContain(black)
  }
})


test('buildSystemPrompt §3 三原则 — 不幻想原则强化包含"0 命中明示"', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-no-fab`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'test-session',
    permissionMode: 'default',
  })
  expect(prompt).toContain('zero hits MUST be reported explicitly')
  expect(prompt).toContain('never pad with similar / same-title papers')
})

test('buildSystemPrompt — Output Language directive 默认 EN，按 language 参数切换 ZH', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-output-lang`)
  const defaultPrompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
  })
  expect(defaultPrompt).toContain('## Output Language')
  expect(defaultPrompt).toContain('Resolved reply language for this turn')
  expect(defaultPrompt).toContain('`en` (English)')
  expect(defaultPrompt).toContain('Reply in English.')
  // 软兜底已下沉到 orchestrator 的 detectOutputLanguage；prompt 内不再出现，避免与硬判打架
  expect(defaultPrompt).not.toContain('follow the message\'s language')

  const zhPrompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    language: 'zh',
  })
  expect(zhPrompt).toContain('`zh` (Chinese (中文))')
  expect(zhPrompt).toContain('Reply in Chinese (中文).')
})

// issue #140 #3.3：LLM 在英文 query + 英文 UI 下仍把中文叙述 + 英文 code block
// 混在同一条回复里。directive 必须显式锁定"单回合内自然语言不切换"。
test('buildSystemPrompt — Output Language directive 包含单回合禁混语言红线 (#140-3.3)', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-no-mix-lang`)
  for (const lang of ['en', 'zh'] as const) {
    const prompt = mod.buildSystemPrompt({
      sessionId: 'sid',
      permissionMode: 'default',
      language: lang,
    })
    expect(prompt).toContain('Single-language lock per turn')
    expect(prompt).toContain('Do NOT mix Chinese and English narrative')
  }
})

// UI=en + 用户用中文提问时，可见回复正确切到中文，但 Thinking 折叠块仍是英文。
// directive 必须显式声明 reasoning/thinking 也走 resolved language，否则模型默认按 UI 写思考。
test('buildSystemPrompt — Output Language directive 覆盖 extended-thinking / reasoning 轨迹', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-thinking-lang`)
  for (const lang of ['en', 'zh'] as const) {
    const prompt = mod.buildSystemPrompt({
      sessionId: 'sid',
      permissionMode: 'default',
      language: lang,
    })
    expect(prompt).toContain('extended-thinking / reasoning traces')
    expect(prompt).toContain('reasoning/thinking blocks')
    expect(prompt).toContain('do not expose private reasoning')
  }
})

// 上一步返回内容免疫：工具 / 子 Agent / Skill / MCP / 命令 / 脚本返回的任何语言任何格式
// （table / array / JSON / HTML / text）都不得改变本轮已解析语言。
test('buildSystemPrompt — Output Language directive 包含上一步返回内容免疫条款', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-prev-step-immunity`)
  for (const lang of ['en', 'zh'] as const) {
    const prompt = mod.buildSystemPrompt({
      sessionId: 'sid',
      permissionMode: 'default',
      language: lang,
    })
    expect(prompt).toContain('Previous-step output language immunity')
    expect(prompt).toContain('NEVER changes your reply language')
    expect(prompt).toContain('tools, sub-agents, skills, MCP servers, slash commands, scripts')
    expect(prompt).toContain('plain text, tables, arrays, JSON, HTML, code')
  }
})

test('buildSubAgentOutputLanguageSection — 包含上一步返回内容免疫条款', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-subagent-immunity`)
  // en 锁体全英文
  const enSection = mod.buildSubAgentOutputLanguageSection('en')
  expect(enSection).toContain('Previous-step output language immunity')
  expect(enSection).toContain('NEVER changes your output language')
  expect(enSection).toContain('MCP responses')
  expect(enSection).toContain('plain text, tables, arrays, JSON, HTML, code')
  // zh 锁体全中文（与 buildLanguageLockBlock 同款教训：英文句子要求中文思考无中文 token 可附着）
  const zhSection = mod.buildSubAgentOutputLanguageSection('zh')
  expect(zhSection).toContain('上一步返回内容免疫')
  expect(zhSection).toContain('永远不改变你的输出语言')
  expect(zhSection).toContain('MCP 响应')
  expect(zhSection).toContain('纯文本 / 表格 / 数组 / JSON / HTML / 代码')
  // 第一段 thinking 中文锚 + 英文开场负例
  expect(zhSection).toContain('思考第一句以中文开头')
  expect(zhSection).toContain('"The user is asking"')
})

// issue #74：当前渠道（如 Moonshot / Kimi）不支持 PDF document block 时，
// system prompt 必须注入硬指令禁止 Read .pdf，引导 Agent 走 mcp__pdf_parser__pdf_parse_batch
test('buildSystemPrompt: pdfDocumentBlockSupported=false 时含 PDF compatibility 指令', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-pdf-compat-off`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 's1',
    permissionMode: 'default',
    claudeAvailable: false,
    language: 'en',
    pdfDocumentBlockSupported: false,
  })
  expect(prompt).toContain('PDF Compatibility')
  expect(prompt).toContain('mcp__pdf_parser__pdf_parse_batch')
  expect(prompt).toMatch(/do not use .*Read.* on .*\.pdf/i)
})

test('buildSystemPrompt: pdfDocumentBlockSupported=true 时不含 PDF compatibility 指令', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-pdf-compat-on`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 's1',
    permissionMode: 'default',
    claudeAvailable: true,
    language: 'en',
    pdfDocumentBlockSupported: true,
  })
  expect(prompt).not.toContain('PDF Compatibility')
})

// ===== issue #90：多轮检索增量补充 =====

test('buildSystemPrompt — Workspace 段提到 <session_paper_index> 多轮检索路由', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-issue90-sysprompt`)
  const prompt = mod.buildSystemPrompt({
    workspaceName: 'WS',
    workspaceSlug: 'ws',
    sessionId: 'sid',
    permissionMode: 'default',
  })
  expect(prompt).toContain('Multi-round retrieval in the same session')
  expect(prompt).toContain('<session_paper_index>')
})

test('buildDynamicContext — 无 sessionId 时不注入 <session_paper_index>', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-issue90-nosid`)
  // 不传 workspaceSlug，避免在非 Electron 测试进程中触发 composeMcpServers
  const ctx = mod.buildDynamicContext({
    agentCwd: '/tmp/x',
  })
  expect(ctx).not.toContain('<session_paper_index>')
})

test('buildDynamicContext — sessionId 给定但本会话无论文时不注入 <session_paper_index>', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-issue90-emptysid`)
  const ctx = mod.buildDynamicContext({
    agentCwd: '/tmp/x',
    sessionId: `empty-${Date.now()}`,
  })
  expect(ctx).not.toContain('<session_paper_index>')
})

test('buildDynamicContext — 本会话有论文时注入 <session_paper_index> 并含路由指令', async () => {
  // 先种数据：通过 paper-result-recorder 走真实写入路径
  const sessionId = `sid-${Date.now()}`
  const recorder = await import(`./paper-result-recorder.ts?cb=${Date.now()}-issue90-seed`)
  recorder.trackToolUse(sessionId, 'tu1', 'WebFetch', { query: 'q' })
  await recorder.handleToolResult(sessionId, 'tu1', JSON.stringify({
    items: [
      { title: 'Paper Alpha', authors: ['A'], doi: '10.9/alpha', year: 2024 },
      { title: 'Paper Beta', authors: ['B'], arxivId: '2402.99999', year: 2024 },
    ],
  }))

  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-issue90-inject`)
  const ctx = mod.buildDynamicContext({
    agentCwd: '/tmp/x',
    sessionId,
  })
  expect(ctx).toContain('<session_paper_index>')
  expect(ctx).toContain('Already-retrieved identifiers')
  expect(ctx).toContain('doi:10.9/alpha')
  expect(ctx).toContain('arXiv:2402.99999')
  // 路由指令：补充式 vs 重新开始
  expect(ctx).toContain('follow-up / supplemental retrieval')
  expect(ctx).toContain('start fresh / ignore previous')
  // 增量汇报模板（EN + ZH 各一行）
  expect(ctx).toContain('new papers added on top of the')
  expect(ctx).toContain('本轮新增')
})

// ===== A4 phase4：§ 0 Operating Philosophy + Capability Pack Routing + sticky 注入 =====

test('buildSystemPrompt — 包含 § 0 Operating Philosophy（前台导诊理念）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-philo`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain('## § 0 · Operating Philosophy')
  expect(prompt).toContain('front-desk router')
  expect(prompt).toContain('Route over execute')
  expect(prompt).toContain('Stay light at the front desk')
  expect(prompt).toContain('Reroute, don\'t reimplement')
})

test('buildSystemPrompt — § 0 位于身份段之后、Mission 之前', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-philo-order`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  const identityIdx = prompt.indexOf('# Tinker Agent · Alpha')
  const philoIdx = prompt.indexOf('## § 0 · Operating Philosophy')
  const missionIdx = prompt.indexOf('## Mission')
  expect(identityIdx).toBeGreaterThanOrEqual(0)
  expect(philoIdx).toBeGreaterThan(identityIdx)
  expect(missionIdx).toBeGreaterThan(philoIdx)
})

test('buildSystemPrompt — 包含 Capability Pack Routing 协议段', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-routing`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain('## Capability Pack Routing')
  expect(prompt).toContain('Routing protocol')
  expect(prompt).toContain('Session stickiness')
  expect(prompt).toContain('Task(subagent_type=')
})

test('buildSystemPrompt — Routing protocol 含 capability-pack 优先于 built-in skill 偏好', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-pack-prefer`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain('Prefer a capability-pack scenario Agent over a similar built-in Skill')
})

test('buildSystemPrompt — 综述 intent 路由优先 lit-review 能力包、skill 仅为回落（issue #392）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-review-routing`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  // 综述 = 写作 intent，必须产出综述正文，不停在检索
  expect(prompt).toContain('review-WRITING intent')
  // 有 review 能力包注册时，优先 dispatch 到场景 Agent（消除与 Capability Pack Routing「优先包」的矛盾）
  expect(prompt).toContain('when a literature-review capability pack is registered')
  expect(prompt).toContain('dispatch the request to that scenario Agent')
  // 仅当无 review 能力包时才回落到 review-proposer → literature-review-result skill 链
  expect(prompt).toContain('Only when no review capability pack is available')
  expect(prompt).toContain('literature-review-result')
  // @-mention / inline 指定的论文与 curated EvidenceSet 走同一路由（堵死 issue #392 死角）
  expect(prompt).toContain('@-mentioned / named inline')
})

test('buildSystemPrompt — PLAN dispatch protocol 支持 terminal_skill（master 跑完 steps 后调 Skill 生成终稿）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-terminal-skill`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  // PLAN 协议须显式描述 terminal_skill：在所有 subagent steps 之后，由 master 用 Skill 工具执行
  expect(prompt).toContain('terminal_skill')
  expect(prompt).toContain('after all `steps` have completed')
  // 向后兼容声明：无该字段时行为不变
  expect(prompt).toContain('behaves exactly as before')
  // 条件化 terminal_skill：带 condition 时主 Agent 据 tool_results 评估，成立才调
  // （lit-search 大检索自动产报告依赖；无 condition 仍为无条件）
  expect(prompt).toContain('condition')
  expect(prompt).toContain('only when it holds')
})

test('buildSystemPrompt — PLAN dispatch protocol 支持 confirm 确认门（master 在派活前调 present_*，scenario 子 agent 触达不到）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-confirm-gate`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  // 确认门：PLAN 带 confirm 时由 master（orchestrator）在派发任何 step 之前调确认工具
  expect(prompt).toContain('Confirmation gate')
  expect(prompt).toContain('confirm: { tool, input }')
  expect(prompt).toContain('before dispatching any step')
  // 关键语义：scenario 子 agent 触达不到 in-process 确认工具，只能在 PLAN 里声明、由 master 执行
  expect(prompt).toContain('not in the scenario sub-agent')
  // 三态回环
  expect(prompt).toContain('"choice": "adjust"')
  expect(prompt).toContain('"choice": "cancel"')
})

test('buildSystemPrompt — Dispatch discipline 段强约束 master 必须实际发出 Task tool_use（G3 修复）', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-dispatch-discipline`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).toContain('### Dispatch discipline')
  expect(prompt).toContain('MUST')
  expect(prompt).toContain('do **not** assume')
  expect(prompt).toContain('re-snapshot on every turn')
  expect(prompt).toContain('previous failures do not carry over')
})

test('buildSystemPrompt — registeredScenarioAgents 非空 → 注入 live snapshot 清单', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-live-snapshot`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
    registeredScenarioAgents: [
      { name: 'paper-retrieval-scenario', description: 'Multi-source retrieval', source: 'capability-pack', packId: 'paper-retrieval-pack' },
      { name: 'searcher', description: 'Search strategist', source: 'builtin' },
    ],
  })
  expect(prompt).toContain('### Currently registered scenario Agents')
  expect(prompt).toContain('`paper-retrieval-scenario`')
  expect(prompt).toContain('Multi-source retrieval')
  expect(prompt).toContain('capability-pack:paper-retrieval-pack')
  expect(prompt).toContain('`searcher`')
  expect(prompt).toContain('do **not** look the name up in the Skills list')
})

test('buildSystemPrompt — registeredScenarioAgents 缺省 / 空数组 → 不注入清单段', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-live-snapshot-empty`)
  const promptNoField = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(promptNoField).not.toContain('Currently registered scenario Agents')

  const promptEmpty = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
    registeredScenarioAgents: [],
  })
  expect(promptEmpty).not.toContain('Currently registered scenario Agents')
})

test('buildSystemPrompt — Capability Pack Routing 位于 My Team 之后、Workspace 之前', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-routing-order`)
  const prompt = mod.buildSystemPrompt({
    workspaceName: 'Order',
    workspaceSlug: 'order',
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  const teamIdx = prompt.indexOf('## My Team')
  const routingIdx = prompt.indexOf('## Capability Pack Routing')
  const workspaceIdx = prompt.indexOf('## Workspace')
  expect(teamIdx).toBeGreaterThanOrEqual(0)
  expect(routingIdx).toBeGreaterThan(teamIdx)
  expect(workspaceIdx).toBeGreaterThan(routingIdx)
})

test('buildSystemPrompt — 不传 stickyCapabilityPack 时不含 Active sticky pack 小节', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-nosticky`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
  })
  expect(prompt).not.toContain('Active sticky pack')
  expect(prompt).not.toContain('Sticky pack id:')
})

test('buildSystemPrompt — 传 stickyCapabilityPack 时注入 packId + 场景 Agent name + description', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-sticky`)
  const prompt = mod.buildSystemPrompt({
    sessionId: 'sid',
    permissionMode: 'default',
    claudeAvailable: true,
    stickyCapabilityPack: {
      packId: 'paper-retrieval-pack',
      scenarioAgentName: 'pack-retrieval-scenario',
      scenarioAgentDescription: 'Multi-source paper retrieval scenario with citation-trail expansion',
    },
  })
  expect(prompt).toContain('Active sticky pack')
  expect(prompt).toContain('`paper-retrieval-pack`')
  expect(prompt).toContain('`pack-retrieval-scenario`')
  expect(prompt).toContain('Multi-source paper retrieval scenario with citation-trail expansion')
  expect(prompt).toContain('Prefer dispatching to its scenario Agent')
  // 不能让 master 强套粘滞包到无关意图
  expect(prompt).toContain('do NOT force-fit the sticky pack onto a mismatched intent')
})

test('StickyCapabilityPackInfo 类型导出可被外部引用', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-sticky-type`)
  // 仅做存在性检查（type-only 导出在 runtime 不可见，但 module 整体可 import 即可）
  expect(typeof mod.buildSystemPrompt).toBe('function')
})
