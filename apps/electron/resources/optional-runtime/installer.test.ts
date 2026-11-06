import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import * as tar from 'tar'
import { installComponent, type Artifact } from './installer'

function fixture() {
 const root = mkdtempSync(join(tmpdir(), 'asci-component-'))
 mkdirSync(join(root, 'source/package'), { recursive: true })
 writeFileSync(join(root, 'source/package/package.json'), '{"name":"fixture","version":"1"}')
 tar.c({ cwd: join(root, 'source'), file: join(root, 'fixture.tgz'), gzip: true, sync: true }, ['package'])
 const bytes = readFileSync(join(root, 'fixture.tgz'))
 const artifact: Artifact = { name: 'fixture', version: '1', url: 'https://registry.npmjs.org/fixture/-/fixture-1.tgz', integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, format: 'tgz' }
 return { root, bytes, artifact }
}
test('download is integrity checked, cached and deduplicated', async () => {
 const f = fixture(); let calls=0
 try {
  const options = { root: join(f.root,'cache'), artifacts:[f.artifact], fetcher: async () => { calls++; return new Response(f.bytes) } }
  const [a,b]=await Promise.all([installComponent(options),installComponent(options)])
  expect(a).toBe(b);expect(calls).toBe(1)
  expect(existsSync(join(a,'node_modules/fixture/package.json'))).toBe(true)
  await installComponent(options);expect(calls).toBe(1)
 } finally {rmSync(f.root,{recursive:true,force:true})}
})
test('bad integrity never promotes cache and a retry succeeds', async () => {
 const f=fixture()
 try {
  const options={root:join(f.root,'cache'),artifacts:[f.artifact]}
  await expect(installComponent({...options,fetcher:async()=>new Response('bad')})).rejects.toThrow('校验')
  expect(existsSync(join(options.root,'ready.json'))).toBe(false)
  const path=await installComponent({...options,fetcher:async()=>new Response(f.bytes)})
  expect(existsSync(join(path,'ready.json'))).toBe(true)
 } finally {rmSync(f.root,{recursive:true,force:true})}
})
test('reject links in upstream archives without writing outside staging', async () => {
 const f=fixture()
 try {
  const {symlinkSync}=await import('node:fs');symlinkSync('/tmp',join(f.root,'source/package/escape'))
  tar.c({cwd:join(f.root,'source'),file:join(f.root,'bad.tgz'),gzip:true,sync:true},['package'])
  const bytes=readFileSync(join(f.root,'bad.tgz'))
  await expect(installComponent({root:join(f.root,'cache'),artifacts:[{...f.artifact,integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`}],fetcher:async()=>new Response(bytes)})).rejects.toThrow('压缩包')
 } finally {rmSync(f.root,{recursive:true,force:true})}
})
test('HTTP failure is retryable, transfer cap enforced, and binary gzip installs executable', async()=>{
 const f=fixture()
 try {
  await expect(installComponent({root:join(f.root,'a'),artifacts:[f.artifact],fetcher:async()=>new Response('fail',{status:503})})).rejects.toThrow('503')
  await expect(installComponent({root:join(f.root,'b'),artifacts:[f.artifact],maxBytes:2,fetcher:async()=>new Response(f.bytes)})).rejects.toThrow('大小')
  const bytes=gzipSync('binary fixture')
  const path=await installComponent({root:join(f.root,'c'),artifacts:[{...f.artifact,name:'ffmpeg',format:'gz',integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`}],fetcher:async()=>new Response(bytes)})
  expect(readFileSync(join(path,'ffmpeg'),'utf8')).toBe('binary fixture')
 } finally {rmSync(f.root,{recursive:true,force:true})}
})

test('runtime archive preserves safe internal aliases and executable entrypoint', async () => {
 const f=fixture()
 try {
  const {symlinkSync,chmodSync,statSync}=await import('node:fs')
  writeFileSync(join(f.root,'source/package/tool'),'#!/bin/sh\necho ready\n');chmodSync(join(f.root,'source/package/tool'),0o755)
  symlinkSync('tool',join(f.root,'source/package/alias'))
  tar.c({cwd:join(f.root,'source'),file:join(f.root,'runtime.tgz'),gzip:true,sync:true},['package'])
  const bytes=readFileSync(join(f.root,'runtime.tgz'))
  const path=await installComponent({root:join(f.root,'cache'),artifacts:[{...f.artifact,format:'runtime-tgz',entrypoint:'package/tool',prunePaths:['package/package.json'],integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`}],fetcher:async()=>new Response(bytes)})
  expect(readFileSync(join(path,'fixture/package/alias'),'utf8')).toContain('ready')
  expect(existsSync(join(path,'fixture/package/package.json'))).toBe(false)
  expect(statSync(join(path,'fixture/package/tool')).mode & 0o111).not.toBe(0)
 } finally {rmSync(f.root,{recursive:true,force:true})}
})
test('runtime archive rejects escaping symlinks and invalid entrypoint', async () => {
 const f=fixture()
 try {
  const {symlinkSync}=await import('node:fs');symlinkSync('../../outside',join(f.root,'source/package/escape'))
  tar.c({cwd:join(f.root,'source'),file:join(f.root,'unsafe.tgz'),gzip:true,sync:true},['package'])
  const bytes=readFileSync(join(f.root,'unsafe.tgz'))
  const artifact={...f.artifact,format:'runtime-tgz' as const,entrypoint:'package/package.json',integrity:`sha512-${createHash('sha512').update(bytes).digest('base64')}`}
  await expect(installComponent({root:join(f.root,'cache'),artifacts:[artifact],fetcher:async()=>new Response(bytes)})).rejects.toThrow('压缩包')
  await expect(installComponent({root:join(f.root,'cache'),artifacts:[{...artifact,entrypoint:'../escape'}],fetcher:async()=>new Response(bytes)})).rejects.toThrow('入口')
 } finally {rmSync(f.root,{recursive:true,force:true})}
})
