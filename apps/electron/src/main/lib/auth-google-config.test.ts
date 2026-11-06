import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readGoogleClientConfig } from './auth-google-config.ts'
test('bundled OAuth config works on a clean installation and local override wins', () => {
 const root = mkdtempSync(join(tmpdir(), 'asci-bundled-auth-'))
 const local = join(root, 'local'); const bundled = join(root, 'bundle')
 const { mkdirSync } = require('node:fs'); mkdirSync(local); mkdirSync(bundled)
 try {
  expect(readGoogleClientConfig(local, bundled)).toBeUndefined()
  writeFileSync(join(bundled, 'auth-google.json'), JSON.stringify({clientId:'bundled.apps.googleusercontent.com'}))
  expect(readGoogleClientConfig(local, bundled)?.clientId).toBe('bundled.apps.googleusercontent.com')
  writeFileSync(join(local, 'auth-google.json'), JSON.stringify({clientId:'local.apps.googleusercontent.com'}))
  expect(readGoogleClientConfig(local, bundled)?.clientId).toBe('local.apps.googleusercontent.com')
  writeFileSync(join(local, 'auth-google.json'), '{broken')
  expect(readGoogleClientConfig(local, bundled)?.clientId).toBe('bundled.apps.googleusercontent.com')
 } finally { rmSync(root, {recursive:true, force:true}) }
})
