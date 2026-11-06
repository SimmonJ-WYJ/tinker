/**
 * 渲染进程 dayjs 入口 —— 随界面语言切换的日期/时间格式化。
 *
 * 基础配置（插件、nowIso/nowMs 等）在 @asci/shared 的 date-time 模块；
 * 本模块只追加"与界面语言相关"的部分：加载 zh-cn / en locale，并提供
 * 跟随 languageAtom 的格式化 helper。
 *
 * 约定（docs/date-time.md）：
 * - 绝对时间展示走这里的 formatMessageTime / formatDateTime / formatDate；
 * - 相对时间（"3 分钟前"）走 useFormatRelativeTime（i18n token，见 utils/format-relative-time）；
 * - 禁止组件内裸 new Date(...).toLocale* / 手搓 padStart 拼时间串。
 */

import { dayjs } from '@asci/shared'
import type { DateInput } from '@asci/shared'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'

export type { DateInput }
export { dayjs }

/** AppLocale('en' | 'zh') → dayjs locale 名 */
function toDayjsLocale(lang: string): string {
  return lang === 'zh' ? 'zh-cn' : 'en'
}

/** 把 dayjs 全局 locale 同步到界面语言；由 setAppLanguage 在每次切换时调用 */
export function syncDayjsLocale(lang: string): void {
  dayjs.locale(toDayjsLocale(lang))
}

/**
 * 消息时间（简略）：今年 `MM/DD HH:mm`，跨年 `YYYY/MM/DD HH:mm`。
 * 与界面语言无关（纯数字格式），但仍统一走 dayjs。
 */
export function formatMessageTime(input: DateInput): string {
  const d = dayjs(input)
  const sameYear = d.year() === dayjs().year()
  return d.format(sameYear ? 'MM/DD HH:mm' : 'YYYY/MM/DD HH:mm')
}

/** 日期 + 时间，随 locale 本地化（替代 `.toLocaleString()`） */
export function formatDateTime(input: DateInput): string {
  return dayjs(input).format('L LT')
}

/** 仅日期，随 locale 本地化（替代 `.toLocaleDateString()`） */
export function formatDate(input: DateInput): string {
  return dayjs(input).format('LL')
}

/** 仅时间（时:分:秒），随 locale（替代 `.toLocaleTimeString()`） */
export function formatTime(input: DateInput): string {
  return dayjs(input).format('LTS')
}
