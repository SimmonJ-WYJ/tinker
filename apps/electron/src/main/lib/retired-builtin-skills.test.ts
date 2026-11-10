import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isKnownRetiredBuiltinSkill } from './retired-builtin-skills.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture(): { root: string; directory: string } {
 const root = fs.mkdtempSync(join(tmpdir(), 'retired-layout-'))
 roots.push(root)
 const directory = join(root, 'review-proposer')
 fs.mkdirSync(directory)
 // 与受信发布文件同长，正文无效；这些 case 必须在读取正文前判定为用户资源。
 fs.writeFileSync(join(directory, 'SKILL.md'), Buffer.alloc(11926, 65))
 return { root, directory }
}
function expectNoBodyReads(directory: string, slug = 'review-proposer'): void {
 const reads: string[] = []
 const wholeFile = spyOn(fs, 'readFileSync').mockImplementation(() => { reads.push('readFileSync'); throw new Error('正文读取禁止') })
 const bounded = spyOn(fs, 'readSync').mockImplementation(() => { reads.push('readSync'); throw new Error('正文读取禁止') })
 try {
  expect(isKnownRetiredBuiltinSkill(directory, slug)).toBe(false)
  expect(reads).toEqual([])
 } finally { wholeFile.mockRestore(); bounded.mockRestore() }
}

test('same-name custom skill with a large or secret extra attachment is preserved without body reads', () => {
 for (const extra of ['large.bin', 'private-secret.txt']) {
  const { directory } = fixture()
  const fd = fs.openSync(join(directory, extra), 'w')
  fs.ftruncateSync(fd, extra === 'large.bin' ? 1024 ** 3 : 42)
  fs.closeSync(fd)
  expectNoBodyReads(directory)
  expect(fs.existsSync(join(directory, extra))).toBe(true)
 }
})
test('missing file or size change is rejected before reading any body', () => {
 const { directory } = fixture()
 fs.unlinkSync(join(directory, 'SKILL.md'))
 expectNoBodyReads(directory)
 fs.writeFileSync(join(directory, 'SKILL.md'), Buffer.alloc(11927))
 expectNoBodyReads(directory)
})
test('symlink root, symlink file and non-file entry remain user-owned without body reads', () => {
 const { root, directory } = fixture()
 const alias = join(root, 'alias')
 fs.symlinkSync(directory, alias, 'dir')
 expectNoBodyReads(alias)
 fs.renameSync(join(directory, 'SKILL.md'), join(root, 'private-source'))
 fs.symlinkSync(join(root, 'private-source'), join(directory, 'SKILL.md'))
 expectNoBodyReads(directory)
 fs.unlinkSync(join(directory, 'SKILL.md'))
 fs.mkdirSync(join(directory, 'SKILL.md'))
 expectNoBodyReads(directory)
})
test('extra deep directories and excessive entries are rejected before recursion or body reads', () => {
 const { directory } = fixture()
 fs.mkdirSync(join(directory, ...Array.from({ length: 50 }, () => 'deep')), { recursive: true })
 expectNoBodyReads(directory)
 for (let i = 0; i < 200; i++) fs.writeFileSync(join(directory, `attachment-${i}`), '')
 expectNoBodyReads(directory)
})
test('unknown slug is preserved without body reads', () => {
 const { directory } = fixture()
 expectNoBodyReads(directory, 'my-custom-skill')
})

test('missing nested file is rejected before reading otherwise matching files', () => {
 const { directory } = fixture()
 fs.writeFileSync(join(directory, 'SKILL.md'), Buffer.alloc(16812))
 fs.mkdirSync(join(directory, 'references'))
 fs.writeFileSync(join(directory, 'references/expansion-prompts.md'), Buffer.alloc(4692))
 expectNoBodyReads(directory, 'litreview')
})
test('same-size modified content is read in fixed chunks only and remains user-owned', () => {
 const { directory } = fixture()
 const originalRead = fs.readSync
 let bytesRead = 0
 let maxRequest = 0
 const wholeFile = spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('不可整文件读取') })
 const reads = spyOn(fs, 'readSync').mockImplementation((...args: unknown[]) => {
  maxRequest = Math.max(maxRequest, Number(args[3]))
  const result = Reflect.apply(originalRead, fs, args) as number
  bytesRead += result
  return result
 })
 try {
  expect(isKnownRetiredBuiltinSkill(directory, 'review-proposer')).toBe(false)
  expect(wholeFile).not.toHaveBeenCalled()
  expect(maxRequest).toBeLessThanOrEqual(8192)
  expect(bytesRead).toBe(11926)
 } finally { wholeFile.mockRestore(); reads.mockRestore() }
 expect(fs.statSync(join(directory, 'SKILL.md')).size).toBe(11926)
})
test('file growth after layout inspection is rejected at fd verification before body reads', () => {
 const { directory } = fixture()
 const path = join(directory, 'SKILL.md')
 const originalOpen = fs.openSync
 const opened = spyOn(fs, 'openSync').mockImplementation((...args: unknown[]) => {
  const fd = Reflect.apply(originalOpen, fs, args) as number
  fs.truncateSync(path, 1024 ** 3)
  return fd
 })
 const reads = spyOn(fs, 'readSync').mockImplementation(() => { throw new Error('突增后不得读取正文') })
 try {
  expect(isKnownRetiredBuiltinSkill(directory, 'review-proposer')).toBe(false)
  expect(opened).toHaveBeenCalledTimes(1)
  expect(reads).not.toHaveBeenCalled()
 } finally { opened.mockRestore(); reads.mockRestore() }
 expect(fs.statSync(path).size).toBe(1024 ** 3)
})
test('growth during a read remains bounded by the known byte length plus one sentinel', () => {
 const { directory } = fixture()
 const path = join(directory, 'SKILL.md')
 const originalRead = fs.readSync
 let bytesRead = 0
 let calls = 0
 let maxRequest = 0
 const reads = spyOn(fs, 'readSync').mockImplementation((...args: unknown[]) => {
  if (calls++ === 0) fs.truncateSync(path, 1024 ** 3)
  maxRequest = Math.max(maxRequest, Number(args[3]))
  const result = Reflect.apply(originalRead, fs, args) as number
  bytesRead += result
  return result
 })
 try {
  expect(isKnownRetiredBuiltinSkill(directory, 'review-proposer')).toBe(false)
  expect(maxRequest).toBeLessThanOrEqual(8192)
  expect(bytesRead).toBeLessThanOrEqual(11927)
  expect(calls).toBe(3)
 } finally { reads.mockRestore() }
 expect(fs.statSync(path).size).toBe(1024 ** 3)
})
test('excessive directory entries stop metadata enumeration at the exact known entry budget', () => {
 const { directory } = fixture()
 for (let i = 0; i < 200; i++) fs.writeFileSync(join(directory, `extra-${i}`), '')
 const reads = spyOn(fs.Dir.prototype, 'readSync')
 try {
  expectNoBodyReads(directory)
  expect(reads.mock.calls.length).toBeLessThanOrEqual(2)
 } finally { reads.mockRestore() }
})
