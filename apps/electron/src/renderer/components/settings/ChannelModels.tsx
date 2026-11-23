/** 模型清单与手动模型输入；自定义渠道可先填模型再测试。 */
import type * as React from 'react'
import { Plus, ChevronUp, ChevronDown, Loader2, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import type { ChannelModel, ChannelTestResult, FetchModelsResult } from '@asci/shared'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
interface Props {
  models: ChannelModel[]
  onRouteChange?: (model: ChannelModel, route: string) => void
  isCustom: boolean
  isEdit: boolean
  testResult: ChannelTestResult | null
  fetchResult: FetchModelsResult | null
  fetchingModels: boolean
  baseUrl: string
  apiKey: string
  hasUsableKey?: boolean
  locked?: boolean
  enabledModelCount: number
  handleFetchModels: () => Promise<void>
  handleToggleModel: (id: string) => void
  showCustomInput: boolean
  setShowCustomInput: React.Dispatch<React.SetStateAction<boolean>>
  addModelError: string | null
  setAddModelError: (value: string | null) => void
  newModelId: string
  setNewModelId: (value: string) => void
  newModelName: string
  setNewModelName: (value: string) => void
  handleAddModel: () => void
}
export function ChannelModels({ models, onRouteChange, isCustom, isEdit, testResult, fetchResult, fetchingModels, baseUrl, apiKey, hasUsableKey, locked, enabledModelCount, handleFetchModels, handleToggleModel, showCustomInput, setShowCustomInput, addModelError, setAddModelError, newModelId, setNewModelId, newModelName, setNewModelName, handleAddModel }: Props): React.ReactElement {
  const { t } = useT('settings')
const testPassed = testResult?.success === true
const modelsEditable = !locked && (testPassed || isCustom)
const lockTooltip = modelsEditable ? undefined : t('channelForm.models.lockedNeedTest')
return (
  <div
    className={cn(
      'space-y-2.5 transition-opacity',
      !modelsEditable && 'opacity-50 pointer-events-none select-none',
    )}
    aria-disabled={!modelsEditable}
    title={lockTooltip}
  >
    <div className="flex items-center justify-between">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground">{t('channelForm.section.models')}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {models.length > 0
            ? t('channelForm.section.modelsDescription', { enabled: enabledModelCount, total: models.length })
            : modelsEditable
              ? t('channelForm.models.emptyHint')
              : t('channelForm.models.lockedNeedTest')}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={handleFetchModels}
        disabled={fetchingModels || !modelsEditable || !baseUrl.trim() || !(hasUsableKey ?? Boolean(apiKey.trim()))}
        title={lockTooltip}
        className="h-8 border border-border/80 bg-background text-xs hover:bg-muted"
      >
        {fetchingModels ? (
          <Loader2 size={14} className="animate-spin !size-3.5" />
        ) : (
          <RefreshCw size={14} className="!size-3.5" />
        )}
        <span>{t('channelForm.models.fetch')}</span>
      </Button>
    </div>

    {/* 拉取结果提示 —— 仅在测试通过后才展示，避免测试失败时与 testResult 重复报错 */}
    {modelsEditable && fetchResult && (
      <div className={cn(
        'flex items-center gap-1.5 text-xs',
        fetchResult.success ? 'text-success' : 'text-destructive'
      )}>
        {fetchResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
        <span>{fetchResult.message}</span>
      </div>
    )}

    {/* 新建模式：模型未就绪的统一 amber 警告（仅在已通过测试但仍未启用模型时显示，避免与 lockedNeedTest 重复） */}
    {!isEdit && testPassed && enabledModelCount === 0 && (
      <div className="flex items-center gap-1.5 text-xs text-warning">
        <AlertTriangle size={12} className="flex-shrink-0" />
        <span>
          {models.length === 0
            ? t('channelForm.models.requiredWarning')
            : t('channelForm.models.noEnabledWarning')}
        </span>
      </div>
    )}

    {models.length > 0 && (
      <ScrollArea className={models.length > 8 ? 'h-[320px]' : undefined}>
        <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border/80">
          {models.map((model) => (
            <div
              key={model.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-foreground">{model.name}</div>
                {model.name !== model.id && (
                  <div className="truncate text-xs text-muted-foreground">{model.id}</div>
                )}
              </div>
              {onRouteChange && model.capability !== 'unsupported' && <select
                aria-label={t('channelForm.models.usageLabel', {name:model.name})}
                value={model.capability === 'image' ? model.supportsImageEdits ? 'edit' : 'image' : 'text'}
                disabled={!modelsEditable}
                className="max-w-36 rounded border border-input bg-background px-1 py-1 text-xs"
                onChange={event => onRouteChange(model, event.target.value)}>
                <option value="text">{t('channelForm.models.text')}</option>
                <option value="image">{t('channelForm.models.image')}</option>
                <option value="edit">{t('channelForm.models.edit')}</option>
              </select>}
              {model.capability === 'unsupported' && <span className="text-xs text-muted-foreground">{t('channelForm.models.unsupported')}</span>}
              <Switch
                className="settings-channel-switch"
                checked={model.enabled && model.capability !== 'unsupported'}
                onCheckedChange={() => handleToggleModel(model.id)}
                disabled={!modelsEditable || model.capability === 'unsupported'}
                aria-disabled={!modelsEditable || model.capability === 'unsupported'}
                aria-label={model.name}
              />
            </div>
          ))}
        </div>
      </ScrollArea>
    )}

    {/* 自定义模型输入区 —— 低频功能，默认折叠；测试未通过时整块禁用 */}
    <div className="pt-1">
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          if (showCustomInput) {
            setAddModelError(null)
            setNewModelId('')
            setNewModelName('')
          }
          setShowCustomInput((v) => !v)
        }}
        disabled={!modelsEditable}
        title={lockTooltip}
        className="flex h-auto w-full items-center justify-between p-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:text-muted-foreground [&_svg]:size-3.5"
        aria-expanded={showCustomInput}
      >
        <span className="flex items-center gap-1.5">
          <Plus size={12} />
          <span>{t('channelForm.models.customSection')}</span>
        </span>
        {showCustomInput ? (
          <ChevronUp size={14} className="flex-shrink-0" />
        ) : (
          <ChevronDown size={14} className="flex-shrink-0" />
        )}
      </Button>
      {showCustomInput && modelsEditable && (
        <div className="space-y-2 pt-2">
          <div className="text-xs text-muted-foreground">{t('channelForm.models.customSectionHint')}</div>
          <div className="flex items-center gap-2">
            <Input
              value={newModelId}
              disabled={locked}
              onChange={(e) => { setNewModelId(e.target.value); setAddModelError(null) }}
              placeholder={t('channelForm.models.modelIdPlaceholder')}
              className={cn('flex-1 h-8 text-sm', addModelError && 'border-destructive')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddModel()
                }
              }}
            />
            <Input
              value={newModelName}
              disabled={locked}
              onChange={(e) => setNewModelName(e.target.value)}
              placeholder={t('channelForm.models.modelNamePlaceholder')}
              className="flex-1 h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddModel()
                }
              }}
            />
            <Button
              variant={newModelId.trim() ? 'default' : 'ghost'}
              size="sm"
              type="button"
              onClick={handleAddModel}
              disabled={!newModelId.trim()}
              className="h-8 px-3 flex-shrink-0"
              title={!newModelId.trim() ? t('channelForm.models.addNeedId') : undefined}
            >
              <Plus size={14} className="!size-3.5" />
              <span>{t('channelForm.models.addButton')}</span>
            </Button>
          </div>
          {addModelError && (
            <p className="text-xs text-destructive">{addModelError}</p>
          )}
        </div>
      )}
    </div>
  </div>
)
}
