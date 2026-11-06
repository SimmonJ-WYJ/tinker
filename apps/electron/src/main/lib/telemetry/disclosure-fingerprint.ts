/**
 * Prompt/内容指纹与字节计量（#710 P0-0 · spec §9 minimal fingerprint helper）
 *
 * 唯一 hash/bytes 生成入口：shared/redact.ts 刻意不引 node:crypto（保持同步纯函数、不污染 Sentry
 * beforeSend 同步路径），故所有 hash 在 main 侧由本文件生成，再传给 shared 的 formatPromptPlaceholder /
 * formatRedactionPlaceholder。泛化自 zotero-article-generator/prompt.ts 的 PROMPT_VERSION 正例。
 * P0 只做 minimal helper；完整 prompt registry（owner/label/canary/rollback）属 P1。
 */
import { createHash } from 'node:crypto'
import type { RedactionMatch } from '@asci/shared'

/** prompt 源指纹（spec §9）。第三方/debug/导出只引用这些字段，绝不引 prompt body。 */
export interface PromptFingerprint {
  promptId: string
  version: string
  hash: string
  configFingerprint?: string
}

/** sha256 全长 hex（截断交给 shared 的 formatPromptPlaceholder 取前 16）。 */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

/** UTF-8 字节数（统计用，不含内容）。 */
export function byteLengthOf(input: string): number {
  return Buffer.byteLength(input, 'utf-8')
}

/** 计算 prompt 指纹；version 接受 string|number（PROMPT_VERSION 数字 → String）。 */
export function computePromptFingerprint(input: {
  promptId: string
  version: string | number
  body: string
  config?: unknown
}): PromptFingerprint {
  return {
    promptId: input.promptId,
    version: String(input.version),
    hash: sha256Hex(input.body),
    configFingerprint: input.config === undefined ? undefined : sha256Hex(JSON.stringify(input.config)).slice(0, 16),
  }
}

/** 出口 formatter 的统一返回（spec §8.3）：脱敏值 + hash/bytes + 命中记录。 */
export interface DisclosureFormatted<T> {
  value: T
  hash?: string
  bytes?: number
  redactionMatches: RedactionMatch[]
}
