/**
 * i18next 实例初始化
 * 业务侧禁止直接 import 'i18next' / 'react-i18next'，统一通过 hooks/useT.ts 与 components/common/Trans.tsx 访问
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  DEFAULT_LOCALE,
  I18N_NAMESPACES,
  defaultResources,
  type AppLocale,
} from '@/locales'
import { syncDayjsLocale } from '@/utils/dayjs'

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: defaultResources,
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: 'common',
    ns: [...I18N_NAMESPACES],
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
  })
}

export { i18n }

// 初始 locale 同步（默认 DEFAULT_LOCALE，挂载后由 setAppLanguage 覆盖）
syncDayjsLocale(DEFAULT_LOCALE)

/** 切换全局语言（同时驱动 react-i18next 重渲染 + dayjs locale） */
export function setAppLanguage(lng: AppLocale): Promise<unknown> {
  syncDayjsLocale(lng)
  return i18n.changeLanguage(lng)
}
