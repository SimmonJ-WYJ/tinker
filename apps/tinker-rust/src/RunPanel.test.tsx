import React from 'react'
import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RunPanel } from './RunPanel.tsx'
import { useT } from './i18n.ts'

interface Pending { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
function nativeHarness() {
  const calls: { command: string; args?: Record<string, unknown> }[] = []
  const pending: Pending[] = []
  const runSnapshot = (overrides: Record<string, unknown> = {}) => {
    const request = [...calls].reverse().find(call => call.command === 'start_lab_run')?.args
    return snapshot({ ...request, runId: request?.requestId ?? 'run-1', ...overrides })
  }
  const runPage = (overrides: Record<string, unknown> = {}) => {
    const current = runSnapshot(overrides)
    return { protocolVersion: 1, snapshot: current, events: [], nextAfterSequence: current.sequence, hasMore: false }
  }
  return { calls, pending, snapshot: runSnapshot, page: runPage, invoke: (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args })
    return new Promise<unknown>((resolve, reject) => pending.push({ resolve, reject }))
  } }
}
function TestPanel({ invoke, input = '合成草稿' }: { invoke: ReturnType<typeof nativeHarness>['invoke']; input?: string }) {
  const { t, toggleLanguage } = useT()
  return <><button onClick={toggleLanguage}>{t('language')}</button><RunPanel t={t} invoke={invoke} input={input} /></>
}
function snapshot(overrides: Record<string, unknown> = {}) {
  return { protocolVersion: 1, runId: 'run-1', requestId: 'run-1', providerKind: 'offlineFixture', scenario: 'success', input: '合成草稿', output: '', status: 'running', sequence: 1, errorCode: null, recoveryRequired: false, ...overrides }
}
async function resolve(pending: Pending | undefined, value: unknown) {
  if (!pending) throw new Error('缺少原生调用')
  await act(async () => pending.resolve(value))
}
async function delay(ms = 140) { await act(async () => { await new Promise(done => setTimeout(done, ms)) }) }
function start() { fireEvent.click(screen.getByRole('button', { name: '开始离线测试' })) }
afterEach(cleanup)

test('离线面板明确范围，重复点击只启动一次并使用父草稿及选择场景', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  expect(native.calls).toHaveLength(0)
  expect(screen.getByText(/仅运行离线合成数据/)).toBeDefined()
  fireEvent.change(screen.getByLabelText('测试场景'), { target: { value: 'failure' } })
  start(); start()
  expect(native.calls).toHaveLength(1)
  expect(native.calls[0]?.command).toBe('start_lab_run')
  expect(native.calls[0]?.args).toMatchObject({ input: '合成草稿', scenario: 'failure' })
  expect(native.calls[0]?.args?.requestId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  await resolve(native.pending[0], native.snapshot({ status: 'completed', output: '离线结果' }))
  expect(screen.getByText('离线结果')).toBeDefined()
  await delay()
  expect(native.calls).toHaveLength(1)
  start()
  expect(native.calls[1]?.args?.requestId).not.toBe(native.calls[0]?.args?.requestId)
})

test('有界游标轮询不重叠，终态停止且保留失败部分输出与父输入', async () => {
  const native = nativeHarness()
  const view = render(<TestPanel invoke={native.invoke} />)
  start()
  await resolve(native.pending[0], native.snapshot({ output: '已有片段' }))
  await waitFor(() => expect(native.calls).toHaveLength(2))
  expect(native.calls[1]).toEqual({ command: 'read_lab_run', args: { runId: native.calls[0]?.args?.requestId, afterSequence: 1, limit: 64 } })
  await delay(220)
  expect(native.calls).toHaveLength(2)
  await resolve(native.pending[1], { ...native.page({ status: 'failed', output: '已有片段', sequence: 2, errorCode: 'fixtureFailed' }), events: [{ protocolVersion: 1, runId: native.calls[0]?.args?.requestId, sequence: 2, kind: 'failed', text: null, errorCode: 'fixtureFailed' }] })
  expect(screen.getByText('已有片段')).toBeDefined()
  expect(screen.getByText('离线测试失败')).toBeDefined()
  view.rerender(<TestPanel invoke={native.invoke} input="仍可编辑的草稿" />)
  expect(screen.getByText('仍可编辑的草稿')).toBeDefined()
  await delay()
  expect(native.calls).toHaveLength(2)
})

test('取消后忽略旧轮询晚到片段，新运行使用新请求且卸载停止读取', async () => {
  const native = nativeHarness()
  const view = render(<TestPanel invoke={native.invoke} />)
  start()
  await resolve(native.pending[0], native.snapshot({ output: '取消前片段' }))
  await waitFor(() => expect(native.calls).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: '取消测试' }))
  expect(native.calls[2]).toEqual({ command: 'cancel_lab_run', args: { runId: native.calls[0]?.args?.requestId } })
  await resolve(native.pending[2], native.snapshot({ status: 'cancelled', output: '取消前片段', sequence: 3 }))
  start()
  await resolve(native.pending[3], native.snapshot({ output: '新运行片段' }))
  await resolve(native.pending[1], native.page({ output: '旧运行晚到结果' }))
  expect(screen.queryByText('旧运行晚到结果')).toBeNull()
  expect(screen.getByText('新运行片段')).toBeDefined()
  view.unmount()
  await delay()
  expect(native.calls).toHaveLength(4)
})

test('启动失败保留输入、隐藏原生错误，并可使用相同 requestId 安全重试', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  start()
  await act(async () => native.pending[0]?.reject('/不应显示/路径'))
  expect(screen.queryByText('/不应显示/路径')).toBeNull()
  expect(screen.getByText('合成草稿')).toBeDefined()
  expect(screen.getByRole('alert').textContent).toBe('离线测试通信失败。输入和已有输出仍保留，请重试或读取最近测试。')
  fireEvent.click(screen.getByRole('button', { name: '重试启动' }))
  expect(native.calls[1]?.args).toEqual(native.calls[0]?.args)
  await resolve(native.pending[1], native.snapshot({ status: 'completed' }))
})

test('恢复最近中断测试不启动 provider，恢复提示及错误支持双语', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  fireEvent.click(screen.getByRole('button', { name: '读取最近测试' }))
  expect(native.calls[0]).toEqual({ command: 'read_lab_run', args: { afterSequence: 0, limit: 64 } })
  await resolve(native.pending[0], native.page({ status: 'interrupted', output: '恢复片段', sequence: 0, recoveryRequired: true }))
  expect(screen.getByText(/上次测试已中断/)).toBeDefined()
  expect(screen.getByText('恢复片段')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByText(/Previous test was interrupted/)).toBeDefined()
  expect(screen.getByText('Offline Test')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Read latest test' }))
  await act(async () => native.pending[1]?.reject('runNotFound'))
  expect(screen.getByRole('alert').textContent).toBe('No offline test found.')
  expect(screen.getByText('恢复片段')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '中文' }))
  expect(screen.getByRole('alert').textContent).toBe('尚无离线测试记录。')
  await delay()
  expect(native.calls).toHaveLength(2)
})

test('轮询协议错误保留输出、停止自动读取，并可显式读取最近测试恢复', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  start()
  await resolve(native.pending[0], native.snapshot({ output: '保留的输出' }))
  await waitFor(() => expect(native.calls).toHaveLength(2))
  await resolve(native.pending[1], native.page({ runId: 'other-run', output: '错误运行输出' }))
  expect(screen.queryByText('错误运行输出')).toBeNull()
  expect(screen.getByText('保留的输出')).toBeDefined()
  expect(screen.getByRole('alert').textContent).toContain('接口版本不兼容')
  await delay()
  expect(native.calls).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '读取最近测试' }))
  await resolve(native.pending[2], native.page({ status: 'cancelled', output: '恢复后的输出', sequence: 0 }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByText('恢复后的输出')).toBeDefined()
})

test('取消失败不清除片段，可重复取消且旧轮询失败不覆盖当前错误', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  start()
  await resolve(native.pending[0], native.snapshot({ output: '取消失败仍保留' }))
  await waitFor(() => expect(native.calls).toHaveLength(2))
  fireEvent.click(screen.getByRole('button', { name: '取消测试' }))
  await act(async () => native.pending[2]?.reject('storeIo'))
  expect(screen.getByRole('alert').textContent).toContain('无法读写离线测试文件')
  await act(async () => native.pending[1]?.reject('runNotFound'))
  expect(screen.getByRole('alert').textContent).toContain('无法读写离线测试文件')
  expect(screen.getByText('取消失败仍保留')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '取消测试' }))
  expect(native.calls[3]).toEqual(native.calls[2])
  await resolve(native.pending[3], native.snapshot({ status: 'cancelled', output: '取消失败仍保留', sequence: 2 }))
  expect(screen.getByText('离线测试已取消')).toBeDefined()
})

test('卸载后的启动或读取响应不再调度轮询', async () => {
  for (const action of ['start', 'restore'] as const) {
    const native = nativeHarness()
    const view = render(<TestPanel invoke={native.invoke} />)
    if (action === 'start') start()
    else fireEvent.click(screen.getByRole('button', { name: '读取最近测试' }))
    view.unmount()
    await resolve(native.pending[0], action === 'start' ? native.snapshot() : native.page({ sequence: 0 }))
    await delay()
    expect(native.calls).toHaveLength(1)
  }
})

test('恢复测试显示持久化执行输入，独立于空白或变化后的父草稿且安全渲染', async () => {
  const native = nativeHarness()
  const view = render(<TestPanel invoke={native.invoke} input="" />)
  fireEvent.click(screen.getByRole('button', { name: '读取最近测试' }))
  const originalInput = '原执行输入 <script>不可执行</script>'
  await resolve(native.pending[0], native.page({ status: 'interrupted', input: originalInput, sequence: 0 }))
  expect(screen.getByText('已保留的执行输入')).toBeDefined()
  expect(screen.getByText(originalInput)).toBeDefined()
  expect(view.container.querySelector('script')).toBeNull()
  view.rerender(<TestPanel invoke={native.invoke} input="新的父草稿" />)
  expect(screen.getByText('新的父草稿')).toBeDefined()
  expect(screen.getByText(originalInput)).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByText('Preserved run input')).toBeDefined()
  expect(screen.getByText(originalInput)).toBeDefined()
  expect(native.calls).toHaveLength(1)
})

test('快照已知终态原因显示固定双语提示，未知原因正文不显示', async () => {
  const native = nativeHarness()
  render(<TestPanel invoke={native.invoke} />)
  const causes = [
    ['offlineFixtureFailed', '合成测试按所选场景在片段后失败，已有输出已保留。', 'The synthetic fixture failed after partial output as selected. Existing output was preserved.'],
    ['processInterrupted', '实验版进程已中断，上次测试不会自动继续。', 'The lab process was interrupted. The previous test will not resume automatically.'],
    ['truncatedLog', '测试记录末尾不完整，已保留可读取的输入与输出。', 'The test log has an incomplete tail. Readable input and output were preserved.'],
  ] as const
  for (const [errorCode, zh, en] of causes) {
    fireEvent.click(screen.getByRole('button', { name: '读取最近测试' }))
    await resolve(native.pending.at(-1), native.page({ status: 'failed', sequence: 0, errorCode }))
    expect(screen.getByText(zh)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(screen.getByText(en)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '中文' }))
  }
  fireEvent.click(screen.getByRole('button', { name: '读取最近测试' }))
  await resolve(native.pending.at(-1), native.page({ status: 'failed', sequence: 0, errorCode: '/未知原生正文/秘密' }))
  expect(screen.queryByText('/未知原生正文/秘密')).toBeNull()
  expect(screen.queryByText(causes[2][1])).toBeNull()
  expect(screen.getByRole('status').textContent).toBe('离线测试失败')
})

test('启动响应必须匹配本次请求的身份、输入与场景', async () => {
  for (const change of [
    { runId: 'wrong-request', requestId: 'wrong-request' }, { input: '错误输入' }, { scenario: 'slow' },
  ]) {
    const native = nativeHarness()
    const view = render(<TestPanel invoke={native.invoke} />)
    start()
    await resolve(native.pending[0], native.snapshot({ status: 'completed', output: '错误响应输出', ...change }))
    expect(screen.getByRole('alert').textContent).toContain('接口版本不兼容')
    expect(screen.queryByText('错误响应输出')).toBeNull()
    view.unmount()
  }
})
