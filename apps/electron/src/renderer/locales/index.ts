/**
 * 多语言资源注册表
 * 新增语言：在 locales/ 下加目录 + 在此处加一行 SUPPORTED_LOCALES + 注册资源
 * 新增命名空间：在两侧 locale 目录新增 JSON + 在此处导入并扩展 defaultResources / I18N_NAMESPACES
 *
 * settings / conversation / library 命名空间已按段拆分到 locales/<lang>/<ns>/*.json，
 * 通过 locales/<lang>/<ns>.ts 聚合后导入；维护单段时只改对应 JSON
 */
import type { AppLocale } from '@/types/settings'
import { authEn } from './en/auth'
import chromeEn from './en/chrome.json'
import commonEn from './en/common.json'
import configEn from './en/config.json'
import { conversationEn } from './en/conversation'
import errorsEn from './en/errors.json'
import { libraryEn } from './en/library'
import navEn from './en/nav.json'
import onboardingEn from './en/onboarding.json'
import previewEn from './en/preview.json'
import { settingsEn } from './en/settings'
import skillsEn from './en/skills.json'
import { authZh } from './zh/auth'
import chromeZh from './zh/chrome.json'
import commonZh from './zh/common.json'
import configZh from './zh/config.json'
import { conversationZh } from './zh/conversation'
import errorsZh from './zh/errors.json'
import { libraryZh } from './zh/library'
import navZh from './zh/nav.json'
import onboardingZh from './zh/onboarding.json'
import previewZh from './zh/preview.json'
import { settingsZh } from './zh/settings'
import skillsZh from './zh/skills.json'

export type { AppLocale }

export interface LocaleDescriptor {
  code: AppLocale
  /** 原生语言名（在切换器中显示） */
  label: string
}

export const SUPPORTED_LOCALES: ReadonlyArray<LocaleDescriptor> = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
]

export const DEFAULT_LOCALE: AppLocale = 'en'

export const defaultResources = {
  en: {
    auth: authEn,
    common: commonEn,
    settings: settingsEn,
    nav: navEn,
    library: libraryEn,
    conversation: conversationEn,
    onboarding: onboardingEn,
    skills: skillsEn,
    errors: errorsEn,
    chrome: chromeEn,
    preview: previewEn,
    config: configEn,
  },
  zh: {
    auth: authZh,
    common: commonZh,
    settings: settingsZh,
    nav: navZh,
    library: libraryZh,
    conversation: conversationZh,
    onboarding: onboardingZh,
    skills: skillsZh,
    errors: errorsZh,
    chrome: chromeZh,
    preview: previewZh,
    config: configZh,
  },
} as const

export const I18N_NAMESPACES = [
  'auth',
  'common',
  'settings',
  'nav',
  'library',
  'conversation',
  'onboarding',
  'skills',
  'errors',
  'chrome',
  'preview',
  'config',
] as const
export type I18nNamespace = (typeof I18N_NAMESPACES)[number]
