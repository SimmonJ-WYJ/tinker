/** 供应商草稿仅保留在当前表单内存；不持久化密钥，也不自动调用网络。 */
import type { ChannelModel, ImageProtocol } from '@asci/shared'
export interface ProviderDraft {
  baseUrl: string
  apiKey: string
  models: ChannelModel[]
  supportsPdfDocumentBlock: boolean
  imageProtocol: ImageProtocol
  imageQualityPriority: number
  imageMaxReferences: number
  newModelId: string
  newModelName: string
}
/** 纯合并：整批验证通过后再更新，精确 ID 去重，不猜测模型别名。 */
export function addQuickModels(models: ChannelModel[], input: string, displayName: string): ChannelModel[] {
  const ids = [...new Set(input.trim().split(/[\s,;，；]+/).filter(Boolean))]
  if (ids.some(id => /^(sk-|Bearer$)/i.test(id))) throw new Error('apiKey')
  if (ids.length > 50 || ids.some(id => id.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9_./:@+-]*$/.test(id))) throw new Error('invalidModelIds')
  const selected = new Set(ids)
  const result = models.map(model => selected.has(model.id) ? { ...model, enabled: true, name: ids.length === 1 ? displayName.trim() || model.name : model.name } : model)
  const existing = new Set(models.map(model => model.id))
  return [...result, ...ids.filter(id => !existing.has(id)).map(id => ({ id, name: ids.length === 1 ? displayName.trim() || id : id, enabled: true }))]
}
