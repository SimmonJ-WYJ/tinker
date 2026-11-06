import { describe, it, expect } from 'bun:test'
import { classifyPaste } from './paste-classify.ts'

describe('classifyPaste', () => {
  it('空串 / 纯空白 → 不折叠', () => {
    expect(classifyPaste('').shouldCollapse).toBe(false)
    expect(classifyPaste('   \n  ').shouldCollapse).toBe(false)
  })

  it('CJK 边界：50 不折叠，51 折叠', () => {
    expect(classifyPaste('字'.repeat(50)).shouldCollapse).toBe(false)
    expect(classifyPaste('字'.repeat(51)).shouldCollapse).toBe(true)
  })

  it('英文单词边界：50 不折叠，51 折叠', () => {
    const w50 = Array.from({ length: 50 }, () => 'word').join(' ')
    const w51 = Array.from({ length: 51 }, () => 'word').join(' ')
    expect(classifyPaste(w50).shouldCollapse).toBe(false)
    expect(classifyPaste(w51).shouldCollapse).toBe(true)
  })

  it('中英混排：各自独立计数，谁先过 50 即折叠', () => {
    const r = classifyPaste('字'.repeat(60) + ' hello world')
    expect(r.cjk).toBe(60)
    expect(r.words).toBe(2)
    expect(r.shouldCollapse).toBe(true)
  })

  it('计数：英文 token 不把 CJK 算进去', () => {
    const r = classifyPaste('你好 hello world 再见')
    expect(r.cjk).toBe(4)
    expect(r.words).toBe(2)
  })
})
