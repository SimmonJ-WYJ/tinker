/**
 * 渲染层 UI 策略常量 · 单一真源
 *
 * 复制成功提示时长与作者列表截断数此前散落在多个组件里。
 * 仅收录"同一语义"的重复值；偶然相等的数字（如各处 300ms 防抖）不收。
 */

/** 复制成功后图标/文案恢复时长（ms） */
export const COPY_FEEDBACK_RESET_MS = 2000

/** 详情面板作者完整展示上限，超出加 " et al." */
export const MAX_AUTHORS_FULL = 8

/** 卡片/对话框等紧凑场景作者展示上限，超出加 " et al." */
export const MAX_AUTHORS_COMPACT = 3

/**
 * 窗口不透明底色（亮/暗），与 renderer tokens.css 的 `--background` 对齐
 * （light `0 0% 100%` = #ffffff，dark `0 0% 7%` = #121212）。
 *
 * BrowserWindow 创建早于渲染主题就绪，需显式给一个不透明 backgroundColor，
 * 避免 Windows GPU 合成层缺不透明 backing 时窗口透出桌面（issue #459）。
 */
export const WINDOW_BG_LIGHT = '#ffffff'
export const WINDOW_BG_DARK = '#121212'

/** 按当前是否暗色取窗口不透明底色（统一三处窗口创建的同一选择逻辑） */
export function windowBgColor(isDark: boolean): string {
  return isDark ? WINDOW_BG_DARK : WINDOW_BG_LIGHT
}
