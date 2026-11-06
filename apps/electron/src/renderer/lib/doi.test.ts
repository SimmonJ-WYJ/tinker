/**
 * doi.ts 单测：四形态解析 / 误伤防护 / 归一化
 * （spec: docs/specs/doi-paper-jump-spec.md §7）
 */
import { describe, expect, test } from 'bun:test'
import { parseDoiExact, findDois, doiFromUrl, normalizeDoi, DOI_PROBE_RE } from './doi.ts'

describe('parseDoiExact（A/D 行内 code 整串匹配）', () => {
  test('裸 DOI', () => {
    expect(parseDoiExact('10.18653/v1/2025.acl-long.28')).toBe('10.18653/v1/2025.acl-long.28')
  })

  test('容忍首尾空白', () => {
    expect(parseDoiExact('  10.1109/lra.2023.3252323  ')).toBe('10.1109/lra.2023.3252323')
  })

  test('doi: 前缀（大小写不敏感、冒号后容忍空格）', () => {
    expect(parseDoiExact('doi:10.1145/3695053.3731051')).toBe('10.1145/3695053.3731051')
    expect(parseDoiExact('DOI: 10.1145/3695053.3731051')).toBe('10.1145/3695053.3731051')
  })

  test('doi.org / dx.doi.org URL 形态', () => {
    expect(parseDoiExact('https://doi.org/10.1609/aaai.v40i38.40502')).toBe('10.1609/aaai.v40i38.40502')
    expect(parseDoiExact('http://dx.doi.org/10.1609/aaai.v40i38.40502')).toBe('10.1609/aaai.v40i38.40502')
  })

  test('剥尾随装饰（句点/逗号/右括号）', () => {
    expect(parseDoiExact('10.23919/date64628.2025.10992912.')).toBe('10.23919/date64628.2025.10992912')
  })

  test('保留大小写（归一化是 normalizeDoi 的职责）', () => {
    expect(parseDoiExact('10.1364/OE.21.025418')).toBe('10.1364/OE.21.025418')
  })

  test('误伤防护：版本号 / 小数 / 注册号不足 4 位 / 含杂质文本', () => {
    expect(parseDoiExact('10.2.3')).toBeNull()
    expect(parseDoiExact('10.5')).toBeNull()
    expect(parseDoiExact('10.123/x')).toBeNull()
    expect(parseDoiExact('见 10.18653/v1/2025.acl-long.28')).toBeNull()
    expect(parseDoiExact('npm install foo@10.1234')).toBeNull()
    expect(parseDoiExact('')).toBeNull()
  })
})

describe('findDois（C/D 裸文本扫描）', () => {
  test('单个裸 DOI，index/length 覆盖完整命中区间', () => {
    const text = '详见 10.18653/v1/2026.latechclfl-1.28 一文'
    const hits = findDois(text)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.doi).toBe('10.18653/v1/2026.latechclfl-1.28')
    expect(text.slice(hits[0]!.index, hits[0]!.index + hits[0]!.length)).toBe(
      '10.18653/v1/2026.latechclfl-1.28',
    )
  })

  test('doi: 前缀命中区间含前缀（供整段替换为 chip）', () => {
    const text = 'See DOI: 10.1109/dac63849.2025.11132542 for details'
    const hits = findDois(text)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.doi).toBe('10.1109/dac63849.2025.11132542')
    expect(text.slice(hits[0]!.index, hits[0]!.index + hits[0]!.length)).toBe(
      'DOI: 10.1109/dac63849.2025.11132542',
    )
  })

  test('多命中', () => {
    const hits = findDois('对比 10.1109/a.1 与 10.18653/b.2 两篇')
    expect(hits.map((h) => h.doi)).toEqual(['10.1109/a.1', '10.18653/b.2'])
  })

  test('中文全角标点紧跟 DOI 时不吞正文', () => {
    const hits = findDois('该文（10.1109/lra.2023.3252323，2023）提出…')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.doi).toBe('10.1109/lra.2023.3252323')
  })

  test('尾随半角句点剥离且 length 同步收缩', () => {
    const text = 'ends with 10.1234/abc.def.'
    const hits = findDois(text)
    expect(hits[0]!.doi).toBe('10.1234/abc.def')
    expect(text.slice(hits[0]!.index, hits[0]!.index + hits[0]!.length)).toBe('10.1234/abc.def')
  })

  test('误伤防护：版本号 / 更长 token 内部不命中', () => {
    expect(findDois('升级到 10.2.3 版本')).toHaveLength(0)
    expect(findDois('v10.1234/xyz 不是 DOI')).toHaveLength(0)
    expect(findDois('增长 10.5% 左右')).toHaveLength(0)
  })
})

describe('doiFromUrl（B 链接形态）', () => {
  test('doi.org / dx.doi.org / www.doi.org 命中', () => {
    expect(doiFromUrl('https://doi.org/10.1364/OE.21.025418')).toBe('10.1364/OE.21.025418')
    expect(doiFromUrl('http://dx.doi.org/10.1364/OE.21.025418')).toBe('10.1364/OE.21.025418')
    expect(doiFromUrl('https://www.doi.org/10.1364/OE.21.025418')).toBe('10.1364/OE.21.025418')
  })

  test('URL 编码的 DOI 后缀解码', () => {
    expect(doiFromUrl('https://doi.org/10.1000/a%3Cb%3E')).toBe('10.1000/a<b>')
  })

  test('非 doi.org 域名 / 非 http(s) / 非 DOI 路径不命中', () => {
    expect(doiFromUrl('https://example.com/10.1234/abc')).toBeNull()
    expect(doiFromUrl('ftp://doi.org/10.1234/abc')).toBeNull()
    expect(doiFromUrl('https://doi.org/about')).toBeNull()
    expect(doiFromUrl('not-a-url')).toBeNull()
  })
})

describe('normalizeDoi（匹配 key 归一化）', () => {
  test('四种书写形态归一到同一小写 key', () => {
    const expected = '10.1364/oe.21.025418'
    expect(normalizeDoi('10.1364/OE.21.025418')).toBe(expected)
    expect(normalizeDoi('doi: 10.1364/OE.21.025418')).toBe(expected)
    expect(normalizeDoi('https://doi.org/10.1364/OE.21.025418')).toBe(expected)
    expect(normalizeDoi('10.1364/OE.21.025418.')).toBe(expected)
  })

  test('非 DOI 返回 null', () => {
    expect(normalizeDoi('10.2.3')).toBeNull()
  })
})

describe('DOI_PROBE_RE（廉价探针）', () => {
  test('含 DOI 形片段命中、普通文本不命中', () => {
    expect(DOI_PROBE_RE.test('见 10.18653/v1/x')).toBe(true)
    expect(DOI_PROBE_RE.test('普通文本 10.2.3 版本')).toBe(false)
  })
})
