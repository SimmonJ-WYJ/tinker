/**
 * PermissionBanner 紧凑化测试 — 空 body 优化 / preview max-h / 无 ↵ 确认 hint。
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai/react'
import { createStore } from 'jotai'
import { PermissionBanner } from './PermissionBanner.tsx'
import { allPendingPermissionRequestsAtom } from '@/atoms/agent-atoms'
import type { ToolPreview } from '@asci/shared'

afterEach(cleanup)

it('image approval explains billing before generation, unrelated tools do not', () => {
 const view=setup({sessionId:'image',toolName:'mcp__asci-image__generate_image'})
 expect(screen.getByText(/Check your relay bill/)).toBeInTheDocument()
 view.unmount()
 setup({sessionId:'other'})
 expect(screen.queryByText(/Check your relay bill/)).toBeNull()
})

// #710：renderer 只收 main 已脱敏的 toolPreview，不再有 raw toolInput
const EMPTY_PREVIEW: ToolPreview = { kind: 'redacted', preview: '{}', hash: '0', bytes: 2 }

interface ReqInput {
  sessionId: string
  requestId?: string
  toolName?: string
  toolPreview?: ToolPreview
  command?: string
  description?: string
  descriptionI18n?: { key: string; params?: Record<string, unknown> }
  dangerLevel?: 'safe' | 'normal' | 'dangerous'
}

interface MockReq {
  requestId: string
  sessionId: string
  toolName: string
  toolPreview: ToolPreview
  command: string | undefined
  description: string
  descriptionI18n: { key: string; params?: Record<string, unknown> }
  dangerLevel: 'safe' | 'normal' | 'dangerous'
  canAlwaysAllow: boolean
  hardRuleReason: string | undefined
  decisionReason: string | undefined
}

function makeReq(p: ReqInput): MockReq {
  const toolName = p.toolName ?? 'mcp__zotero__zotero_list_collections'
  return {
    requestId: p.requestId ?? 'req-1',
    sessionId: p.sessionId,
    toolName,
    toolPreview: p.toolPreview ?? EMPTY_PREVIEW,
    command: p.command,
    description: p.description ?? '使用工具：mcp__zotero__zotero_list_collections',
    descriptionI18n: p.descriptionI18n ?? { key: 'banner.description.generic', params: { tool: toolName } },
    dangerLevel: p.dangerLevel ?? 'normal',
    canAlwaysAllow: true,
    hardRuleReason: undefined,
    decisionReason: undefined,
  }
}

function setup(req: ReqInput) {
  const store = createStore()
  store.set(allPendingPermissionRequestsAtom, new Map([[req.sessionId, [makeReq(req)]]]))
  return render(
    <JotaiProvider store={store}>
      <PermissionBanner sessionId={req.sessionId} />
    </JotaiProvider>
  )
}

describe('PermissionBanner 紧凑化', () => {
  it('无 input 的 MCP 工具，body 不渲染冗余 "Use tool: <toolName>" 文案；非冗余 fallback 仍渲染', () => {
    // 负例：fallback = "Use tool: mcp__zotero__zotero_list_collections" 与 subtitle 信息重复 → 短路返回 null
    const { unmount } = setup({ sessionId: 's1' })
    expect(screen.queryByText(/Use tool: mcp__zotero/)).toBeNull()
    // 同时确保没有任何 <p> 渲染出该 toolName（防止其他降级路径意外输出）
    expect(screen.queryByText(/mcp__zotero__zotero_list_collections/)).toBeNull()
    unmount()

    // 正例：fallback = "Run Bash command"（bashGeneric）不包含 toolName 也不匹配 /Use tool|使用工具/
    // → 不短路 → <p> 应渲染
    setup({
      sessionId: 's1b',
      toolName: 'unknown_tool',
      descriptionI18n: { key: 'banner.description.bashGeneric' },
    })
    expect(screen.getByText('Run Bash command')).toBeTruthy()
  })

  it('Bash 预览块 max-h ≤ 100 防溢出', () => {
    setup({ sessionId: 's2', toolName: 'Bash', toolPreview: { kind: 'command', command: 'ls -la' } })
    const pre = screen.getByText('ls -la')
    // PRE_CLASS 应包含某个 max-h-[Npx] 限高（80px 当前；调整时不需要更新此测试）
    expect(pre.className).toMatch(/max-h-\[(60|70|80|90|100)px\]/)
  })

  it('footerHints 不再包含 "↵ Confirm" key 提示', () => {
    setup({ sessionId: 's3' })
    // footer 的 ↵ kbd 不应再出现在 KeyboardHintFooter spans 中
    // 注意：右下确定按钮里的 ↵ 是不同 DOM 节点（按钮内 kbd），故用 role="note" 范围内找
    // en 模式下 confirm 文案为 "Confirm"；shell 右下按钮 label 是 "Allow"/"Deny"/"Always allow this session"，不会触发该断言误判
    const footerNote = screen.queryByRole('note')
    if (footerNote) {
      expect(footerNote.textContent ?? '').not.toContain('Confirm')
    }
  })
})

describe('PermissionBanner 判定原因 tooltip', () => {
  it('hardRuleReason 存在时显示 ⓘ 触发点', () => {
    const store = createStore()
    const req = makeReq({ sessionId: 's4' })
    req.hardRuleReason = 'rm-rf-protection'
    store.set(allPendingPermissionRequestsAtom, new Map([['s4', [req]]]))
    render(<JotaiProvider store={store}><PermissionBanner sessionId="s4" /></JotaiProvider>)
    // 用 aria-label 命中触发按钮（视实现可能是 "判定原因" 或英文 "Reason"）
    expect(
      screen.queryByLabelText(/判定原因|Reason/i)
    ).toBeTruthy()
  })

  it('hardRuleReason 不存在时不显示 ⓘ', () => {
    setup({ sessionId: 's5' })
    expect(screen.queryByLabelText(/判定原因|Reason/i)).toBeNull()
  })
})
