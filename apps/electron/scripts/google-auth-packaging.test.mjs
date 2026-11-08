import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { beforePack, afterPack } from './google-auth-packaging.mjs'

const roots = []
const originalSource = process.env.TINKER_GOOGLE_AUTH_CONFIG
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (originalSource === undefined) delete process.env.TINKER_GOOGLE_AUTH_CONFIG
  else process.env.TINKER_GOOGLE_AUTH_CONFIG = originalSource
})
function fixture(config) {
  const root = mkdtempSync(join(tmpdir(), 'tinker-auth-package-')); roots.push(root)
  const resources = join(root, 'resources'); mkdirSync(resources)
  const source = join(resources, 'auth-google.json')
  if (config !== undefined) writeFileSync(source, typeof config === 'string' ? config : JSON.stringify(config))
  process.env.TINKER_GOOGLE_AUTH_CONFIG = source
  return { root, resources, source, context: { appOutDir: join(root, 'out'), packager: { info: { appDir: root }, getResourcesDir: () => join(root, 'packaged-resources') } } }
}
const client = { clientId: 'preview.apps.googleusercontent.com', clientSecret: 'desktop-client-value' }

test('missing OAuth client fails packaging and removes stale staged config', async () => {
  const f = fixture();mkdirSync(join(f.root, 'dist'));writeFileSync(join(f.root, 'dist/auth-google.json'), JSON.stringify(client))
  await expect(beforePack(f.context)).rejects.toThrow(/Google.*配置/)
  expect(existsSync(join(f.root, 'dist/auth-google.json'))).toBe(false)
})
test.each(['{broken', { clientId: 'not-a-google-client' }, { clientId: 42 }, { ...client, clientSecret: 42 }, { ...client, refreshToken: 'must-not-ship' }])('rejects malformed config and user token fields: %p', async config => {
  const f = fixture(config)
  await expect(beforePack(f.context)).rejects.toThrow(/Google.*配置/)
  expect(existsSync(join(f.root, 'dist/auth-google.json'))).toBe(false)
})
test('stages only the valid application client and preserves its source', async () => {
  const f = fixture(client);await beforePack(f.context)
  expect(JSON.parse(readFileSync(join(f.root, 'dist/auth-google.json'), 'utf8'))).toEqual(client)
  expect(readFileSync(f.source, 'utf8')).toBe(JSON.stringify(client))
})
test('project-local resource is used when no explicit source is selected', async () => {
  const f = fixture(client);delete process.env.TINKER_GOOGLE_AUTH_CONFIG
  await beforePack(f.context)
  expect(JSON.parse(readFileSync(join(f.root, 'dist/auth-google.json'), 'utf8'))).toEqual(client)
})
test('explicit missing source never silently substitutes another client', async () => {
  const f = fixture(client);process.env.TINKER_GOOGLE_AUTH_CONFIG = join(f.root, 'missing.json')
  await expect(beforePack(f.context)).rejects.toThrow(/Google.*配置/)
})
test('final packaged resource must exist and match the staged client', async () => {
  const f = fixture(client);await beforePack(f.context)
  await expect(afterPack(f.context)).rejects.toThrow(/Google.*配置/)
  const out = f.context.packager.getResourcesDir();mkdirSync(out)
  writeFileSync(join(out, 'auth-google.json'), JSON.stringify({ clientId: 'different.apps.googleusercontent.com' }))
  await expect(afterPack(f.context)).rejects.toThrow(/Google.*配置/)
  writeFileSync(join(out, 'auth-google.json'), JSON.stringify(client))
  await expect(afterPack(f.context)).resolves.toBeUndefined()
})
test('builder configuration declares both hooks and the Resources file', () => {
  const yaml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  expect(yaml).toMatch(/beforePack: .\/scripts\/google-auth-packaging.mjs/)
  expect(yaml).toMatch(/afterPack: .\/scripts\/google-auth-packaging.mjs/)
  expect(yaml).toMatch(/from: dist\/auth-google.json\s+to: auth-google.json/)
})

test.each(['darwin', 'win32', 'linux'])('real builder invokes the hook with its actual %s context', async platform => {
  const f = fixture(client)
  const hook = fileURLToPath(new URL('./google-auth-packaging.mjs', import.meta.url))
  // 构建器依赖的 Bluebird/source-map-support 在 Bun 内不兼容；使用其真实 Node 宿主。
  const output = execFileSync('node', ['-e', `
    (async () => {
      const assert = require('node:assert/strict'); const { join } = require('node:path');
      require('app-builder-lib');
      const { resolveFunction } = require('app-builder-lib/out/util/resolve.js');
      const { PlatformPackager } = require('app-builder-lib/out/platformPackager.js');
      const [hook, root, platform] = process.argv.slice(1);
      assert.equal(typeof await resolveFunction('module', hook, 'beforePack'), 'function');
      assert.equal(typeof await resolveFunction('module', hook, 'afterPack'), 'function');
      const sentinel = Symbol('dependency stage reached');
      const packager = {
        packagerOptions: {}, appInfo: { type: 'module' }, config: { beforePack: hook },
        info: { appDir: root, cancellationToken: { cancelled: false }, installAppDependencies: async () => { throw sentinel; } },
      };
      let reached = false;
      try { await PlatformPackager.prototype.doPack.call(packager, join(root, 'out'), join(root, 'out/app'), platform, 1, {}, []); }
      catch (error) { if (error !== sentinel) throw error; reached = true; }
      assert.equal(reached, true); console.log('HOOK_CONTRACT_OK');
    })().catch(error => { console.error(error); process.exit(1); });
  `, hook, f.root, platform], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 15000 })
  expect(output).toContain('HOOK_CONTRACT_OK')
  expect(JSON.parse(readFileSync(join(f.root, 'dist/auth-google.json'), 'utf8'))).toEqual(client)
})
