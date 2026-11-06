/**
 * 粘贴文本分类 —— 判定是否需要折叠为 PASTED 卡片。
 * 规则：CJK 字符数 > 阈值 或 英文单词数 > 阈值（仅用于粘贴时判定）。
 */

/** CJK 字符折叠阈值 */
export const PASTE_CJK_THRESHOLD = 50
/** 英文单词折叠阈值 */
export const PASTE_WORD_THRESHOLD = 50

/** CJK/全角标点 + 中日韩文字 + 假名 + 谚文 */
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿가-힯＀-￯]/g
/** 英文单词：连续字母数字（允许内部 ' - ） */
const WORD_RE = /[A-Za-z0-9]+(?:[''-][A-Za-z0-9]+)*/g

export interface PasteClassification {
  cjk: number
  words: number
  shouldCollapse: boolean
}

export function classifyPaste(text: string): PasteClassification {
  const cjk = (text.match(CJK_RE) ?? []).length
  const words = (text.match(WORD_RE) ?? []).length
  return {
    cjk,
    words,
    shouldCollapse: cjk > PASTE_CJK_THRESHOLD || words > PASTE_WORD_THRESHOLD,
  }
}
