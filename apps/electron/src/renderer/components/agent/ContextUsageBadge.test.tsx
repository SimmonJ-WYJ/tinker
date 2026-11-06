import { afterEach, expect, test, mock } from 'bun:test'
import { cleanup, render, fireEvent, screen, waitFor } from '@testing-library/react'
import { ContextUsageBadge } from './ContextUsageBadge'
import { setAppLanguage } from '@/lib/i18n'
import type { ContextRecord } from '@asci/shared'
afterEach(cleanup)
const props = { sessionId: 'context-test', inputTokens: 125000, contextWindow: 200000, isCompacting: false, isProcessing: false }
function api(record: ContextRecord = { pins: [] }): void {
 window.electronAPI = { getContextRecord: mock(async () => record), saveContextPins: mock(async (_id, pins) => ({ ...record, pins })) } as unknown as Window['electronAPI']
}
test('点击打开容量面板，固定原文写入真实保留 API', async () => {
 await setAppLanguage('en'); api()
 render(<ContextUsageBadge {...props} candidates={[{ id: 'one', label: 'Keep goal', text: 'Use monochrome' }]} onCompact={() => {}} />)
 fireEvent.click(screen.getByRole('button', { name: 'Manage context' }))
 await screen.findByText('Context')
 fireEvent.click(screen.getByText(/Retained excerpts/))
 fireEvent.click(screen.getByRole('checkbox'))
 await waitFor(() => expect(window.electronAPI.saveContextPins).toHaveBeenCalledWith('context-test', [{ id: 'one', label: 'Keep goal', text: 'Use monochrome' }]))
})
test('整理时入口仍可打开，显示真实状态且不可重复提交', async () => {
 api({ pins: [], status: 'working' })
 render(<ContextUsageBadge {...props} isCompacting isProcessing onCompact={() => {}} />)
 fireEvent.click(screen.getByRole('button', { name: 'Manage context' }))
 expect(await screen.findByRole('status')).toBeTruthy()
 expect(screen.getByRole('button', { name: 'Organizing…' })).toBeDisabled()
})
test('完成展示真实摘要和前后用量', async () => {
 api({ pins: [], status: 'complete', report: { summary: 'Real compact summary', completedAt: 1, trigger: 'manual', beforeTokens: 125000, afterTokens: 18000 } })
 render(<ContextUsageBadge {...props} onCompact={() => {}} />)
 fireEvent.click(screen.getByRole('button', { name: 'Manage context' }))
 expect(await screen.findByText('Context organized')).toBeTruthy()
 fireEvent.click(screen.getByText('View summary'))
 expect(screen.getByText('Real compact summary')).toBeTruthy()
 expect(screen.getByText('After: 18k tokens')).toBeTruthy()
})
test('失败不显示成功结果，提供重试', async () => {
 api({ pins: [], status: 'failed', error: 'SDK failed' })
 render(<ContextUsageBadge {...props} onCompact={() => {}} />)
 fireEvent.click(screen.getByRole('button', { name: 'Manage context' }))
 expect(await screen.findByRole('alert')).toBeTruthy()
 expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
 expect(screen.queryByText('Context organized')).toBeNull()
})
