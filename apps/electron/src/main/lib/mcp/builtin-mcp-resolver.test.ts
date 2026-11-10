import { test, expect } from 'bun:test'
import { resolveBuiltinMcpServers, BUILTIN_MCP_NAMES, buildBuiltinResolverInputFromEnv } from './builtin-mcp-resolver.ts'

test('media resolver preserves configured paths and child isolation without reading scientific credentials', () => {
 const forbidden = (): never => { throw new Error('scientific configuration must not be read') }
 const deps = {
  getSettings: () => ({ zoteroEnabled: false, zoteroOcrEnabled: true, zoteroAsrEnabled: false }),
  findUvBin: forbidden, getZoteroServerCjsPath: forbidden, getPaperSearchPackageDir: forbidden, getPyCacheDir: forbidden, loadPaperSearchEnv: forbidden,
  getOcrServerCjsPath: () => '/ocr.cjs', getAsrServerCjsPath: () => '/asr.cjs', getAsrWeightsDir: () => '/weights', getAsrCacheDir: () => '/cache', getConfigEnvForChildren: () => ({ ASCI_DEV: '1' }),
 }
 const input = buildBuiltinResolverInputFromEnv(deps)
 const servers = resolveBuiltinMcpServers(input)
 expect(Object.keys(servers).sort()).toEqual(['asr', 'ocr'])
 expect(servers.ocr).toMatchObject({ enabled: true, args: ['/ocr.cjs'], env: { ASCI_DEV: '1' } })
 expect(servers.asr).toMatchObject({ enabled: false, args: ['/asr.cjs'], env: { ASCI_ASR_CACHE_ROOT: '/cache', ASCI_DEV: '1' } })
})

test('reserved protocol identifiers remain compatible', () => {
 for (const name of ['ocr', 'asr', 'zotero', 'paper-search']) expect(BUILTIN_MCP_NAMES.has(name)).toBe(true)
})
