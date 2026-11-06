import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPdfAsBase64 } from './zotero-library.ts'

let tmpDir = ''

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'asci-zotero-readpdf-'))
  process.env.ZOTERO_DATA_DIR = tmpDir
  mkdirSync(join(tmpDir, 'storage', 'ABC123'), { recursive: true })
  writeFileSync(join(tmpDir, 'storage', 'ABC123', 'paper.pdf'), Buffer.from('PDFBYTES'))
})

afterEach(() => {
  delete process.env.ZOTERO_DATA_DIR
  rmSync(tmpDir, { recursive: true, force: true })
})

test('readPdfAsBase64 读取 storage 下文件并返回 base64', () => {
  const result = readPdfAsBase64({
    path: join(tmpDir, 'storage', 'ABC123', 'paper.pdf'),
  })
  expect(result).toBe(Buffer.from('PDFBYTES').toString('base64'))
})

test('readPdfAsBase64 拒绝 storage 目录之外的路径', () => {
  const outside = join(tmpDir, 'elsewhere.pdf')
  writeFileSync(outside, Buffer.from('NOPE'))
  expect(() => readPdfAsBase64({ path: outside })).toThrow(/不在 Zotero 数据目录/)
})

test('readPdfAsBase64 拒绝路径穿越', () => {
  const outside = join(tmpDir, 'outside.pdf')
  writeFileSync(outside, Buffer.from('TRAVERSAL'))
  const evil = join(tmpDir, 'storage', 'ABC123', '..', '..', 'outside.pdf')
  expect(() => readPdfAsBase64({ path: evil })).toThrow(/不在 Zotero 数据目录/)
})

test('readPdfAsBase64 文件不存在时抛错', () => {
  const missing = join(tmpDir, 'storage', 'XYZ', 'missing.pdf')
  expect(() => readPdfAsBase64({ path: missing })).toThrow(/文件不存在/)
})

test('readPdfAsBase64 拒绝指向 storage 外的符号链接', () => {
  const secret = join(tmpDir, 'secret.txt')
  writeFileSync(secret, Buffer.from('SECRET'))
  const link = join(tmpDir, 'storage', 'ABC123', 'evil.pdf')
  symlinkSync(secret, link)
  expect(() => readPdfAsBase64({ path: link })).toThrow(/不在 Zotero 数据目录/)
})
