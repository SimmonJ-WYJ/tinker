/**
 * UserAvatar - 用户头像组件
 *
 * 支持三种渲染：
 * - 'icon:<name>' 哨兵 → lucide 图标（默认头像）
 * - data:image/* / http URL → 图片
 * - 其他字符串 → emoji 文本
 * 圆形，柔和边框。
 */

import * as React from 'react'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'

interface UserAvatarProps {
  /** 头像内容（'icon:xxx' 哨兵 / data:image/* URL / emoji 字符串） */
  avatar: string
  /** 尺寸（像素），默认 35 */
  size?: number
  className?: string
  onClick?: React.MouseEventHandler<HTMLDivElement>
}

/** 判断是否为图片 URL（data:image 或 http） */
function isImageUrl(avatar: string): boolean {
  return avatar.startsWith('data:image') || avatar.startsWith('http')
}

/** 判断是否为 lucide 图标哨兵 */
function isIconSentinel(avatar: string): boolean {
  return avatar.startsWith('icon:')
}

export function UserAvatar({
  avatar,
  size = 35,
  className,
  onClick,
}: UserAvatarProps): React.ReactElement {
  const { t } = useT('common')
  const fontSize = Math.round(size * 0.5)

  // lucide 图标分支：目前仅支持 'icon:user'，未来可扩展映射表
  if (isIconSentinel(avatar)) {
    const iconSize = Math.round(size * 0.55)
    return (
      <div
        className={cn(
          'shrink-0 flex items-center justify-center rounded-full',
          'bg-foreground/[0.04] dark:bg-foreground/[0.08] border-[0.5px] border-foreground/10',
          onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
          className
        )}
        style={{ width: size, height: size }}
        onClick={onClick}
      >
        <User size={iconSize} strokeWidth={1.75} className="text-foreground/60" />
      </div>
    )
  }

  if (isImageUrl(avatar)) {
    return (
      <div
        className={cn(
          'shrink-0 overflow-hidden rounded-full border-[0.5px] border-foreground/10',
          onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
          className
        )}
        style={{ width: size, height: size }}
        onClick={onClick}
      >
        <img
          src={avatar}
          alt={t('userAvatar')}
          className="size-full object-cover"
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-center rounded-full',
        'bg-foreground/[0.04] dark:bg-foreground/[0.08] border-[0.5px] border-foreground/10',
        onClick && 'cursor-pointer hover:opacity-80 transition-opacity',
        className
      )}
      style={{ width: size, height: size, fontSize }}
      onClick={onClick}
    >
      {avatar}
    </div>
  )
}
