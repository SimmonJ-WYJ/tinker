/** 关闭与刷新共用最新状态持久化；最终 revision 检查后立即进入 native gate。 */
import { withDeadline } from './deadline.ts'
export interface LifecycleParticipant<T> {
  timeoutMs?: number
  hydrated: Promise<void>
  freeze(value: boolean): void
  drain(): Promise<void>
  capture(): T
  persist(value: T): Promise<number>
  begin(): Promise<string>
  abort(token: string): Promise<void>
  finish(token: string, revision: number): Promise<void>
  reload(): void
  failure(error: unknown): void
}
export function createLifecycle<T>(participant: LifecycleParticipant<T>) {
  let pending: Promise<void> | undefined
  let committing: { token: string; revision: number } | undefined
  async function execute(action: 'close' | 'reload') {
    participant.freeze(true)
    const deadline = performance.now() + (participant.timeoutMs ?? 8000)
    const bounded = <V>(promise: Promise<V>) => withDeadline(promise, deadline - performance.now())
    let token = committing?.token
    try {
      if (committing) {
        // 未知提交不能 reload 或重新采集；原生 close 是用户再次授权查询同一事务。
        if (action === 'close') await participant.finish(committing.token, committing.revision)
        return
      }
      await bounded(participant.hydrated)
      await bounded(participant.drain())
      if (action === 'close') token = await bounded(participant.begin())
      for (let attempt = 0; attempt < 32; attempt++) {
        const value = participant.capture()
        const revision = await bounded(participant.persist(value))
        await bounded(participant.drain())
        if (JSON.stringify(value) !== JSON.stringify(participant.capture())) continue
        // 此处到 finish 调用不再 await，避免最后采样后留下交互空窗。
        if (token) { committing = { token, revision }; await participant.finish(token, revision) }
        else participant.reload()
        return
      }
      throw new Error('flushBusy')
    } catch (error) {
      let aborted = !token
      if (token) {
        try { await withDeadline(participant.abort(token), 1000); aborted = true; committing = undefined } catch { /* native 未确认恢复，不开放交互 */ }
      }
      if (aborted) participant.freeze(false)
      participant.failure(error)
    }
  }
  return { run(action: 'close' | 'reload') { pending ??= execute(action).finally(() => { pending = undefined }); return pending } }
}
