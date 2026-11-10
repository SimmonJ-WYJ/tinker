import { expect, test } from 'bun:test'
import { selectRuntimePolicy, buildLeanSystemPrompt, AUTONOMY_RULES, measureRequestContext } from './runtime-policy.ts'

test('fresh greetings use a tool-free conversation without implicit project context', () => {
 for (const message of ['hello', '你好！', 'hi', 'Reply only OK']) {
  const p = selectRuntimePolicy({ message, mode: 'search' })
  expect(p.profile).toBe('conversation')
  expect(p.tools).toEqual([])
  expect(p.includeWorkspaceContext).toBe(false)
  expect(p.includeSubagents).toBe(false)
 }
})
test('never drop existing session context or explicitly referenced capabilities for a greeting', () => {
 for (const extra of [{ hasScientificReferences: true }, { hasStickyWorkflow: true }]) {
  expect(selectRuntimePolicy({ message: 'hello', mode: 'search', ...extra }).profile).toBe('general')
 }
})
test('coding keeps executable tools and generic capability context', () => {
 const p = selectRuntimePolicy({ message: 'Fix the login bug', mode: 'coding' })
 expect(p.profile).toBe('coding')
 expect(p.tools).toContain('Bash')
 expect(p.tools).toContain('Read')
 expect(p.includeWorkspaceContext).toBe(true)
 expect(p.includeSubagents).toBe(true)
})
test('scientific wording uses ordinary coding or general task policies', () => {
 for (const message of ['分析这篇论文', 'write a literature review']) {
  expect(selectRuntimePolicy({ message, mode: 'coding' }).profile).toBe('coding')
 }
 expect(selectRuntimePolicy({ message: 'Use the project skill', mode: 'coding', hasReferences: true }).profile).toBe('coding')
 expect(selectRuntimePolicy({ message: 'hello, now delete the project', mode: 'search' }).profile).toBe('general')
})
test('lean prompt retains grouped questions, language and risk boundaries within a small byte budget', () => {
 const prompt = buildLeanSystemPrompt('coding', 'zh', '/tmp/project')
 expect(prompt).toContain(AUTONOMY_RULES)
 expect(prompt).toContain('Chinese')
 expect(prompt).toContain('permission')
 expect(new TextEncoder().encode(prompt).length).toBeLessThan(4000)
})
test('context diagnostics report bytes rather than pretend to report billed tokens or credentials', () => {
 const stats = measureRequestContext('你好', 'hello', ['search'], 2)
 expect(stats.systemBytes).toBe(6)
 expect(stats.messageBytes).toBe(5)
 expect(stats).toEqual({ systemBytes: 6, messageBytes: 5, mcpServerCount: 1, agentCount: 2 })
})
test('conversation follow-ups stay lean; a real task can upgrade without losing session history', () => {
 expect(selectRuntimePolicy({ message: '你好', mode: 'search', hasHistory: true, previousProfile: 'conversation' }).profile).toBe('conversation')
 expect(selectRuntimePolicy({ message: 'search recent papers', mode: 'search', hasHistory: true, previousProfile: 'conversation' }).profile).toBe('general')
 expect(selectRuntimePolicy({ message: 'hello', mode: 'search', hasHistory: true, previousProfile: 'research' }).profile).toBe('general')
})

test('general tasks use executable tools and generic workspace context', () => {
 for (const message of ['Write a business plan', '分析销售数据', 'Summarize this PDF', 'Search hotels in Shanghai', 'What is your model?']) {
  const p = selectRuntimePolicy({ message, mode: 'search' })
  expect(p.profile).toBe('general')
  expect(p.tools).toContain('WebSearch')
  expect(p.tools).toContain('Read')
  expect(p.includeWorkspaceContext).toBe(true)
 }
})
test('generic coding PDF and compaction do not trigger scientific workflow', () => {
 for (const message of ['Fix PDF export', 'Change paper size in CSS', '/compact'])
  expect(selectRuntimePolicy({ message, mode: 'coding' }).profile).toBe('coding')
})
test('explicit capabilities survive without adopting a scientific identity', () => {
 const p = selectRuntimePolicy({ message: 'Use my spreadsheet skill', mode: 'search', hasReferences: true })
 expect(p.profile).toBe('general')
 expect(p.includeWorkspaceContext).toBe(true)
 expect(p.tools).toContain('Read')
 expect(p.tools).toContain('Skill')
 expect(p.includeSubagents).toBe(true)
 expect(selectRuntimePolicy({ message: 'Summarize these sources', hasScientificReferences: true }).profile).toBe('general')
 expect(selectRuntimePolicy({ message: 'continue', previousProfile: 'research', hasHistory: true }).profile).toBe('general')
 expect(selectRuntimePolicy({ message: 'Write a sales email', previousProfile: 'research', hasHistory: true }).profile).toBe('general')
})
test('general prompt defines broad work and keeps permission boundaries', () => {
 const p = buildLeanSystemPrompt('general', 'zh')
 expect(p).toContain('writing')
 expect(p).toContain(AUTONOMY_RULES)
 expect(p).not.toContain('main job: paper')
})

test('coding prefers real isolated HTML verification over ad hoc shell scripts',()=>{
 const prompt=buildLeanSystemPrompt('coding','zh','/project')
 expect(prompt).toContain('mcp__asci-project__verify_html')
 expect(prompt).toContain('do not add frameworks, persistence or test infrastructure unless needed')
 expect(prompt).toContain('Separate sourced facts from interpretation')
})
