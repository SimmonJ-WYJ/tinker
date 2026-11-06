/**
 * ProfileSettings - 个人资料设置页（账户组）
 *
 * 列表风格：头像 + 显示名称各一行，独立编辑。
 * - 头像行：点击右侧头像直接弹 emoji picker（即点即改）
 * - 显示名称行：默认展示名字 + 编辑按钮；进入编辑态行内显示 input + 保存/取消
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Camera, Check, CheckCircle2, ImagePlus, Pencil, X } from 'lucide-react'
import Picker from '@emoji-mart/react'
import data from '@emoji-mart/data'
import { toast } from 'sonner'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover'
import { Button } from '../ui/button'
import { UserAvatar } from '../common/UserAvatar'
import { userProfileAtom, useDisplayUserName } from '@/atoms/user-profile'
import { languageAtom } from '@/atoms/language-atoms'
import { currentUserAtom } from '@/atoms/auth-atoms'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { formatDate } from '@/utils/dayjs'
import { useFormatRelativeTime } from '@/utils/format-relative-time'
import { toMs } from '@asci/shared'
import { LOGIN_ENABLED, useIsDevMode } from '@/lib/dev-mode'
import { resolveProfileNameSave } from './profile-card-helpers.ts'
import { LogoutConfirmDialog } from '../auth/LogoutConfirmDialog.tsx'
import { DeleteAccountDialog } from '../auth/DeleteAccountDialog.tsx'

/** emoji-mart 选择回调的 emoji 对象类型 */
interface EmojiMartEmoji {
  id: string
  name: string
  native: string
  unified: string
  keywords: string[]
  shortcodes: string
}

export function ProfileSettings(): React.ReactElement {
  const [userProfile, setUserProfile] = useAtom(userProfileAtom)
  const displayUserName = useDisplayUserName()
  const [language] = useAtom(languageAtom)
  const currentUser = useAtomValue(currentUserAtom)
  const { t } = useT('settings')
  const { t: tAuth } = useT('auth')
  const formatRelativeTime = useFormatRelativeTime()
  const isDevMode = useIsDevMode()

  const [logoutOpen, setLogoutOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [resendingVerify, setResendingVerify] = React.useState(false)
  const [verifyingConn, setVerifyingConn] = React.useState(false)

  // dev-only 连通自检：只读 GET /me，验证客户端能否打通已部署的 ASCI-Server（零删除风险）。
  // 文案为 dev-only，无需走 i18n。
  const handleVerifyConnection = async (): Promise<void> => {
    setVerifyingConn(true)
    try {
      const r = await window.electronAPI.auth.verifyConnection()
      if (!r.ok) {
        toast.error(`连通失败（${r.error.code}）：${r.error.message}`)
        return
      }
      const { serverBaseUrl, httpStatus, authorized } = r.value
      if (authorized) toast.success(`已联通 ${serverBaseUrl}（GET /me ${httpStatus}，token 被接受）`)
      else toast.warning(`可达但 token 被拒：${serverBaseUrl}（GET /me ${httpStatus}）`)
    } finally {
      setVerifyingConn(false)
    }
  }

  // dev-only：取当前 access token 原文并复制到剪贴板，供手动 curl 调试接口 / 给后端定位受众问题。
  const handleCopyToken = async (): Promise<void> => {
    const r = await window.electronAPI.auth.getAccessTokenForDev()
    if (!r.ok) {
      toast.error(`取 token 失败（${r.error.code}）：${r.error.message}`)
      return
    }
    if (!r.value) {
      toast.warning('当前无 access token（未登录或会话已清）')
      return
    }
    await navigator.clipboard.writeText(r.value)
    toast.success(`access token 已复制（${r.value.length} 字符）`)
  }

  const handleResendVerification = async (): Promise<void> => {
    if (!currentUser) return
    setResendingVerify(true)
    try {
      await window.electronAPI.auth.requestEmailVerify({ email: currentUser.email })
      toast.success(tAuth('profile.resendVerificationSent'))
    } catch {
      // 静默失败
    } finally {
      setResendingVerify(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title={t('profile.title')}
        description={t('profile.description')}
      >
        <SettingsCard>
          {LOGIN_ENABLED && currentUser !== null ? (
            // 登录态：只读展示线上 OPENSCI 账户（本期仅查询获取，不提供编辑）
            <>
              {/* 头像（线上，只读） */}
              <SettingsRow label={tAuth('profile.avatar')}>
                <UserAvatar avatar={currentUser.avatarUrl ?? 'icon:user'} size={40} />
              </SettingsRow>

              {/* 昵称（线上，只读；即显示名） */}
              <SettingsRow label={tAuth('profile.nickname')}>
                <ReadonlyValue value={currentUser.nickname} placeholder={tAuth('profile.noValue')} />
              </SettingsRow>

              {/* 邮箱 + 验证状态 */}
              <SettingsRow label={tAuth('profile.email')}>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground truncate">{currentUser.email}</span>
                  {currentUser.emailVerified ? (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <CheckCircle2 size={13} />
                      {tAuth('profile.emailVerified')}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2"
                      disabled={resendingVerify}
                      onClick={() => void handleResendVerification()}
                    >
                      {resendingVerify ? tAuth('common.loading') : tAuth('profile.resendVerification')}
                    </Button>
                  )}
                </div>
              </SettingsRow>

              {/* 机构（只读） */}
              <SettingsRow label={tAuth('profile.institution')}>
                <ReadonlyValue value={currentUser.institution} placeholder={tAuth('profile.noValue')} />
              </SettingsRow>

              {/* 学科（只读） */}
              <SettingsRow label={tAuth('profile.field')}>
                <ReadonlyValue value={currentUser.field} placeholder={tAuth('profile.noValue')} />
              </SettingsRow>

              {/* 注册时间 */}
              <SettingsRow label={tAuth('profile.registeredAt')}>
                <span className="text-sm text-foreground/60">{formatDate(currentUser.createdAt)}</span>
              </SettingsRow>

              {/* 上次登录 */}
              <SettingsRow label={tAuth('profile.lastLogin')}>
                <span className="text-sm text-foreground/60">
                  {formatRelativeTime(toMs(currentUser.lastLoginAt))}
                </span>
              </SettingsRow>
            </>
          ) : (
            // 未登录 / LOGIN_ENABLED 关：本地自定义头像 + 显示名（对话/侧边栏身份来源，可编辑）
            <>
              <AvatarRow
                avatar={userProfile.avatar}
                language={language}
                label={t('profile.avatar.label')}
                uploadCustomLabel={t('profile.uploadCustom')}
                onChange={async (avatar) => {
                  const updated = await window.electronAPI.updateUserProfile({ avatar })
                  setUserProfile(updated)
                }}
              />
              <NameRow
                currentName={userProfile.userName}
                displayName={displayUserName}
                label={t('profile.name.label')}
                placeholder={t('profile.name.placeholder')}
                saveLabel={t('profile.save')}
                cancelLabel={t('profile.cancel')}
                editLabel={t('profile.edit')}
                onSave={async (nextName) => {
                  const updated = await window.electronAPI.updateUserProfile({ userName: nextName })
                  setUserProfile(updated)
                }}
              />
            </>
          )}
        </SettingsCard>

        {/* 退出登录 + 删除账户（账户信息下方） */}
        {LOGIN_ENABLED && currentUser !== null && (
          <div className="pt-2 flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              className="self-start text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setLogoutOpen(true)}
            >
              {tAuth('profile.logout')}
            </Button>

            {/* dev-only 连通自检：只读 GET /me，与删除走同一条 base URL + token 链路但零副作用。
                文案 dev-only，无需 i18n；生产构建被 tree-shaking 剥离。 */}
            {isDevMode && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={verifyingConn}
                  onClick={handleVerifyConnection}
                >
                  {verifyingConn ? '测试连接中…' : '测试服务端连接 (dev)'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={handleCopyToken}
                >
                  复制 access token (dev)
                </Button>
              </div>
            )}

            {/* 删除账户（DO-3）：GDPR 被遗忘权——清服务端身份+遥测，本地研究库保留 */}
            <div className="rounded-lg border border-destructive/20 bg-destructive/[0.03] p-4">
              <h4 className="text-sm font-medium text-foreground">{tAuth('profile.deleteAccount')}</h4>
              <p className="mt-1 text-xs text-foreground/60 leading-relaxed">
                {tAuth('profile.deleteAccountDescription')}
              </p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-3"
                onClick={() => setDeleteOpen(true)}
              >
                {tAuth('profile.deleteAccount')}
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>

      {/* 数据位置说明（U-A6 预期管理：研究数据仅本地、不跨设备同步） */}
      <SettingsSection title={tAuth('profile.dataLocality.title')}>
        <SettingsCard>
          <p className="px-4 py-3 text-sm leading-relaxed text-foreground/60">
            {tAuth('profile.dataLocality.body')}
          </p>
        </SettingsCard>
      </SettingsSection>

      {LOGIN_ENABLED && <LogoutConfirmDialog open={logoutOpen} onOpenChange={setLogoutOpen} />}
      {LOGIN_ENABLED && <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />}
    </div>
  )
}

// ===== 只读字段值展示（空值显示占位灰字） =====

function ReadonlyValue({ value, placeholder }: { value: string | null; placeholder: string }): React.ReactElement {
  return value ? (
    <span className="text-sm text-foreground">{value}</span>
  ) : (
    <span className="text-sm text-foreground/40">{placeholder}</span>
  )
}

// ===== 头像行：点头像弹 emoji picker / 上传图片，即点即改 =====

interface AvatarRowProps {
  avatar: string
  language: string
  label: string
  uploadCustomLabel: string
  onChange: (avatar: string) => Promise<void>
}

function AvatarRow({ avatar, language, label, uploadCustomLabel, onChange }: AvatarRowProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleEmojiSelect = async (emoji: EmojiMartEmoji): Promise<void> => {
    try {
      await onChange(emoji.native)
      setOpen(false)
    } catch (error) {
      console.error('[个人资料] 更新头像失败:', error)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        await onChange(reader.result as string)
        setOpen(false)
      } catch (error) {
        console.error('[个人资料] 上传头像失败:', error)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <SettingsRow label={label}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="relative size-auto group/avatar rounded-full p-0 hover:bg-transparent focus-visible:outline-none"
          >
            <UserAvatar avatar={avatar} size={40} />
            <div className="absolute inset-0 rounded-full flex items-center justify-center bg-black/0 group-hover/avatar:bg-black/40 transition-colors">
              <Camera className="size-4 text-white opacity-0 group-hover/avatar:opacity-100 transition-opacity" />
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="left"
          align="start"
          sideOffset={12}
          className="w-auto p-0 border-none shadow-xl"
        >
          <Picker
            data={data}
            onEmojiSelect={handleEmojiSelect}
            locale={language}
            theme="auto"
            previewPosition="none"
            skinTonePosition="search"
            perLine={8}
          />
          <div className="px-3 p-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'w-full h-auto flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-normal',
                'text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06]',
              )}
            >
              <ImagePlus className="size-4" />
              {uploadCustomLabel}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
        </PopoverContent>
      </Popover>
    </SettingsRow>
  )
}

// ===== 显示名称行：默认 readonly + 编辑按钮；编辑态行内 input + 保存/取消 =====

interface NameRowProps {
  /** 用户存储的原始名（可能为空） */
  currentName: string
  /** 解析后展示用名字（空时走默认值） */
  displayName: string
  label: string
  placeholder: string
  saveLabel: string
  cancelLabel: string
  editLabel: string
  onSave: (nextName: string) => Promise<void>
}

function NameRow({
  currentName,
  displayName,
  label,
  placeholder,
  saveLabel,
  cancelLabel,
  editLabel,
  onSave,
}: NameRowProps): React.ReactElement {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(currentName)

  const startEdit = (): void => {
    setDraft(currentName)
    setEditing(true)
  }

  const cancelEdit = React.useCallback((): void => {
    setDraft(currentName)
    setEditing(false)
  }, [currentName])

  const handleSave = async (): Promise<void> => {
    const resolution = resolveProfileNameSave(draft, currentName)
    if (!resolution.shouldSave) {
      setDraft(resolution.nextName)
      setEditing(false)
      return
    }
    try {
      await onSave(resolution.nextName)
      setEditing(false)
    } catch (error) {
      console.error('[个人资料] 更新用户名失败:', error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelEdit()
    }
  }

  // 编辑态下提供全局 Esc 兜底，避免焦点丢失时不响应
  React.useEffect(() => {
    if (!editing) return
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelEdit()
    }
    window.addEventListener('keydown', handleEscape, { capture: true })
    return () => window.removeEventListener('keydown', handleEscape, { capture: true })
  }, [cancelEdit, editing])

  return (
    <SettingsRow label={label}>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={30}
            autoFocus
            placeholder={placeholder}
            className={cn(
              'h-8 w-[180px] rounded-md bg-muted/40 px-3 text-sm text-foreground',
              'outline-none transition-shadow',
              'focus:bg-background',
            )}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-sm"
            onClick={() => void handleSave()}
          >
            <Check size={14} className="!size-3.5" />
            {saveLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-sm"
            onClick={cancelEdit}
          >
            <X size={14} />
            {cancelLabel}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate max-w-[200px]">{displayName}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={startEdit}
            title={editLabel}
            aria-label={editLabel}
          >
            <Pencil size={14} className="!size-3.5" />
          </Button>
        </div>
      )}
    </SettingsRow>
  )
}
