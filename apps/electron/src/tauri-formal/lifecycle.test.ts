import { expect, test } from 'bun:test'
import { createLifecycle } from './lifecycle.ts'

test('关闭等待 hydrate，采集最新状态，重复关闭只执行一次', async () => {
  const calls: string[] = []; let value = 0; let release = () => {}
  const hydrated = new Promise<void>((resolve) => { release = resolve })
  const lifecycle = createLifecycle({
    hydrated, freeze: (on) => calls.push(`freeze:${on}`), drain: async () => {},
    capture: () => ({ value }), persist: async () => { calls.push(`save:${value}`); return 3 },
    begin: async () => 'token', abort: async () => {},
    finish: async (token, revision) => { calls.push(`finish:${token}:${revision}`) },
    reload: () => calls.push('reload'), failure: () => calls.push('error'),
  })
  const first = lifecycle.run('close'); const second = lifecycle.run('close')
  await Promise.resolve(); expect(calls).toEqual(['freeze:true'])
  value = 2; release(); await Promise.all([first, second])
  expect(calls).toEqual(['freeze:true', 'save:2', 'finish:token:3'])
})
test('持久化期间 dirty 变化重试；失败不关窗并恢复交互', async () => {
  let value = 1; let saves = 0; let finishes = 0; let frozen = false; let failures = 0
  const lifecycle = createLifecycle({ hydrated: Promise.resolve(), freeze: (on) => { frozen = on }, drain: async () => {}, capture: () => value,
    persist: async () => { saves++; value++; if (saves === 2) throw Error('disk'); return 1 }, begin: async () => 'token', abort: async () => {}, finish: async () => { finishes++ }, reload: () => {}, failure: () => { failures++ },
  })
  await lifecycle.run('close')
  expect(saves).toBe(2); expect(finishes).toBe(0); expect(frozen).toBe(false); expect(failures).toBe(1)
})
test('reload 同样 flush，但不请求 native close/cancel', async () => {
  const calls: string[] = []
  const lifecycle = createLifecycle({ hydrated: Promise.resolve(), freeze: () => {}, drain: async () => {}, capture: () => 1, persist: async () => { calls.push('save'); return 1 }, begin: async () => { calls.push('begin'); return 'token' }, abort: async () => {}, finish: async () => { calls.push('close') }, reload: () => calls.push('reload'), failure: () => {} })
  await lifecycle.run('reload'); expect(calls).toEqual(['save', 'reload'])
})

test('hydrate 超时恢复窗口且稍后的 hydrate 不触发关闭', async () => {
  let resolve = () => {}; let frozen = false; let closed = false; let errors = 0
  const hydrated = new Promise<void>((yes) => { resolve = yes })
  const lifecycle = createLifecycle({ timeoutMs: 5, hydrated, freeze: (v) => { frozen = v }, drain: async () => {}, capture: () => 1, persist: async () => 1, begin: async () => 't', abort: async () => {}, finish: async () => { closed = true }, reload: () => {}, failure: () => { errors++ } })
  await Promise.race([lifecycle.run('close'), new Promise((yes) => setTimeout(yes, 20))])
  expect(frozen).toBe(false); expect(errors).toBe(1)
  resolve(); await new Promise((yes) => setTimeout(yes, 0)); expect(closed).toBe(false)
})
