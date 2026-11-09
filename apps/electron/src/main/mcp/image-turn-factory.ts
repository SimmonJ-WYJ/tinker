/** 从宿主真实用户记录恢复图片任务语义；队列只在消费时推进，绝不继承旧批准。 */
import { ImageRequestAuthorization, requestsImage } from '@asci/shared'
import type { ImageAuthorizationContext } from '@asci/shared'
import { ImageTurnJournal } from './image-turn-journal.ts'
import { attachedImagePaths, readSessionImageScope } from './image-turn-context.ts'
import type { ImageTurnSnapshot } from './image-turn-controller.ts'

interface ImageUserTurn { id: string; queued: boolean; text: string; selectedImageId?: string }
function imageUserHistory(history: readonly unknown[]): ImageUserTurn[] {
 const seen = new Set<string>()
 const turns: ImageUserTurn[] = []
 for (const entry of history) {
  if (!entry || typeof entry !== 'object') continue
  const message = entry as Record<string, unknown>
  if (message.type !== 'user' || message.isSynthetic || message.isReplay || message.parent_tool_use_id !== null) continue
  const uuid = typeof message.source_uuid === 'string' ? message.source_uuid : message.uuid
  if (typeof uuid !== 'string' || seen.has(uuid)) continue
  const content = (message.message as { content?: unknown } | undefined)?.content
  if (Array.isArray(content) && content.some(block => block?.type === 'tool_result')) continue
  const text = typeof content === 'string' ? content : Array.isArray(content)
   ? content.flatMap((block: unknown) => {
    if (!block || typeof block !== 'object') return []
    const item = block as Record<string, unknown>
    return item.type === 'text' && typeof item.text === 'string' ? [item.text] : []
   }).join('\n') : ''
  if (!text) continue
  seen.add(uuid)
  const selected = (message.imageEditReference as { imageId?: unknown } | undefined)?.imageId
  turns.push({ id: uuid, queued: Boolean(message._imageQueued), text, selectedImageId: typeof selected === 'string' ? selected : undefined })
 }
 return turns
}

export function createImageTurnFactory(sessionId: string, directory: string, sessionDirectory: string, history: readonly unknown[]) {
 const journal = new ImageTurnJournal(directory)
 const turns = imageUserHistory(history)
 const userMessages = turns.map(turn => turn.text)
 let previousImageTask: boolean = false
 const context = (text: string, selectedImageId?: string) => {
  const scope = readSessionImageScope(sessionId, directory, { sessionDirectory, userMessages: [...userMessages, text], currentUserMessage: text })
  return { userMessage: text, previousImageTask, ...scope, selectedImageId }
 }
 // 历史恢复只验证一次文件集合；纯意图折叠不能逐回合重读所有图片。
 const historicalScope = readSessionImageScope(sessionId, directory, { sessionDirectory, userMessages })
 const validatedPaths = new Set(historicalScope.referenceImagePaths)
 const historicalContexts = new Map<string, ImageAuthorizationContext>()
 for (const turn of turns) {
  const scope: ImageAuthorizationContext = { ...historicalScope, userMessage: turn.text, previousImageTask, selectedImageId: turn.selectedImageId,
   hasCurrentImageAttachment: attachedImagePaths(turn.text).some(path => validatedPaths.has(path)) }
  // 历史选择只用于理解任务，失效或跨会话版本不能提供选图授权。
  if (scope.selectedImageId && !scope.referenceImageIds?.includes(scope.selectedImageId)) scope.selectedImageId = undefined
  historicalContexts.set(turn.id, scope)
  previousImageTask = turn.queued ? false : requestsImage(scope)
 }
 // 新格式以实际消费顺序为准；输入日志只证明入队，不能提供消费证明。
 const positions = new Map(turns.map((turn, index) => [turn.id, index]))
 const records = journal.records.filter(record => positions.has(record.id))
 const known = new Set(records.map(record => record.id))
 const latest = records.at(-1)
 // 普通输入缺少消费记录时是语义屏障；前缀计数保持恢复折叠线性复杂度。
 const unknownOrdinaryCounts = [0]
 for (const turn of turns) unknownOrdinaryCounts.push(unknownOrdinaryCounts.at(-1)! + (!turn.queued && !known.has(turn.id) ? 1 : 0))
 const barrier = records.filter(record => !record.queued).at(-1)
 const barrierPosition = barrier ? positions.get(barrier.id)! : -1
 if (latest) {
  previousImageTask = false
  let priorPosition = -1
  for (const record of records) {
   const position = positions.get(record.id)!
   const from = Math.min(priorPosition, position) + 1
   const to = Math.max(priorPosition, position)
   if (unknownOrdinaryCounts[to]! > unknownOrdinaryCounts[from]!) previousImageTask = false
   priorPosition = position
   const scope: ImageAuthorizationContext = { ...historicalContexts.get(record.id)!, previousImageTask }
   // 旧 false 可能只是旧识别器的漏判。只重算已消费输入；没有当时的选图/上传证据时，
   // 不借用现在才出现的图片集合恢复视觉编辑，只有明确生图或已证明任务的重试可成立。
   if (!scope.selectedImageId && !scope.hasCurrentImageAttachment) {
    scope.referenceImageIds = []; scope.referenceImagePaths = []
   }
   previousImageTask = record.imageTask || requestsImage(scope)
  }
 }
 if (!journal.readable || turns.some((turn, index) => index > barrierPosition && turn.queued && !known.has(turn.id))) previousImageTask = false
 // 其他版本新增了无消费证明的普通输入时也不能复活旧侧车状态。
 const lastKnownPosition = Math.max(-1, ...records.map(record => positions.get(record.id)!))
 if (latest && turns.some((turn, index) => index > lastKnownPosition && !turn.queued && !known.has(turn.id))) previousImageTask = false
 let created = false
 let lastAuthorization: ImageRequestAuthorization | undefined
 return (id: string, text: string, selectedImageId?: string): ImageTurnSnapshot => {
  // 读取实际上一个消费回合在运行中确立的语义，不继承其参数许可。
  if (lastAuthorization) previousImageTask = lastAuthorization.isImageTask()
  const scope = context(text, selectedImageId)
  const authorization = new ImageRequestAuthorization(scope, () => journal.confirmImageTask(id))
  lastAuthorization = authorization
  journal.record(id, authorization.isImageTask(), created)
  created = true
  previousImageTask = authorization.isImageTask()
  userMessages.push(text)
  return { id, selectedImageId, latestImageId: scope.latestImageId, authorization }
 }
}
