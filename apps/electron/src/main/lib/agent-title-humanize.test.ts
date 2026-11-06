import { describe, expect, test } from 'bun:test'
import { humanizeMessageForTitle } from './agent-title-humanize.ts'

describe('humanizeMessageForTitle', () => {
  test('zotero-col 带 url-encoded label → 解码后的 label', () => {
    const input = '@zotero-col:LPS4YRHQ|AS4-%E5%BF%83%E7%90%86%E5%AD%A6'
    expect(humanizeMessageForTitle(input)).toBe('AS4-心理学')
  })

  test('zotero-col 无 label 回退到 KEY', () => {
    expect(humanizeMessageForTitle('@zotero-col:LPS4YRHQ')).toBe('LPS4YRHQ')
  })

  test('zotero-item 带 url-encoded label → 解码后的 label', () => {
    expect(humanizeMessageForTitle('@zotero-item:ABC|%E8%AE%BA%E6%96%87')).toBe('论文')
  })

  test('@file: 取 basename', () => {
    expect(humanizeMessageForTitle('@file:/abs/path/to/foo.pdf')).toBe('foo.pdf')
    expect(humanizeMessageForTitle('@file:bar.txt')).toBe('bar.txt')
  })

  test('/skill: 与 #mcp: 直接用 ID', () => {
    expect(humanizeMessageForTitle('/skill:my-skill')).toBe('my-skill')
    expect(humanizeMessageForTitle('#mcp:server-name')).toBe('server-name')
  })

  test('@dir: 取末段目录名', () => {
    expect(humanizeMessageForTitle('@dir:searches')).toBe('searches')
    expect(humanizeMessageForTitle('@dir:a/b/sub')).toBe('sub')
  })

  test('@evidence-set: 带 url-encoded label → 解码后的 label', () => {
    expect(humanizeMessageForTitle('@evidence-set:set_1|%E8%AF%81%E6%8D%AE%E9%9B%86')).toBe('证据集')
  })

  test('mention 与普通文本混合时只替换 mention', () => {
    expect(humanizeMessageForTitle('请整理 @zotero-col:K|集合 中的资料'))
      .toBe('请整理 集合 中的资料')
  })

  test('无 mention 时原样返回', () => {
    expect(humanizeMessageForTitle('普通消息')).toBe('普通消息')
  })

  test('多个 mention 全部替换', () => {
    expect(humanizeMessageForTitle('@zotero-col:K1|A @zotero-col:K2|B')).toBe('A B')
  })

  test('label url-encoding 损坏时回退到原始 encoded 串', () => {
    expect(humanizeMessageForTitle('@zotero-col:K|%FX')).toBe('%FX')
  })

  test('回归：@zotero-col 长度恰好 20 时不会被截断丢失 label', () => {
    // bug 复现：长度 20 → slice(0, 20) 切掉 |encoded
    // 修复后 humanize 在 slice 之前替换为短 label
    const input = '@zotero-col:LPS4YRHQ|%E5%BF%83'
    const humanized = humanizeMessageForTitle(input)
    expect(humanized).toBe('心')
    expect(humanized.length).toBeLessThan(20)
  })
})

test('附件包装不污染会话标题', () => {
 expect(humanizeMessageForTitle('<attached_files>\n- image.png\n</attached_files>\n\n把姿势保留')).toBe('把姿势保留')
})
