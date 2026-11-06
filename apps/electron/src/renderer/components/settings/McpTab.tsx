/**
 * McpTab - Settings → MCP（spec §6.5）
 *
 * 独立 MCP 服务器 tab：从原 agent tab 里拆出 McpSection，作为"系统底座 跨场景共享"
 * 的基础设施单独成 tab（spec §6.5 / 0.3 §三-C.0 配置分层）。
 *
 * 数据来源不变：
 *  - 全局 MCP 配置：~/.asci/mcp.json（getGlobalMcpConfig）
 *  - 内建 MCP（zotero/ocr/asr/paper-search）：从 workspace capabilities 拼接
 *
 * §6.6 升级迁移：~/.asci/mcp.json 在 main 进程启动时由 migrateWorkspaceMcpToGlobal
 * 自动从老用户的 workspace mcp.json 迁移过来；本 tab 直接读全局表，无需关心迁移。
 *
 * 注：McpSection 仍需 workspaceSlug（用于拼接内建项 + capabilities 刷新事件），
 * 因此本 tab 也复用 currentAgentWorkspace 作 context。如果没有工作区则显示空态。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { FolderOpen } from 'lucide-react'
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
  workspaceCapabilitiesVersionAtom,
} from '@/atoms/agent-atoms'
import { McpSection } from './agent/McpSection'
import { useT } from '@/hooks/useT'

export function McpTab(): React.ReactElement {
  const { t } = useT('settings')
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const capabilitiesVersion = useAtomValue(workspaceCapabilitiesVersionAtom)

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const workspaceSlug = currentWorkspace?.slug ?? ''

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <FolderOpen size={48} className="text-muted-foreground/50 mb-4" />
        <p className="text-sm text-muted-foreground">{t('agent.noWorkspace')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <McpSection workspaceSlug={workspaceSlug} capabilitiesVersion={capabilitiesVersion} />
    </div>
  )
}
