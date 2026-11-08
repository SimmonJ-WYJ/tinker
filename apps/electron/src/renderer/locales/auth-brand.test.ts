/** 认证界面翻译资源回归：自有页面统一 Tinker，兼容标识不在此范围。 */
import { expect, test } from 'bun:test'
import loginEn from './en/auth/login.json'
import loginZh from './zh/auth/login.json'
import oauthEn from './en/auth/oauth.json'
import oauthZh from './zh/auth/oauth.json'

test('登录页与 loopback 双语资源使用 Tinker 品牌', () => {
  for (const login of [loginEn, loginZh]) {
    expect(login).toHaveProperty('brand', 'Tinker')
  }
  for (const [language, oauth] of [['en', oauthEn], ['zh', oauthZh]] as const) {
    expect(oauth).toHaveProperty('callback')
    const callback = oauth.callback
    expect(Object.keys(callback).sort()).toEqual(['cancelled', 'received', 'security'])
    for (const message of Object.values(callback)) {
      expect(message).toContain('Tinker')
      expect(message).not.toMatch(/ASCI|OPENSCI/i)
      expect(/[\u4e00-\u9fff]/.test(message)).toBe(language === 'zh')
    }
  }
})
