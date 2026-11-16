/**
 * PermissionBanner — Agent 权限请求横幅（F51 ChoiceCard + F52 队列 / i18n 融合）。
 *
 * 基座：ChoiceCard primitive
 *   - 数字键 1-3 直选 / ↑↓ 导航 / Enter 确认 / Esc 关闭并终止 Agent
 *   - dangerous 工具的 alwaysAllow 选项标 danger:true → 由 ChoiceCard 自动弹 ConfirmDangerousModal
 *   - useActiveBannerSlot 与其他 banner 互斥
 * 功能层（来自 F52）：
 *   - i18n 走 banner.* keys，PermissionRequest.descriptionI18n 优先于 description
 *   - body 用 ToolPreview（Bash 命令 / 文件 / 模式 / JSON 选择性渲染）
 *   - bodyExtra 用 PermissionQueueList 同时展示队列剩余请求（只读，防误点）
 *   - decisionReason / hardRuleReason 紧贴 body 顶部，用户可见决策原因
 */

import * as React from 'react'
import { toast } from 'sonner'
import { useAtom, useSetAtom } from 'jotai'
import { FileText, Search, Info } from 'lucide-react'
import {
  allPendingPermissionRequestsAtom,
  agentStreamingStatesAtom,
  finalizeStreamingActivities,
} from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { ChoiceCard } from './choice/ChoiceCard.tsx'
import { useActiveBannerSlot } from './choice/useActiveBannerSlot.ts'
import type { ToolPreview as ToolPreviewData } from '@asci/shared'
import { PermissionQueueList } from './permission/PermissionQueueList'

/** 解析工具显示名称（MCP 工具显示 server / tool） */
function formatToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

interface PermissionBannerProps {
  sessionId: string
}

export function PermissionBanner({ sessionId }: PermissionBannerProps): React.ReactElement | null {
  const { t } = useT('conversation')
  const { t: tCommon } = useT('common')
  const slot = useActiveBannerSlot(sessionId)
  const [allRequests, setAllRequests] = useAtom(allPendingPermissionRequestsAtom)
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const [responding, setResponding] = React.useState(false)

  const requests = allRequests.get(sessionId) ?? []
  const request = requests[0] ?? null
  const queuedRequests = requests.slice(1)
  const total = requests.length

  // 仅当 slot 仲裁返回 permission 且有待处理请求时挂载
  if (slot !== 'permission' || request == null) return null

  const isDangerous = request.dangerLevel === 'dangerous'
  const canAlwaysAllow = request.canAlwaysAllow !== false
  const formattedTool = formatToolName(request.toolName)

  /** 响应权限请求（IPC + 队列出队） */
  const respond = async (behavior: 'allow' | 'deny', alwaysAllow = false): Promise<void> => {
    if (responding) return
    setResponding(true)
    try {
      await window.electronAPI.respondPermission({
        requestId: request.requestId,
        behavior,
        alwaysAllow,
      })
      setAllRequests((prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        const newValue = current.filter((r) => r.requestId !== request.requestId)
        if (newValue.length === 0) map.delete(sessionId)
        else map.set(sessionId, newValue)
        return map
      })
    } catch (error) {
      console.error('[PermissionBanner] 响应失败:', error)
      toast.error(t('banner.responseFailed'), { description: error instanceof Error ? error.message : undefined })
    } finally {
      setResponding(false)
    }
  }

  /** Esc / ✕ 关闭：清空请求队列并终止 Agent */
  const handleDismiss = (): void => {
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current || !current.running) return prev
      const map = new Map(prev)
      map.set(sessionId, {
        ...current,
        running: false,
        ...finalizeStreamingActivities(current.toolActivities, current.teammates),
      })
      return map
    })
    setAllRequests((prev) => {
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })
    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }

  const titleText = isDangerous
    ? t('banner.title.dangerous')
    : request.dangerLevel === 'safe'
      ? t('banner.title.safe')
      : t('banner.title.normal')

  /** 决策上下文（hardRule 优先，其次 decisionReason，缺省不显示） */
  const reasonText = request.hardRuleReason
    ? t('banner.reason.hardRule', { rule: request.hardRuleReason })
    : request.decisionReason
      ? t('banner.reason.decision', { reason: request.decisionReason })
      : null

  /**
   * 描述文案：优先 descriptionI18n（renderer 翻译），否则回退主进程 description。
   * 主进程动态拼接的 i18n key 无法被 i18next 字面量联合类型静态推断，走宽松签名调用；
   * 命中性由 banner.description.* 段与 key-parity 测试保证。
   */
  const tFlex = t as unknown as (k: string, p?: Record<string, unknown>) => string
  const descriptionText = request.descriptionI18n
    ? tFlex(request.descriptionI18n.key, request.descriptionI18n.params)
    : request.description

  const previewElement = ToolPreview({
    toolName: request.toolName,
    preview: request.toolPreview,
    fallbackDescription: descriptionText,
  })

  const billingNotice = request.toolName === 'mcp__asci-image__generate_image'
    ? <p className="text-xs text-muted-foreground">{tCommon('imageBillingNotice')}</p>
    : null
  const body = previewElement == null && billingNotice == null
    ? null
    : <div className="space-y-2 pb-1">{previewElement}{billingNotice}</div>

  const titleNode = reasonText ? (
    <span className="inline-flex items-center gap-1">
      <span>{titleText}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('banner.reason.tooltipLabel')}
              className="inline-flex items-center text-muted-foreground hover:text-foreground focus-visible:text-foreground"
            >
              <Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{reasonText}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  ) : titleText

  const options = [
    { id: 'allow', label: t('banner.action.allow'), disabled: responding },
    { id: 'deny', label: t('banner.action.deny'), disabled: responding },
    ...(canAlwaysAllow
      ? [{
          id: 'alwaysAllow',
          label: t('banner.action.alwaysAllowSession'),
          hint: t('banner.alwaysAllowTooltip'),
          danger: isDangerous,
          disabled: responding,
        }]
      : []),
  ]

  return (
    <ChoiceCard
      key={request.requestId}
      title={titleNode}
      subtitle={formattedTool}
      dangerLevel={request.dangerLevel}
      counter={total > 1 ? { current: 1, total } : undefined}
      footerHints={[
        { key: '↑↓', label: t('choiceCard.keyboardHint.navigate') },
        { key: '1-3', label: t('choiceCard.keyboardHint.select') },
        { key: 'esc', label: t('choiceCard.keyboardHint.dismissTerminate') },
      ]}
      onDismiss={handleDismiss}
      body={body}
      bodyExtra={queuedRequests.length > 0 ? <PermissionQueueList requests={queuedRequests} /> : undefined}
      options={options}
      defaultFocusedId="allow"
      onSelect={(id) => {
        if (id === 'allow') void respond('allow', false)
        else if (id === 'deny') void respond('deny', false)
        else if (id === 'alwaysAllow') void respond('allow', true)
      }}
    />
  )
}

// ===== Tool input 预览渲染 =====

interface ToolPreviewProps {
  toolName: string
  preview: ToolPreviewData
  fallbackDescription: string
}

const PRE_CLASS = 'text-sm font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto scrollbar-thin'

/** 渲染 main 已脱敏的 ToolPreview（#710）：Bash 命令 / 文件 / 模式 / redacted（未知工具脱敏预览）。 */
function ToolPreview({ toolName, preview, fallbackDescription }: ToolPreviewProps): React.ReactElement | null {
  switch (preview.kind) {
    case 'command':
      return <pre className={PRE_CLASS}>{preview.command}</pre>
    case 'file':
      return (
        <div className="flex items-start gap-2 text-xs bg-background/50 rounded px-2 py-1.5">
          <FileText className="size-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="break-all">{preview.path}</div>
            {preview.meta && (
              <div className="text-sm text-muted-foreground mt-0.5">{preview.meta}</div>
            )}
          </div>
        </div>
      )
    case 'pattern':
      return (
        <div className="flex items-start gap-2 text-xs bg-background/50 rounded px-2 py-1.5">
          <Search className="size-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="break-all">{preview.pattern}</div>
            {preview.path && (
              <div className="text-sm text-muted-foreground mt-0.5 break-all">{preview.path}</div>
            )}
          </div>
        </div>
      )
    case 'redacted': {
      // 空入参（'{}'）退回描述/留空，避免展示无意义的 {}；否则展示 main 已脱敏的预览（含 [[REDACTED:*]] 占位符）
      if (preview.preview === '{}') {
        const redundant = fallbackDescription.includes(toolName) && /使用工具|Use tool/.test(fallbackDescription)
        return redundant ? null : <p className="text-xs text-muted-foreground">{fallbackDescription}</p>
      }
      return <pre className={PRE_CLASS}>{preview.preview}</pre>
    }
  }
}
