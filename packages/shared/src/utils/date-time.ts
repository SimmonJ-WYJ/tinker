/**
 * 日期时间基础模块 —— 全仓库统一的 dayjs 入口。
 *
 * 约定（详见 docs/date-time.md）：
 * - 任何日期 / 时间处理一律走 dayjs，禁止裸 `new Date(...)` 直接格式化、禁止 `.toLocale*`。
 * - 本模块只做"与界面语言无关"的基础配置与 helper，**不含任何 locale 字符串**
 *   （CLAUDE.md §7.4：packages/ 不得耦合 renderer i18n）。
 *   需要随界面语言切换的格式化放在 renderer/utils/dayjs.ts。
 *
 * 已注册插件（均随 dayjs core 分发，无额外依赖）：
 * - utc：UTC / 时区无关处理
 * - localizedFormat：`L` / `LL` / `LT` 等本地化格式 token（配合 renderer 侧 locale）
 * - customParseFormat：按显式 format 解析非 ISO 字符串
 */

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import customParseFormat from 'dayjs/plugin/customParseFormat'

dayjs.extend(utc)
dayjs.extend(localizedFormat)
dayjs.extend(customParseFormat)

export { dayjs }
export default dayjs

export type DateInput = dayjs.ConfigType

/** 当前时刻的 ISO 8601 字符串（替代 `new Date().toISOString()`） */
export function nowIso(): string {
  return dayjs().toISOString()
}

/** 当前时刻的毫秒时间戳（替代 `Date.now()`） */
export function nowMs(): number {
  return dayjs().valueOf()
}

/** 把任意日期输入（ISO 串 / 毫秒数 / Date）转 ISO 8601 字符串（替代 `new Date(x).toISOString()`） */
export function toIso(input: DateInput): string {
  return dayjs(input).toISOString()
}

/** 把任意日期输入转毫秒时间戳（替代 `new Date(x).getTime()`） */
export function toMs(input: DateInput): number {
  return dayjs(input).valueOf()
}
