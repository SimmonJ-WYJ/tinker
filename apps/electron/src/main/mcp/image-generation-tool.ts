/** 宿主生图工具：真实参考图、持久版本记录和显式协议，不暴露密钥。 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { bindImageEditSelection } from './image-edit-selection.ts'
import { buildImageRequestBody } from './image-request-body.ts'
import { ImageRequestLedger } from './image-request-ledger.ts'
import { ImageExecutionGuard } from './image-execution-guard.ts'
import type { ImageExecutionOptions } from './image-execution-guard.ts'
import type { ImageTurnSnapshot } from './image-turn-controller.ts'
import { basename, isAbsolute, join } from 'node:path'
import { readImageReferences } from './image-reference.ts'
import { ImageAssets } from './image-assets.ts'
import { selectImageModel } from './image-routing.ts'
import { getConversationAttachmentsDir } from '../lib/config-paths.ts'
import { normalizeOpenAIBaseUrl, parseGeneratedImage, buildGeminiImageRequest, parseGeminiImage } from '@asci/core'
import { listChannels, decryptApiKey } from '../lib/channel-manager.ts'
import { getFetchFn } from '../lib/proxy-fetch.ts'
import { getEffectiveProxyUrl } from '../lib/proxy-settings-service.ts'

export function createImageGenerationMcpServer(sessionId: string, sessionDirectory?: string, runId: string = randomUUID(), selectedImageId?: string, executionOptions: ImageExecutionOptions & { getTurn?: () => ImageTurnSnapshot; latestImageId?: string; onImageSaved?: (id: string, paths: string[]) => void } = {}) {
  const channels = listChannels().filter(channel => channel.enabled && channel.provider === 'custom-image')
  const choices = channels.flatMap(channel => channel.models.filter(model => model.enabled).map(model => ({ channelId: channel.id, channelName: channel.name, model: model.id, maxReferences: channel.capabilities?.imageMaxReferences, quality: channel.capabilities?.imageQualityPriority })))
  if (!choices.length) return undefined
  const directory = getConversationAttachmentsDir(sessionId)
  const assets = new ImageAssets(directory)
  const executionContexts = new Map<string, {guard:ImageExecutionGuard;requests:ImageRequestLedger;selectedImageId?:string;latestImageId?:string;onImageSaved?: (id:string,paths:string[])=>void}>()
  const getExecutionContext = () => {
    const turn=executionOptions.getTurn?.()
    const id=turn?.id ?? runId
    let context=executionContexts.get(id)
    if(!context) {
      context={
        guard:new ImageExecutionGuard({...executionOptions,authorization:turn?.authorization ?? executionOptions.authorization}),
        requests:new ImageRequestLedger(directory,id),
        selectedImageId:turn ? turn.selectedImageId : selectedImageId,
        latestImageId:turn?.latestImageId ?? executionOptions.latestImageId ?? assets.list().filter(asset=>asset.available).at(-1)?.id,
        onImageSaved:turn ? (imageId,paths)=>turn.authorization.addReference(imageId,paths) : executionOptions.onImageSaved,
      }
      executionContexts.set(id,context)
    }
    return context
  }
  const roots = [...(sessionDirectory ? [sessionDirectory] : []), directory]
  const resolvePath = (path: string): string => {
    if (isAbsolute(path)) return path
    // 兼容旧工具返回的会话相对附件路径；不接受其他会话的路径。
    if (path.startsWith(`${sessionId}/`) && basename(path) === path.slice(sessionId.length + 1)) return join(directory, basename(path))
    throw new Error('Reference path must belong to this session')
  }
  let busy = false
  return createSdkMcpServer({ name: 'asci-image', version: '1.1.0', tools: [
    tool('list_images', 'List generated images in this session, including stable IDs, model/channel and original prompts. Use before continuing an earlier edit; never ask for re-upload while an asset is available.', {}, async () => ({content:[{type:'text' as const,text:JSON.stringify({images:assets.list(),warnings:assets.warnings()})}]})),
    tool('inspect_image', 'View a generated image by stable imageId (or latest) for visual verification. This does not generate an image or incur an image API call.', {imageId:z.string()}, async ({imageId}) => {
      try {
        const [image] = readImageReferences([assets.path(imageId)], roots)
        return {content:[{type:'image' as const,data:Buffer.from(image!.bytes).toString('base64'),mimeType:image!.mime}]}
      } catch(error) {return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:'Image not found'}]}}
    }),
    tool('generate_image', `Generate ONE image only for an explicit user request. Paid API; never retry automatically. When the current user selects a base image, use that exact version and no other base. Available selections: ${JSON.stringify(choices)}.
For edits, set baseImageId to the exact stable ID from list_images. If no version is explicitly selected, latest resolves to the last available image at the start of this user turn; it never follows newly generated results. This automatically supplies the base image and retains its model/channel unless the user explicitly requests another. Use referenceImagePaths for attached original images in order, never describe missing references from memory. Reference order: baseImageId first, followed by referenceImageIds, then referenceImagePaths. Exact model IDs must match; do not substitute. For a complex composition or multi-reference task set complex=true. Automatic ranking uses configured quality preference, not a guarantee of model identity or quality.
Prompt must preserve the user's language and all invariant constraints, including pose, composition, identity, style and anatomy when specified. State each reference's role explicitly. Do not invent a new style. After success inspect_image to verify the result before claiming constraints met. UI renders generatedImage automatically: DO NOT emit markdown image links, raw filesystem links or duplicate attachments. Return a concise truthful summary only; do not claim perfect fidelity.`, {
      prompt: z.string().min(1).max(12000),
      channelId: z.string().optional(), model: z.string().optional(), complex:z.boolean().optional(),
      baseImageId:z.string().optional(), referenceImageIds:z.array(z.string()).max(3).optional(),
      referenceImagePaths: z.array(z.string().min(1)).max(4).optional(),
    }, async (input, extra) => {
      if (busy) return { isError: true, content: [{ type: 'text' as const, text: 'An image request is already running. Do not submit another.' }] }
      busy = true
      let key = ''
      const signal = extra && typeof extra === 'object' && 'signal' in extra && extra.signal instanceof AbortSignal ? extra.signal : undefined
      try {
        // 捕获本次调用的不可变回合，后续 await 期间也不能继承新用户消息的授权。
        const { guard, requests, selectedImageId: selected, latestImageId, onImageSaved } = getExecutionContext()
        const resolveId = (id: string): string => {
          if (id !== 'latest') return id
          if (!latestImageId) throw new Error('No image was available at the start of this user turn; use list_images for a stable image ID')
          return latestImageId
        }
        guard.assertAllowed(input, signal)
        assets.assertWritable()
        const requestedBase = bindImageEditSelection(selected, input.baseImageId)
        const baseImageId = requestedBase ? resolveId(requestedBase) : undefined
        const parent = baseImageId ? assets.get(baseImageId) : undefined
        const ids = [...new Set([...(parent ? [parent.id] : []), ...(input.referenceImageIds ?? []).map(resolveId)])]
        const paths = [...ids.map(id=>assets.path(id)), ...(input.referenceImagePaths ?? []).map(resolvePath)]
        const references = readImageReferences(paths, roots)
        const choice = selectImageModel(choices, {...input, parent, referenceCount:references.length})
        const channel = channels.find(item => item.id === choice.channelId)!
        const fingerprint = createHash('sha256').update(JSON.stringify([choice.channelId, choice.model, input.prompt, references.map(reference => createHash('sha256').update(reference.bytes).digest('hex'))])).digest('hex')
        const result = await guard.run(input, fingerprint, () => requests.run(fingerprint, async () => {
        guard.assertAllowed(input, signal)
        key = decryptApiKey(channel.id)
        const protocol = channel.capabilities?.imageProtocol ?? 'openai-images'
        const gemini = protocol === 'openai-images' ? undefined : buildGeminiImageRequest(channel.baseUrl,key,choice.model,input.prompt,references.map(ref=>({mime:ref.mime,data:Buffer.from(ref.bytes).toString('base64')})),protocol)
        const fetch = getFetchFn(await getEffectiveProxyUrl())
        guard.assertAllowed(input, signal)
        const response = await fetch(gemini?.url ?? `${normalizeOpenAIBaseUrl(channel.baseUrl)}/images/${references.length ? 'edits' : 'generations'}`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(180_000)]),
          headers: gemini?.headers ?? { ...(references.length ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${key}` },
          body: buildImageRequestBody({ model: choice.model, prompt: input.prompt, references, geminiBody: gemini?.body }),
        })
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Empty image response')
        const chunks: Uint8Array[] = []; let length = 0
        try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 30_000_000) throw new Error('Image response exceeds 30 MB'); chunks.push(part.value) } }
        finally { await reader.cancel().catch(() => {}) }
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!response.ok) {
          let detail = ''
          try { detail = String((JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? '') } catch { /* 不展示 HTML */ }
          throw new Error(`Image API HTTP ${response.status}: ${(key ? detail.split(key).join('[redacted]') : detail).slice(0, 300)}`)
        }
        const image = gemini ? parseGeminiImage(JSON.parse(raw)) : parseGeneratedImage(JSON.parse(raw))
        const extension = image.mimeType.split('/')[1]
        const { saveAttachment } = await import('../lib/attachment-service.ts')
        const { attachment } = saveAttachment({ conversationId: sessionId, filename: `generated.${extension}`, mediaType: image.mimeType, data: image.data })
        assets.add({id:attachment.id,filename:basename(attachment.localPath),model:choice.model,channelId:channel.id,prompt:input.prompt,referenceIds:ids,baseImageId:parent?.id})
        return JSON.stringify({ model: choice.model, channelName:channel.name, channelId:channel.id, protocol, referenceCount:references.length, imageId:attachment.id, baseImageId:parent?.id, generatedImage: attachment })
        }), signal)
        const saved = JSON.parse(result) as { imageId: string }
        const savedPath = assets.path(saved.imageId)
        readImageReferences([savedPath], [directory])
        onImageSaved?.(saved.imageId, [savedPath, `${sessionId}/${basename(savedPath)}`])
        return { content: [{ type: 'text' as const, text: result }] }
      } catch (error) {
        const message=error instanceof Error ? error.message : 'Image generation failed'
        return { isError: true, content: [{ type: 'text' as const, text: key ? message.split(key).join('[redacted]') : message }] }
      } finally { busy = false }
    }),
  ] })
}
