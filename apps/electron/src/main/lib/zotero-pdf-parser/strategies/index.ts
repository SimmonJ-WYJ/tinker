/**
 * PDF 解析策略适配层（wiki/{key}.md 链路）
 *
 * 已实装：
 * - lite —— pdf-parse 抽 plain text + 简单 markdown 包装（默认且唯一在队列里跑的）
 *
 * 注意：`structured` 是一个独立的、手动触发的 .txt 链路（见
 * `lib/zotero-structured-txt/`），**不**通过本 worker 队列，因此 STRATEGIES 字典
 * 故意只放 lite。`ZoteroPdfParseStrategy` 类型保留 'structured' 仅为兼容旧 snapshot；
 * 命中 'structured' 时 fallback 到 lite 并 warn。
 */

import type { ZoteroPdfActualStrategy, ZoteroPdfParseStrategy, ZoteroPdfRecord } from '@asci/shared'
import { liteStrategy } from './lite'

export interface ParseResult {
  body: string
  actualStrategy: ZoteroPdfActualStrategy
}

export interface ParseStrategy {
  name: ZoteroPdfParseStrategy
  parse(input: { rec: ZoteroPdfRecord; pdfPath: string }): Promise<ParseResult>
}

const STRATEGIES: Partial<Record<ZoteroPdfParseStrategy, ParseStrategy>> = {
  lite: liteStrategy,
  // structured: 走独立 .txt 链路，故意不注册到 worker 队列
}

export function selectStrategy(name: ZoteroPdfParseStrategy): ParseStrategy {
  const found = STRATEGIES[name]
  if (found) return found
  console.warn(`[Zotero PDF Parser] 策略 '${name}' 不在 worker 队列内（structured 走独立链路），回退到 lite`)
  return liteStrategy
}
