import { expect, test } from 'bun:test'
import { taskModePrompt } from './task-mode-prompt'
test('任务模式注入不同指令，旧调用保持兼容', () => {
 expect(taskModePrompt('search')).toContain('Cite verifiable source URLs')
 expect(taskModePrompt('search')).toContain('host permission checks')
 expect(taskModePrompt('coding')).toContain('implementing, debugging')
 expect(taskModePrompt(undefined)).toBe('')
})
