import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveDesktopPreview } from './config.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tinker-desktop-preview-')))
  roots.push(root)
  const binary = join(root, 'runtime')
  writeFileSync(binary, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  writeFileSync(join(root, 'preview.json'), JSON.stringify({ version: 1, kind: 'tinker-rust-preview', root }), { mode: 0o600 })
  writeFileSync(join(root, 'profiles.json'), JSON.stringify([{ profileId: 'local', label: 'Synthetic', configRevision: 'r1', protocol: 'openai-chat', models: [{ modelId: 'model/a', label: 'A', supportedEfforts: ['high'] }], endpoint: 'http://127.0.0.1:1234/v1/chat/completions', key: 'synthetic' }]), { mode: 0o600 })
  return { root, env: { TINKER_DESKTOP_RUNTIME: 'rust-preview', TINKER_DESKTOP_ROOT: root, TINKER_DESKTOP_BINARY: binary, TINKER_DESKTOP_PROFILES: join(root, 'profiles.json'), ASCI_CONFIG_HOME: join(root, 'electron-compat') } }
}
test('default backend needs no preview paths', () => expect(resolveDesktopPreview({}, false)).toBeNull())
test('preview requires unpackaged explicit isolated configuration', () => {
  const { env, root } = fixture()
  expect(resolveDesktopPreview(env, false)?.root).toBe(root)
  expect(() => resolveDesktopPreview(env, true)).toThrow('DESKTOP_PREVIEW_CONFIG')
  for (const field of ['TINKER_DESKTOP_ROOT', 'TINKER_DESKTOP_BINARY', 'TINKER_DESKTOP_PROFILES', 'ASCI_CONFIG_HOME']) {
    expect(() => resolveDesktopPreview({ ...env, [field]: '' }, false)).toThrow('DESKTOP_PREVIEW_CONFIG')
  }
  expect(() => resolveDesktopPreview({ ...env, TINKER_DESKTOP_RUNTIME: 'rust' }, false)).toThrow()
})
test('external endpoints, unmarked roots, symlinks and writable profiles fail closed', () => {
  const { env, root } = fixture()
  const profiles = env.TINKER_DESKTOP_PROFILES
  const bad = JSON.stringify([{ endpoint: 'https://example.com/v1/chat/completions' }])
  writeFileSync(profiles, bad)
  expect(() => resolveDesktopPreview(env, false)).toThrow('DESKTOP_PREVIEW_CONFIG')
  rmSync(profiles)
  symlinkSync(join(root, 'preview.json'), profiles)
  expect(() => resolveDesktopPreview(env, false)).toThrow()
  rmSync(profiles)
  writeFileSync(profiles, '[]')
  chmodSync(profiles, 0o666)
  expect(() => resolveDesktopPreview(env, false)).toThrow()
  mkdirSync(join(root, 'agent-sessions'))
  expect(() => resolveDesktopPreview(env, false)).toThrow()
})

test('compat preference symlinks cannot escape an otherwise marked root',()=>{
 const {env,root}=fixture()
 mkdirSync(join(root,'electron-compat','.asci'),{recursive:true})
 symlinkSync(join(root,'profiles.json'),join(root,'electron-compat','.asci','settings.json'))
 expect(()=>resolveDesktopPreview(env,false)).toThrow('DESKTOP_PREVIEW_CONFIG')
})

test.each(['symlink','hardlink'])('restart rejects nested deliverables %s to owned outside sentinel',kind=>{
 const {env,root}=fixture()
 const outside=realpathSync(mkdtempSync(join(tmpdir(),'tinker-sentinel-')));roots.push(outside)
 const sentinel=join(outside,'sentinel.txt');writeFileSync(sentinel,'synthetic only',{mode:0o600})
 const dir=join(root,'deliverables','s');mkdirSync(dir,{recursive:true,mode:0o700})
 writeFileSync(join(dir,'owned.txt'),'owned',{mode:0o600})
 expect(resolveDesktopPreview(env,false)?.root).toBe(root)
 if(kind==='symlink')symlinkSync(outside,join(dir,'nested'))
 else linkSync(sentinel,join(dir,'linked.txt'))
 expect(()=>resolveDesktopPreview(env,false)).toThrow('DESKTOP_PREVIEW_CONFIG')
})
