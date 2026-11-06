import { afterEach, expect, test } from 'bun:test'
import { setLanguage } from './i18n-main.ts'
import { getResponseFailureMessage } from './agent-response-failure.ts'
import { friendlyErrorMessage, mapSDKErrorToTypedError } from './adapters/claude-agent-adapter.ts'
afterEach(() => setLanguage('en'))
test('response failure messages are localized and distinguish incomplete output', () => {
 setLanguage('en')
 expect(getResponseFailureMessage('422 ASCI_EMPTY_RESPONSE')).toContain('may have charged')
 expect(getResponseFailureMessage('ASCI_INCOMPLETE_RESPONSE')).toContain('Check existing outputs')
 setLanguage('zh')
 expect(getResponseFailureMessage('ASCI_EMPTY_RESPONSE')).toContain('可能已计费')
 expect(getResponseFailureMessage('ASCI_INCOMPLETE_RESPONSE')).toContain('已有结果')
 expect(getResponseFailureMessage('unrelated')).toBeNull()
})
test('empty responses offer manual recovery without automatic replay', () => {
 const raw='422 invalid_request_error ASCI_EMPTY_RESPONSE'
 const error=mapSDKErrorToTypedError('invalid_request_error',friendlyErrorMessage(raw),raw)
 expect(error.message).toContain('may have charged')
 expect(error.canRetry).toBe(true)
 expect(error.actions.some(action=>action.action==='retry')).toBe(true)
 expect(error.code).toBe('unknown_error')
})

test('429 failure offers localized manual recovery', () => {
 setLanguage('en')
 const raw='API Error: Request rejected (429) Upstream HTTP 429'
 expect(getResponseFailureMessage(raw)).toContain('rate limited (HTTP 429)')
 const typed=mapSDKErrorToTypedError('unknown_error',friendlyErrorMessage(raw),raw)
 expect(typed.canRetry).toBe(true)
 setLanguage('zh')
 expect(getResponseFailureMessage(raw)).toContain('HTTP 429')
})
