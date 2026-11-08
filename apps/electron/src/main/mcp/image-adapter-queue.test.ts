import { expect,test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
test('真实adapter显式启用replay并在已登记queued用户消费后切scope',()=>{
 const result=spawnSync(process.execPath,['run',join(import.meta.dir,'image-adapter-queue.fixture.ts')],{encoding:'utf8',timeout:20_000})
 expect(result.status,`${result.stdout}\n${result.stderr}`).toBe(0)
 expect(result.stdout).toContain('IMAGE_ADAPTER_QUEUE_PASS')
})
