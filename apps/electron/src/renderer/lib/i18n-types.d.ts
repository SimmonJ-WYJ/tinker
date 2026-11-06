/**
 * i18next 模块增强：把 resources 中英文 JSON 注入类型系统
 * 让 t('xxx') 在 TS 严格模式下获得 key 自动补全 + 拼写检查
 */
import 'i18next'
import type { authEn } from '../locales/en/auth'
import type chromeEn from '../locales/en/chrome.json'
import type commonEn from '../locales/en/common.json'
import type configEn from '../locales/en/config.json'
import type { conversationEn } from '../locales/en/conversation'
import type errorsEn from '../locales/en/errors.json'
import type { libraryEn } from '../locales/en/library'
import type navEn from '../locales/en/nav.json'
import type onboardingEn from '../locales/en/onboarding.json'
import type previewEn from '../locales/en/preview.json'
import type { settingsEn } from '../locales/en/settings'
import type skillsEn from '../locales/en/skills.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      auth: typeof authEn
      common: typeof commonEn
      settings: typeof settingsEn
      nav: typeof navEn
      library: typeof libraryEn
      conversation: typeof conversationEn
      onboarding: typeof onboardingEn
      skills: typeof skillsEn
      errors: typeof errorsEn
      chrome: typeof chromeEn
      preview: typeof previewEn
      config: typeof configEn
    }
  }
}
