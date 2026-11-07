import { expect, test } from 'bun:test'
import { friendlyErrorMessage, mapSDKErrorToTypedError } from './claude-agent-adapter.ts'
test('401 明确为模型渠道认证，错误详情不携带原凭据且不提供盲重试',()=>{
 const raw='AxiosError: Request failed with status code 401; Authorization: Bearer fixture-sensitive-token'
 const message=friendlyErrorMessage(raw)
 expect(message).toContain('401')
 expect(message).not.toContain('fixture-sensitive-token')
 const mapped=mapSDKErrorToTypedError('overloaded',message,raw)
 expect(mapped.code).toBe('invalid_api_key')
 expect(mapped.canRetry).toBe(false)
 expect(JSON.stringify(mapped)).not.toContain('fixture-sensitive-token')
})
test('429 等其他错误不被误判为认证错误',()=>{
 const result=mapSDKErrorToTypedError('rate_limited','429','HTTP 429')
 expect(result.code).toBe('rate_limited')
 expect(result.canRetry).toBe(true)
})

test('SDK 诊断聚合后脱敏，跨块认证信息和已知渠道 Key 不进入出口', async () => {
 const { sanitizeProviderDiagnostic } = await import('./claude-agent-adapter.ts')
 const chunks = ['HTTP 401; Authorization: Bea', 'rer fixture-sensitive-token']
 expect(sanitizeProviderDiagnostic(chunks.join(''))).not.toContain('fixture-sensitive-token')
 expect(sanitizeProviderDiagnostic('SDK failure relay-fixture-value', ['relay-fixture-value'])).not.toContain('relay-fixture-value')
 expect(sanitizeProviderDiagnostic('HTTP 429; Authorization: Bearer fixture-sensitive-token')).not.toContain('fixture-sensitive-token')
 expect(sanitizeProviderDiagnostic('HTTP 429 retry later')).toContain('429')
})

test('自动 resume 的认证错误只输出安全消息，普通回复保持原对象', async () => {
 const { normalizeProviderAuthenticationMessage } = await import('./claude-agent-adapter.ts')
 const raw = {type:'assistant' as const,parent_tool_use_id:null,message:{content:[{type:'text' as const,text:'HTTP 401 Authorization: Bearer fixture-sensitive-token'}]},error:{message:'HTTP 401',errorType:'authentication_failed'}}
 const safe = normalizeProviderAuthenticationMessage(raw)
 expect(JSON.stringify(safe)).not.toContain('fixture-sensitive-token')
 expect(JSON.stringify(raw)).toContain('fixture-sensitive-token')
 const reply = {type:'assistant' as const,parent_tool_use_id:null,message:{content:[{type:'text' as const,text:'ordinary reply'}]}}
 expect(normalizeProviderAuthenticationMessage(reply)).toBe(reply)
})
