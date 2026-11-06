import {test,expect} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {stageOptionalPythonPayload} from './optional-python-payload'
test('stage keeps Node, removes heavy payload, and wrappers preserve spaces, arguments and exit code',()=>{
 const root=mkdtempSync(join(tmpdir(),'asci python payload '))
 try {
  mkdirSync(join(root,'app/dist/resources'),{recursive:true});writeFileSync(join(root,'app/dist/resources/optional-python-launcher.cjs'),'fixture')
  mkdirSync(join(root,'runtimes/node/bin'),{recursive:true});writeFileSync(join(root,'runtimes/node/bin/node'),'#!/bin/sh\nprintf \'%s\\n\' "$@"\nexit 17\n',{mode:0o755})
  mkdirSync(join(root,'runtimes/python/heavy'),{recursive:true});writeFileSync(join(root,'runtimes/python/heavy/data'),'old')
  writeFileSync(join(root,'runtimes/uv'),'old')
  stageOptionalPythonPayload(root)
  expect(existsSync(join(root,'runtimes/python/heavy'))).toBe(false)
  for(const bin of ['uv','python/runtime/bin/python','python/runtime/bin/python3.12']) {
   const result=spawnSync(join(root,'runtimes',bin),['-c','print("hello world")'],{encoding:'utf8'})
   expect(result.status).toBe(17);expect(result.stdout).toContain('print("hello world")\n')
  }
  expect(existsSync(join(root,'runtimes/.optional-python'))).toBe(true)
 } finally {rmSync(root,{recursive:true,force:true})}
})
test('missing Node or launcher fails before deleting payload',()=>{
 const root=mkdtempSync(join(tmpdir(),'asci-python-missing-'))
 try {expect(()=>stageOptionalPythonPayload(root)).toThrow('requires')} finally {rmSync(root,{recursive:true,force:true})}
})
