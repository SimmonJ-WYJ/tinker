/** 宿主消费顺序与单调任务确认；不保存提示词、图片、密钥或请求批准。 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
interface ImageTurnRecord { id: string; imageTask: boolean; queued: boolean }
interface ImageTaskConfirmation { kind: 'image-task-confirmed'; id: string }
export class ImageTurnJournal {
  readonly records: ImageTurnRecord[] = []
  readonly path: string
  readable = true
  constructor(directory: string) {
    this.path = join(directory, '.image-consumed-turns.jsonl')
    try {
      if (!existsSync(this.path)) return
      for (const line of readFileSync(this.path, 'utf8').split('\n').filter(Boolean)) {
        try {
          this.restore(JSON.parse(line)); this.readable = true
        } catch { this.readable = false; this.records.length = 0 }
      }
    } catch { this.readable = false }
  }
  private restore(record: unknown): void {
    if (!record || typeof record !== 'object') throw new Error('Invalid image turn record')
    const item = record as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id) throw new Error('Invalid image turn identity')
    if (item.kind === 'image-task-confirmed') {
      if (Object.keys(item).some(key => key !== 'id' && key !== 'kind')) throw new Error('Invalid image task confirmation')
      const consumed = this.records.findLast(entry => entry.id === item.id)
      if (!consumed) throw new Error('Image task confirmation has no consumed turn')
      consumed.imageTask = true
      return
    }
    if (item.kind !== undefined || typeof item.imageTask !== 'boolean' || typeof item.queued !== 'boolean') throw new Error('Invalid image turn record')
    this.records.push({ id: item.id, imageTask: item.imageTask, queued: item.queued })
  }
  private append(record: ImageTurnRecord | ImageTaskConfirmation): boolean {
    try {
      appendFileSync(this.path, `\n${JSON.stringify(record)}\n`, { mode: 0o600 })
      return true
    } catch {
      // 写入不确定时不制造消费/确认事实；重启恢复必须保守。
      this.readable = false; this.records.length = 0
      return false
    }
  }
  record(id: string, imageTask: boolean, queued: boolean): void {
    const record = { id, imageTask, queued }
    if (this.append(record)) this.records.push(record)
  }
  confirmImageTask(id: string): void {
    const consumed = this.records.findLast(entry => entry.id === id)
    if (!consumed || consumed.imageTask) return
    if (this.append({ kind: 'image-task-confirmed', id })) consumed.imageTask = true
  }
}
