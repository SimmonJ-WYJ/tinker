/** 每轮生图请求的持久防重记录；失败或中断后的上游计费状态不可推断。 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
interface RequestRecord { state: 'pending' | 'complete' | 'uncertain'; result?: string }
export class ImageRequestLedger {
 constructor(private readonly directory: string, private readonly runId: string) {}
 async run(fingerprint: string, generate: () => Promise<string>): Promise<string> {
  const folder=join(this.directory,'image-requests');mkdirSync(folder,{recursive:true,mode:0o700})
  const id=createHash('sha256').update(JSON.stringify([this.runId,fingerprint])).digest('hex')
  const path=join(folder,`${id}.json`)
  if (existsSync(path)) return this.replay(path)
  try {writeFileSync(path,JSON.stringify({state:'pending'}),{flag:'wx',mode:0o600})}
  catch(error) {if ((error as NodeJS.ErrnoException).code==='EEXIST') return this.replay(path);throw error}
  try {
   const result=await generate()
   this.save(path,{state:'complete',result})
   return result
  } catch(error) {
   this.save(path,{state:'uncertain'})
   throw error
  }
 }
 private replay(path: string): string {
  const record=JSON.parse(readFileSync(path,'utf8')) as RequestRecord
  if(record.state==='complete' && typeof record.result==='string') return record.result
  throw new Error('IMAGE_REQUEST_REPLAY_BLOCKED: An earlier image request in this turn is pending or its result is uncertain. Do not generate again. Inspect saved images and check billing before asking the user to explicitly start a new request.')
 }
 private save(path: string, record: RequestRecord): void {
  const temporary=`${path}.tmp`;writeFileSync(temporary,JSON.stringify(record),{mode:0o600});renameSync(temporary,path)
 }
}
