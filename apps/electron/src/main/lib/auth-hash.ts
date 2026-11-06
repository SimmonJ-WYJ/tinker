/**
 * 密码哈希 - spec §七 7.3
 *
 * 用 Node 内置 crypto.scrypt（无外部依赖）。生产端 ADR-002 可换 argon2id，
 * 只需在本文件内增加 format 版本分派，调用方零改动。
 *
 * format: `scrypt$v1$<salt-b64url>$<hash-b64url>`
 */

import { scrypt, randomBytes, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>

const SCRYPT_KEYLEN = 64
/** OWASP 2023 推荐最低 N。生产端 ADR-002 拍板 argon2id 后可替换整套 helper。*/
const SCRYPT_N = 1 << 16  // 65536
/** maxmem 覆盖 OpenSSL 默认保守限制（~32 MB），确保 N=65536 在 Electron 和 Bun 测试中均可运行。*/
const SCRYPT_OPTIONS: ScryptOptions = { N: SCRYPT_N, maxmem: 256 * 1024 * 1024 }
const FORMAT_PREFIX = 'scrypt$v1'

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(plain, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
  return `${FORMAT_PREFIX}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(`${FORMAT_PREFIX}$`)) return false
  const parts = stored.split('$')
  if (parts.length !== 4) return false
  const saltB64 = parts[2]
  const hashB64 = parts[3]
  if (!saltB64 || !hashB64) return false
  try {
    const salt = Buffer.from(saltB64, 'base64url')
    const expected = Buffer.from(hashB64, 'base64url')
    if (expected.length !== SCRYPT_KEYLEN) return false
    const actual = await scryptAsync(plain, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS)
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}
