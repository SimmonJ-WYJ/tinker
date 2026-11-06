/**
 * 时间戳到相对时间短串。
 *
 * 设计：纯函数 getRelativeTimeParts 返回 {unit, value}，由调用方按当前 i18n
 * 语言渲染最终字符串；useFormatRelativeTime hook 包装 useT 提供约定式格式化。
 *
 * formatRelativeTime（旧 API）保留中文输出，仅在不便引入 hook 的旧调用点临时使用，
 * 新代码请优先用 useFormatRelativeTime。
 */

import { useT } from '@/hooks/useT'
import { nowMs } from '@asci/shared'

export type RelativeTimeUnit = 'now' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface RelativeTimeParts {
  unit: RelativeTimeUnit
  /** unit === 'now' 时为 0；其余为该单位下取整后的数值 */
  value: number
}

/** 将时间戳拆解到 {unit, value}；未来时间视作 0 差（防御性） */
export function getRelativeTimeParts(timestamp: number, now: number = nowMs()): RelativeTimeParts {
  const diffMs = Math.max(0, now - timestamp)
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return { unit: 'now', value: 0 }

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return { unit: 'minute', value: diffMin }

  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return { unit: 'hour', value: diffHour }

  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return { unit: 'day', value: diffDay }

  if (diffDay < 30) {
    const diffWeek = Math.floor(diffDay / 7)
    return { unit: 'week', value: diffWeek }
  }

  if (diffDay < 365) {
    const diffMonth = Math.floor(diffDay / 30)
    return { unit: 'month', value: diffMonth }
  }

  const diffYear = Math.floor(diffDay / 365)
  return { unit: 'year', value: diffYear }
}

/** 旧 API：保留中文输出，供尚未迁移到 hook 的调用点使用；新代码用 useFormatRelativeTime */
export function formatRelativeTime(timestamp: number, now: number = nowMs()): string {
  const parts = getRelativeTimeParts(timestamp, now)
  switch (parts.unit) {
    case 'now': return '刚刚'
    case 'minute': return `${parts.value} 分`
    case 'hour': return `${parts.value} 时`
    case 'day': return `${parts.value} 天`
    case 'week': return `${parts.value} 周`
    case 'month': return `${parts.value} 月`
    case 'year': return `${parts.value} 年`
  }
}

/** Hook：按当前界面语言把时间戳格式化为相对时间短串 */
export function useFormatRelativeTime(): (timestamp: number, now?: number) => string {
  const { t } = useT('common')
  return (timestamp: number, now?: number) => {
    const parts = getRelativeTimeParts(timestamp, now)
    switch (parts.unit) {
      case 'now': return t('relativeTime.now')
      case 'minute': return t('relativeTime.minute', { count: parts.value })
      case 'hour': return t('relativeTime.hour', { count: parts.value })
      case 'day': return t('relativeTime.day', { count: parts.value })
      case 'week': return t('relativeTime.week', { count: parts.value })
      case 'month': return t('relativeTime.month', { count: parts.value })
      case 'year': return t('relativeTime.year', { count: parts.value })
    }
  }
}
