import { test, expect } from 'bun:test'
import { normalizeDoi } from './normalize-doi'

test('normalizeDoi: 干净输入', () => {
  expect(normalizeDoi('10.1038/nature12373')).toBe('10.1038/nature12373')
  expect(normalizeDoi('10.1145/2487575.2488217')).toBe('10.1145/2487575.2488217')
})

test('normalizeDoi: trim + lowercase', () => {
  expect(normalizeDoi('  10.1038/Nature12373  ')).toBe('10.1038/nature12373')
})

test('normalizeDoi: 去 https://doi.org/ 前缀', () => {
  expect(normalizeDoi('https://doi.org/10.1038/nature12373')).toBe('10.1038/nature12373')
  expect(normalizeDoi('http://dx.doi.org/10.1038/nature12373')).toBe('10.1038/nature12373')
})

test('normalizeDoi: 去 doi: 前缀', () => {
  expect(normalizeDoi('doi:10.1038/nature12373')).toBe('10.1038/nature12373')
})

test('normalizeDoi: 去尾随反引号（markdown 表格爬取的典型污染）', () => {
  expect(normalizeDoi('10.1017/9781108653985.012`')).toBe('10.1017/9781108653985.012')
  expect(normalizeDoi('10.1145/2487575.2488217```')).toBe('10.1145/2487575.2488217')
})

test('normalizeDoi: 去尾随冒号（"DOI: xxx:" 拼接残留）', () => {
  expect(normalizeDoi('10.1017/9781108653985.023:')).toBe('10.1017/9781108653985.023')
})

test('normalizeDoi: 去尾随标点（句号、逗号、分号、引号、括号、引号、反斜杠）', () => {
  expect(normalizeDoi('10.1038/nature12373.')).toBe('10.1038/nature12373')
  expect(normalizeDoi('10.1038/nature12373,')).toBe('10.1038/nature12373')
  expect(normalizeDoi('10.1038/nature12373;')).toBe('10.1038/nature12373')
  expect(normalizeDoi('10.1038/nature12373)')).toBe('10.1038/nature12373')
  expect(normalizeDoi('10.1038/nature12373"')).toBe('10.1038/nature12373')
  expect(normalizeDoi("10.1038/nature12373'")).toBe('10.1038/nature12373')
  expect(normalizeDoi('10.1038/nature12373\\')).toBe('10.1038/nature12373')
})

test('normalizeDoi: 多个尾随字符叠加', () => {
  expect(normalizeDoi('10.1038/nature12373.`')).toBe('10.1038/nature12373')
  expect(normalizeDoi('10.1145/3219819.3219919: ')).toBe('10.1145/3219819.3219919')
})

test('normalizeDoi: N/A、空、非法返回 null', () => {
  expect(normalizeDoi('N/A')).toBe(null)
  expect(normalizeDoi('n/a')).toBe(null)
  expect(normalizeDoi('')).toBe(null)
  expect(normalizeDoi('   ')).toBe(null)
  expect(normalizeDoi('not a doi')).toBe(null)
  expect(normalizeDoi('20.1038/nature12373')).toBe(null)
  expect(normalizeDoi(null)).toBe(null)
  expect(normalizeDoi(undefined)).toBe(null)
  expect(normalizeDoi(123)).toBe(null)
})

test('normalizeDoi: 截断的 DOI（无法恢复）保留原样', () => {
  // 真实数据：'10.1016/0197-2456(86' 缺尾巴；我们不试图补回，但至少不被尾部正则吞掉数字
  expect(normalizeDoi('10.1016/0197-2456(86')).toBe('10.1016/0197-2456(86')
})

test('normalizeDoi: 含合法的特殊字符（路径段、版本号）保留', () => {
  expect(normalizeDoi('10.1039/d5sc00677e/v1/review2')).toBe('10.1039/d5sc00677e/v1/review2')
  expect(normalizeDoi('10.1017/9781108653985.023')).toBe('10.1017/9781108653985.023')
})
