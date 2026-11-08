import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

test('真实生图handler使用本回合授权与账本，假网络只执行已授权请求', () => {
 // 模块 mock 限定在独立进程，防止污染其他权限、配置和图片测试。
 const result=spawnSync(process.execPath,['run',join(import.meta.dir,'image-generation-handler.fixture.ts')],{encoding:'utf8',timeout:20_000})
 expect(result.status,`${result.stdout}\n${result.stderr}`).toBe(0)
 expect(result.stdout).toContain('IMAGE_HANDLER_FIXTURE_PASS')
})
