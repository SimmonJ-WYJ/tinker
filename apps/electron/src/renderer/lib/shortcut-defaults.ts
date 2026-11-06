/**
 * 快捷键默认配置
 *
 * 定义所有快捷键的 ID、默认绑定和分类。
 * 这是快捷键系统的基础数据层，由 shortcut-registry 消费。
 *
 * 文案（name / description / category 标签）走 i18n，键名见
 * `locales/<lang>/settings/shortcuts.json` 下 `shortcuts.items.<id>.{name,description}`
 * 与 `shortcuts.category.<category>`。
 */

// ===== 类型定义 =====

/** 快捷键分类 */
export type ShortcutCategory = 'app' | 'edit' | 'navigation' | 'global'

/** 内置快捷键 ID 字面量联合（与 locales/.../settings/shortcuts.json items 下的 key 严格对齐） */
export type ShortcutId =
  | 'open-settings'
  | 'new-session'
  | 'toggle-sidebar'
  | 'toggle-mode'
  | 'global-search'
  | 'focus-input'
  | 'editor-bold'
  | 'editor-strikethrough'
  | 'clear-context'
  | 'stop-generation'
  | 'reference-selected-files'
  | 'close-tab'
  | 'quick-task'
  | 'show-main-window'

/** 快捷键定义（不可变，内置于代码） */
export interface ShortcutDefinition {
  /** 唯一标识（如 'open-settings'） */
  id: ShortcutId
  /** macOS 默认快捷键（如 'Cmd+,'） */
  defaultMac: string
  /** Windows 默认快捷键（如 'Ctrl+,'） */
  defaultWin: string
  /** 分类 */
  category: ShortcutCategory
  /** 是否为全局快捷键（由主进程 globalShortcut 注册） */
  global?: boolean
  /** 是否为只读（仅展示，不可自定义） */
  readonly?: boolean
}

/** 用户自定义快捷键覆盖（持久化到 settings.json） */
export interface ShortcutOverrides {
  [shortcutId: string]: {
    mac?: string
    win?: string
  }
}

// ===== 默认快捷键列表 =====

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // 应用级
  {
    id: 'open-settings',
    defaultMac: 'Cmd+,',
    defaultWin: 'Ctrl+,',
    category: 'app',
  },
  {
    id: 'new-session',
    defaultMac: 'Cmd+N',
    defaultWin: 'Ctrl+N',
    category: 'app',
  },
  {
    id: 'toggle-sidebar',
    defaultMac: 'Cmd+B',
    defaultWin: 'Ctrl+B',
    category: 'app',
  },
  {
    id: 'toggle-mode',
    defaultMac: 'Cmd+Shift+M',
    defaultWin: 'Ctrl+Shift+M',
    category: 'app',
  },
  {
    id: 'global-search',
    defaultMac: 'Cmd+F',
    defaultWin: 'Ctrl+F',
    category: 'navigation',
  },
  {
    id: 'focus-input',
    defaultMac: 'Cmd+L',
    defaultWin: 'Ctrl+L',
    category: 'navigation',
  },

  // 编辑级（输入框格式化，仅 macOS — Cmd+B/S 被全局快捷键占用）
  {
    id: 'editor-bold',
    defaultMac: 'Ctrl+B',
    defaultWin: '',
    category: 'edit',
    readonly: true,
  },
  {
    id: 'editor-strikethrough',
    defaultMac: 'Ctrl+S',
    defaultWin: '',
    category: 'edit',
    readonly: true,
  },

  // 编辑级
  {
    id: 'clear-context',
    defaultMac: 'Cmd+K',
    defaultWin: 'Ctrl+K',
    category: 'edit',
  },
  {
    id: 'stop-generation',
    defaultMac: 'Cmd+.',
    defaultWin: 'Ctrl+.',
    category: 'edit',
  },
  {
    id: 'reference-selected-files',
    defaultMac: 'Cmd+Shift+R',
    defaultWin: 'Ctrl+Shift+R',
    category: 'edit',
  },
  {
    id: 'close-tab',
    defaultMac: 'Cmd+W',
    defaultWin: 'Ctrl+W',
    category: 'app',
  },

  // 全局快捷键（由主进程 globalShortcut 注册，应用外也生效）
  {
    id: 'quick-task',
    defaultMac: 'Alt+Space',
    defaultWin: 'Alt+Space',
    category: 'global',
    global: true,
  },
  {
    id: 'show-main-window',
    defaultMac: 'Cmd+Shift+P',
    defaultWin: 'Ctrl+Shift+P',
    category: 'global',
    global: true,
  },
]

/** 按 ID 索引的快捷键 Map（用于快速查找） */
export const SHORTCUT_MAP: Map<string, ShortcutDefinition> = new Map(
  DEFAULT_SHORTCUTS.map((s) => [s.id, s]),
)
