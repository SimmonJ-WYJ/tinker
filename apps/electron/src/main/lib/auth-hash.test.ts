import { test, expect, describe } from 'bun:test'
import { hashPassword, verifyPassword } from './auth-hash.ts'

describe('auth-hash', () => {
  test('hash + verify roundtrip', async () => {
    const h = await hashPassword('mySecret123')
    expect(await verifyPassword('mySecret123', h)).toBe(true)
  })

  test('错误密码 verify 返回 false', async () => {
    const h = await hashPassword('correct1')
    expect(await verifyPassword('wrong1', h)).toBe(false)
  })

  test('同密码两次 hash 不同 (salt 不同)', async () => {
    const h1 = await hashPassword('same1234')
    const h2 = await hashPassword('same1234')
    expect(h1).not.toEqual(h2)
  })

  test('format 前缀错误返回 false', async () => {
    expect(await verifyPassword('any', 'bcrypt$invalid$format')).toBe(false)
  })

  test('format 包含版本前缀', async () => {
    const h = await hashPassword('test1234')
    expect(h.startsWith('scrypt$v1$')).toBe(true)
  })

  test('format 段数不足 3 返回 false (覆盖 parts.length 守门)', async () => {
    expect(await verifyPassword('any', 'scrypt$v1$onlythreeparts')).toBe(false)
  })
})
