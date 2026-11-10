/** 独立 Bun 进程使用假 Electron 与 SDK，避免 mock 污染其它回归。 */
import { mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'
import { ZOTERO_IPC_CHANNELS, MEDIA_IPC_CHANNELS, ASR_WEIGHTS_IPC_CHANNELS } from '@asci/shared'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
mock.module('electron', () => ({
 app: { isPackaged: false, getAppPath: () => '/synthetic/app', getPath: () => process.env.ASCI_CONFIG_HOME },
 BrowserWindow: { getAllWindows: () => [] },
 dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false, decryptString: () => { throw new Error('credentials forbidden') } },
 ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) },
}))
const { setRuntimeProvisioner } = await import('../../runtime/runtime-provisioner.ts')
setRuntimeProvisioner({ getStatus: () => ({ phase: 'idle' }) } as never)
const { registerZoteroIpc } = await import('../../../ipc/zotero.ts')
registerZoteroIpc()
for (const channel of [ZOTERO_IPC_CHANNELS.SET_ENABLED, ZOTERO_IPC_CHANNELS.PDF_DIFF_NOW, ZOTERO_IPC_CHANNELS.PDF_STRUCTURED_TXT_GENERATE_ALL, ZOTERO_IPC_CHANNELS.ARTICLE_CONFIG_SET, ZOTERO_IPC_CHANNELS.ARTICLE_RETRY_ALL, ZOTERO_IPC_CHANNELS.ARTICLE_REGENERATE_ALL, ZOTERO_IPC_CHANNELS.EMBED_CONFIG_SET, ZOTERO_IPC_CHANNELS.EMBED_REBUILD_ALL, ZOTERO_IPC_CHANNELS.EMBED_MODEL_DOWNLOAD]) {
 assert.throws(() => handlers.get(channel)!(null, true), /SCIENTIFIC_WORKFLOW_UNAVAILABLE/)
}
for (const channel of [ZOTERO_IPC_CHANNELS.LIB_GET_ITEM, ZOTERO_IPC_CHANNELS.LIB_READ_PDF_BASE64, ZOTERO_IPC_CHANNELS.PDF_PARSE_STATUS, ZOTERO_IPC_CHANNELS.ARTICLE_CONFIG_GET, ZOTERO_IPC_CHANNELS.EMBED_CONFIG_GET, MEDIA_IPC_CHANNELS.CACHE_STATS, MEDIA_IPC_CHANNELS.CACHE_CLEAR, ...Object.values(ASR_WEIGHTS_IPC_CHANNELS).filter(c => c !== ASR_WEIGHTS_IPC_CHANNELS.STATUS_CHANGED)]) assert.equal(typeof handlers.get(channel), 'function')
const { getGlobalMcpPath } = await import('../../config-paths.ts')
const path = getGlobalMcpPath()
mkdirSync(join(path, '..'), { recursive: true })
const serialized = JSON.stringify({ servers: { 'paper-search': { type: 'stdio', command: 'custom-owned-command', enabled: true }, workspace_papers: { type: 'http', url: 'http://127.0.0.1:65530/fake-mcp', enabled: true }, disabled: { type: 'stdio', command: 'do-not-spawn', enabled: false } } })
writeFileSync(path, serialized)
const { buildMcpServers } = await import('../../agent-orchestrator-mcp.ts')
const servers = await buildMcpServers({ isPythonRuntimeReady: false }, undefined)
assert.equal(servers['paper-search']?.command, 'custom-owned-command')
assert.equal(servers.workspace_papers?.url, 'http://127.0.0.1:65530/fake-mcp')
for (const name of ['papers-rg', 'asci-zotero', 'litreview', 'researchgap', 'searchplan', 'zotero', 'disabled', 'asr']) assert.equal(servers[name], undefined)
assert.equal(servers.ocr?.type, 'stdio')
assert.equal(readFileSync(path, 'utf8'), serialized)
console.log('runtime IPC + MCP assembly: passed (synthetic configuration; no servers spawned)')

// 使用真实宿主 assembly + adapter，只 mock SDK 边界；不启动 Claude binary 或 provider。
let sdkOptions: import('@anthropic-ai/claude-agent-sdk').Options | undefined
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
 query: (input: { options: import('@anthropic-ai/claude-agent-sdk').Options }) => {
  sdkOptions = input.options
  return Object.assign((async function* () {
   yield { type: 'system', subtype: 'task_started', task_type: 'local_workflow', task_id: 'background', session_id: 'synthetic' }
   if (input.options.model === 'throw-after-start') throw new Error('synthetic iterator error')
   yield { type: 'result', subtype: 'success', session_id: 'synthetic' }
   yield { type: 'system', subtype: 'task_notification', task_id: 'background', status: 'completed', session_id: 'synthetic' }
  })(), { close() {} })
 },
}))
const { createInMemorySubagentRegistry } = await import('../../subagent-registry.ts')
const { runOrchestratorQuery } = await import('../../run-orchestrator-query.ts')
const { ClaudeAgentAdapter } = await import('../../adapters/claude-agent-adapter.ts')
const registry = createInMemorySubagentRegistry()
registry.register({ kind: 'subagent', source: 'user-config', name: 'custom-reviewer', def: { description: 'Review code', prompt: 'Use evidence.', tools: ['Read'], model: 'inherit' } })
const adapter = new ClaudeAgentAdapter()
const { createRuntimeSkillProjection } = await import('../../runtime-skill-projection.ts')
const projection = createRuntimeSkillProjection('synthetic', 'synthetic')
const iterator = runOrchestratorQuery({ adapter, registry, sessionId: 'synthetic', sink: { append() {}, update() {} }, baseOptions: { runtimeSkills: projection, plugins: [{ type: 'local', path: projection.path }], sessionId: 'synthetic', prompt: 'Review the code', tools: ['Read', 'Agent', 'Skill'], settingSources: ['project'], mcpServers: servers, sdkCliPath: '/fake/never-executed', executable: { type: 'node', path: '/fake/node' }, executableArgs: [], env: {}, systemPrompt: 'General task', sdkPermissionMode: 'acceptEdits', allowDangerouslySkipPermissions: false } as never })[Symbol.asyncIterator]()
await iterator.next() // SDK 已派后台任务，主回合结束不能删除 plugin。
projection.dispose()
assert.equal(existsSync(projection.path), true)
await iterator.next() // lead result，后台仍在运行。
assert.equal(existsSync(projection.path), true)
await iterator.next() // 任务终态，但 SDK iterator 尚未结束。
assert.equal(existsSync(projection.path), true)
await iterator.next()
assert.equal(existsSync(projection.path), false)
assert.equal(sdkOptions?.agents?.['custom-reviewer']?.prompt, 'Use evidence.')
assert.equal(sdkOptions?.agents?.['custom-reviewer']?.model, 'inherit')
assert.deepEqual(sdkOptions?.settingSources, ['project'])
assert.equal((sdkOptions?.mcpServers?.['paper-search'] as { command: string }).command, 'custom-owned-command')
assert.equal((sdkOptions?.mcpServers?.workspace_papers as { url: string }).url, 'http://127.0.0.1:65530/fake-mcp')
assert.equal(sdkOptions?.hooks?.Stop, undefined)
assert.equal(sdkOptions?.strictMcpConfig, undefined)
assert.equal(sdkOptions?.plugins?.[0]?.path, projection.path)
assert.equal(readFileSync(path, 'utf8'), serialized)
adapter.dispose()
console.log('host to adapter to mock SDK: custom agents/MCP/project settings passed')

for (let i = 0; i < 70; i++) {
 const lease = createRuntimeSkillProjection('synthetic', `cancel-${i}`)
 const stream = adapter.query({ sessionId: `cancel-${i}`, prompt: 'test', runtimeSkills: lease, executable: { type: 'node', path: '/fake' }, env: {}, systemPrompt: 'Test' } as never)[Symbol.asyncIterator]()
 await stream.next()
 lease.dispose()
 if (i % 2) adapter.dispose()
 else adapter.abort(`cancel-${i}`)
 await stream.return?.(undefined as never)
 assert.equal(existsSync(lease.path), false, 'closed SDK query must release its task pins')
}
const failedLease = createRuntimeSkillProjection('synthetic', 'error-case')
const failedStream = adapter.query({ sessionId: 'error-case', prompt: 'test', model: 'throw-after-start', runtimeSkills: failedLease, executable: { type: 'node', path: '/fake' }, env: {}, systemPrompt: 'Test' } as never)[Symbol.asyncIterator]()
await failedStream.next()
failedLease.dispose()
await assert.rejects(failedStream.next(), /synthetic iterator error/)
assert.equal(existsSync(failedLease.path), false)
console.log('70 abort/dispose runs and exceptional SDK iterator release all skill leases')
