/**
 * lit-review-structure-lint-guard 行为单测（spec：lit-review-finalize-fast-path P0）
 *
 * 覆盖两部分：
 *   - 纯 linter lintReviewHtmlStructure：裸 [N] / 缺 <q> 的 <cite> 检出；<q> 内 [N]、§7 refs 不误报
 *   - guard PostToolUse：Write 到 reviews/*.html 命中违规 → block + 清单；非 Write / 非 review 路径 /
 *     干净内容 → 放行；block 次数封顶防循环
 */

import { describe, expect, test } from 'bun:test'

import {
  lintReviewHtmlStructure,
  createLitReviewStructureLintGuard,
} from './lit-review-structure-lint-guard.ts'

type Guard = ReturnType<typeof createLitReviewStructureLintGuard>

function runWritePost(
  guard: Guard,
  filePath: string,
  content: string,
): { decision?: string; reason?: string } {
  const cb = guard.PostToolUse[0]!.hooks[0]! as (input: unknown) => unknown
  return cb({
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  }) as { decision?: string; reason?: string }
}

const REVIEW_PATH = '/Users/x/.asci-dev/agent-workspaces/s/sid/reviews/2026-06-17_10-00-llm.html'

describe('lintReviewHtmlStructure（纯函数）', () => {
  test('正文裸 [N] / [1, 3] → 检出 bare-bracket-ref', () => {
    const html = '<p>后训练向 RLVR 转变[7]。FactAlign[13] 也如此，又见[1, 3]。</p>'
    const v = lintReviewHtmlStructure(html)
    expect(v.filter((x) => x.type === 'bare-bracket-ref').length).toBe(3)
  })

  test('<q> 引文内的 [1], [2] / [128] 不误报', () => {
    const html =
      '<p>协议：<cite data-ref="40"><q>Cite every claim by embedding reference tokens (e.g., [1], [2]) that link…</q></cite></p>' +
      '<p>发现：<cite data-ref="26"><q>as studied in [128] MAS approach…</q></cite></p>'
    const v = lintReviewHtmlStructure(html)
    expect(v.length).toBe(0)
  })

  test('§7 refs 列表（<ol class="refs">）内不误报', () => {
    const html =
      '<ol class="refs" start="11"><li id="ref-11" data-ref="11"><strong>InstructGPT.</strong> [11] NeurIPS 2022.</li></ol>'
    const v = lintReviewHtmlStructure(html)
    expect(v.length).toBe(0)
  })

  test('叙述式 cite（缺 <q>）→ 检出 cite-missing-quote', () => {
    const html = '<p>LLM 综述<cite data-ref="7">系统性总结了注意力优化方向</cite>：见正文。</p>'
    const v = lintReviewHtmlStructure(html)
    expect(v.length).toBe(1)
    expect(v[0]!.type).toBe('cite-missing-quote')
  })

  test('空 cite（<cite data-ref="5"></cite>）→ 检出', () => {
    const html = '<p>X<cite data-ref="5"></cite>。</p>'
    const v = lintReviewHtmlStructure(html)
    expect(v.length).toBe(1)
    expect(v[0]!.type).toBe('cite-missing-quote')
  })

  test('合法 cite（含 <q>）+ 无裸 [N] → 零违规', () => {
    const html =
      '<p>DeepSeek-V3 采用 MLA<cite data-ref="5"><q>In addition to the MLA and DeepSeekMoE architectures…</q></cite>。</p>'
    const v = lintReviewHtmlStructure(html)
    expect(v.length).toBe(0)
  })

  test('行号自上而下排序', () => {
    const html = '<p>a</p>\n<p>b[2]</p>\n<p>c<cite data-ref="3">x</cite></p>'
    const v = lintReviewHtmlStructure(html)
    expect(v.length).toBe(2)
    expect(v[0]!.line).toBeLessThanOrEqual(v[1]!.line)
  })
})

describe('createLitReviewStructureLintGuard（hook）', () => {
  test('Write 到 reviews/*.html 命中违规 → block + 清单 + 日志', () => {
    const logs: string[] = []
    const guard = createLitReviewStructureLintGuard('s1', (m) => logs.push(m))
    const out = runWritePost(guard, REVIEW_PATH, '<p>转变[7]，又<cite data-ref="2">叙述</cite>。</p>')
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('Structure lint')
    expect(out.reason).toContain('[N]')
    expect(out.reason).toContain('<q>')
    expect(logs.length).toBe(1)
    expect(guard.readState().blockCount).toBe(1)
  })

  test('干净内容 → 放行（无 decision）', () => {
    const guard = createLitReviewStructureLintGuard('s2')
    const out = runWritePost(
      guard,
      REVIEW_PATH,
      '<p>X<cite data-ref="1"><q>verbatim source passage here</q></cite>。</p>',
    )
    expect(out.decision).toBeUndefined()
    expect(guard.readState().blockCount).toBe(0)
  })

  test('Windows 反斜杠 review 路径也命中 → block', () => {
    const guard = createLitReviewStructureLintGuard('s3w')
    const out = runWritePost(guard, 'C:\\Users\\x\\asci\\reviews\\2026-06-17_10-00-llm.html', '<p>坏[7]</p>')
    expect(out.decision).toBe('block')
  })

  test('非 review 路径（reviews 外）→ 放行', () => {
    const guard = createLitReviewStructureLintGuard('s3')
    const out = runWritePost(guard, '/tmp/notes/draft.html', '<p>坏[7]<cite data-ref="2">x</cite></p>')
    expect(out.decision).toBeUndefined()
  })

  test('非 Write 工具 → 放行', () => {
    const guard = createLitReviewStructureLintGuard('s4')
    const cb = guard.PostToolUse[0]!.hooks[0]! as (input: unknown) => unknown
    const out = cb({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: REVIEW_PATH, content: '坏[7]' },
    }) as { decision?: string }
    expect(out.decision).toBeUndefined()
  })

  test('block 次数封顶（MAX_BLOCKS=3）后放行防循环', () => {
    const guard = createLitReviewStructureLintGuard('s5')
    const bad = '<p>坏[7]</p>'
    for (let i = 0; i < 3; i++) {
      expect((runWritePost(guard, REVIEW_PATH, bad)).decision).toBe('block')
    }
    // 第 4 次：超过封顶 → 放行
    expect(runWritePost(guard, REVIEW_PATH, bad).decision).toBeUndefined()
    expect(guard.readState().blockCount).toBe(3)
  })
})
