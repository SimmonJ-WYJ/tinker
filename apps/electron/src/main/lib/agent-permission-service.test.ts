import { describe, expect, test } from 'bun:test'
import type { PermissionRequest } from '@asci/shared'
import { AgentPermissionService, type CanUseToolOptions, type PermissionResult } from './agent-permission-service'
import { CANARY } from './telemetry/redaction-canary.ts'

const options = (): CanUseToolOptions => ({
  signal: new AbortController().signal,
  toolUseID: 'toolu_test',
})

const pending = Symbol('pending')

async function settleOrPending(promise: Promise<PermissionResult>): Promise<PermissionResult | typeof pending> {
  return Promise.race([
    promise,
    new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 10)),
  ])
}

describe('AgentPermissionService hard rules', () => {
  test('hard deny returns before prompting or consulting SDK approval flow', async () => {
    const service = new AgentPermissionService({
      cwd: '/workspace/project',
      workspaceRoot: '/workspace/project',
      homeDir: '/home/alice',
    })
    const requests: PermissionRequest[] = []
    const canUseTool = service.createCanUseTool('session-1', (request) => requests.push(request))

    const result = await settleOrPending(canUseTool('Bash', { command: 'rm -rf /' }, options()))

    expect(result).toMatchObject({
      behavior: 'deny',
      message: expect.stringContaining('bash.deny.rm-root'),
    })
    expect(requests).toHaveLength(0)
  })

  test('hard ask is surfaced with ruleId and is not made session-whitelisted by alwaysAllow', async () => {
    const service = new AgentPermissionService({
      cwd: '/workspace/project',
      workspaceRoot: '/workspace/project',
      homeDir: '/home/alice',
    })
    const requests: PermissionRequest[] = []
    const canUseTool = service.createCanUseTool('session-1', (request) => requests.push(request))

    const first = canUseTool('Bash', { command: 'git push origin main' }, options())
    expect(requests[0]).toMatchObject({
      hardRuleId: 'bash.ask.git-push',
      canAlwaysAllow: false,
    })
    service.respondToPermission(requests[0]!.requestId, 'allow', true)
    expect(await first).toMatchObject({ behavior: 'allow' })

    const second = canUseTool('Bash', { command: 'git push origin main' }, options())
    expect(await settleOrPending(second)).toBe(pending)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      hardRuleId: 'bash.ask.git-push',
      canAlwaysAllow: false,
    })
    service.respondToPermission(requests[1]!.requestId, 'deny', false)
    await second
  })

  test('Bash session whitelist uses the full normalized command, not the base command', async () => {
    const service = new AgentPermissionService({
      cwd: '/workspace/project',
      workspaceRoot: '/workspace/project',
      homeDir: '/home/alice',
    })
    const requests: PermissionRequest[] = []
    const canUseTool = service.createCanUseTool('session-1', (request) => requests.push(request))

    const first = canUseTool('Bash', { command: 'npm   test' }, options())
    service.respondToPermission(requests[0]!.requestId, 'allow', true)
    expect(await first).toMatchObject({ behavior: 'allow' })

    const same = await canUseTool('Bash', { command: ' npm test ' }, options())
    expect(same).toMatchObject({ behavior: 'allow' })
    expect(requests).toHaveLength(1)

    const variant = canUseTool('Bash', { command: 'npm test -- --watch' }, options())
    expect(await settleOrPending(variant)).toBe(pending)
    expect(requests).toHaveLength(2)
    service.respondToPermission(requests[1]!.requestId, 'deny', false)
    await variant
  })

  test('PreToolUse hook maps hard decisions and lets internal defer continue to SDK auto', async () => {
    const service = new AgentPermissionService({
      cwd: '/workspace/project',
      workspaceRoot: '/workspace/project',
      homeDir: '/home/alice',
    })
    const hook = service.createPreToolUseHardRuleHookForSession('session-1')

    await expect(hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      tool_use_id: 'toolu_test',
    }, 'toolu_test', options())).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('bash.deny.rm-root'),
      },
    })

    await expect(hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push origin main' },
      tool_use_id: 'toolu_test',
    }, 'toolu_test', options())).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: expect.stringContaining('bash.ask.git-push'),
      },
    })

    await expect(hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'toolu_test',
    }, 'toolu_test', options())).resolves.toEqual({})

    await expect(hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git status --short' },
      tool_use_id: 'toolu_test',
    }, 'toolu_test', options())).resolves.toEqual({})

    await expect(hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/workspace/project/README.md' },
      tool_use_id: 'toolu_test',
    }, 'toolu_test', options())).resolves.toEqual({})
  })

  test('PreToolUse hook reads the current session hard-rule context at call time', async () => {
    const service = new AgentPermissionService({
      cwd: '/fallback',
      workspaceRoot: '/fallback',
      homeDir: '/home/fallback',
    })
    const hook = service.createPreToolUseHardRuleHookForSession('session-1')

    service.setSessionHardRuleContext('session-1', {
      cwd: '/workspace/project',
      workspaceRoot: '/workspace/project',
      homeDir: '/home/alice',
    })

    await expect(hook({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /home/alice' },
      tool_use_id: 'toolu_test',
    }, 'toolu_test', options())).resolves.toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('bash.deny.rm-home'),
      },
    })
  })
})

describe('#710 raw toolInput 收口 + SDK resume', () => {
  test('approve 后 updatedInput === 原始 raw input（renderer 看不到 raw，SDK 仍拿全量）+ DTO 凭证 0 命中', async () => {
    const service = new AgentPermissionService({ cwd: '/w', workspaceRoot: '/w', homeDir: '/home/a' })
    const requests: PermissionRequest[] = []
    const canUseTool = service.createCanUseTool('s', (r) => requests.push(r))
    const rawInput = { command: `curl -H "Authorization: Bearer ${CANARY.secretToken}"`, extra: { k: 1 } }

    const first = canUseTool('Bash', rawInput, options())
    const dto = requests[0]!
    // 发到 renderer 的 DTO：无 raw toolInput 字段，含脱敏 toolPreview，凭证 0 命中
    expect('toolInput' in dto).toBe(false)
    expect(dto.toolPreview).toBeDefined()
    expect(JSON.stringify(dto)).not.toContain(CANARY.secretToken)

    // approve → SDK resume 拿到完整 raw input（含未脱敏凭证）
    service.respondToPermission(dto.requestId, 'allow', false)
    const res = await first
    expect(res).toMatchObject({ behavior: 'allow' })
    if (res.behavior === 'allow') expect(res.updatedInput).toEqual(rawInput)
  })

  test('getPendingRequests() 快照天然脱敏：未知工具无 toolInput、凭证 0 命中', () => {
    const service = new AgentPermissionService({ cwd: '/w', workspaceRoot: '/w', homeDir: '/home/a' })
    const requests: PermissionRequest[] = []
    const canUseTool = service.createCanUseTool('s', (r) => requests.push(r))
    void canUseTool('mcp__x__do', { api_key: CANARY.secretToken }, options())

    const snap = service.getPendingRequests()
    expect(snap).toHaveLength(1)
    expect('toolInput' in snap[0]!).toBe(false)
    expect(snap[0]!.toolPreview.kind).toBe('redacted')
    expect(JSON.stringify(snap)).not.toContain(CANARY.secretToken)
  })
})

test('acceptEdits ordinary scoped writes do not prompt, while secrets still require a decision', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const cwd = mkdtempSync(join(tmpdir(), 'asci-permission-integration-'))
  const requests: PermissionRequest[] = []
  const service = new AgentPermissionService({ cwd, workspaceRoot: cwd, homeDir: '/home/test' })
  const use = service.createCanUseTool('scoped-write', request => requests.push(request))
  try {
    expect(await use('Write', { file_path: join(cwd, 'hello.txt'), content: 'hello' }, options())).toMatchObject({behavior:'allow'})
    expect(requests).toHaveLength(0)
    const secret = use('Write', { file_path: join(cwd, '.env'), content: 'example' }, options())
    expect(await settleOrPending(secret)).toBe(pending)
    expect(requests).toHaveLength(1)
    service.respondToPermission(requests[0]!.requestId, 'deny', false)
    expect(await secret).toMatchObject({behavior:'deny'})
  } finally { service.clearSessionPending('scoped-write'); rmSync(cwd, {recursive:true,force:true}) }
})

test('controlled public web tools never prompt; arbitrary Python remains permission checked',async()=>{
 const service=new AgentPermissionService({cwd:'/workspace/project',workspaceRoot:'/workspace/project',homeDir:'/home/alice'})
 const requests:PermissionRequest[]=[]
 const use=service.createCanUseTool('web-search',(r)=>requests.push(r))
 for(const name of ['mcp__asci-web__search','mcp__asci-web__fetch','mcp__asci-project__verify_html']) expect((await use(name,{query:'Tesla',url:'https://example.com/'},options())).behavior).toBe('allow')
 expect(requests).toHaveLength(0)
 const command=use('Bash',{command:'python -c "print(1)"'},options())
 expect(await settleOrPending(command)).toBe(pending);expect(requests).toHaveLength(1)
 service.respondToPermission(requests[0]!.requestId,'deny',false);await command
})
