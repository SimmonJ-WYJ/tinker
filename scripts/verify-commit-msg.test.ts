/**
 * commit-msg 守门测试 —— 校验 verify-commit-msg.sh 对 Conventional Commits 的拦截。
 *
 * 真相源：docs/adr/ADR-000-common-convention.md §3.2
 * 通过把 message 写进临时文件、以该文件路径调脚本，断言 exit code（0 通过 / 1 拒绝）。
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(import.meta.dir, 'verify-commit-msg.sh')
const TMP = mkdtempSync(join(tmpdir(), 'commit-msg-'))

afterAll(() => rmSync(TMP, { recursive: true, force: true }))

/** 把 message 写进临时文件并跑脚本，返回退出码 */
function runWith(message: string): number {
  const file = join(TMP, `msg-${Buffer.from(message).toString('hex').slice(0, 16)}`)
  writeFileSync(file, message)
  const { exitCode } = Bun.spawnSync(['bash', SCRIPT, file], { stdout: 'ignore', stderr: 'ignore' })
  return exitCode
}

describe('verify-commit-msg.sh', () => {
  describe('合规 message 通过（exit 0）', () => {
    const valid = [
      'feat(lit-search): 全源捕获 venue',
      'fix: 修复登录态丢失',
      'chore(release): bump to v0.1.435',
      'refactor(datetime): 全仓库统一用 dayjs',
      'docs(design): 反模式清单加规则',
      'ci: 加 commit-msg hook',
      'revert: 回退 SSO 登录',
      'test(scripts): 补单测',
      'perf(papers): DOI 缓存',
      'style(ui): 移除 focus ring',
      'feat!: 重命名 IPC 通道', // breaking change 标记
      'feat(agent)!: 破坏性 + scope',
      'feat(lit-search-report): scope 含连字符',
      'feat(#454): scope 含特殊字符',
    ]
    for (const msg of valid) {
      test(`✅ ${msg}`, () => expect(runWith(msg)).toBe(0))
    }
  })

  describe('不合规 message 拒绝（exit 1）', () => {
    const invalid = [
      'update readme', // 无 type
      'Feature: xxx', // type 非白名单（大写）
      'feature: xxx', // type 非白名单
      'feat 缺冒号', // 缺 ": "
      'feat:', // subject 为空
      'feat: ', // subject 仅空格
      '随便写点中文', // 完全不符合
      'WIP', // 无格式
    ]
    for (const msg of invalid) {
      test(`❌ ${msg}`, () => expect(runWith(msg)).toBe(1))
    }
    test('❌ 空 message', () => expect(runWith('')).toBe(1))
  })

  describe('git 自动生成 message 豁免（exit 0）', () => {
    const exempt = [
      "Merge branch 'main' into feat/x",
      'Merge pull request #123 from foo/bar',
      'Revert "feat(x): something"',
      'fixup! feat(x): original',
      'squash! fix: original',
    ]
    for (const msg of exempt) {
      test(`✅ ${msg}`, () => expect(runWith(msg)).toBe(0))
    }
  })

  describe('注释行 / 空行处理', () => {
    test('✅ 跳过注释行取首条有效行', () =>
      expect(runWith('# 这是 git 注释\n\nfeat: 正文')).toBe(0))
    test('❌ 注释后首条有效行不合规仍拒绝', () =>
      expect(runWith('# 注释\nbad message')).toBe(1))
  })
})
