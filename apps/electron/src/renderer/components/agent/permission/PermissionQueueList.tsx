/**
 * PermissionQueueList - 权限请求队列展开预览（只读）
 *
 * 当 banner 后面还排着 N 个待确认的工具调用时，点击 header 的 +N chevron 展开此列表，
 * 让用户提前看到后面是哪些工具（toolName + dangerLevel dot + 工具参数摘要）。
 *
 * 故意不提供 allow/deny 操作 —— 防误点；用户响应当前 banner 后队列会自动前进。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import type { PermissionRequest, DangerLevel } from '@asci/shared'

const DANGER_DOT: Record<DangerLevel, string> = {
  safe: 'bg-success',
  normal: 'bg-primary',
  dangerous: 'bg-warning',
}

interface PermissionQueueListProps {
  /** banner 头部之后 FIFO 排队的请求（不含当前展示的第一个） */
  requests: PermissionRequest[]
}

/** MCP 工具显示成 `server / tool`，普通工具原样 */
function formatToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts[0] === 'mcp' && parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join('__')}`
  }
  return toolName
}

/** 一行摘要文本：读 main 已脱敏的 toolPreview（#710，不再触碰 raw toolInput） */
function summarize(request: PermissionRequest): string {
  if (request.command) return request.command
  const preview = request.toolPreview
  switch (preview.kind) {
    case 'command':
      return preview.command
    case 'file':
      return preview.meta ? `${preview.path} · ${preview.meta}` : preview.path
    case 'pattern':
      return preview.path ? `${preview.pattern} (${preview.path})` : preview.pattern
    case 'redacted':
      return preview.preview.replace(/\s+/g, ' ')
  }
}

export function PermissionQueueList({ requests }: PermissionQueueListProps): React.ReactElement | null {
  if (requests.length === 0) return null
  return (
    <ul className="px-3 pb-2 space-y-1">
      {requests.map((req) => (
        <li
          key={req.requestId}
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <span className={cn('size-1.5 rounded-full flex-shrink-0', DANGER_DOT[req.dangerLevel])} />
          <span className="text-foreground/80 flex-shrink-0">
            {formatToolName(req.toolName)}
          </span>
          <span className="truncate">
            {summarize(req)}
          </span>
        </li>
      ))}
    </ul>
  )
}
