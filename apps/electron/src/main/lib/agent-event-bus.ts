/**
 * AgentEventBus — Agent 事件总线
 *
 * 统一的事件分发中心，支持中间件链扩展。
 *
 * 核心方法：
 * - emit(sessionId, payload): 发射事件，经过中间件链后分发给所有监听器
 * - on(handler): 注册事件监听器，返回取消函数
 * - use(middleware): 注册中间件（事件经过中间件链后再分发）
 *
 * 中间件可通过 next(sessionId?, enrichedPayload?) 向后传递修改后的数据。
 * 若不传参，则沿用当前 sessionId 与 payload。（A4 phase4：支持 speaker 元数据注入）
 */

import type { AgentStreamPayload } from '@asci/shared'

/** 事件监听器 */
export type AgentEventHandler = (sessionId: string, payload: AgentStreamPayload) => void

/**
 * 中间件：可修改事件或执行副作用，调用 next() 继续链路。
 *
 * next 可接收可选的 (sessionId, payload) 覆盖参数，用于在中间件内注入/变换 payload
 * （例如：speaker 转换中间件注入 asci_metadata.speaker 后传给后续中间件和 IPC 转发层）。
 */
export type AgentEventMiddleware = (
  sessionId: string,
  payload: AgentStreamPayload,
  next: (nextSessionId?: string, nextPayload?: AgentStreamPayload) => void,
) => void

export class AgentEventBus {
  private handlers: Set<AgentEventHandler> = new Set()
  private middlewares: AgentEventMiddleware[] = []

  /**
   * 发射事件
   *
   * 事件依次经过中间件链，最终分发给所有监听器。
   * 中间件可以通过不调用 next() 来拦截事件，也可通过 next(sid, enriched) 传递变换后的 payload。
   */
  emit(sessionId: string, payload: AgentStreamPayload): void {
    const dispatch = (sid: string, pl: AgentStreamPayload): void => {
      for (const handler of this.handlers) {
        try {
          handler(sid, pl)
        } catch (error) {
          console.error(`[AgentEventBus] 事件处理器错误:`, error)
        }
      }
    }

    if (this.middlewares.length === 0) {
      dispatch(sessionId, payload)
      return
    }

    // 构建中间件链：递归方式让每层中间件收到上层传入（或默认）的 sid/payload
    const runMiddleware = (index: number, sid: string, pl: AgentStreamPayload): void => {
      if (index >= this.middlewares.length) {
        dispatch(sid, pl)
        return
      }

      const mw = this.middlewares[index]!
      const next = (nextSid?: string, nextPayload?: AgentStreamPayload): void => {
        // 若中间件未传参则沿用当前值，支持透传或变换两种用法
        runMiddleware(index + 1, nextSid ?? sid, nextPayload ?? pl)
      }

      try {
        mw(sid, pl, next)
      } catch (error) {
        console.error(`[AgentEventBus] 中间件错误:`, error)
        // 出错时继续传播（不拦截后续链路）
        next()
      }
    }

    try {
      runMiddleware(0, sessionId, payload)
    } catch (error) {
      console.error(`[AgentEventBus] 事件分发错误:`, error)
    }
  }

  /** 注册事件监听器，返回取消注册函数 */
  on(handler: AgentEventHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  /** 注册中间件（按注册顺序执行） */
  use(middleware: AgentEventMiddleware): void {
    this.middlewares.push(middleware)
  }

  /** 移除所有监听器和中间件 */
  dispose(): void {
    this.handlers.clear()
    this.middlewares = []
  }
}
