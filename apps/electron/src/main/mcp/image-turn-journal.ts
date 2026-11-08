/** 仅记录宿主实际进入的用户回合类别和顺序，不保存提示词、图片或密钥。 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
interface ImageTurnRecord { id: string; imageTask: boolean; queued: boolean }
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
     const record: unknown = JSON.parse(line)
     if (!record || typeof record !== 'object') throw new Error('Invalid image turn record')
     const item = record as Record<string, unknown>
     if (typeof item.id !== 'string' || typeof item.imageTask !== 'boolean' || typeof item.queued !== 'boolean') throw new Error('Invalid image turn record')
     this.readable = true
     this.records.push({ id: item.id, imageTask: item.imageTask, queued: item.queued })
    } catch { this.readable = false; this.records.length = 0 }
   }
  } catch { this.readable = false }
 }
 record(id: string, imageTask: boolean, queued: boolean): void {
  try { appendFileSync(this.path, `\n${JSON.stringify({ id, imageTask, queued })}\n`) }
  catch { /* 缺失消费证明时恢复端清除继承，不保留旧图片任务。 */ }
 }
}
