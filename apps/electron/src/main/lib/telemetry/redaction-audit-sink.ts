/**
 * 脱敏审计 sink（#710 P0-0 · spec §8.3 审计落盘）
 *
 * 复用 JsonlBuffer（追加/轮转/静默失败），落 ~/.asci/telemetry/redaction-audit.jsonl。
 * 只记**规则命中摘要**（route/ruleName/category/action/runId/ts），**绝不记被脱敏的 raw value**。
 * 高频出口 formatter 节流：按 (route+category) 计数，每 AUDIT_SAMPLE_EVERY 条或跨时间窗才落一条，
 * 防日志膨胀（spec §8.3：高频 formatter 只记摘要）。采样率/保留期产品化属 P1-8。
 */
import { JsonlBuffer } from './jsonl-buffer.ts'
import { nowIso, nowMs } from '@asci/shared'
import type { RedactionCategory, RedactionMatch } from '@asci/shared'

/** 审计事件（spec §8.3）：仅结构信息。 */
export interface RedactionAuditEvent {
  route: string
  ruleName: string
  category: RedactionCategory
  action: string
  runId?: string
  ts: string
}

const AUDIT_SAMPLE_EVERY = 20
const AUDIT_WINDOW_MS = 60_000

export class RedactionAuditSink {
  private readonly buffer = new JsonlBuffer('redaction-audit.jsonl')
  private readonly counts = new Map<string, number>()
  private readonly lastTs = new Map<string, number>()

  /** 记录一批命中（节流）。失败静默——审计绝不影响主功能。 */
  recordMatches(route: string, matches: readonly RedactionMatch[], runId?: string): void {
    try {
      for (const m of matches) {
        const key = `${route}::${m.category}`
        const n = (this.counts.get(key) ?? 0) + 1
        this.counts.set(key, n)
        const last = this.lastTs.get(key) ?? 0
        const now = nowMs()
        // 每 AUDIT_SAMPLE_EVERY 条的第一条 或 跨时间窗 才落盘（聚合摘要）
        if (n % AUDIT_SAMPLE_EVERY === 1 || now - last >= AUDIT_WINDOW_MS) {
          this.lastTs.set(key, now)
          const event: RedactionAuditEvent = {
            route,
            ruleName: m.ruleName,
            category: m.category,
            action: m.action,
            runId,
            ts: nowIso(),
          }
          this.buffer.append(event)
        }
      }
    } catch {
      // 审计绝不影响主功能
    }
  }
}

let singleton: RedactionAuditSink | undefined
export function getRedactionAuditSink(): RedactionAuditSink {
  return (singleton ??= new RedactionAuditSink())
}
