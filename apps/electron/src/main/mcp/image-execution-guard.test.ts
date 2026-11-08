import { expect, test } from 'bun:test'
import { ImageRequestAuthorization, IMAGE_GENERATION_TOOL } from '@asci/shared'
import { ImageExecutionGuard } from './image-execution-guard.ts'
import { ImageRequestLedger } from './image-request-ledger.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const input={prompt:'office'}
test('生成边界无授权、计划模式或取消时绝不调用假生成器', async () => {
 let calls=0
 const generate=async()=>{calls++;return 'saved'}
 const scope=new ImageRequestAuthorization({userMessage:'生成图片'})
 await expect(new ImageExecutionGuard().run(input,'bytes',generate)).rejects.toThrow('authorization')
 await expect(new ImageExecutionGuard({authorization:scope,isExecutionAllowed:()=>false}).run(input,'bytes',generate)).rejects.toThrow('unavailable')
 scope.cancel()
 await expect(new ImageExecutionGuard({authorization:scope}).run(input,'bytes',generate)).rejects.toThrow('ended')
 expect(calls).toBe(0)
})
test('同一参数复用账本只生成一次，引用内容改变或uncertain不能暗中重试', async () => {
 const directory=mkdtempSync(join(tmpdir(),'image-guard-'))
 try {
  const scope=new ImageRequestAuthorization({userMessage:'生成图片'})
  const guard=new ImageExecutionGuard({authorization:scope})
  const ledger=new ImageRequestLedger(directory,'turn')
  let calls=0
  const generate=()=>ledger.run('bytes',async()=>{calls++;return 'saved'})
  expect(await guard.run(input,'bytes',generate)).toBe('saved')
  expect(await guard.run(input,'bytes',generate)).toBe('saved')
  expect(calls).toBe(1)
  await expect(guard.run(input,'changed bytes',generate)).rejects.toThrow('changed')
  const failedScope=new ImageRequestAuthorization({userMessage:'生成图片'})
  const failedGuard=new ImageExecutionGuard({authorization:failedScope})
  const failed=()=>ledger.run('uncertain',async()=>{calls++;throw new Error('unknown outcome')})
  await expect(failedGuard.run(input,'uncertain',failed)).rejects.toThrow('unknown outcome')
  await expect(failedGuard.run(input,'uncertain',failed)).rejects.toThrow('REPLAY_BLOCKED')
  expect(calls).toBe(2)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('执行边界仅接受本回合精确批准，不继承前一回合', async () => {
 const scope=new ImageRequestAuthorization({userMessage:'看看这个需求'})
 scope.approve(IMAGE_GENERATION_TOOL,input,'one')
 expect(await new ImageExecutionGuard({authorization:scope}).run(input,'bytes',async()=>'saved')).toBe('saved')
 const next=new ImageRequestAuthorization({userMessage:'继续解释'})
 await expect(new ImageExecutionGuard({authorization:next}).run(input,'bytes',async()=>'bad')).rejects.toThrow('explicitly')
})
