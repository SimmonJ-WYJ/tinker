/**
 * 用户档案类型
 *
 * 用户名、头像、IPC 通道等定义。
 */

/** 默认用户头像哨兵：'icon:<name>' 由 UserAvatar 渲染为对应 lucide 图标 */
export const DEFAULT_USER_AVATAR = 'icon:user'

/** 默认用户名 */
export const DEFAULT_USER_NAME = '用户'

/** 用户档案 */
export interface UserProfile {
  /** 用户名 */
  userName: string
  /** 头像：data:image/* base64 URL / emoji 字符串 / 'icon:<lucide-name>' 哨兵 */
  avatar: string
}

/** 用户档案 IPC 通道 */
export const USER_PROFILE_IPC_CHANNELS = {
  GET: 'user-profile:get',
  UPDATE: 'user-profile:update',
} as const
