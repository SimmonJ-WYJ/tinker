import { test, expect } from 'bun:test'
import { resolveBuiltinMcpServers, BUILTIN_MCP_NAMES } from './builtin-mcp-resolver.ts'

const STUB_PATHS = {
  zoteroServerCjs: '/tmp/zotero-server.cjs',
  ocrServerCjs: '/tmp/ocr-server.cjs',
  asrServerCjs: '/tmp/asr-server.cjs',
  paperSearchPackageDir: '/tmp/paper-search-mcp',
  asrModelDir: '/tmp/asr-models',
  asrCacheRoot: '/tmp/asr-cache',
  pyCachePrefixDir: '/tmp/pycache',
}

test('全关闭：4 个内建 entry 始终输出（设置页固定可见）；uv 未就绪时 paper-search 也禁用', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: false,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: null,
    paths: STUB_PATHS,
    devEnv: {},
    paperSearchEnv: {},
  })
  expect(Object.keys(servers).sort()).toEqual(['asr', 'ocr', 'paper-search', 'zotero'])
  expect(servers.zotero?.enabled).toBe(false)
  expect(servers.ocr?.enabled).toBe(false)
  expect(servers.asr?.enabled).toBe(false)
  expect(servers['paper-search']?.enabled).toBe(false)
})

test('paper-search：uv 可用即自动启用（无独立 paperSearchEnabled gate）', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: false,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: '/usr/local/bin/uv',
    paths: STUB_PATHS,
    devEnv: {},
    paperSearchEnv: {},
  })
  expect(servers['paper-search']?.enabled).toBe(true)
  expect(servers['paper-search']?.command).toBe('/usr/local/bin/uv')
  // --no-sync：spawn 不重同步，避免并发 uv run 重建 editable 安装损坏共享 .venv
  // （venv 首次同步由 ensurePaperSearchVenvSynced 在会话启动前串行完成）
  expect(servers['paper-search']?.args).toEqual([
    'run', '--no-sync', '--extra', 'mcp',
    '--directory', STUB_PATHS.paperSearchPackageDir,
    'paper-search-mcp',
  ])
})

test('zoteroEnabled=true + ocr/asr 子开关都开 → 三件套 enabled=true', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: true,
    zoteroOcrEnabled: true,
    zoteroAsrEnabled: true,
    uvBin: null,
    paths: STUB_PATHS,
    devEnv: { ASCI_DEV: '1' },
    paperSearchEnv: {},
    zoteroDataDir: '/zotero-data',
  })
  expect(servers.zotero?.enabled).toBe(true)
  expect(servers.zotero?.command).toBe('node')
  expect(servers.zotero?.args?.[0]).toBe(STUB_PATHS.zoteroServerCjs)
  expect(servers.zotero?.env?.ZOTERO_DATA_DIR).toBe('/zotero-data')
  expect(servers.zotero?.env?.ASCI_DEV).toBe('1')
  expect(servers.ocr?.enabled).toBe(true)
  expect(servers.ocr?.args?.[0]).toBe(STUB_PATHS.ocrServerCjs)
  expect(servers.asr?.enabled).toBe(true)
  expect(servers.asr?.env?.ASCI_ASR_MODEL_DIR).toBe(STUB_PATHS.asrModelDir)
  expect(servers.asr?.env?.ASCI_ASR_CACHE_ROOT).toBe(STUB_PATHS.asrCacheRoot)
})

test('zoteroEnabled=true 但 ocr/asr 子开关关闭 → 子能力 enabled=false（zotero 自身仍 enabled）', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: true,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: null,
    paths: STUB_PATHS,
    devEnv: {},
    paperSearchEnv: {},
  })
  expect(servers.zotero?.enabled).toBe(true)
  expect(servers.ocr?.enabled).toBe(false)
  expect(servers.asr?.enabled).toBe(false)
})

test('uvBin=null → paper-search entry 仍输出但 enabled=false、command 空串', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: false,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: null,
    paths: STUB_PATHS,
    devEnv: {},
    paperSearchEnv: {},
  })
  expect(servers['paper-search']).toBeDefined()
  expect(servers['paper-search']?.enabled).toBe(false)
  expect(servers['paper-search']?.command).toBe('')
})

test('uvBin 就绪 → 注入 paper-search 含 --extra mcp', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: false,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: '/usr/local/bin/uv',
    paths: STUB_PATHS,
    devEnv: {},
    paperSearchEnv: { PAPER_SEARCH_MCP_UNPAYWALL_EMAIL: 'a@b' },
  })
  const ps = servers['paper-search']
  expect(ps?.command).toBe('/usr/local/bin/uv')
  expect(ps?.args).toContain('--extra')
  expect(ps?.args).toContain('mcp')
  expect(ps?.args).toContain('--directory')
  const args = ps?.args ?? []
  expect(args[args.indexOf('--directory') + 1]).toBe(STUB_PATHS.paperSearchPackageDir)
  expect(ps?.env?.PAPER_SEARCH_MCP_UNPAYWALL_EMAIL).toBe('a@b')
  expect(ps?.timeout).toBe(60)
})

test('paper-search：devEnv 注入 ASCI_DEV，与用户 paperSearchEnv 合并', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: false,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: '/usr/local/bin/uv',
    paths: STUB_PATHS,
    devEnv: { ASCI_DEV: '1' },
    paperSearchEnv: { PAPER_SEARCH_MCP_UNPAYWALL_EMAIL: 'a@b' },
  })
  const ps = servers['paper-search']
  expect(ps?.env?.ASCI_DEV).toBe('1')
  expect(ps?.env?.PAPER_SEARCH_MCP_UNPAYWALL_EMAIL).toBe('a@b')
})

test('paper-search：devEnv 与 paperSearchEnv 都为空时 env 仍含 PYTHONPYCACHEPREFIX（无 PYTHONDONTWRITEBYTECODE）', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: false,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: '/usr/local/bin/uv',
    paths: STUB_PATHS,
    devEnv: {},
    paperSearchEnv: {},
  })
  // issue #587：.pyc 重定向到缓存目录（不在包目录写盘 → 不触发 dev 热重载），
  // 同时保留字节码缓存（PYTHONDONTWRITEBYTECODE 会让每次冷启动全量重编译）
  expect(servers['paper-search']?.env).toEqual({ PYTHONPYCACHEPREFIX: STUB_PATHS.pyCachePrefixDir })
  expect(servers['paper-search']?.env?.PYTHONDONTWRITEBYTECODE).toBeUndefined()
})

test('paper-search：仅有 devEnv（prod 下无 paperSearchEnv key）也能下发 env', () => {
  const servers = resolveBuiltinMcpServers({
    zoteroEnabled: false,
    zoteroOcrEnabled: false,
    zoteroAsrEnabled: false,
    uvBin: '/usr/local/bin/uv',
    paths: STUB_PATHS,
    devEnv: { ASCI_DEV: '1' },
    paperSearchEnv: {},
  })
  expect(servers['paper-search']?.env?.ASCI_DEV).toBe('1')
})

test('BUILTIN_MCP_NAMES 包含四个保留名', () => {
  expect(BUILTIN_MCP_NAMES.has('zotero')).toBe(true)
  expect(BUILTIN_MCP_NAMES.has('ocr')).toBe(true)
  expect(BUILTIN_MCP_NAMES.has('asr')).toBe(true)
  expect(BUILTIN_MCP_NAMES.has('paper-search')).toBe(true)
})

test('buildBuiltinResolverInputFromEnv 调用各依赖收集器并返回 BuiltinMcpResolverInput', () => {
  const { buildBuiltinResolverInputFromEnv } = require('./builtin-mcp-resolver.ts')
  const input = buildBuiltinResolverInputFromEnv({
    getSettings: () => ({
      zoteroEnabled: true,
      zoteroOcrEnabled: true,
      zoteroAsrEnabled: false,
      zoteroDataDir: '/dir',
    }),
    findUvBin: () => '/uv',
    getZoteroServerCjsPath: () => '/zotero.cjs',
    getOcrServerCjsPath: () => '/ocr.cjs',
    getAsrServerCjsPath: () => '/asr.cjs',
    getPaperSearchPackageDir: () => '/ps',
    getAsrWeightsDir: () => '/asr-weights',
    getAsrCacheDir: () => '/asr-cache',
    getPyCacheDir: () => '/pycache',
    getConfigEnvForChildren: () => ({ ASCI_DEV: '1' }),
    loadPaperSearchEnv: () => ({ unpaywall_email: 'a@b' }),
  })
  expect(input.zoteroEnabled).toBe(true)
  expect(input.uvBin).toBe('/uv')
  expect(input.paths.zoteroServerCjs).toBe('/zotero.cjs')
  expect(input.paths.asrModelDir).toContain('/asr-weights')
  expect(input.paths.asrModelDir).toContain('sherpa-onnx-sense-voice')
  expect(input.paths.asrCacheRoot).toBe('/asr-cache')
  expect(input.paths.pyCachePrefixDir).toBe('/pycache')
  expect(input.devEnv.ASCI_DEV).toBe('1')
  expect(input.paperSearchEnv.PAPER_SEARCH_MCP_UNPAYWALL_EMAIL).toBe('a@b')
  expect(input.zoteroDataDir).toBe('/dir')
})
