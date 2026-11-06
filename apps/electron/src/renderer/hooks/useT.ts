/**
 * 业务侧获取翻译函数的唯一入口
 * 包装 react-i18next 的 useTranslation，保留字面量泛型让 t() 的 key 自动收敛到指定命名空间
 */
import { useTranslation } from 'react-i18next'
import type { I18nNamespace } from '@/locales'

export function useT<NS extends I18nNamespace = 'common'>(ns?: NS) {
  return useTranslation((ns ?? 'common') as NS)
}
