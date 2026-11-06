/**
 * createBatchedSpansSink — debounced in-memory cache + batched flush（Phase 2 TODO #3）。
 *
 * 替代 Phase 1 的"每次 hook 4 次磁盘 I/O"实现：
 * - append / update 仅操作 in-memory cache
 * - cache 变更触发 debounced flush（500ms 合并多次 mutation 成一次 write）
 * - flush 完成后 cache 清空，避免下次 flush 重复落盘同一批 spans
 *
 * **风险**：debounce 窗口内进程崩溃会丢失最近 spans。0.2 dogfood 阶段可接受；
 * 0.3 telemetry consumer 接入时考虑 durable write。
 *
 * **update 路径**：
 * - 如果 span 还在 cache 内（未 flush）→ 直接改 cache，并 schedule 下一次 flush
 * - 如果 span 已经 flush 到磁盘 → 走 storage.read + write 改已落盘 spans（直接 I/O，无 cache 加速；这是 stop 比 start 晚很多 dispatch 的边界情况）
 */
import type { SubagentSpan, AgentSessionMeta } from '@asci/shared'
import type { SpanSink } from './subagent-spans-hook.ts'

const DEBOUNCE_MS = 500

export interface SpansSinkStorage {
  /** 读 session meta；返回 null 表示 session 不存在 */
  read(sessionId: string): AgentSessionMeta | null
  /** 写回 session meta 的 subagentSpans 字段（完全替换） */
  write(sessionId: string, spans: SubagentSpan[]): void
}

export interface BatchedSpansSink extends SpanSink {
  /** 显式 flush — 在 session 结束 / orchestrator cleanup 路径调用，保兜底落盘 */
  flush(): void
}

export function createBatchedSpansSink(storage: SpansSinkStorage): BatchedSpansSink {
  /** Per-session 待 flush 的"增量" spans 队列 */
  const cache = new Map<string, SubagentSpan[]>()
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleFlush = (): void => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = setTimeout(flush, DEBOUNCE_MS)
  }

  const flush = (): void => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    for (const [sessionId, pendingSpans] of cache.entries()) {
      const meta = storage.read(sessionId)
      if (!meta) {
        console.warn('[BatchedSpansSink] session not found at flush, dropped:', sessionId)
        continue
      }
      const existing = meta.subagentSpans ?? []
      storage.write(sessionId, [...existing, ...pendingSpans])
    }
    cache.clear()
  }

  return {
    append(sessionId, span) {
      const arr = cache.get(sessionId) ?? []
      arr.push(span)
      cache.set(sessionId, arr)
      scheduleFlush()
    },
    update(sessionId, predicate, patch) {
      const inCache = cache.get(sessionId) ?? []
      const idx = inCache.findIndex(predicate)
      if (idx >= 0) {
        // span 还在 cache 里 → 直接改 cache
        // patch 是 Partial<SubagentSpan>，与已有 span 合并后必含必需字段，断言类型安全
        inCache[idx] = { ...inCache[idx], ...patch } as SubagentSpan
        cache.set(sessionId, inCache)
        scheduleFlush()
        return
      }
      // cache 里没找到 → 改已落盘 spans
      const meta = storage.read(sessionId)
      if (!meta) {
        console.warn('[BatchedSpansSink] update target not found:', sessionId)
        return
      }
      const existing = meta.subagentSpans ?? []
      const mapped = existing.map((s) => predicate(s) ? { ...s, ...patch } : s)
      storage.write(sessionId, mapped)
    },
    flush,
  }
}
