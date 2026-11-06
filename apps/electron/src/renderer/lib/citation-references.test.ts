import { test, expect } from 'bun:test'
import { parseReferences, parseReferenceLine } from './citation-references.ts'

test('解析标准格式：作者. *标题*. 期刊, 年份', () => {
  const md = `
## 7. References

[1] Broxton, M., et al. *Wave optics theory and 3D deconvolution for the light field microscope*. Optics Express 21(21), 25418, 2013.
[2] Stefanoiu, A. *Artifact-free deconvolution*. IEEE TCI, 2019.
`
  const map = parseReferences(md)
  expect(map.size).toBe(2)
  const r1 = map.get(1)!
  expect(r1.authors).toBe('Broxton, M., et al')
  expect(r1.title).toBe('Wave optics theory and 3D deconvolution for the light field microscope')
  expect(r1.venue).toBe('Optics Express 21(21), 25418')
  expect(r1.year).toBe('2013')
  const r2 = map.get(2)!
  expect(r2.year).toBe('2019')
})

test('支持 ### 7. References 与 # 7 References 等多级 heading', () => {
  const md = `### 7 References\n\n[3] A. *T*. 2020.\n`
  expect(parseReferences(md).get(3)?.year).toBe('2020')
})

test('容忍 §7 前缀：## §7 References / ### §7 References', () => {
  // abstract-only 路径 LLM 常输出 `## §7 References` 而非规范的 `## 7. References`
  const md1 = `## §7 References\n\n[1] Lo et al. *A Closer Look*. NAACL, 2025.\n`
  const map1 = parseReferences(md1)
  expect(map1.size).toBe(1)
  expect(map1.get(1)?.year).toBe('2025')

  const md2 = `### §7 References\n\n[2] He et al. *Upcycling*. arXiv:2410.07524, 2024.\n`
  expect(parseReferences(md2).get(2)?.year).toBe('2024')
})

test('支持列表前缀 - [N] 与 * [N]', () => {
  const md = `## 7. References\n- [1] A. *T1*. 2020.\n* [2] B. *T2*. 2021.\n`
  const map = parseReferences(md)
  expect(map.get(1)?.title).toBe('T1')
  expect(map.get(2)?.title).toBe('T2')
})

test('粗体标题 **Title** 也能识别', () => {
  const meta = parseReferenceLine('[5] Smith J. **A Bold Title**. Nature, 2022.')!
  expect(meta.title).toBe('A Bold Title')
  expect(meta.authors).toBe('Smith J')
  expect(meta.year).toBe('2022')
})

test('无斜体时按 ". " 分段兜底', () => {
  const meta = parseReferenceLine('[7] Doe J. A Plain Title. Some Venue, 2018.')!
  expect(meta.authors).toBe('Doe J')
  expect(meta.title).toBe('A Plain Title')
  expect(meta.year).toBe('2018')
})

test('Reminder Block 风格 (Year)', () => {
  const meta = parseReferenceLine('[9] Authors. *Title*. (2017)')!
  expect(meta.year).toBe('2017')
  expect(meta.title).toBe('Title')
  // (2017) 应被剥离，venue 不应残留括号或 2017
  expect(meta.venue ?? '').not.toContain('2017')
})

test('venue 末尾的 year 会被剥离避免与 meta.year 重复', () => {
  const meta = parseReferenceLine('[10] Smith J. *T*. Nature, 2022.')!
  expect(meta.venue).toBe('Nature')
  expect(meta.year).toBe('2022')
})

test('§7 边界：遇到 §8 heading 即停止', () => {
  const md = `
## 7. References

[1] A. *T1*. 2020.
[2] B. *T2*. 2021.

## 8. Decisions

[3] 不应被解析. *X*. 2022.
`
  const map = parseReferences(md)
  expect(map.size).toBe(2)
  expect(map.has(3)).toBe(false)
})

test('没有 §7 时返回空 Map（只解析 §0 Reminder Block 不算）', () => {
  const md = `> ⚠ **证据深度提示**\n>\n> - [1] A. *T*. (2020)\n\n## 1. Introduction\n`
  expect(parseReferences(md).size).toBe(0)
})

test('编号允许 gap', () => {
  const md = `## 7. References\n[1] A. *T1*. 2020.\n[3] C. *T3*. 2022.\n`
  const map = parseReferences(md)
  expect(map.size).toBe(2)
  expect(map.has(2)).toBe(false)
  expect(map.get(3)?.title).toBe('T3')
})

test('降级：无法切分 authors/title 时仍保留 raw', () => {
  const meta = parseReferenceLine('[8] 单段无法切分')!
  expect(meta.n).toBe(8)
  expect(meta.raw).toBe('单段无法切分')
  expect(meta.title).toBeUndefined()
})

test('空字符串 / 不匹配行返回 null', () => {
  expect(parseReferenceLine('')).toBeNull()
  expect(parseReferenceLine('普通段落')).toBeNull()
  expect(parseReferenceLine('[abc] 非数字')).toBeNull()
})

// —— #448 对话流溯源：§7 引用行携带 doi 标识，供点击解析到具体 PDF ——

test('提取行尾 doi: 标识（对话流溯源用）', () => {
  const meta = parseReferenceLine('[1] Smith J. *A Title*. NeurIPS, 2023. doi:10.48550/arXiv.2001.08361')!
  expect(meta.doi).toBe('10.48550/arXiv.2001.08361')
  // 标识不应污染 venue/year
  expect(meta.year).toBe('2023')
  expect(meta.venue).toBe('NeurIPS')
})

test('提取 DOI: 大小写不敏感 + 冒号后空格', () => {
  const meta = parseReferenceLine('[2] Doe J. *T*. Nature, 2022. DOI: 10.1038/s41586-022-04567-7')!
  expect(meta.doi).toBe('10.1038/s41586-022-04567-7')
})

test('提取 https://doi.org/ 形式的 doi', () => {
  const meta = parseReferenceLine('[3] A. *T*. 2021. https://doi.org/10.1145/3292500.3330701')!
  expect(meta.doi).toBe('10.1145/3292500.3330701')
})

test('剥离 doi 尾随的句点/括号', () => {
  const meta = parseReferenceLine('[4] A. *T*. 2020 (doi:10.1000/xyz123).')!
  expect(meta.doi).toBe('10.1000/xyz123')
})

test('无 doi 时 doi 字段为 undefined', () => {
  const meta = parseReferenceLine('[5] A. *T*. Nature, 2022.')!
  expect(meta.doi).toBeUndefined()
})

test('parseReferences 整块解析也带出 doi', () => {
  const md = `## 7. References\n[1] A. *T1*. 2020. doi:10.1234/aaa\n[2] B. *T2*. 2021.\n`
  const map = parseReferences(md)
  expect(map.get(1)?.doi).toBe('10.1234/aaa')
  expect(map.get(2)?.doi).toBeUndefined()
})

// —— #448 渲染器容错：放宽 References 标题 + 支持 arXiv 标识 ——

test('放宽标题：## §6 References 也能解析（对话流主 Agent 常用 §6）', () => {
  const md = `### §6 References\n\n[1] Kaplan et al. *Scaling Laws*. arXiv:2001.08361, 2020.\n`
  const map = parseReferences(md)
  expect(map.size).toBe(1)
  expect(map.get(1)?.title).toBe('Scaling Laws')
})

test('放宽标题：无编号 ## References 也能解析', () => {
  const md = `## References\n\n[1] A. *T*. 2020. doi:10.1234/xyz\n`
  expect(parseReferences(md).get(1)?.doi).toBe('10.1234/xyz')
})

test('arXiv 标识归一成 DataCite DOI 形式 10.48550/arXiv.<id>', () => {
  const meta = parseReferenceLine('[1] Kaplan et al. *Scaling Laws*. arXiv:2001.08361, 2020.')!
  expect(meta.doi).toBe('10.48550/arXiv.2001.08361')
  expect(meta.year).toBe('2020')
})

test('arXiv 带版本号 vN 也能识别（去掉版本号）', () => {
  const meta = parseReferenceLine('[2] Hoffmann et al. *Chinchilla*. arXiv:2203.15556v2, 2022.')!
  expect(meta.doi).toBe('10.48550/arXiv.2203.15556')
})

test('显式 doi 优先于 arXiv', () => {
  const meta = parseReferenceLine('[3] A. *T*. arXiv:2001.08361. doi:10.1038/real-doi')!
  expect(meta.doi).toBe('10.1038/real-doi')
})
