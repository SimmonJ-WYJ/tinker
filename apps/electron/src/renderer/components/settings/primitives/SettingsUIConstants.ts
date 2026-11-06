/**
 * SettingsUIConstants - 设置界面统一样式 token
 *
 * 集中管理设置组件中使用的 Tailwind class，
 * 确保所有设置页面保持一致的视觉语言。
 */

/** 标签样式 */
export const LABEL_CLASS = 'text-sm font-medium text-foreground'

/** 描述文字样式 */
export const DESCRIPTION_CLASS = 'text-sm text-muted-foreground'

/** 区块标题样式 - 大类标题，主色 + 半粗 + 紧字距，确保比卡片内 row label 更重 */
export const SECTION_TITLE_CLASS = 'text-base font-semibold text-foreground tracking-tight'

/** 区块描述样式 - 标题下的辅助说明；与卡片内文案同字号，靠颜色/字重区分层级 */
export const SECTION_DESCRIPTION_CLASS = 'text-sm text-muted-foreground mt-1'

/** 卡片容器样式 - 一个大类作为一张卡片 */
export const CARD_CLASS = 'rounded-xl overflow-hidden settings-card'

/** 行布局样式 */
export const ROW_CLASS = 'flex items-center justify-between px-5 py-5'

/** 卡片内分隔线样式（Separator 底色用 bg-border，这里用 bg-border/30 调淡） */
export const DIVIDER_CLASS = 'bg-border/30'
