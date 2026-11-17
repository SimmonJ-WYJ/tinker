/** 日常合成回归；显式加 --git-baseline 可审计54真实发布布局（需要本地历史，不自动 fetch）。
 * 命令：bun apps/electron/src/main/lib/__tests__/fixtures/scientific-assets.fixture.ts --git-baseline
 * 仅使用临时文件；假 Electron/SDK 不产生网络或模型调用。
 */
import { mock, spyOn } from 'bun:test'
import { strict as assert } from 'node:assert'
import * as fs from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import baseline from './scientific-assets-baseline.json'
import { RETIRED_BUILTIN_SKILL_SLUGS, RETIRED_BUILTIN_SKILLS } from '@asci/shared'
import { isKnownRetiredBuiltinSkill, skillDirectoryFingerprint } from '../../retired-builtin-skills.ts'

const useGitBaseline = process.argv.includes('--git-baseline')
const root = fs.mkdtempSync(join(tmpdir(), 'scientific-assets-baseline-'))
const repo = resolve(import.meta.dir, '../../../../../../..')
const retired = baseline.skills.filter(s => ['retire', 'already-planned'].includes(s.classification))
const retained = baseline.skills.filter(s => !['retire', 'already-planned'].includes(s.classification))
const bundle = join(root, 'bundle')
fs.mkdirSync(bundle)
mock.module('electron', () => ({ app: { isPackaged: true } }))
Object.defineProperty(process, 'resourcesPath', { configurable: true, value: bundle })

function treeHash(directory: string): string {
 const hash = crypto.createHash('sha256')
 function walk(parent: string): string[] {
  return fs.readdirSync(join(directory, parent), { withFileTypes: true }).flatMap(e => {
   const path = parent ? `${parent}/${e.name}` : e.name
   return e.isDirectory() ? walk(path) : [path]
  })
 }
 for (const path of walk('').sort()) hash.update(path + '\0').update(fs.readFileSync(join(directory, path))).update('\0')
 return hash.digest('hex')
}

try {
 const sources = join(root, 'apps/electron/default-skills')
 if (useGitBaseline) {
  try { execFileSync('git', ['cat-file', '-e', `${baseline.baseline}^{commit}`], { cwd: repo, stdio: 'pipe' }) }
  catch { throw new Error(`needs-history: baseline ${baseline.baseline} is required for this explicit audit; no fetch was attempted`) }
  const archive = execFileSync('git', ['archive', baseline.baseline, 'apps/electron/default-skills'], { cwd: repo, maxBuffer: 20 * 1024 * 1024 })
  execFileSync('tar', ['-xf', '-', '-C', root], { input: archive })
 } else {
  // 日常测试无 Git 历史依赖：正文按受信精确布局合成，不保留退役资源副本。
  // 显式逐项遍历，避免本机 macOS/Bun 整目录 clonefileat 快速路径阻塞；保留全部资源。
  for (const skill of retained) {
   const source = join(repo, 'apps/electron/default-skills', skill.slug)
   const target = join(sources, skill.slug)
   fs.cpSync(source, target, { recursive: true, filter: () => true })
   assert.equal(treeHash(target), treeHash(source), `${skill.slug}: every retained resource copied unchanged`)
  }
  for (const skill of retired) {
   for (const [path, bytes] of Object.entries(RETIRED_BUILTIN_SKILLS[skill.slug]!.files)) {
    const content = Buffer.alloc(bytes, 32)
    if (path === 'SKILL.md') content.write(`---\nname: ${skill.slug}\ncategory: default\nversion: 1.0.0\n---\nSynthetic skill\n`)
    const target = join(sources, skill.slug, path)
    fs.mkdirSync(dirname(target), { recursive: true }); fs.writeFileSync(target, content)
   }
  }
  // 仅在隔离子进程中映射合成完整正文的摘要，验证真实 classifier/consumer 分支。
  // 真实 SHA-256 与54已发布正文由 --git-baseline 独立审计验证。
  const syntheticDigests = new Map(retired.map(skill => [treeHash(join(sources, skill.slug)), skill.fingerprint]))
  const originalHash = crypto.createHash
  spyOn(crypto, 'createHash').mockImplementation((...args: Parameters<typeof crypto.createHash>) => {
   const hash = originalHash(...args)
   const digest = hash.digest.bind(hash)
   hash.digest = ((encoding?: crypto.BinaryToTextEncoding) => {
    if (encoding) { const value = digest(encoding); return syntheticDigests.get(value) ?? value }
    return digest()
   }) as typeof hash.digest
   return hash
  })
 }
 assert.equal(retired.length, 54)
 assert.equal(retained.length, 45)
 assert.deepEqual([...RETIRED_BUILTIN_SKILL_SLUGS].sort(), retired.map(s => s.slug).sort())
 for (const skill of retired) {
  const directory = join(sources, skill.slug)
  assert.equal(treeHash(directory), skill.fingerprint, `${skill.slug}: complete fixture fingerprint`)
  if (useGitBaseline) console.log(`baseline fingerprint ${skill.slug} ${skill.fingerprint}`)
  const files = RETIRED_BUILTIN_SKILLS[skill.slug]!.files
  const entries = new Set(Object.keys(files))
  for (const path of Object.keys(files)) {
   const parts = path.split('/')
   for (let i = 1; i < parts.length; i++) entries.add(parts.slice(0, i).join('/'))
   assert.ok(parts.length <= 4)
  }
  assert.ok(entries.size <= 64)
  assert.ok(Object.values(files).every(bytes => bytes <= 64 * 1024))
  assert.ok(Object.values(files).reduce((a, b) => a + b, 0) <= 512 * 1024)
  const originalRead = fs.readSync
  let bytesRequested = 0
  const bounded = spyOn(fs, 'readSync').mockImplementation((...args: unknown[]) => {
   const requested = Number(args[3]); assert.ok(requested <= 8192); bytesRequested += requested
   return Reflect.apply(originalRead, fs, args) as number
  })
  const enumerations = spyOn(fs.Dir.prototype, 'readSync')
  const wholeFile = spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('不可整文件读取用户正文') })
  try {
   assert.equal(skillDirectoryFingerprint(directory, skill.slug), skill.fingerprint, `${skill.slug}: trusted bounded layout`)
   assert.equal(bytesRequested, Object.values(files).reduce((a, b) => a + b, 0) + Object.keys(files).length, `${skill.slug}: exact body budget plus per-file sentinels`)
   const directories = entries.size - Object.keys(files).length + 1
   assert.equal(enumerations.mock.calls.length, 2 * (entries.size + directories), `${skill.slug}: exact metadata budget for two inspections`)
  } finally { bounded.mockRestore(); enumerations.mockRestore(); wholeFile.mockRestore() }
  assert.equal(isKnownRetiredBuiltinSkill(directory, skill.slug), true, skill.slug)
 }
 for (const skill of retained) {
  const reads = spyOn(fs, 'readSync')
  try { assert.equal(isKnownRetiredBuiltinSkill(join(sources, skill.slug), skill.slug), false); assert.equal(reads.mock.calls.length, 0) }
  finally { reads.mockRestore() }
  if (useGitBaseline) {
   const original = join(sources, skill.slug)
   const current = join(repo, 'apps/electron/default-skills', skill.slug)
   const files = fs.readdirSync(original, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(original.length + 1)).sort()
   const currentFiles = fs.readdirSync(current, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(current.length + 1)).sort()
   assert.deepEqual(currentFiles, files, `${skill.slug}: every retained resource remains`)
   const edited = new Set(['markdown-mermaid-writing/SKILL.md', 'hypothesis-generation/SKILL.md', 'hypothesis-generation/assets/FORMATTING_GUIDE.md'])
   for (const path of files) if (!edited.has(`${skill.slug}/${path}`)) assert.deepEqual(fs.readFileSync(join(current, path)), fs.readFileSync(join(original, path)), `${skill.slug}/${path}: retained raw bytes unchanged`)
  }
 }
 for (const path of baseline.legalPaths) {
  const actual = fs.readFileSync(join(repo, path))
  assert.equal(crypto.createHash('sha256').update(actual).digest('hex'), baseline.legalHashes[path as keyof typeof baseline.legalHashes], `${path}: legal bytes unchanged`)
  if (useGitBaseline) assert.deepEqual(actual, execFileSync('git', ['show', `${baseline.baseline}:${path}`], { cwd: repo }))
 }
 const distributed = fs.readdirSync(join(repo, 'apps/electron/default-skills')).filter(slug => fs.existsSync(join(repo, 'apps/electron/default-skills', slug, 'SKILL.md'))).sort()
 assert.deepEqual(distributed, retained.map(s => s.slug).sort(), 'repository contains exactly 45 retained skills')

 const paths = await import('../../config-paths.ts')
 const manager = await import('../../agent-workspace-manager.ts')
 const defaults = paths.getDefaultSkillsDir()
 fs.cpSync(sources, join(bundle, 'default-skills'), { recursive: true })
 paths.seedDefaultSkills()
 assert.deepEqual(fs.readdirSync(defaults).sort(), retained.map(s => s.slug).sort(), 'seed excludes all 54 names')
 // 模拟旧版 default 缓存：复制/升级仍不得重新分发退役目录。
 fs.cpSync(sources, defaults, { recursive: true })
 for (const skill of retired) fs.writeFileSync(join(bundle, 'default-skills', skill.slug, 'SKILL.md'), `---\nname: ${skill.slug}\nversion: 999.0.0\ncategory: default\n---\nMust never overwrite a retired cached skill.\n`)
 paths.seedDefaultSkills()
 for (const skill of retired) assert.equal(treeHash(join(defaults, skill.slug)), skill.fingerprint, `${skill.slug}: seed leaves cached source unchanged`)
 const ws = manager.createAgentWorkspace('asset-regression')
 assert.deepEqual(manager.getAllWorkspaceSkills(ws.slug).map(s => s.slug).sort(), retained.map(s => s.slug).sort(), 'copy retains all 45 skills')
 const active = paths.getWorkspaceSkillsDir(ws.slug)
 // 全54原始副本仍在用户磁盘，但 discovery / registry / plugin 不再提供它们。
 for (const skill of retired) fs.cpSync(join(sources, skill.slug), join(active, skill.slug), { recursive: true })
 const { createRuntimeSkillProjection } = await import('../../runtime-skill-projection.ts')
 let projection = createRuntimeSkillProjection(ws.slug)
 try { for (const skill of retired) assert.equal(fs.existsSync(join(projection.path, 'skills', skill.slug)), false) }
 finally { projection.dispose() }
 const { createInMemorySubagentRegistry } = await import('../../subagent-registry.ts')
 const { seedSkillsToRegistry } = await import('../../skill-registry-seed.ts')
 const registry = createInMemorySubagentRegistry()
 seedSkillsToRegistry(registry, manager.getWorkspaceSkills(ws.slug))
 for (const skill of retired) assert.equal(registry.get(skill.slug, { kind: 'skill' }), null, `${skill.slug}: exact baseline absent from registry`)
 for (const skill of retired) {
  const directory = join(active, skill.slug)
  assert.equal(treeHash(directory), skill.fingerprint, `${skill.slug}: projection leaves source unchanged`)
  const path = join(directory, 'SKILL.md')
  fs.appendFileSync(path, '\nUser-owned changes\n')
 }
 const changedHashes = new Map(retired.map(s => [s.slug, treeHash(join(active, s.slug))]))
 for (const skill of retired) fs.writeFileSync(join(defaults, skill.slug, 'SKILL.md'), `---\nname: ${skill.slug}\nversion: 999.0.0\ncategory: default\n---\nMust never overwrite a retired workspace skill.\n`)
 manager.upgradeDefaultSkillsInWorkspaces()
 for (const skill of retired) assert.equal(treeHash(join(active, skill.slug)), changedHashes.get(skill.slug), `${skill.slug}: upgrade preserves custom copy`)
 // 删除保留技能，证明 upgrade 补装路径仅补装45项。
 for (const skill of retained) {
  fs.rmSync(join(active, skill.slug), { recursive: true, force: true })
  fs.rmSync(join(paths.getInactiveSkillsDir(ws.slug), skill.slug), { recursive: true, force: true })
 }
 manager.upgradeDefaultSkillsInWorkspaces()
 assert.equal(manager.getAllWorkspaceSkills(ws.slug).length, 99)

 // 每种已发布布局都验证正文修改、附件和链接；辅助文件也独立验证。
 for (const skill of retired) {
  const directory = join(sources, skill.slug)
  const file = join(directory, 'SKILL.md')
  const original = fs.readFileSync(file)
  const modified = Buffer.from(original); modified[modified.length - 1] = modified[modified.length - 1]! ^ 1
  fs.writeFileSync(file, modified)
  assert.equal(isKnownRetiredBuiltinSkill(directory, skill.slug), false, `${skill.slug}: same-size modification`)
  assert.deepEqual(fs.readFileSync(file), modified)
  fs.writeFileSync(file, original)
  const auxiliary = fs.readdirSync(directory, { recursive: true, withFileTypes: true }).find(e => e.isFile() && e.name !== 'SKILL.md')
  if (auxiliary) {
   const path = join(auxiliary.parentPath, auxiliary.name)
   const originalAux = fs.readFileSync(path)
   const changedAux = Buffer.from(originalAux)
   changedAux[changedAux.length - 1] = changedAux[changedAux.length - 1]! ^ 1
   fs.writeFileSync(path, changedAux)
   assert.equal(isKnownRetiredBuiltinSkill(directory, skill.slug), false, `${skill.slug}: same-size auxiliary change`)
   assert.deepEqual(fs.readFileSync(path), changedAux)
   fs.writeFileSync(path, originalAux)
  }
  const extra = join(directory, 'private-attachment.bin')
  const fd = fs.openSync(extra, 'w'); fs.ftruncateSync(fd, 1024 ** 3); fs.closeSync(fd)
  let reads = spyOn(fs, 'readSync')
  try { assert.equal(isKnownRetiredBuiltinSkill(directory, skill.slug), false); assert.equal(reads.mock.calls.length, 0) }
  finally { reads.mockRestore() }
  assert.equal(fs.statSync(extra).size, 1024 ** 3)
  fs.unlinkSync(extra)
  fs.unlinkSync(file); fs.symlinkSync(join(active, skill.slug, 'SKILL.md'), file)
  reads = spyOn(fs, 'readSync')
  try { assert.equal(isKnownRetiredBuiltinSkill(directory, skill.slug), false); assert.equal(reads.mock.calls.length, 0) }
  finally { reads.mockRestore() }
  fs.unlinkSync(file); fs.writeFileSync(file, original)
  assert.equal(treeHash(directory), skill.fingerprint)
 }
 seedSkillsToRegistry(registry, manager.getWorkspaceSkills(ws.slug))
 for (const skill of retired) assert.ok(registry.get(skill.slug, { kind: 'skill' }), `${skill.slug}: custom same-name remains registered`)
 let sdkOptions: import('@anthropic-ai/claude-agent-sdk').Options | undefined
 mock.module('@anthropic-ai/claude-agent-sdk', () => ({ query: (input: { options: import('@anthropic-ai/claude-agent-sdk').Options }) => {
  sdkOptions = input.options
  return Object.assign((async function* () { yield { type: 'result', subtype: 'success', session_id: 'asset-regression' } })(), { close() {} })
 } }))
 const { ClaudeAgentAdapter } = await import('../../adapters/claude-agent-adapter.ts')
 const adapter = new ClaudeAgentAdapter()
 async function verifySdkPlugin(): Promise<void> {
  projection = createRuntimeSkillProjection(ws.slug)
  try {
   for await (const _message of adapter.query({ sessionId: 'asset-regression', prompt: 'Synthetic regression', plugins: [{ type: 'local', path: projection.path }], runtimeSkills: projection, executable: { type: 'node', path: '/fake/never-executed' }, env: {}, systemPrompt: 'General task' } as never)) { /* 消费假 SDK。 */ }
   assert.equal(sdkOptions?.plugins?.[0]?.path, projection.path)
   for (const skill of baseline.skills) assert.ok(fs.existsSync(join(projection.path, 'skills', skill.slug)), `${skill.slug}: available mock SDK plugin`)
  } finally { projection.dispose() }
 }
 await verifySdkPlugin()
 for (const skill of retired) assert.equal(treeHash(join(active, skill.slug)), changedHashes.get(skill.slug))
 for (const skill of retired) {
  fs.cpSync(join(sources, skill.slug), join(active, skill.slug), { recursive: true })
  fs.writeFileSync(join(active, skill.slug, 'private-attachment'), 'user attachment')
 }
 await verifySdkPlugin()
 for (const skill of retired) {
  assert.equal(fs.readFileSync(join(active, skill.slug, 'private-attachment'), 'utf8'), 'user attachment')
  fs.unlinkSync(join(active, skill.slug, 'private-attachment'))
  fs.unlinkSync(join(active, skill.slug, 'SKILL.md'))
  fs.symlinkSync(join(sources, skill.slug, 'SKILL.md'), join(active, skill.slug, 'SKILL.md'))
 }
 await verifySdkPlugin()
 for (const skill of retired) {
  assert.ok(fs.lstatSync(join(active, skill.slug, 'SKILL.md')).isSymbolicLink())
  assert.equal(fs.readlinkSync(join(active, skill.slug, 'SKILL.md')), join(sources, skill.slug, 'SKILL.md'))
  assert.equal(treeHash(join(active, skill.slug)), skill.fingerprint)
 }
 adapter.dispose()
 console.log('scientific assets: 54 layouts, 45 retained skills, protected user copies and mock SDK plugin passed')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
