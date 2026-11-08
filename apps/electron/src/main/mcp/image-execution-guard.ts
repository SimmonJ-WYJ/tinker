/** 实际生成边界与权限回调复用同一个用户回合授权。 */
import { IMAGE_GENERATION_TOOL, imageRequestKey } from '@asci/shared'
import type { ImageAuthorization } from '@asci/shared'
export interface ImageExecutionOptions {
 authorization?: ImageAuthorization
 isExecutionAllowed?: () => boolean
}
export class ImageExecutionGuard {
 private readonly fingerprints = new Map<string, string>()
 constructor(private readonly options: ImageExecutionOptions = {}) {}
 assertAllowed(input: Record<string, unknown>, signal?: AbortSignal): void {
  if (signal?.aborted || this.options.isExecutionAllowed?.() === false) throw new Error('Image generation is unavailable in plan mode or an ended turn')
  if (!this.options.authorization) throw new Error('Image generation requires current-turn authorization')
  const decision=this.options.authorization.authorize(IMAGE_GENERATION_TOOL,input)
  if(decision.action!=='allow') throw new Error(decision.reason)
 }
 async run<T>(input: Record<string, unknown>, fingerprint: string, generate: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  this.assertAllowed(input,signal)
  const key=imageRequestKey(input)
  const previous=this.fingerprints.get(key)
  if(previous!==undefined && previous!==fingerprint) throw new Error('Image request references or model changed; do not retry automatically')
  this.fingerprints.set(key,fingerprint)
  return generate()
 }
}
