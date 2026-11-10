import { MediaCapabilityRow } from '../MediaCapabilityRow'
import { ZoteroMediaPanel } from '../ZoteroMediaPanel'
/**
 * McpSection - Agent 设置页内 MCP 服务器配置区
 *
 * 列出当前工作区可见的 MCP：内建 OCR/ASR（独立设置）
 * 与用户自定义。新增/编辑切到 McpServerForm 表单视图，删除/启停就地操作。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Plus, Plug, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { McpServerEntry, GlobalMcpConfig, WorkspaceCapabilities } from '@asci/shared'
import { workspaceCapabilitiesVersionAtom } from '@/atoms/agent-atoms'
import { SettingsSection, SettingsCard, SettingsRow } from '../primitives'
import { McpServerForm } from '../McpServerForm'
import { useT } from '@/hooks/useT'

/** 视图模式：列表 / 新增 / 编辑 */
type ViewMode = 'list' | 'create' | 'edit'

/** 编辑中的服务器信息 */
interface EditingServer {
  name: string
  entry: McpServerEntry
}

interface McpSectionProps {
  workspaceSlug: string
  /** 父级 capabilities 版本号，bump 时重新拉数据 */
  capabilitiesVersion: number
}

export function McpSection({ workspaceSlug, capabilitiesVersion }: McpSectionProps): React.ReactElement {
  const { t } = useT('settings')
  const bumpCapabilitiesVersion = useSetAtom(workspaceCapabilitiesVersionAtom)

  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingServer, setEditingServer] = React.useState<EditingServer | null>(null)
  const [mcpConfig, setMcpConfig] = React.useState<GlobalMcpConfig>({ servers: {} })
  // 内建媒体 MCP —— 由 capabilities 拼接，设置字段负责启停
  const [builtinServers, setBuiltinServers] = React.useState<WorkspaceCapabilities['mcpServers']>([])
  const [loading, setLoading] = React.useState(true)

  /** 加载 MCP 配置（全局表 + 内建项） */
  const loadData = React.useCallback(async () => {
    if (!workspaceSlug) {
      setLoading(false)
      return
    }
    try {
      const [config, capabilities] = await Promise.all([
        window.electronAPI.getGlobalMcpConfig(),
        window.electronAPI.getWorkspaceCapabilities(workspaceSlug),
      ])
      setMcpConfig(config)
      // 仅取内建项；用户自定义已在 mcpConfig 内（避免双份显示）
      setBuiltinServers(capabilities.mcpServers.filter((s) => s.isBuiltin))
    } catch (error) {
      console.error('[Agent MCP] 加载配置失败:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceSlug])

  React.useEffect(() => {
    loadData()
  }, [loadData, capabilitiesVersion])

  React.useEffect(() => {
    const unsub = window.electronAPI.onMcpGlobalChanged(() => loadData())
    return unsub
  }, [loadData])

  /** 删除 MCP 服务器 */
  const handleDelete = async (serverName: string): Promise<void> => {
    if (!confirm(t('agent.mcp.deleteConfirm', { name: serverName }))) return
    try {
      const newServers = { ...mcpConfig.servers }
      delete newServers[serverName]
      const newConfig: GlobalMcpConfig = { servers: newServers }
      await window.electronAPI.saveGlobalMcpConfig(newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent MCP] 删除失败:', error)
    }
  }

  /** 切换 MCP 服务器启用状态 */
  const handleToggle = async (serverName: string): Promise<void> => {
    try {
      const entry = mcpConfig.servers[serverName]
      if (!entry) return
      const newConfig: GlobalMcpConfig = {
        servers: {
          ...mcpConfig.servers,
          [serverName]: { ...entry, enabled: !entry.enabled },
        },
      }
      await window.electronAPI.saveGlobalMcpConfig(newConfig)
      setMcpConfig(newConfig)
      bumpCapabilitiesVersion((v) => v + 1)
    } catch (error) {
      console.error('[Agent MCP] 切换状态失败:', error)
    }
  }

  /** 表单保存回调 */
  const handleFormSaved = (): void => {
    setViewMode('list')
    setEditingServer(null)
    loadData()
    bumpCapabilitiesVersion((v) => v + 1)
  }

  /** 取消表单 */
  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingServer(null)
  }

  // 表单视图：占满整个 section（外层 AgentSettings 会跟它一起被替换）
  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <McpServerForm
        server={editingServer}
        onSaved={handleFormSaved}
        onCancel={handleFormCancel}
      />
    )
  }

  const serverEntries = Object.entries(mcpConfig.servers ?? {}).filter(
    ([name]) => name !== 'memos-cloud', // 记忆功能已迁移到独立配置，隐藏旧 MCP 条目
  )

  return (
    <SettingsSection
      title={t('agent.mcp.section')}
      description={t('agent.mcp.description')}
      action={
        <Button size="sm" onClick={() => setViewMode('create')}>
          <Plus size={16} />
          <span>{t('agent.mcp.add')}</span>
        </Button>
      }
    >
      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">{t('agent.mcp.loading')}</div>
      ) : (
        <SettingsCard>
          {/* 通用媒体 MCP：独立开关 */}
          {builtinServers.filter(s => s.name === 'ocr' || s.name === 'asr').map((s) => (
            <MediaCapabilityRow
              key={s.name}
              kind={s.name as 'ocr' | 'asr'}
              label={t(s.name === 'ocr' ? 'agent.mcp.builtin.ocrLabel' : 'agent.mcp.builtin.asrLabel')}
              description={t(s.name === 'ocr' ? 'agent.mcp.builtin.ocrDescription' : 'agent.mcp.builtin.asrDescription')}
              onSettingsChanged={loadData}
              refreshVersion={`${capabilitiesVersion}:${s.enabled}`}
            />
          ))}
          {/* 用户自定义 MCP */}
          {serverEntries.map(([name, entry]) => (
            <McpServerRow
              key={name}
              name={name}
              entry={entry}
              onEdit={() => {
                setEditingServer({ name, entry })
                setViewMode('edit')
              }}
              onDelete={() => handleDelete(name)}
              onToggle={() => handleToggle(name)}
            />
          ))}
          {builtinServers.length === 0 && serverEntries.length === 0 && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              {t('agent.mcp.empty')}
            </div>
          )}
        </SettingsCard>
      )}
      <ZoteroMediaPanel embedded />
    </SettingsSection>
  )
}

// ===== 行子组件 =====

/** 传输类型显示标签 */
const TRANSPORT_LABELS: Record<string, string> = {
  stdio: 'stdio',
  http: 'HTTP',
  sse: 'SSE',
}

interface McpServerRowProps {
  name: string
  entry: McpServerEntry
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}

function McpServerRow({ name, entry, onEdit, onDelete, onToggle }: McpServerRowProps): React.ReactElement {
  const { t } = useT('settings')
  return (
    <SettingsRow
      label={name}
      icon={<Plug size={18} className="text-info" />}
      description={entry.type === 'stdio' ? entry.command : entry.url}
      className="group"
    >
      <div className="flex items-center gap-2">
        <span className="text-badge px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-normal">
          {TRANSPORT_LABELS[entry.type] ?? entry.type}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          className="size-auto p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 opacity-0 group-hover:opacity-100 [&_svg]:size-3.5"
          title={t('agent.mcp.row.edit')}
        >
          <Pencil size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          className="size-auto p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 [&_svg]:size-3.5"
          title={t('agent.mcp.row.delete')}
        >
          <Trash2 size={14} />
        </Button>
        <Switch
          checked={entry.enabled}
          onCheckedChange={onToggle}
        />
      </div>
    </SettingsRow>
  )
}
