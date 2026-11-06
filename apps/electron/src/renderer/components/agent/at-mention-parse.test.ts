import { test, expect } from 'bun:test'
import {
  extractZoteroItemKeys,
  extractZoteroCollectionKeys,
  extractEvidenceSetIds,
  humanizeMentions,
} from './at-mention-parse.ts'

test('extractZoteroItemKeys 抽取一个 key', () => {
  expect(extractZoteroItemKeys('请看 @zotero-item:ABC123 这篇')).toEqual(['ABC123'])
})

test('extractZoteroItemKeys 抽取多个并去重保序', () => {
  const text = '@zotero-item:A 和 @zotero-item:B\n再来一次 @zotero-item:A'
  expect(extractZoteroItemKeys(text)).toEqual(['A', 'B'])
})

test('extractZoteroItemKeys 无匹配返回空数组', () => {
  expect(extractZoteroItemKeys('普通文本')).toEqual([])
})

test('extractZoteroItemKeys 不会误匹配 @zotero-col', () => {
  expect(extractZoteroItemKeys('@zotero-col:X')).toEqual([])
})

test('extractZoteroCollectionKeys 抽取一个 key', () => {
  expect(extractZoteroCollectionKeys('看看 @zotero-col:XYZ 类目')).toEqual(['XYZ'])
})

test('extractZoteroCollectionKeys 去重', () => {
  expect(extractZoteroCollectionKeys('@zotero-col:K @zotero-col:K')).toEqual(['K'])
})

test('extractZoteroItemKeys 去除 | 后面的 label 部分', () => {
  expect(extractZoteroItemKeys('看 @zotero-item:ABC|Attention%20Is%20All%20You%20Need 这篇')).toEqual(['ABC'])
})

test('extractZoteroCollectionKeys 去除 | 后面的 label 部分', () => {
  expect(extractZoteroCollectionKeys('@zotero-col:XYZ|AS4-%E5%BF%83%E7%90%86%E5%AD%A6')).toEqual(['XYZ'])
})

test('extractEvidenceSetIds 抽取一个 id', () => {
  expect(extractEvidenceSetIds('引用 @evidence-set:set_123 这个集合')).toEqual(['set_123'])
})

test('extractEvidenceSetIds 去重保序 + 去掉 |label', () => {
  const text = '@evidence-set:a|Transformers @evidence-set:b 再来 @evidence-set:a'
  expect(extractEvidenceSetIds(text)).toEqual(['a', 'b'])
})

test('extractEvidenceSetIds 不会误匹配 @zotero-item', () => {
  expect(extractEvidenceSetIds('@zotero-item:X')).toEqual([])
})

// ---------- humanizeMentions：把 @提及 token 替换成可读名 ----------

test('humanizeMentions: zotero-col decode 中文显示名', () => {
  // %E9%A2%84%E8%AE%AD%E7%BB%83 = 预训练
  expect(humanizeMentions('@zotero-col:DXM83Q8B|%E9%A2%84%E8%AE%AD%E7%BB%83 综述')).toBe('@预训练 综述')
})

test('humanizeMentions: zotero-item decode 含空格英文标题', () => {
  expect(humanizeMentions('@zotero-item:QQ9Y2QM5|Self-Healing%20Memory')).toBe('@Self-Healing Memory')
})

test('humanizeMentions: 多个连续 mention 各自独立替换', () => {
  expect(humanizeMentions('@zotero-col:A|%E9%A2%84 @zotero-item:B|Attention')).toBe('@预 @Attention')
})

test('humanizeMentions: evidence-set 按 name 段解码', () => {
  expect(humanizeMentions('@evidence-set:uuid-1|My%20Set')).toBe('@My Set')
})

test('humanizeMentions: file / dir 取 basename', () => {
  expect(humanizeMentions('@file:/Users/a/project/README.md')).toBe('@README.md')
  expect(humanizeMentions('@dir:/Users/a/project')).toBe('@project')
})

test('humanizeMentions: skill / mcp 保留原前缀 + 名字', () => {
  expect(humanizeMentions('用 /skill:paper-search 搜')).toBe('用 /paper-search 搜')
  expect(humanizeMentions('#mcp:zotero')).toBe('#zotero')
})

test('humanizeMentions: 旧 token 无 |name → 回退显示 KEY', () => {
  expect(humanizeMentions('@zotero-col:DXM83Q8B')).toBe('@DXM83Q8B')
})

test('humanizeMentions: 普通文本不动', () => {
  expect(humanizeMentions('这是一段没有 mention 的文本')).toBe('这是一段没有 mention 的文本')
})

test('humanizeMentions: decode 失败保留原编码串', () => {
  expect(humanizeMentions('@zotero-item:K|%E0%A4%A')).toBe('@%E0%A4%A')
})
