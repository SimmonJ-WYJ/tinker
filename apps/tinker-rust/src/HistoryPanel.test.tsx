import React from 'react'
import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HistoryPanel } from './HistoryPanel.tsx'
import { useT } from './i18n.ts'
import type { HistoryPage } from './history-contract.ts'

interface Call { command: string; args?: Record<string, unknown> }
interface Pending { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
function nativeHarness() {
  const calls: Call[] = []
  const pending: Pending[] = []
  return {
    calls, pending,
    invoke: (command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args })
      return new Promise<unknown>((resolve, reject) => pending.push({ resolve, reject }))
    },
  }
}
function TestPanel({ invoke }: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }) {
  const { t, toggleLanguage } = useT()
  return <><button onClick={toggleLanguage}>{t('language')}</button><HistoryPanel t={t} invoke={invoke} /></>
}
function page(text = '最新页', lineNumber = 9, nextBeforeLine: number | null = 9): HistoryPage {
  return { protocolVersion: 1, entries: [{ lineNumber, kind: 'assistant', text, uuid: null, raw: { unknown: '默认不显示' } }], nextBeforeLine, incompleteTail: null }
}
function openPanel() { fireEvent.click(screen.getByText('只读历史')) }
async function resolve(pending: Pending | undefined, value: unknown) {
  if (!pending) throw new Error('缺少待处理的原生调用')
  await act(async () => pending.resolve(value))
}
afterEach(cleanup)

test('历史面板默认折叠、无自动读取，并支持较早页和最新页替换', async () => {
  const native = nativeHarness()
  const { container } = render(<TestPanel invoke={native.invoke} />)
  expect(container.querySelector('details')?.open).toBe(false)
  expect(native.calls).toHaveLength(0)
  openPanel()
  expect(screen.getByLabelText('会话 ID').getAttribute('value')).toBe('history')
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  expect(native.calls).toEqual([{ command: 'read_session_history', args: { sessionId: 'history', beforeLine: null, limit: 64 } }])
  await resolve(native.pending[0], page())
  expect(screen.getByText('最新页')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '较早一页' }))
  expect(native.calls[1]?.args).toEqual({ sessionId: 'history', beforeLine: 9, limit: 64 })
  await resolve(native.pending[1], page('较早内容', 2, null))
  expect(screen.queryByText('最新页')).toBeNull()
  expect(screen.getByText('较早内容')).toBeDefined()
  expect(screen.getByRole('button', { name: '较早一页' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '最新一页' }))
  expect(native.calls[2]?.args).toEqual({ sessionId: 'history', beforeLine: null, limit: 64 })
  await resolve(native.pending[2], { protocolVersion: 1, entries: [], nextBeforeLine: null, incompleteTail: null })
  expect(screen.queryByText('较早内容')).toBeNull()
  expect(screen.getByText('本页没有完整记录。')).toBeDefined()
})

test('读取失败保留当前页和游标，错误可重试且不显示原生错误正文', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  openPanel()
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  await resolve(native.pending[0], page())
  fireEvent.click(screen.getByRole('button', { name: '较早一页' }))
  await act(async () => native.pending[1]?.reject('historyBusy'))
  expect(screen.getByRole('alert').textContent).toBe('历史文件正被使用，请稍后重试。')
  expect(screen.getByText('最新页')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '较早一页' }))
  expect(native.calls[2]?.args?.beforeLine).toBe(9)
  await act(async () => native.pending[2]?.reject('/敏感/原生错误正文'))
  expect(screen.queryByText('/敏感/原生错误正文')).toBeNull()
  expect(screen.getByRole('alert').textContent).toBe('历史读取失败，请重试。')
  expect(screen.getByText('最新页')).toBeDefined()
})

test('编辑会话 ID 清除旧页，并忽略旧请求完成或失败', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  openPanel()
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  fireEvent.change(screen.getByLabelText('会话 ID'), { target: { value: 'other' } })
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  expect(native.calls[1]?.args?.sessionId).toBe('other')
  await resolve(native.pending[1], page('新会话'))
  await resolve(native.pending[0], page('过期结果'))
  expect(screen.queryByText('过期结果')).toBeNull()
  expect(screen.getByText('新会话')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '最新一页' }))
  fireEvent.change(screen.getByLabelText('会话 ID'), { target: { value: 'third' } })
  expect(screen.queryByText('新会话')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  await act(async () => native.pending[2]?.reject('historyCorrupt'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: '读取中…' }).hasAttribute('disabled')).toBe(true)
  await resolve(native.pending[3], page('第三个会话'))
})

test('结构化记录和不完整尾行显示双语提示，历史文本只作为文本渲染', async () => {
  const native = nativeHarness()
  const { container } = render(<TestPanel invoke={native.invoke} />)
  openPanel()
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  const text = '<img src="file:///不读取.png" onerror="alert(1)"><script>alert(1)</script>'
  const result = page(text)
  result.entries.push({ lineNumber: 10, kind: 'tool', text: '', uuid: null, raw: { imagePath: '/不读取.png', tool: '不执行' } })
  result.incompleteTail = 11
  await resolve(native.pending[0], result)
  expect(screen.getByText(text)).toBeDefined()
  expect(screen.getByText('结构化记录')).toBeDefined()
  expect(screen.getByText(/末尾未完成的行/).textContent).toContain('11')
  expect(container.querySelector('img, script')).toBeNull()
  expect(container.textContent).not.toContain('imagePath')
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByText('Read-only history')).toBeDefined()
  expect(screen.getByLabelText('Session ID')).toBeDefined()
  expect(screen.getByText('Structured record')).toBeDefined()
  expect(screen.getByText(/Incomplete final line/).textContent).toContain('11')
  expect(screen.getByText(/authorized copies/)).toBeDefined()
})

test('卸载后的原生异步结果被忽略', async () => {
  const native = nativeHarness()
  const rendered = render(<TestPanel invoke={native.invoke} />)
  openPanel()
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  rendered.unmount()
  await resolve(native.pending[0], page('卸载后结果'))
  await waitFor(() => expect(screen.queryByText('卸载后结果')).toBeNull())
})

test('所有稳定历史错误码都有中英文提示，异常响应不替换当前页', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  openPanel()
  const errors = [
    ['historyNotFound', '未找到该会话的历史副本。', 'No history copy found for this session.'],
    ['historyUnsafePath', '历史路径不安全，已停止读取。', 'Unsafe history path. Reading stopped.'],
    ['historyUnavailable', '无法读取历史，请检查实验版目录权限。', 'Cannot read history. Check the lab directory permissions.'],
    ['historyBusy', '历史文件正被使用，请稍后重试。', 'History file is in use. Try again shortly.'],
    ['historyInvalidOptions', '历史读取参数无效，请检查会话 ID。', 'Invalid history options. Check the session ID.'],
    ['historyCorrupt', '历史文件损坏，已停止读取。', 'History file is corrupt. Reading stopped.'],
    ['historyInvalidMessage', '历史记录格式无效，已停止读取。', 'Invalid history record format. Reading stopped.'],
    ['historyTooLarge', '历史文件或记录超出读取限制。', 'History file or record exceeds the read limit.'],
    ['nativeRequired', '请在 Tinker Rust Lab 桌面应用中打开。', 'Open this in the Tinker Rust Lab desktop app.'],
    ['protocolMismatch', '接口版本不兼容，请保留输入并使用匹配的实验版。', 'Incompatible interface version. Keep your input and use a matching lab build.'],
  ] as const
  for (const [code, zh, en] of errors) {
    fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
    await act(async () => native.pending.at(-1)?.reject(code))
    expect(screen.getByRole('alert').textContent).toBe(zh)
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByRole('alert').textContent).toBe(en)
    fireEvent.click(screen.getByRole('button', { name: '中文' }))
  }
  fireEvent.click(screen.getByRole('button', { name: '读取历史' }))
  await resolve(native.pending.at(-1), page('保留的页面'))
  fireEvent.click(screen.getByRole('button', { name: '较早一页' }))
  await resolve(native.pending.at(-1), { ...page('畸形响应'), nextBeforeLine: -1 })
  expect(screen.queryByText('畸形响应')).toBeNull()
  expect(screen.getByText('保留的页面')).toBeDefined()
  expect(screen.getByRole('alert').textContent).toContain('接口版本不兼容')
  fireEvent.click(screen.getByRole('button', { name: '较早一页' }))
  expect(native.calls.at(-1)?.args?.beforeLine).toBe(9)
  await resolve(native.pending.at(-1), page('重试成功'))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('实验版范围文案同时说明草稿与只读历史验证，并支持语言切换', () => {
  function LabScope() {
    const { t, toggleLanguage } = useT()
    return <><button onClick={toggleLanguage}>{t('language')}</button><p>{t('stage')}</p><p>{t('note')}</p><p>{t('fileStorage')}</p></>
  }
  render(<LabScope />)
  expect(screen.getByText('Rust 会话核心 · 草稿与只读历史验证')).toBeDefined()
  expect(screen.getByText('当前验证本机草稿与只读历史；模型、生图、搜索与项目尚未接入。')).toBeDefined()
  expect(screen.getByText(/不会自动导入现用应用历史/)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByText('Rust session core · Draft and read-only history verification')).toBeDefined()
  expect(screen.getByText('Local draft and read-only history verification. Models, image generation, search and projects are not connected.')).toBeDefined()
  expect(screen.getByText(/History from the current app is not automatically imported/)).toBeDefined()
})
