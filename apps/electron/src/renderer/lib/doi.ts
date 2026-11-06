/**
 * DOI 识别与归一化 —— 全应用单一事实源
 * （spec: docs/specs/doi-paper-jump-spec.md §4）
 *
 * 对话流与检索报告中 DOI 的四种书写形态及对应入口：
 *   A. 行内 code：    `10.18653/v1/2025.acl-long.28`          → parseDoiExact
 *   B. doi.org 链接： https://doi.org/10.18653/...             → doiFromUrl
 *   C. 裸文本：       …见 10.18653/v1/2025.acl-long.28，…      → findDois
 *   D. 前缀文本：     doi: 10.18653/...                        → findDois / parseDoiExact
 *
 * citation-references.ts 的引用行 DOI 抽取也从这里取片段（集中定义避免多处各写一份易走样）。
 * 匹配 key 与 session-papers-utils 的 recordKey 对齐：`doi:` + 小写 DOI（见 normalizeDoi）。
 */

/**
 * DOI 主体：`10.<4-9位注册号>/<后缀>`。注册号位数下限 4 天然排除版本号（10.2.3）与小数（10.5）。
 * 字符类与 citation-references 历史行为一致（仅排除空白与右括号），引用行解析行为零变化。
 */
export const DOI_BODY = '10\\.\\d{4,9}\\/[^\\s)]+'

/** 可选前缀：`doi:`（冒号后容忍空格）/ https://doi.org/ / https://dx.doi.org/ */
export const DOI_PREFIX = '(?:doi:\\s*|https?:\\/\\/(?:dx\\.)?doi\\.org\\/)?'

/**
 * 裸文本扫描用主体：在 DOI_BODY 基础上额外排除半角分隔符、HTML 尖括号、CJK 文字与全角标点。
 * 中文语境里 DOI 后常紧跟全角逗号/句号（无空格分隔），不排除会把后续正文吞进 DOI。
 * 代价：合法但极罕见的含逗号 DOI 会被截断——可接受（截断后仍可走 crossref / 外链兜底）。
 */
const DOI_SCAN_BODY =
  '10\\.\\d{4,9}\\/[^\\s)\\]>,;"\'<（）。，；：！？、【】「」『』\\u4e00-\\u9fff]+'

/** 尾随装饰剥离：DOI 不会以这些字符结尾（半角 + 全角标点） */
const TRAILING_DECOR_RE = /[.,;:)\]>"'。，；：）】」』]+$/

/** 整串精确匹配（A/D 行内 code 用）：去首尾空白后整段必须就是一个（可带前缀的）DOI */
const DOI_EXACT_RE = new RegExp(`^${DOI_PREFIX}(${DOI_BODY})$`, 'i')

/**
 * 多匹配扫描（C/D 裸文本用）。lookbehind 防止匹配进更长 token 内部（如 `v10.1234/x`）。
 * 模块级编译一次（消息流式渲染是热路径）；findDois 入口重置 lastIndex，
 * 单线程且循环内无 await，复用安全。
 */
const DOI_SCAN_RE = new RegExp(`(?<![\\w/.])${DOI_PREFIX}(${DOI_SCAN_BODY})`, 'gi')

/** 廉价探针：文本可能含 DOI 才值得跑完整扫描（remark 插件挂载前置判断用） */
export const DOI_PROBE_RE = /\b10\.\d{4,9}\//

/** findDois 的单条命中：index/length 覆盖**含前缀**的完整命中区间（供文本切分替换） */
export interface DoiMatch {
  /** 命中区间在原文本中的起点（含 `doi:` / doi.org 前缀） */
  index: number
  /** 命中区间长度（已扣除被剥离的尾随装饰） */
  length: number
  /** DOI 原文（剥前缀与尾随装饰，保留大小写） */
  doi: string
}

/** 剥尾随装饰；返回 [清理后的 DOI, 剥掉的字符数] */
function stripTrailing(doi: string): [string, number] {
  const stripped = doi.replace(TRAILING_DECOR_RE, '')
  return [stripped, doi.length - stripped.length]
}

/** 剥离后仍需是合法 DOI 形（防止剥空 / 剥掉整个后缀） */
const DOI_VALID_RE = /^10\.\d{4,9}\/\S+$/

/**
 * A/D 形态：整串是否恰为一个 DOI（可带 `doi:` / doi.org 前缀）。
 * 命中返回 DOI 原文（保留大小写）；含其他杂质的文本返回 null（行内 code 不误染）。
 */
export function parseDoiExact(text: string): string | null {
  const m = DOI_EXACT_RE.exec(text.trim())
  if (!m || m[1] === undefined) return null
  const [doi] = stripTrailing(m[1])
  return DOI_VALID_RE.test(doi) ? doi : null
}

/** C/D 形态：扫描整段文本，返回所有 DOI 命中（供 remark 插件 / TreeWalker 切分文本节点） */
export function findDois(text: string): DoiMatch[] {
  DOI_SCAN_RE.lastIndex = 0
  const re = DOI_SCAN_RE
  const out: DoiMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1]
    if (raw === undefined) continue
    const [doi, strippedCount] = stripTrailing(raw)
    if (!DOI_VALID_RE.test(doi)) continue
    out.push({ index: m.index, length: m[0].length - strippedCount, doi })
  }
  return out
}

/**
 * B 形态：从链接 href 提取 DOI。仅认 doi.org / dx.doi.org / www.doi.org host，
 * 其他域名一律返回 null（论文落地页 URL 里偶含 DOI 片段，不在此处理）。
 */
export function doiFromUrl(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  if (host !== 'doi.org' && host !== 'dx.doi.org' && host !== 'www.doi.org') return null
  let doi: string
  try {
    doi = decodeURIComponent(url.pathname.slice(1))
  } catch {
    doi = url.pathname.slice(1)
  }
  // URL 路径已精确定界，无「尾随正文装饰」概念，不剥尾（DOI 合法字符含 <>. 等）
  return DOI_VALID_RE.test(doi) ? doi : null
}

/**
 * 归一化为匹配 key 的 DOI 部分（小写）。与 recordKey 的 `doi:${doi.toLowerCase()}`
 * （session-papers-utils.ts）拼接侧对齐。入参可为任意书写形态；非 DOI 返回 null。
 */
export function normalizeDoi(raw: string): string | null {
  const doi = parseDoiExact(raw)
  return doi ? doi.toLowerCase() : null
}
