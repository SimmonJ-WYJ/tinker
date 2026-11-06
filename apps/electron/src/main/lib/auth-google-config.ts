import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface GoogleClientConfig { clientId: string; clientSecret?: string }

/** 本地覆盖优先；安装包只携带应用客户端配置，不携带用户令牌。 */
export function readGoogleClientConfig(configDir: string, resourcesDir?: string): GoogleClientConfig | undefined {
  for (const path of [join(configDir, 'auth-google.json'), ...(resourcesDir ? [join(resourcesDir, 'auth-google.json')] : [])]) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as GoogleClientConfig
      if (typeof value.clientId === 'string' && value.clientId.endsWith('.apps.googleusercontent.com')) return value
    } catch { /* 缺失或损坏时继续尝试安装包配置。 */ }
  }
  return undefined
}
