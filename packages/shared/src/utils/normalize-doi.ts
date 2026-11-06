/**
 * DOI 规范化：统一论文身份标识符的清洗逻辑。
 *
 * 历史上 paper-result-recorder.ts / wiki-lookup.ts / workspace-paper-store.ts
 * 各自维护自己的 normalize，正则不一致（漏掉反引号、冒号），导致脏 DOI 写入
 * workspace-papers 后再也匹配不上 wiki 索引。本文件作为唯一真相源。
 *
 * 处理顺序：
 *   1. 非字符串 / 'N/A' / 空 → null
 *   2. trim、转小写
 *   3. 去掉 https://doi.org/ 或 https://dx.doi.org/ 前缀
 *   4. 剥离尾部噪声字符：标点、引号、反引号、空白
 *      （来自 markdown 表格爬取 / 文本提取的常见污染）
 *   5. 必须以 '10.' 开头才算合法 DOI，否则 null
 */
export function normalizeDoi(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s || s.toUpperCase() === 'N/A') return null
  s = s.toLowerCase()
  s = s.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')
  s = s.replace(/^doi:/, '')
  // 去尾部噪声：. , ; : ] ) > ' " ` 反斜杠 / 空白
  s = s.replace(/[\s.,;:\]\)>'"`\\]+$/, '')
  return s.startsWith('10.') ? s : null
}
