/**
 * User Profile Atom - 用户档案状态
 *
 * 管理用户名和头像，通过 IPC 从本地配置文件加载/保存。
 */

import { atom, useAtomValue } from 'jotai'
import { DEFAULT_USER_AVATAR, DEFAULT_USER_NAME } from '../../types'
import type { UserProfile } from '../../types'
import { useT } from '@/hooks/useT'

/** 用户档案 */
export const userProfileAtom = atom<UserProfile>({
  userName: DEFAULT_USER_NAME,
  avatar: DEFAULT_USER_AVATAR,
})

/**
 * 显示名解析：当 userName 仍是默认中文哨兵 '用户' 时，按当前语言返回 i18n 文案；
 * 用户自定义过的名字保留原值
 */
export function useDisplayUserName(): string {
  const profile = useAtomValue(userProfileAtom)
  const { t } = useT('common')
  if (!profile.userName || profile.userName === DEFAULT_USER_NAME) return t('user')
  return profile.userName
}
