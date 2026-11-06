/**
 * 自动归档配置解析 —— 纯函数,便于单测
 *
 * 用户心智:默认应"不归档",看到对话莫名"消失"会困惑。所以缺省值是 0(Disabled),
 * 仅当用户主动在设置页选择天数后才启用归档。
 */

import type { AppSettings } from '../../types/settings.ts'

/**
 * 解析归档天数:
 *   - undefined → 0(Disabled,新用户首次启动场景)
 *   - 0 → 0(用户显式禁用)
 *   - >0 → 该天数
 *
 * 调用方需以 `days > 0` 守门后再实际触发归档。
 */
export function resolveArchiveDays(settings: Pick<AppSettings, 'archiveAfterDays'>): number {
  return settings.archiveAfterDays ?? 0
}
