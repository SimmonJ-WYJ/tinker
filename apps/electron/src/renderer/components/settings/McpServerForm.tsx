/**
 * McpServerForm - MCP 服务器创建/编辑表单
 *
 * 支持 stdio / http / sse 三种传输类型，
 * 复用设置原语组件实现卡片化布局。
 */

import * as React from 'react'
import { ArrowLeft, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { McpServerEntry, McpTransportType, GlobalMcpConfig } from '@asci/shared'
import { BUILTIN_MCP_RESERVED_NAMES, nowMs } from '@asci/shared'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
  LABEL_CLASS,
  DESCRIPTION_CLASS,
} from './primitives'
import { useT } from '@/hooks/useT'

/** 编辑中的服务器 */
interface EditingServer {
  name: string
  entry: McpServerEntry
}

interface McpServerFormProps {
  /** 编辑模式传入已有服务器，创建模式传 null */
  server: EditingServer | null
  onSaved: () => void
  onCancel: () => void
}


/**
 * 解析多行文本为 key=value / key: value 的 Record
 *
 * 支持：
 * - KEY=VALUE（环境变量格式）
 * - Key: Value（HTTP 头格式）
 */
function parseKeyValueText(text: string, separator: '=' | ':'): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf(separator)
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/**
 * 将 Record 序列化为多行 key=value / key: value 文本
 */
function serializeKeyValueText(record: Record<string, string> | undefined, separator: '=' | ':'): string {
  if (!record) return ''
  return Object.entries(record)
    .map(([key, value]) => `${key}${separator}${separator === ':' ? ' ' : ''}${value}`)
    .join('\n')
}

export function McpServerForm({ server, onSaved, onCancel }: McpServerFormProps): React.ReactElement {
  const { t } = useT('settings')
  const isEdit = server !== null
  const transportOptions: Array<{ value: string; label: string }> = [
    { value: 'stdio', label: t('mcpForm.transport.stdio') },
    { value: 'http', label: t('mcpForm.transport.http') },
    { value: 'sse', label: t('mcpForm.transport.sse') },
  ]

  // 表单状态
  const [name, setName] = React.useState(server?.name ?? '')
  const [transportType, setTransportType] = React.useState<McpTransportType>(server?.entry.type ?? 'stdio')
  const [enabled, setEnabled] = React.useState(server?.entry.enabled ?? false) // 默认关闭

  // stdio 字段
  const [command, setCommand] = React.useState(server?.entry.command ?? '')
  const [argsText, setArgsText] = React.useState(server?.entry.args?.join(', ') ?? '')
  const [envText, setEnvText] = React.useState(serializeKeyValueText(server?.entry.env, '='))
  const [timeoutStr, setTimeoutStr] = React.useState(
    server?.entry.timeout != null ? String(server.entry.timeout) : ''
  )

  // http/sse 字段
  const [url, setUrl] = React.useState(server?.entry.url ?? '')
  const [headersText, setHeadersText] = React.useState(serializeKeyValueText(server?.entry.headers, ':'))

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(
    server?.entry.lastTestResult ?? null
  )

  // 监听配置改变，清空测试结果（避免使用过期的测试结果）
  React.useEffect(() => {
    if (!server) return // 新建时不需要清空

    // 检查关键配置是否改变（包括连接相关的所有字段）
    const configChanged =
      transportType !== server.entry.type ||
      (transportType === 'stdio' && command !== server.entry.command) ||
      (transportType !== 'stdio' && url !== server.entry.url) ||
      argsText !== (server.entry.args?.join(', ') ?? '') ||
      envText !== serializeKeyValueText(server.entry.env, '=') ||
      headersText !== serializeKeyValueText(server.entry.headers, ':')

    if (configChanged) {
      setTestResult(null)
      setEnabled(false) // 配置改变时自动关闭开关
    }
  }, [transportType, command, url, argsText, envText, headersText, server])

  /** 构建 McpServerEntry */
  const buildEntry = (includeTestResult = false): McpServerEntry => {
    const base: McpServerEntry = {
      type: transportType,
      // 关键保护：只有测试成功才能启用
      enabled: enabled && testResult?.success === true,
      // 保存测试结果
      ...(includeTestResult && testResult && {
        lastTestResult: {
          ...testResult,
          timestamp: nowMs(),
        },
      }),
    }

    if (transportType === 'stdio') {
      base.command = command.trim()
      const args = argsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (args.length > 0) base.args = args
      const env = parseKeyValueText(envText, '=')
      if (Object.keys(env).length > 0) base.env = env
      const timeout = parseInt(timeoutStr, 10)
      if (!isNaN(timeout) && timeout > 0) base.timeout = timeout
    } else {
      base.url = url.trim()
      const headers = parseKeyValueText(headersText, ':')
      if (Object.keys(headers).length > 0) base.headers = headers
    }

    return base
  }

  /** 测试连接 */
  const handleTest = async (): Promise<void> => {
    const serverName = name.trim()
    if (!serverName) return

    // stdio 需要 command，http/sse 需要 url
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    setTesting(true)
    setTestResult(null)

    try {
      const entry = buildEntry(false) // 测试时不包含旧的测试结果
      const result = await window.electronAPI.testMcpServer(serverName, entry)
      setTestResult({
        success: result.success,
        message: result.message,
      })
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : t('mcpForm.test.failureFallback'),
      })
    } finally {
      setTesting(false)
    }
  }

  /** 提交表单 */
  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()

    const serverName = name.trim()
    if (!serverName) return

    // stdio 需要 command，http/sse 需要 url
    if (transportType === 'stdio' && !command.trim()) return
    if (transportType !== 'stdio' && !url.trim()) return

    // 警告：如果用户试图启用但测试未成功
    if (enabled && !testResult?.success) {
      console.warn('[MCP 表单] 用户试图启用未测试成功的 MCP，将强制禁用')
    }

    setSaving(true)
    try {
      // 读取现有配置
      const config = await window.electronAPI.getGlobalMcpConfig()
      const entry = buildEntry(true) // 保存时包含测试结果

      // 日志记录实际保存的状态
      console.log(`[MCP 表单] 保存 MCP: ${serverName}, enabled: ${entry.enabled}, testResult: ${testResult?.success}`)

      const newConfig: GlobalMcpConfig = {
        servers: {
          ...config.servers,
          [serverName]: entry,
        },
      }
      await window.electronAPI.saveGlobalMcpConfig(newConfig)
      onSaved()
    } catch (error) {
      console.error('[MCP 表单] 保存失败:', error)
    } finally {
      setSaving(false)
    }
  }

  // 内建 MCP 保留名（zotero / ocr / asr / paper-search）由运行时拼接，禁止用作自定义 server 名
  const trimmedName = name.trim()
  const isReservedName = (BUILTIN_MCP_RESERVED_NAMES as readonly string[]).includes(trimmedName)

  /** 判断表单是否可提交 */
  const canSubmit = (): boolean => {
    if (!trimmedName) return false
    if (isReservedName) return false
    if (transportType === 'stdio' && !command.trim()) return false
    if (transportType !== 'stdio' && !url.trim()) return false
    return true
  }

  /** 判断是否可以测试 */
  const canTest = (): boolean => {
    return canSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 标题栏 + 操作按钮（滚动时固定在顶部） */}
      <div className="sticky top-0 z-20 -mx-6 -mt-4 px-6 pt-4 pb-3 bg-muted/30 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" type="button" onClick={onCancel}>
            <ArrowLeft size={18} />
          </Button>
          <h3 className="text-lg font-medium text-foreground flex-1">
            {isEdit ? t('mcpForm.title.edit') : t('mcpForm.title.create')}
          </h3>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
              {t('mcpForm.cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={saving || !canSubmit()}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              <span>{isEdit ? t('mcpForm.saveEdit') : t('mcpForm.createServer')}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 基本信息 */}
      <SettingsSection title={t('mcpForm.section')}>
        <SettingsCard>
          <SettingsInput
            label={t('mcpForm.fields.name')}
            value={name}
            onChange={setName}
            placeholder={t('mcpForm.fields.namePlaceholder')}
            required
            disabled={isEdit}
          />
          {/* 保留名校验提示 */}
          {isReservedName && trimmedName && (
            <p className="px-4 text-sm text-destructive">
              {t('mcpForm.fields.reservedName', { name: trimmedName })}
            </p>
          )}
          <SettingsSelect
            label={t('mcpForm.fields.transportLabel')}
            value={transportType}
            onValueChange={(v) => setTransportType(v as McpTransportType)}
            options={transportOptions}
            placeholder={t('mcpForm.fields.transportPlaceholder')}
          />

          {/* stdio 专用字段 */}
          {transportType === 'stdio' && (
            <>
              <SettingsInput
                label={t('mcpForm.fields.command')}
                value={command}
                onChange={setCommand}
                placeholder={t('mcpForm.fields.commandPlaceholder')}
                required
              />
              <SettingsInput
                label={t('mcpForm.fields.args')}
                value={argsText}
                onChange={setArgsText}
                placeholder={t('mcpForm.fields.argsPlaceholder')}
                description={t('mcpForm.fields.argsDescription')}
              />
              {/* 环境变量多行输入 */}
              <div className="px-4 py-3 space-y-2">
                <div>
                  <div className={LABEL_CLASS}>{t('mcpForm.fields.env')}</div>
                  <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{t('mcpForm.fields.envDescription')}</div>
                </div>
                <textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  placeholder="GITHUB_TOKEN=ghp_xxx&#10;DEBUG=true"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                />
              </div>
              <SettingsInput
                label={t('mcpForm.fields.timeout')}
                description={t('mcpForm.fields.timeoutDescription')}
                value={timeoutStr}
                onChange={setTimeoutStr}
                placeholder="30"
                type="number"
              />
            </>
          )}

          {/* http/sse 专用字段 */}
          {transportType !== 'stdio' && (
            <>
              <SettingsInput
                label={t('mcpForm.fields.url')}
                value={url}
                onChange={setUrl}
                placeholder={t('mcpForm.fields.urlPlaceholder')}
                required
              />
              {/* 请求头多行输入 */}
              <div className="px-4 py-3 space-y-2">
                <div>
                  <div className={LABEL_CLASS}>{t('mcpForm.fields.headers')}</div>
                  <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{t('mcpForm.fields.headersDescription')}</div>
                </div>
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  placeholder="Authorization: Bearer xxx&#10;X-Custom-Header: value"
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                />
              </div>
            </>
          )}

          {/* 测试连接区域 */}
          <div className="px-4 py-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className={LABEL_CLASS}>{t('mcpForm.test.label')}</div>
                <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>
                  {t('mcpForm.test.description')}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || !canTest()}
              >
                {testing && <Loader2 size={14} className="animate-spin" />}
                <span>{testing ? t('mcpForm.test.running') : t('mcpForm.test.run')}</span>
              </Button>
            </div>

            {/* 测试结果显示 */}
            {testResult && (
              <div
                className={cn(
                  'flex items-start gap-2 px-3 py-2 rounded-md text-sm',
                  testResult.success
                    ? 'bg-success/10 text-success'
                    : 'bg-destructive/10 text-destructive'
                )}
              >
                {testResult.success ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                ) : (
                  <XCircle size={16} className="mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                  <div className="font-medium">
                    {testResult.success ? t('mcpForm.test.success') : t('mcpForm.test.failed')}
                  </div>
                  <div className="text-xs mt-0.5 opacity-90">{testResult.message}</div>
                </div>
              </div>
            )}

            {/* 未测试警告 */}
            {!testResult && !testing && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-md text-sm bg-warning/10 text-warning">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div className="text-xs">
                  {t('mcpForm.test.untested')}
                </div>
              </div>
            )}
          </div>

          {/* 启用开关 */}
          <SettingsToggle
            label={t('mcpForm.enable.label')}
            description={
              testResult?.success
                ? t('mcpForm.enable.descriptionTested')
                : t('mcpForm.enable.descriptionUntested')
            }
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!testResult?.success}
          />
        </SettingsCard>
      </SettingsSection>
    </form>
  )
}
