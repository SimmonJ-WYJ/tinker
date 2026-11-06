/**
 * 主进程 i18n 模块
 *
 * 仅服务于 menu / tray / dialog 等主进程 UI；不引入 i18next 依赖，直接复用
 * renderer 端的 chrome.json / errors.json / common.json 资源（esbuild 内联打包）。
 *
 * 与 renderer 之间通过 settings.json 的 language 字段同步：
 * - 启动：从 settings 读取 language，调用 setLanguage
 * - 切换：renderer 调用 settings:update 后，main ipc 处理器额外触发 setLanguage
 *   并通过 onLanguageChange 监听器重建 menu/tray
 *
 * 仅支持嵌套 string 树；t(key) 返回缺失键时回退到原 key 字符串，便于发现漏翻
 */

import chromeEn from '../../renderer/locales/en/chrome.json'
import chromeZh from '../../renderer/locales/zh/chrome.json'
import errorsEn from '../../renderer/locales/en/errors.json'
import errorsZh from '../../renderer/locales/zh/errors.json'
import commonEn from '../../renderer/locales/en/common.json'
import commonZh from '../../renderer/locales/zh/common.json'

type AppLocale = 'en' | 'zh'

interface LocaleResources {
  chrome: Record<string, unknown>
  errors: Record<string, unknown>
  common: Record<string, unknown>
}

const RESOURCES: Record<AppLocale, LocaleResources> = {
  en: { chrome: chromeEn, errors: errorsEn, common: commonEn },
  zh: { chrome: chromeZh, errors: errorsZh, common: commonZh },
}

let currentLanguage: AppLocale = 'en'
const listeners = new Set<(lng: AppLocale) => void>()

/** 设置当前语言；触发 onLanguageChange 监听 */
export function setLanguage(lng: AppLocale): void {
  if (currentLanguage === lng) return
  currentLanguage = lng
  for (const listener of listeners) {
    try {
      listener(lng)
    } catch (err) {
      console.error('[主进程 i18n] 语言变更监听器异常:', err)
    }
  }
}

/** 获取当前语言 */
export function getLanguage(): AppLocale {
  return currentLanguage
}

/** 注册语言变更监听器；返回取消订阅函数 */
export function onLanguageChange(listener: (lng: AppLocale) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 取翻译文本：key 形如 'chrome.menu.app.about'
 * 路径首段决定命名空间（chrome/errors/common）；缺失时返回原 key
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const parts = key.split('.')
  if (parts.length < 2) return key
  const ns = parts[0] as keyof LocaleResources
  const bucket = RESOURCES[currentLanguage]?.[ns]
  if (!bucket) return key

  let node: unknown = bucket
  for (let i = 1; i < parts.length; i += 1) {
    if (typeof node !== 'object' || node === null) return key
    node = (node as Record<string, unknown>)[parts[i]!]
    if (node === undefined) return key
  }
  if (typeof node !== 'string') return key
  if (!vars) return node
  return node.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const v = vars[name]
    return v === undefined ? `{{${name}}}` : String(v)
  })
}
