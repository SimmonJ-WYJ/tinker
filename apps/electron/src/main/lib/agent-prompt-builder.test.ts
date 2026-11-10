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



test('RED_LINES.S3 — 0 命中 / 字段错配显式汇报红线已注册', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-s3-redline`)
  expect(mod.RED_LINES.S3).toBeDefined()
  expect(mod.RED_LINES.S3).toContain('S3')
  expect(mod.RED_LINES.S3).toContain('no match')
  expect(mod.RED_LINES.S3).toContain('core-field mismatch')
  expect(mod.RED_LINES.S3).toContain('Approximate match (non-exact)')
  expect(mod.RED_LINES.S3).toContain('pad with')
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

test('StickyCapabilityPackInfo 类型导出可被外部引用', async () => {
  const mod = await import(`./agent-prompt-builder.ts?cb=${Date.now()}-sticky-type`)
  // 仅做存在性检查（type-only 导出在 runtime 不可见，但 module 整体可 import 即可）
  expect(typeof mod.buildSystemPrompt).toBe('function')
})
