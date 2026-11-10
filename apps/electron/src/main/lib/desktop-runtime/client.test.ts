import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesktopClient } from './client.ts'
const roots: string[] = []
const clients: DesktopClient[] = []
afterEach(() => { clients.splice(0).forEach(c => c.close()); roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })) })
function fake(script: string, timeoutMs = 150) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tinker-desktop-preview-'))); roots.push(root)
  const binary = join(root, 'fake'); writeFileSync(binary, '#!/usr/bin/env python3\n'+script, { mode: 0o700 })
  const c = new DesktopClient({ root, binary, profilesFile: '', compatHome: '' }, timeoutMs); clients.push(c); return c
}
test('malformed, wrong-ID, ambiguous and timed-out frames fail all pending without replay', async () => {
  for (const reply of ['bad', '{"version":1,"id":"other","result":{}}', '{"version":1,"id":"host_1","result":{},"error":{"code":"BAD"}}']) {
    const c = fake(`import sys\nsys.stdin.readline()\nprint(${JSON.stringify(reply)}, flush=True)\nsys.stdin.read()\n`)
    const a = c.request('profiles.list', {}); const b = c.request('sessions.list', {})
    expect((await Promise.allSettled([a,b])).every(r => r.status === 'rejected')).toBe(true)
    await expect(c.request('profiles.list', {})).rejects.toThrow('DESKTOP_TRANSPORT')
  }
  await expect(fake('import sys\nsys.stdin.read()\n').request('sessions.list', {})).rejects.toThrow('DESKTOP_TRANSPORT')
})

test('partial frame then stdout EOF fails immediately while child remains alive', async () => {
  const client = fake(`import os,sys\nsys.stdin.readline()\nos.write(1,b' {"version":1')\nos.close(1)\nsys.stdin.read()\n`, 30000)
  let timer:ReturnType<typeof setTimeout>|undefined
  try {
    const outcome = await Promise.race([
      client.request('sessions.list', {}).then(()=>'resolved', error=>String(error)),
      new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('still waiting for timeout'),3000)}),
    ])
    expect(outcome).toContain('DESKTOP_TRANSPORT')
    await expect(client.request('profiles.list', {})).rejects.toThrow('DESKTOP_TRANSPORT')
  } finally { clearTimeout(timer) }
})
