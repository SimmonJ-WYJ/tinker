import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isScopedProjectEdit } from './scoped-edit-permission.ts'
test('only ordinary edits inside the canonical cwd are eligible for automatic approval', () => {
 const root = mkdtempSync(join(tmpdir(), 'asci-edit-scope-'))
 const cwd = join(root, 'project'); const outside = join(root, 'outside')
 mkdirSync(cwd); mkdirSync(outside); symlinkSync(outside, join(cwd, 'linked'))
 try {
  expect(isScopedProjectEdit('Write', { file_path: join(cwd, 'src/new.ts') }, cwd)).toBe(true)
  expect(isScopedProjectEdit('Edit', { file_path: 'app.ts' }, cwd)).toBe(true)
  for (const path of ['../outside/a', 'linked/a', '.env', '.git/config', '.aws/credentials', 'auth-google.json', 'credentials.json']) {
   expect(isScopedProjectEdit('Write', { file_path: path }, cwd)).toBe(false)
  }
  expect(isScopedProjectEdit('Bash', { command: 'touch a' }, cwd)).toBe(false)
  expect(isScopedProjectEdit('Write', {}, cwd)).toBe(false)
 } finally { rmSync(root, {recursive:true,force:true}) }
})
