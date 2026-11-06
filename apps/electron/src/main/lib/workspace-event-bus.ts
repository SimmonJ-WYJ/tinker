/**
 * WorkspaceEventBus — 工作区对象生命周期事件总线（spec §3）
 *
 * 对照 AgentEventBus（SDK streaming 事件）—— 本总线服务于 5 大对象 CRUD +
 * 能力包场景收口共 9 事件。0.2 阶段无运行时订阅者，仅落 emit 框架；0.3
 * ProposalDispatcher 直接 `on(...)` 接入即可。
 *
 * 设计取舍：
 *   - 模块级单例（`workspaceEventBus`）—— Repository 内联 emit 不需要参数注入
 *   - 同步 emit —— spec §3.3 明确禁止 async；订阅者错误内吞，不阻塞调用方
 *   - 无中间件 —— 0.2 无 speaker / scoped 等增量逻辑，加上反而模糊语义
 *   - emit 出错 swallow + console.error —— Repository 内部 emit 不能拖垮 CRUD 事务
 *
 * 测试隔离：在测试里订阅 emit 后必须 dispose 或 off，避免泄漏到下一个测试。
 * 提供 `__resetForTests()` 一次性清空所有订阅。
 */

import type { WorkspaceEvent, WorkspaceEventKind } from '@asci/shared'

export type WorkspaceEventHandler<E extends WorkspaceEvent = WorkspaceEvent> = (
  event: E,
) => void

export class WorkspaceEventBus {
  /** 全量监听器：接收所有 kind 的事件 */
  private handlers: Set<WorkspaceEventHandler> = new Set()
  /** 按 kind 过滤的监听器；性能优化兼语义清晰 */
  private kindHandlers: Map<WorkspaceEventKind, Set<WorkspaceEventHandler>> = new Map()

  /**
   * 同步 emit 事件。
   *
   * 任意监听器抛错时 swallow + console.error，不影响其他监听器与调用方事务。
   */
  emit(event: WorkspaceEvent): void {
    for (const handler of this.handlers) {
      try {
        handler(event)
      } catch (error) {
        console.error(`[WorkspaceEventBus] handler 错误 (kind=${event.kind}):`, error)
      }
    }
    const kindSet = this.kindHandlers.get(event.kind)
    if (kindSet) {
      for (const handler of kindSet) {
        try {
          handler(event)
        } catch (error) {
          console.error(`[WorkspaceEventBus] kind handler 错误 (kind=${event.kind}):`, error)
        }
      }
    }
  }

  /**
   * 监听全部 kind 或指定 kind。
   *
   * @param kindOrHandler 字面量 kind 字符串（仅匹配该 kind）或 handler（匹配全部）
   * @param handler kind 模式下传入实际 handler
   * @returns 取消监听函数
   */
  on(handler: WorkspaceEventHandler): () => void
  on<K extends WorkspaceEventKind>(
    kind: K,
    handler: WorkspaceEventHandler<Extract<WorkspaceEvent, { kind: K }>>,
  ): () => void
  on(
    kindOrHandler: WorkspaceEventKind | WorkspaceEventHandler,
    handler?: WorkspaceEventHandler,
  ): () => void {
    if (typeof kindOrHandler === 'function') {
      this.handlers.add(kindOrHandler)
      return () => {
        this.handlers.delete(kindOrHandler)
      }
    }
    if (!handler) {
      throw new Error('[WorkspaceEventBus] on(kind, handler) handler 不可缺')
    }
    const set = this.kindHandlers.get(kindOrHandler) ?? new Set()
    set.add(handler)
    this.kindHandlers.set(kindOrHandler, set)
    return () => {
      set.delete(handler)
    }
  }

  /** 清除全部监听器（用于测试隔离） */
  dispose(): void {
    this.handlers.clear()
    this.kindHandlers.clear()
  }
}

/**
 * 模块级单例。Repository emit 内联调用此实例；订阅者 import 同一个对象。
 *
 * 测试侧通过 `workspaceEventBus.dispose()` 清场，避免跨测试泄漏。
 */
export const workspaceEventBus: WorkspaceEventBus = new WorkspaceEventBus()
