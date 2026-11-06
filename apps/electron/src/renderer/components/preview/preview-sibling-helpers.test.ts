import { test, expect, describe } from 'bun:test'
import {
  siblingsFromEntries,
  extFromName,
  shouldIgnoreKeyboardEvent,
} from './preview-sibling-helpers'
import type { FileEntry } from '@asci/shared'

const mkFile = (name: string): FileEntry => ({
  name,
  path: `/root/${name}`,
  isDirectory: false,
})
const mkDir = (name: string): FileEntry => ({
  name,
  path: `/root/${name}`,
  isDirectory: true,
})

/** 构造鸭子类型的键盘事件目标 fake，无需 DOM */
const fakeTarget = (props: { tagName?: string; isContentEditable?: boolean }): EventTarget =>
  props as unknown as EventTarget

describe('siblingsFromEntries', () => {
  test('过滤掉目录，保留原有文件顺序', () => {
    const entries = [mkDir('sub'), mkFile('a.pdf'), mkFile('b.md')]
    const result = siblingsFromEntries(entries, '/root/a.pdf')
    expect(result).not.toBeNull()
    expect(result!.files.map((f) => f.name)).toEqual(['a.pdf', 'b.md'])
    expect(result!.currentIndex).toBe(0)
  })

  test('currentPath 不在列表中 currentIndex 为 -1', () => {
    const entries = [mkFile('a.pdf'), mkFile('b.md')]
    const result = siblingsFromEntries(entries, '/root/c.pdf')
    expect(result!.currentIndex).toBe(-1)
  })

  test('空文件列表返回 null', () => {
    expect(siblingsFromEntries([], '/root/a.pdf')).toBeNull()
    expect(siblingsFromEntries([mkDir('only-dir')], '/root/a.pdf')).toBeNull()
  })
})

describe('extFromName', () => {
  test('提取小写扩展名', () => {
    expect(extFromName('foo.PDF')).toBe('pdf')
    expect(extFromName('a.tar.gz')).toBe('gz')
  })

  test('无扩展名返回空串', () => {
    expect(extFromName('README')).toBe('')
    expect(extFromName('.hidden')).toBe('')
  })
})

describe('shouldIgnoreKeyboardEvent', () => {
  test('INPUT / TEXTAREA / contentEditable 应当忽略', () => {
    expect(shouldIgnoreKeyboardEvent(fakeTarget({ tagName: 'INPUT' }))).toBe(true)
    expect(shouldIgnoreKeyboardEvent(fakeTarget({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(shouldIgnoreKeyboardEvent(fakeTarget({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
  })

  test('普通元素或 null 不忽略', () => {
    expect(shouldIgnoreKeyboardEvent(fakeTarget({ tagName: 'DIV' }))).toBe(false)
    expect(shouldIgnoreKeyboardEvent(fakeTarget({}))).toBe(false)
    expect(shouldIgnoreKeyboardEvent(null)).toBe(false)
  })
})
