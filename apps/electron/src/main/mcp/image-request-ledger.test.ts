import { test, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageRequestLedger } from './image-request-ledger.ts'
test('同轮重复和重建后复用已保存结果，新轮次允许新请求', async () => {
 const dir=mkdtempSync(join(tmpdir(),'asci-charge-')); let calls=0
 try {
  const generate=async()=>{calls++;return '{"imageId":"one"}'}
  expect(await new ImageRequestLedger(dir,'turn-1').run('fingerprint',generate)).toContain('one')
  expect(await new ImageRequestLedger(dir,'turn-1').run('fingerprint',generate)).toContain('one')
  expect(calls).toBe(1)
  await new ImageRequestLedger(dir,'turn-2').run('fingerprint',generate);expect(calls).toBe(2)
 } finally {rmSync(dir,{recursive:true,force:true})}
})
test('请求进行中与结果不确定时阻止重放，包括重建宿主之后', async () => {
 const dir=mkdtempSync(join(tmpdir(),'asci-charge-'));let release!:()=>void;let calls=0
 try {
  const ledger=new ImageRequestLedger(dir,'turn');const gate=new Promise<void>(resolve=>{release=resolve})
  const first=ledger.run('f',async()=>{calls++;await gate;throw Error('timeout')})
  await expect(new ImageRequestLedger(dir,'turn').run('f',async()=>{calls++;return 'wrong'})).rejects.toThrow('IMAGE_REQUEST_REPLAY_BLOCKED')
  release();await expect(first).rejects.toThrow('timeout')
  await expect(new ImageRequestLedger(dir,'turn').run('f',async()=>{calls++;return 'wrong'})).rejects.toThrow('IMAGE_REQUEST_REPLAY_BLOCKED')
  expect(calls).toBe(1)
 } finally {rmSync(dir,{recursive:true,force:true})}
})
