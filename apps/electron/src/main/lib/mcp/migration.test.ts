import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 用临时目录隔离测试，避免污染真实 ~/.asci
// 照搬 global-config.test.ts 的 ASCI_CONFIG_HOME + cachebust 模式
let tmpHome: string
let originalConfigHome: string | undefined
let originalDev: string | undefined
let cachebust: number

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-migration-'))
  originalConfigHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  // 强制走 .asci 命名（绕过 dev/packaged 检测）
  process.env.ASCI_DEV = ''
  cachebust = Date.now() + Math.random()
})

afterEach(() => {
  if (originalConfigHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalConfigHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

/** 写入工作区索引 + workspace mcp.json 文件 */
async function setupWorkspace(
  slug: string,
  mcp: object,
  bust: number,
): Promise<{ wsDir: string; indexPath: string }> {
  const cp = await import(`../config-paths.ts?bust=${bust}`)
  const wsDir = join(cp.getAgentWorkspacesDir(), slug)
  mkdirSync(wsDir, { recursive: true })
  writeFileSync(join(wsDir, 'mcp.json'), JSON.stringify(mcp))

  // 工作区索引（listAgentWorkspaces 依赖它）
  const indexPath = join(cp.getConfigDir(), 'agent-workspaces.json')
  const existing = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf-8'))
    : { version: 2, workspaces: [] }
  existing.workspaces.push({
    id: `id-${slug}`,
    name: slug,
    slug,
    createdAt: 0,
    updatedAt: 0,
  })
  writeFileSync(indexPath, JSON.stringify(existing))
  return { wsDir, indexPath }
}

// ─────────────────────────────────────────────────────────
// 测试 1: 空白机器（无工作区）→ 写空 servers，幂等
// ─────────────────────────────────────────────────────────
test('空白机器：写入空 servers 的全局文件', async () => {
  const bust = cachebust++
  const { migrateWorkspaceMcpToGlobal } = await import(`./migration.ts?bust=${bust}`)
  const cp = await import(`../config-paths.ts?bust=${bust}`)

  migrateWorkspaceMcpToGlobal()

  const globalPath = cp.getGlobalMcpPath()
  expect(existsSync(globalPath)).toBe(true)
  const cfg = JSON.parse(readFileSync(globalPath, 'utf-8'))
  expect(cfg).toEqual({ servers: {} })
})

// ─────────────────────────────────────────────────────────
// 测试 2: 单工作区 + 自定义 server → 进全局
// ─────────────────────────────────────────────────────────
test('单工作区自定义 server 迁移到全局', async () => {
  const bust = cachebust++
  await setupWorkspace(
    'ws-alpha',
    {
      servers: {
        'my-tool': { type: 'stdio', command: 'node', args: ['tool.js'], enabled: true },
      },
    },
    bust,
  )
  const { migrateWorkspaceMcpToGlobal } = await import(`./migration.ts?bust=${bust}`)
  const cp = await import(`../config-paths.ts?bust=${bust}`)

  migrateWorkspaceMcpToGlobal()

  const cfg = JSON.parse(readFileSync(cp.getGlobalMcpPath(), 'utf-8'))
  expect(cfg.servers['my-tool']).toBeDefined()
  expect(cfg.servers['my-tool'].command).toBe('node')
})

// ─────────────────────────────────────────────────────────
// 测试 3: 保留名条目（zotero/ocr/asr/paper-search）一律跳过
// ─────────────────────────────────────────────────────────
test('保留名 server 被跳过，不进全局', async () => {
  const bust = cachebust++
  await setupWorkspace(
    'ws-builtin',
    {
      servers: {
        'zotero': { type: 'stdio', command: 'node', args: [], enabled: true },
        'ocr': { type: 'stdio', command: 'ocr-bin', args: [], enabled: true },
        'asr': { type: 'stdio', command: 'asr-bin', args: [], enabled: true },
        'paper-search': { type: 'stdio', command: 'uv', args: [], enabled: true },
        'legit-tool': { type: 'stdio', command: 'my-cmd', args: [], enabled: true },
      },
    },
    bust,
  )
  const { migrateWorkspaceMcpToGlobal } = await import(`./migration.ts?bust=${bust}`)
  const cp = await import(`../config-paths.ts?bust=${bust}`)

  migrateWorkspaceMcpToGlobal()

  const cfg = JSON.parse(readFileSync(cp.getGlobalMcpPath(), 'utf-8'))
  expect(cfg.servers['zotero']).toBeUndefined()
  expect(cfg.servers['ocr']).toBeUndefined()
  expect(cfg.servers['asr']).toBeUndefined()
  expect(cfg.servers['paper-search']).toBeUndefined()
  expect(cfg.servers['legit-tool']).toBeDefined()
})

// ─────────────────────────────────────────────────────────
// 测试 4: isBuiltin: true 标记的条目也跳过，且不携带 isBuiltin 字段进全局
// ─────────────────────────────────────────────────────────
test('isBuiltin: true 条目被跳过，正常条目不携带 isBuiltin 字段', async () => {
  const bust = cachebust++
  await setupWorkspace(
    'ws-flagged',
    {
      servers: {
        'custom-tool': {
          type: 'stdio',
          command: 'my-cmd',
          args: [],
          enabled: true,
          isBuiltin: false,
        },
        'marked-builtin': {
          type: 'stdio',
          command: 'something',
          args: [],
          enabled: true,
          isBuiltin: true,
        },
      },
    },
    bust,
  )
  const { migrateWorkspaceMcpToGlobal } = await import(`./migration.ts?bust=${bust}`)
  const cp = await import(`../config-paths.ts?bust=${bust}`)

  migrateWorkspaceMcpToGlobal()

  const cfg = JSON.parse(readFileSync(cp.getGlobalMcpPath(), 'utf-8'))
  // isBuiltin: true → 跳过
  expect(cfg.servers['marked-builtin']).toBeUndefined()
  // isBuiltin: false → 进全局，但不带 isBuiltin 字段
  expect(cfg.servers['custom-tool']).toBeDefined()
  expect(cfg.servers['custom-tool'].isBuiltin).toBeUndefined()
})

// ─────────────────────────────────────────────────────────
// 测试 5: 多工作区同名 server → 先到先得
// ─────────────────────────────────────────────────────────
test('多工作区同名 server 先到先得，第二个被丢弃', async () => {
  const bust = cachebust++
  // ws-first 先写（排序靠前）
  await setupWorkspace(
    'ws-first',
    { servers: { 'shared-tool': { type: 'stdio', command: 'first-cmd', args: [], enabled: true } } },
    bust,
  )
  await setupWorkspace(
    'ws-second',
    { servers: { 'shared-tool': { type: 'stdio', command: 'second-cmd', args: [], enabled: true } } },
    bust,
  )
  const { migrateWorkspaceMcpToGlobal } = await import(`./migration.ts?bust=${bust}`)
  const cp = await import(`../config-paths.ts?bust=${bust}`)

  migrateWorkspaceMcpToGlobal()

  const cfg = JSON.parse(readFileSync(cp.getGlobalMcpPath(), 'utf-8'))
  expect(cfg.servers['shared-tool']).toBeDefined()
  // 先到先得：只保留一个
  const entries = Object.keys(cfg.servers).filter((k) => k === 'shared-tool')
  expect(entries.length).toBe(1)
})

// ─────────────────────────────────────────────────────────
// 测试 6: 成功后删除所有工作区 mcp.json
// ─────────────────────────────────────────────────────────
test('迁移成功后删除所有工作区 mcp.json', async () => {
  const bust = cachebust++
  const { wsDir: wsDir1 } = await setupWorkspace(
    'ws-del-a',
    { servers: { 'tool-a': { type: 'stdio', command: 'cmd-a', args: [], enabled: true } } },
    bust,
  )
  const { wsDir: wsDir2 } = await setupWorkspace(
    'ws-del-b',
    { servers: { 'tool-b': { type: 'stdio', command: 'cmd-b', args: [], enabled: true } } },
    bust,
  )
  const { migrateWorkspaceMcpToGlobal } = await import(`./migration.ts?bust=${bust}`)

  migrateWorkspaceMcpToGlobal()

  expect(existsSync(join(wsDir1, 'mcp.json'))).toBe(false)
  expect(existsSync(join(wsDir2, 'mcp.json'))).toBe(false)
})

// ─────────────────────────────────────────────────────────
// 测试 7: 全局文件已存在 → 幂等跳过，不动工作区文件
// ─────────────────────────────────────────────────────────
test('幂等：全局文件已存在则跳过，不动工作区 mcp.json', async () => {
  const bust = cachebust++
  const cp = await import(`../config-paths.ts?bust=${bust}`)
  const { wsDir } = await setupWorkspace(
    'ws-idempotent',
    { servers: { 'existing-tool': { type: 'stdio', command: 'cmd', args: [], enabled: true } } },
    bust,
  )

  // 预先写入全局文件（内容与工作区不同）
  const globalPath = cp.getGlobalMcpPath()
  mkdirSync(join(globalPath, '..'), { recursive: true })
  const originalGlobal = { servers: { 'pre-existing': { type: 'stdio', command: 'pre-cmd', args: [], enabled: true } } }
  writeFileSync(globalPath, JSON.stringify(originalGlobal, null, 2))

  const { migrateWorkspaceMcpToGlobal } = await import(`./migration.ts?bust=${bust}`)
  migrateWorkspaceMcpToGlobal()

  // 全局文件内容未变
  const cfg = JSON.parse(readFileSync(globalPath, 'utf-8'))
  expect(cfg).toEqual(originalGlobal)

  // 工作区 mcp.json 未被删除
  expect(existsSync(join(wsDir, 'mcp.json'))).toBe(true)
})
