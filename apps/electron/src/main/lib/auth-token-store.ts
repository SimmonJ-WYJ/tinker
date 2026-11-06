/**
 * Token 本地加密存储 - spec §二 + §七 7.5
 *
 * 三字段（accessToken / refreshToken / obtainedAt）合并为单个加密文件，
 * 写入时用 tmp + rename 保证原子性，防止 partial-write 导致字段错位。
 * 退出登录时 clear() 删除文件（顺带清理可能残留的 .tmp）。
 */

import { safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getConfigDir } from './config-paths.ts'

export interface StoredTokens {
  googleClientId?: string
  accessToken: string
  /** stub 路径恒为 string；OIDC（OPENSCI 透传）可能无 refresh，故放宽为可空 */
  refreshToken: string | null
  obtainedAt: string  // ISO
  /** access token 过期时间戳（ms）；仅 OIDC 路径写入，stub 不传 */
  expiresAt?: number
}

const TOKENS_FILE = 'auth-tokens.enc'

export interface AuthTokenStore {
  save(tokens: StoredTokens): Promise<void>
  /** 一次读出全部字段（避免多个 getter 各自读盘 + safeStorage 解密同一文件） */
  getAll(): Promise<StoredTokens | null>
  getAccessToken(): Promise<string | null>
  getRefreshToken(): Promise<string | null>
  getObtainedAt(): Promise<string | null>
  clear(): Promise<void>
}

export function createAuthTokenStore(baseDir: string, fileName = TOKENS_FILE): AuthTokenStore {
  const tokensPath = path.join(baseDir, fileName)

  async function readAll(): Promise<StoredTokens | null> {
    let buf: Buffer
    try {
      buf = await fs.readFile(tokensPath)
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return null
      throw err
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('[auth-token-store] safeStorage decryption unavailable')
    }
    try {
      const plain = safeStorage.decryptString(buf)
      return JSON.parse(plain) as StoredTokens
    } catch {
      // 文件损坏 / 钥匙串变化 → 视为无 session
      return null
    }
  }

  return {
    async save(tokens) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('[auth-token-store] safeStorage encryption unavailable')
      }
      await fs.mkdir(baseDir, { recursive: true })
      const plain = JSON.stringify(tokens)
      const encrypted = safeStorage.encryptString(plain)
      // 写临时文件再 rename，确保原子性
      const tmp = `${tokensPath}.tmp`
      await fs.writeFile(tmp, encrypted)
      await fs.rename(tmp, tokensPath)
    },
    async getAll() {
      return readAll()
    },
    async getAccessToken() {
      const all = await readAll()
      return all?.accessToken ?? null
    },
    async getRefreshToken() {
      const all = await readAll()
      return all?.refreshToken ?? null
    },
    async getObtainedAt() {
      const all = await readAll()
      return all?.obtainedAt ?? null
    },
    async clear() {
      try {
        await fs.unlink(tokensPath)
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException
        if (e.code !== 'ENOENT') throw err
      }
      // 清理可能残留的临时文件
      try {
        await fs.unlink(`${tokensPath}.tmp`)
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException
        if (e.code !== 'ENOENT') throw err
      }
    },
  }
}

/** 工厂：从 config-paths 自动取目录（getConfigDir() 返回 ~/.asci[-dev]/） */
export function createDefaultAuthTokenStore(): AuthTokenStore {
  return createAuthTokenStore(getConfigDir())
}

/** Google 与旧 OPENSCI token 文件隔离，绝不恢复旧身份。 */
export function createGoogleAuthTokenStore(): AuthTokenStore {
  return createAuthTokenStore(getConfigDir(), 'auth-google-tokens.enc')
}
