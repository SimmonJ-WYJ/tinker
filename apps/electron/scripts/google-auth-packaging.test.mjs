import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  return { root, resources, source, context: { appDir: root, appOutDir: join(root, 'out'), packager: { getResourcesDir: () => join(root, 'packaged-resources') } } }
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
test('builder resolves both named hooks and ships configuration as a Resources file', () => {
  const yaml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
  expect(yaml).toMatch(/beforePack: .\/scripts\/google-auth-packaging.mjs/)
  expect(yaml).toMatch(/afterPack: .\/scripts\/google-auth-packaging.mjs/)
  expect(yaml).toMatch(/from: dist\/auth-google.json\s+to: auth-google.json/)
})
