/**
 * auth 命名空间聚合：从 auth/ 子目录按段合并为一份资源
 * 各段对应认证体系的不同功能模块；合并后供 i18next defaultResources 使用
 */
import common from './auth/common.json'
import login from './auth/login.json'
import errors from './auth/errors.json'
import oauth from './auth/oauth.json'
import splash from './auth/splash.json'
import menu from './auth/menu.json'
import profile from './auth/profile.json'
import upgrade from './auth/upgrade.json'
import conflict from './auth/conflict.json'

export const authZh = {
  common,
  login,
  errors,
  oauth,
  splash,
  menu,
  profile,
  upgrade,
  conflict,
} as const
