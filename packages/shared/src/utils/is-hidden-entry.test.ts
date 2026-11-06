import { test, expect, describe } from 'bun:test'
import { isHiddenEntry, HIDDEN_FS_ENTRIES } from './is-hidden-entry'

describe('isHiddenEntry', () => {
  test('点号开头文件应当被隐藏', () => {
    expect(isHiddenEntry('.env')).toBe(true)
    expect(isHiddenEntry('.gitignore')).toBe(true)
    expect(isHiddenEntry('.mcp.json')).toBe(true)
  })

  test('点号开头目录应当被隐藏', () => {
    expect(isHiddenEntry('.git')).toBe(true)
    expect(isHiddenEntry('.vscode')).toBe(true)
  })

  test('系统文件应当被隐藏（含不以点开头的）', () => {
    expect(isHiddenEntry('.DS_Store')).toBe(true)
    expect(isHiddenEntry('Thumbs.db')).toBe(true)
    expect(HIDDEN_FS_ENTRIES.has('Thumbs.db')).toBe(true)
  })

  test('普通文件不应当被隐藏', () => {
    expect(isHiddenEntry('paper.pdf')).toBe(false)
    expect(isHiddenEntry('README.md')).toBe(false)
    expect(isHiddenEntry('data.csv')).toBe(false)
  })

  test('空串或仅一个点的边界情况', () => {
    expect(isHiddenEntry('')).toBe(false)
    // 仅 "." 或 ".." 在 readdir 语境下一般不会出现，但仍按规则处理
    expect(isHiddenEntry('.')).toBe(true)
    expect(isHiddenEntry('..')).toBe(true)
  })

  test('名字中含点但不以点开头不应被隐藏', () => {
    expect(isHiddenEntry('my.file.txt')).toBe(false)
    expect(isHiddenEntry('archive.tar.gz')).toBe(false)
  })
})
