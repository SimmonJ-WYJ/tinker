/**
 * detect-message-language 单元测试
 *
 * 覆盖 CLAUDE.md §2 "UI 语言 + 用户消息语言双重判断" 的契约：
 * - 任意 CJK → 'zh'，零 CJK → 'en'，无文本输入 → UI 语言
 * - 代码块 / inline code / URL 不参与判断
 */

import { test, expect } from 'bun:test'
import { buildLanguageLockContext, buildUserTurnLanguagePin, buildUserTurnLanguageTailAnchor, detectOutputLanguage, isLanguageNeutralInput } from './detect-message-language'

test('空字符串 / 仅空白 → 回退 UI 语言', () => {
  expect(detectOutputLanguage('', 'en')).toBe('en')
  expect(detectOutputLanguage('', 'zh')).toBe('zh')
  expect(detectOutputLanguage('   \n\t  ', 'en')).toBe('en')
  expect(detectOutputLanguage('   \n\t  ', 'zh')).toBe('zh')
})

test('slash 命令（如 /compact）→ 回退 UI 语言', () => {
  expect(detectOutputLanguage('/compact', 'en')).toBe('en')
  expect(detectOutputLanguage('/compact', 'zh')).toBe('zh')
  expect(detectOutputLanguage('/clear', 'zh')).toBe('zh')
})

test('纯英文消息 → en（UI 不影响）', () => {
  expect(detectOutputLanguage('What is the capital of France?', 'zh')).toBe('en')
  expect(detectOutputLanguage('Hello, world!', 'zh')).toBe('en')
  expect(detectOutputLanguage('Refactor this function to use async/await.', 'en')).toBe('en')
})

test('纯中文消息 → zh（UI 不影响）', () => {
  expect(detectOutputLanguage('法国首都是哪里？', 'en')).toBe('zh')
  expect(detectOutputLanguage('帮我重构这个函数', 'en')).toBe('zh')
  expect(detectOutputLanguage('你好', 'zh')).toBe('zh')
})

test('中英混合消息（任意 CJK）→ zh', () => {
  expect(detectOutputLanguage('Anthropic 的最新模型是什么？', 'en')).toBe('zh')
  expect(detectOutputLanguage('帮我读一下这篇 paper：On the …', 'en')).toBe('zh')
  expect(detectOutputLanguage('What is 你好 in English?', 'en')).toBe('zh')
})

test('英文消息中含 CJK 代码块 → en（代码块被剥离）', () => {
  const msg = 'What does this print?\n```python\nprint("你好")\n```'
  expect(detectOutputLanguage(msg, 'en')).toBe('en')
  expect(detectOutputLanguage(msg, 'zh')).toBe('en')
})

test('英文消息中含 CJK inline code → en（inline code 被剥离）', () => {
  expect(detectOutputLanguage('Set the variable to `你好`.', 'en')).toBe('en')
})

test('英文消息中含 CJK URL anchor → en（URL 被剥离）', () => {
  expect(detectOutputLanguage('Check https://example.com/路径 for details.', 'en')).toBe('en')
  expect(detectOutputLanguage('See http://zh.wikipedia.org/wiki/中文 page.', 'en')).toBe('en')
})

test('中文消息中含英文 URL → 仍为 zh（中文 narrative 在 URL 外）', () => {
  expect(detectOutputLanguage('请帮我看 https://example.com/path 这个链接', 'en')).toBe('zh')
})

test('中文标点（全角逗号 / 句号）→ zh', () => {
  expect(detectOutputLanguage('Hello，world。', 'en')).toBe('zh')
})

test('日文（平假名 / 片假名）→ zh（AppLocale 二元 fallback）', () => {
  expect(detectOutputLanguage('こんにちは', 'en')).toBe('zh')
  expect(detectOutputLanguage('カタカナ', 'en')).toBe('zh')
})

test('CJK 扩展 B（supplementary plane）→ zh', () => {
  // U+20000 是 CJK 扩展 B 区第一个码点
  const supplementaryChar = String.fromCodePoint(0x20000)
  expect(detectOutputLanguage(`这是 ${supplementaryChar} 字`, 'en')).toBe('zh')
  expect(detectOutputLanguage(supplementaryChar, 'en')).toBe('zh')
})

// ===== buildUserTurnLanguagePin =====
//
// 黑名单语义：除 anthropic native 外，所有 Anthropic-compat provider 都注入 user-turn 语言锁
// （DeepSeek / Kimi / Moonshot / MiniMax / OpenRouter 等 reasoning trace 不严格服从 system prompt）。
// Forward-compat：任意未来扩入的 provider 都默认注入，无需修改本文件。

test('buildUserTurnLanguagePin: deepseek + en → 注入英文锁，含 thinking 约束 + CJK forbidden 列表', () => {
  const pin = buildUserTurnLanguagePin('deepseek', 'en')
  expect(pin).not.toBeNull()
  expect(pin).toContain('<language_lock>')
  expect(pin).toContain('Reply in English')
  expect(pin).toContain('thinking')
  // 强化后的 pin 包含 CJK forbidden 示例（注意：示例本身含 "Chinese (中文)" 字样），
  // 这是有意的：DeepSeek 对负向示例响应稳定
  expect(pin).toContain('Forbidden')
  expect(pin).toContain('中文')
})

test('buildUserTurnLanguagePin: deepseek + zh → 注入全中文锁体', () => {
  const pin = buildUserTurnLanguagePin('deepseek', 'zh')
  expect(pin).not.toBeNull()
  expect(pin).toContain('<language_lock>')
  expect(pin).toContain('本轮回复使用中文')
  expect(pin).toContain('全程中文')
})

test('buildUserTurnLanguagePin: anthropic native → null（豁免，避免 prompt cache 失效）', () => {
  expect(buildUserTurnLanguagePin('anthropic', 'en')).toBeNull()
  expect(buildUserTurnLanguagePin('anthropic', 'zh')).toBeNull()
})

test('buildUserTurnLanguagePin: moonshot / kimi / minimax / openrouter + en → 注入英文锁', () => {
  for (const provider of ['moonshot', 'kimi', 'minimax', 'openrouter']) {
    const pin = buildUserTurnLanguagePin(provider, 'en')
    expect(pin).not.toBeNull()
    expect(pin).toContain('<language_lock>')
    expect(pin).toContain('Reply in English')
  }
})

test('buildUserTurnLanguagePin: moonshot / kimi / minimax / openrouter + zh → 注入全中文锁体', () => {
  for (const provider of ['moonshot', 'kimi', 'minimax', 'openrouter']) {
    const pin = buildUserTurnLanguagePin(provider, 'zh')
    expect(pin).not.toBeNull()
    expect(pin).toContain('<language_lock>')
    expect(pin).toContain('本轮回复使用中文')
  }
})

test('buildUserTurnLanguagePin: 未知/未来 provider → 默认注入（forward-compat 黑名单语义）', () => {
  // 任意未来扩入的 provider 都应自动获保护，无需修改 detect-message-language.ts
  for (const provider of ['some-future-llm', 'doubao', 'hunyuan', 'qwen-anthropic-compat']) {
    const pin = buildUserTurnLanguagePin(provider, 'en')
    expect(pin).not.toBeNull()
    expect(pin).toContain('<language_lock>')
  }
})

test('buildUserTurnLanguagePin: provider 缺失 → null（防御性）', () => {
  expect(buildUserTurnLanguagePin(undefined, 'en')).toBeNull()
  expect(buildUserTurnLanguagePin('', 'en')).toBeNull()
})

test('buildUserTurnLanguagePin: 锁体含上一步返回内容免疫条款（任意来源 × 任意格式，按解析语言措辞）', () => {
  const enPin = buildUserTurnLanguagePin('deepseek', 'en')
  expect(enPin).not.toBeNull()
  expect(enPin).toContain('never adopt their language')
  expect(enPin).toContain('Tool / sub-agent / skill / MCP / script results')
  expect(enPin).toContain('JSON, tables, HTML, text')

  const zhPin = buildUserTurnLanguagePin('deepseek', 'zh')
  expect(zhPin).not.toBeNull()
  expect(zhPin).toContain('不要跟随其语言')
  expect(zhPin).toContain('工具 / 子 Agent / Skill / MCP / 脚本返回的内容')
})

// zh 锁体全中文：DeepSeek 等 reasoning 通道跟随周围文本语言而非指令语义；
// 实测（2026-06-10）英文锁体 + 单句中文锚不足，全中文锁体最大化同语言锚 token。
// 负例针对 DeepSeek agentic thinking 实测固定开场白 "The user is asking…"。
test('buildUserTurnLanguagePin: zh 锁体全中文 + 含英文开场负例，en 锁不含中文叙述', () => {
  const zhPin = buildUserTurnLanguagePin('deepseek', 'zh')
  expect(zhPin).not.toBeNull()
  expect(zhPin).toContain('思考的第一句必须以中文开头')
  expect(zhPin).toContain('"The user is asking"')
  // zh 锁体不含英文叙述句（负例引用内的英文除外）
  expect(zhPin).not.toContain('Reply in Chinese')
  expect(zhPin).not.toContain('MUST also be in')

  const enPin = buildUserTurnLanguagePin('deepseek', 'en')
  expect(enPin).not.toBeNull()
  expect(enPin).toContain('Reply in English')
  expect(enPin).not.toContain('本轮回复使用中文')
})

// ===== buildUserTurnLanguageTailAnchor =====
// 尾部贴脸锚：用户消息之后、离第一段 thinking 生成点最近的指令。
// 第一段 thinking 在所有 tool_result 之前，PostToolUse 重锁保护不到它。

test('buildUserTurnLanguageTailAnchor: anthropic native → null（豁免）', () => {
  expect(buildUserTurnLanguageTailAnchor('anthropic', 'zh')).toBeNull()
  expect(buildUserTurnLanguageTailAnchor('anthropic', 'en')).toBeNull()
})

test('buildUserTurnLanguageTailAnchor: provider 缺失 → null（防御性）', () => {
  expect(buildUserTurnLanguageTailAnchor(undefined, 'zh')).toBeNull()
  expect(buildUserTurnLanguageTailAnchor('', 'zh')).toBeNull()
})

test('buildUserTurnLanguageTailAnchor: deepseek + zh → 中文短锚，含第一句开头指令 + 英文开场负例', () => {
  const anchor = buildUserTurnLanguageTailAnchor('deepseek', 'zh')
  expect(anchor).not.toBeNull()
  expect(anchor).toContain('<language_lock>')
  expect(anchor).toContain('思考的第一句就以中文开头')
  expect(anchor).toContain('"The user is asking"')
})

test('buildUserTurnLanguageTailAnchor: deepseek + en → 英文短锚，含 CJK 禁令', () => {
  const anchor = buildUserTurnLanguageTailAnchor('deepseek', 'en')
  expect(anchor).not.toBeNull()
  expect(anchor).toContain('<language_lock>')
  expect(anchor).toContain('think and reply in English only')
  expect(anchor).toContain('CJK')
})

// ===== buildLanguageLockContext =====
// PostToolUse hook 的 additionalContext 注入，与 buildUserTurnLanguagePin 共享同一锁体
// 与同一黑名单（仅 anthropic 豁免）。

test('buildLanguageLockContext: deepseek + en → 与 pin 同形锁体', () => {
  const ctx = buildLanguageLockContext('deepseek', 'en')
  expect(ctx).not.toBeNull()
  expect(ctx).toContain('<language_lock>')
  expect(ctx).toContain('Reply in English')
})

test('buildLanguageLockContext: anthropic native → null（豁免）', () => {
  expect(buildLanguageLockContext('anthropic', 'en')).toBeNull()
  expect(buildLanguageLockContext('anthropic', 'zh')).toBeNull()
})

test('buildLanguageLockContext: moonshot / kimi / minimax / openrouter → 注入锁体', () => {
  for (const provider of ['moonshot', 'kimi', 'minimax', 'openrouter']) {
    const ctx = buildLanguageLockContext(provider, 'en')
    expect(ctx).not.toBeNull()
    expect(ctx).toContain('<language_lock>')
  }
})

test('buildLanguageLockContext: 未知/未来 provider → 默认注入（forward-compat）', () => {
  const ctx = buildLanguageLockContext('some-future-llm', 'zh')
  expect(ctx).not.toBeNull()
  expect(ctx).toContain('<language_lock>')
})

test('buildLanguageLockContext: provider 缺失 → null', () => {
  expect(buildLanguageLockContext(undefined, 'zh')).toBeNull()
  expect(buildLanguageLockContext('', 'en')).toBeNull()
})

// ===== isLanguageNeutralInput =====
//
// "语言中立"输入：纯数字 / 数字+常见分隔符 / 列表序号；本身不携带语言信号，
// 应沿用上一轮已解析语言以避免抖动（"2024"、"1, 2"、"1." 等典型 follow-up）。

test('isLanguageNeutralInput: 纯数字 → true', () => {
  expect(isLanguageNeutralInput('2024')).toBe(true)
  expect(isLanguageNeutralInput('42')).toBe(true)
  expect(isLanguageNeutralInput('0')).toBe(true)
})

test('isLanguageNeutralInput: 数字 + 分隔符 → true', () => {
  expect(isLanguageNeutralInput('3.14')).toBe(true)
  expect(isLanguageNeutralInput('2024-05-18')).toBe(true)
  expect(isLanguageNeutralInput('1, 2, 3')).toBe(true)
  expect(isLanguageNeutralInput('1 2 3')).toBe(true)
  expect(isLanguageNeutralInput('12:30')).toBe(true)
  expect(isLanguageNeutralInput('1/2')).toBe(true)
})

test('isLanguageNeutralInput: 列表序号 → true', () => {
  expect(isLanguageNeutralInput('1.')).toBe(true)
  expect(isLanguageNeutralInput('(3)')).toBe(true)
  expect(isLanguageNeutralInput('2)')).toBe(true)
})

test('isLanguageNeutralInput: 含字母 / CJK → false', () => {
  expect(isLanguageNeutralInput('2024 年')).toBe(false)
  expect(isLanguageNeutralInput('item 1')).toBe(false)
  expect(isLanguageNeutralInput('v2')).toBe(false)
  expect(isLanguageNeutralInput('a')).toBe(false)
})

test('isLanguageNeutralInput: 纯空白 / 纯符号 / 空串 → false（必须有数字）', () => {
  expect(isLanguageNeutralInput('')).toBe(false)
  expect(isLanguageNeutralInput('---')).toBe(false)
  expect(isLanguageNeutralInput('...')).toBe(false)
  expect(isLanguageNeutralInput('()')).toBe(false)
})

// ===== detectOutputLanguage cache-aware =====
//
// 语言中立输入沿用 cachedLanguage（上一轮已解析）；无缓存（cold start）回退 UI 语言。
// 含字母 / CJK 的明确输入忽略缓存，正常路由。

test('detectOutputLanguage: 纯数字 + 缓存=zh → 沿用 zh（UI=en 不影响）', () => {
  expect(detectOutputLanguage('2024', 'en', 'zh')).toBe('zh')
  expect(detectOutputLanguage('42', 'en', 'zh')).toBe('zh')
  expect(detectOutputLanguage('1.', 'en', 'zh')).toBe('zh')
  expect(detectOutputLanguage('1, 2, 3', 'en', 'zh')).toBe('zh')
  expect(detectOutputLanguage('(3)', 'en', 'zh')).toBe('zh')
})

test('detectOutputLanguage: 纯数字 + 缓存=en → 沿用 en（UI=zh 不影响）', () => {
  expect(detectOutputLanguage('2024', 'zh', 'en')).toBe('en')
  expect(detectOutputLanguage('1.', 'zh', 'en')).toBe('en')
})

test('detectOutputLanguage: 纯数字 + 无缓存 → 回退 UI 语言（cold start）', () => {
  expect(detectOutputLanguage('2024', 'en')).toBe('en')
  expect(detectOutputLanguage('2024', 'zh')).toBe('zh')
  expect(detectOutputLanguage('1.', 'zh')).toBe('zh')
  expect(detectOutputLanguage('1, 2, 3', 'en')).toBe('en')
})

test('detectOutputLanguage: 非中立输入忽略缓存（含 CJK → zh）', () => {
  // 缓存 en，但本轮明确中文 → 必须返回 zh，不能被缓存粘住
  expect(detectOutputLanguage('帮我看这个', 'en', 'en')).toBe('zh')
})

test('detectOutputLanguage: 非中立输入忽略缓存（纯英文 → en）', () => {
  // 缓存 zh，但本轮明确英文 → 必须返回 en
  expect(detectOutputLanguage('What is this?', 'zh', 'zh')).toBe('en')
})

test('detectOutputLanguage: 数字 + CJK 代码块 → 缓存生效（代码块剥离后剩数字）', () => {
  const msg = "2024\n```python\nprint('你好')\n```"
  expect(detectOutputLanguage(msg, 'en', 'zh')).toBe('zh')
})
