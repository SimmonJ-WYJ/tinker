/**
 * TaskProgressCard — 内联聚合式任务进度卡片
 *
 * 将消息流中散落的 TaskCreate / TaskUpdate / TodoWrite 工具调用
 * 聚合为一个实时更新的进度卡片。
 *
 * 数据来源：直接从 ToolActivity[] 中提取 task 相关活动并聚合状态。
 */

import * as React from 'react'
import {
  CheckCircle2,
  Circle,
  ListTodo,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { ToolActivity } from '@/atoms/agent-atoms'

// ===== 数据类型 =====

/** Task 工具名集合（用于聚合判断，与 ToolActivityItem / SDKMessageRenderer 共享语义）
 * 注意：TaskGet/TaskList 是只读查询工具，不纳入聚合，保留为普通工具活动行 */
export const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite'])

interface TaskItem {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed' | 'deleted'
  activeForm?: string
}

// ===== 聚合逻辑 =====

/**
 * 从 ToolActivity[] 中提取并聚合所有任务项的最新状态
 *
 * 策略：
 * 1. 先扫描所有 TaskCreate，从 result 中提取 SDK 分配的真实 taskId
 * 2. 对于 result 尚未到达的 TaskCreate，用 toolUseId 作为临时 key
 * 3. TaskUpdate 通过真实 taskId 匹配已有条目
 */
function aggregateTaskItems(
  activities: ToolActivity[],
  streamEnded: boolean,
  historicalTaskSubjects: Map<string, string> | undefined,
  fallbackLabels: { unnamed: string; taskIdFallback: (id: string) => string },
): TaskItem[] {
  const taskMap = new Map<string, TaskItem>()
  let todoAutoId = 0

  // 第一遍：为每个 TaskCreate 确定其真实 ID
  // result 格式: "Task #7 created successfully: xxx"
  const taskCreateIdMap = new Map<string, string>() // toolUseId → realTaskId | toolUseId(fallback)
  for (const activity of activities) {
    if (activity.toolName !== 'TaskCreate') continue
    let realId: string | undefined
    if (activity.result) {
      const match = activity.result.match(/Task\s*#(\d+)/i)
      if (match) realId = match[1]
    }
    taskCreateIdMap.set(activity.toolUseId, realId ?? activity.toolUseId)
  }

  // 第二遍：聚合
  for (const activity of activities) {
    if (activity.toolName === 'TodoWrite') {
      const todos = activity.input.todos
      if (Array.isArray(todos)) {
        // 仅清除之前的 todo 条目，保留 TaskCreate/TaskUpdate 产生的条目
        for (const key of taskMap.keys()) {
          if (key.startsWith('todo-')) taskMap.delete(key)
        }
        for (const t of todos as Array<Record<string, unknown>>) {
          const id = `todo-${todoAutoId++}`
          taskMap.set(id, {
            id,
            subject: String(t.subject ?? t.content ?? ''),
            status: (t.status as TaskItem['status']) ?? 'pending',
            activeForm: typeof t.activeForm === 'string' ? t.activeForm : undefined,
          })
        }
      }
    } else if (activity.toolName === 'TaskCreate') {
      const id = taskCreateIdMap.get(activity.toolUseId) ?? activity.toolUseId

      const subject = typeof activity.input.subject === 'string'
        ? activity.input.subject
        : typeof activity.input.description === 'string'
          ? activity.input.description
          : fallbackLabels.unnamed
      const activeForm = typeof activity.input.activeForm === 'string'
        ? activity.input.activeForm
        : undefined

      taskMap.set(id, {
        id,
        subject,
        status: 'pending',
        activeForm,
      })
    } else if (activity.toolName === 'TaskUpdate') {
      const rawId = activity.input.taskId
      const taskId = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : undefined
      if (!taskId) continue

      const existing = taskMap.get(taskId)
      if (existing) {
        taskMap.set(taskId, {
          ...existing,
          ...(typeof activity.input.status === 'string' && { status: activity.input.status as TaskItem['status'] }),
          ...(typeof activity.input.subject === 'string' && { subject: activity.input.subject }),
          ...(typeof activity.input.activeForm === 'string' && { activeForm: activity.input.activeForm }),
        })
      } else {
        // TaskCreate 的 result 尚未到达，通过遍历 taskCreateIdMap 找临时 key
        // 查找是否有 TaskCreate 的临时 key（toolUseId）尚未被替换为真实 ID
        // 此时无法确定对应关系，走兜底
        taskMap.set(taskId, {
          id: taskId,
          subject: typeof activity.input.subject === 'string'
            ? activity.input.subject
            : historicalTaskSubjects?.get(taskId) ?? fallbackLabels.taskIdFallback(taskId),
          status: (typeof activity.input.status === 'string' ? activity.input.status : 'pending') as TaskItem['status'],
          activeForm: typeof activity.input.activeForm === 'string' ? activity.input.activeForm : undefined,
        })
      }
    }
  }

  // 流式结束后，将仍处于 in_progress 的任务降级为 pending（停止 spinner）
  let items = Array.from(taskMap.values()).filter((t) => t.status !== 'deleted')
  if (streamEnded) {
    items = items.map((t) =>
      t.status === 'in_progress' ? { ...t, status: 'pending' as const } : t
    )
  }
  return items
}

// ===== 任务行 =====

interface TaskRowProps {
  item: TaskItem
}

function TaskRow({ item }: TaskRowProps): React.ReactElement {
  const isCompleted = item.status === 'completed'
  const isInProgress = item.status === 'in_progress'

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-sm py-[3px]',
        'transition-colors duration-200',
        isCompleted && 'opacity-50',
      )}
    >
      {/* 状态图标 */}
      <span className="flex items-center justify-center size-2.5 shrink-0">
        {item.status === 'pending' && (
          <Circle className="size-2.5 text-muted-foreground/40" />
        )}
        {isInProgress && (
          <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground/60" />
        )}
        {isCompleted && (
          <CheckCircle2 className="size-2.5 text-success" />
        )}
      </span>

      {/* 任务文字 */}
      <span
        className={cn(
          'truncate flex-1',
          isCompleted && 'text-muted-foreground line-through',
          isInProgress && 'text-foreground/90',
          !isCompleted && !isInProgress && 'text-muted-foreground',
        )}
      >
        {isInProgress && item.activeForm ? item.activeForm : item.subject}
      </span>
    </div>
  )
}

// ===== 进度条 =====

function ProgressBar({ completed, total }: { completed: number; total: number }): React.ReactElement | null {
  if (total <= 1) return null
  const percent = Math.round((completed / total) * 100)

  return (
    <div className="h-0.5 bg-muted rounded-full mb-2 overflow-hidden">
      <div
        className="h-full bg-primary rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

// ===== 主组件 =====

const MAX_VISIBLE = 8

interface TaskProgressCardProps {
  /** 包含 TaskCreate/TaskUpdate/TodoWrite 的活动列表 */
  activities: ToolActivity[]
  /** 是否处于流式状态 */
  animate?: boolean
  /** 流式是否已结束（用于停止 in_progress 任务的 spinner） */
  streamEnded?: boolean
  /** 历史 TaskCreate 的 taskId → subject 映射（跨 turn 回溯，用于恢复任务名） */
  historicalTaskSubjects?: Map<string, string>
}

export function TaskProgressCard({ activities, animate = false, streamEnded = false, historicalTaskSubjects }: TaskProgressCardProps): React.ReactElement | null {
  const { t } = useT('conversation')
  const { t: tCommon } = useT('common')
  const fallbackLabels = React.useMemo(
    () => ({
      unnamed: t('agent.taskProgress.unnamedTask'),
      taskIdFallback: (id: string) => t('agent.taskProgress.taskIdFallback', { id }),
    }),
    [t],
  )
  const items = React.useMemo(
    () => aggregateTaskItems(activities, streamEnded, historicalTaskSubjects, fallbackLabels),
    [activities, streamEnded, historicalTaskSubjects, fallbackLabels],
  )
  const [expanded, setExpanded] = React.useState(false)

  if (items.length === 0) return null

  const completedCount = items.filter((t) => t.status === 'completed').length
  const totalCount = items.length
  const needsCollapse = items.length > MAX_VISIBLE
  const visibleItems = needsCollapse && !expanded ? items.slice(0, MAX_VISIBLE) : items

  return (
    <div className={cn('my-1', animate && 'animate-in fade-in duration-200')}>
      {/* 浅灰实线边框容器 */}
      <div className="rounded-lg bg-muted/40 px-3.5 py-3 border border-border/60">
        {/* 标题行 */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <ListTodo className="size-3.5 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            {t('agent.taskProgress.title')}
          </span>
          <span className="text-sm text-muted-foreground/50 tabular-nums">
            {completedCount}/{totalCount}
          </span>
        </div>

        {/* 进度条 */}
        <ProgressBar completed={completedCount} total={totalCount} />

        {/* 任务列表 */}
        <div className="space-y-0">
          {visibleItems.map((item) => (
            <TaskRow key={item.id} item={item} />
          ))}
        </div>

        {/* 展开/收起按钮 */}
        {needsCollapse && (
          <Button
            type="button"
            variant="subtle"
            size="inline"
            onClick={() => setExpanded(!expanded)}
            className="mt-1 flex items-center gap-1 text-muted-foreground/50 hover:text-foreground/70"
          >
            {expanded ? (
              <>
                <ChevronUp className="!size-3" />
                <span>{tCommon('collapse')}</span>
              </>
            ) : (
              <>
                <ChevronDown className="!size-3" />
                <span>{t('agent.taskProgress.expandAll', { count: totalCount })}</span>
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
