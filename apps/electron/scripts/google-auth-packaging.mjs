/** Google 登录配置的打包守门：只接受应用客户端信息，绝不携带用户令牌。 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const CONFIG_FILE = 'auth-google.json'

function readClient(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    if (Object.keys(value).some(key => !['clientId', 'clientSecret'].includes(key))) throw new Error()
    if (typeof value.clientId !== 'string' || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(value.clientId)) throw new Error()
    if (value.clientSecret !== undefined && (typeof value.clientSecret !== 'string' || !value.clientSecret.trim())) throw new Error()
    return value.clientSecret === undefined
      ? { clientId: value.clientId }
      : { clientId: value.clientId, clientSecret: value.clientSecret }
  } catch {
    // 错误中不拼接配置内容，避免将客户端值或误传的用户令牌写进构建日志。
    throw new Error('Google 客户端配置缺失或无效。请提供仅含 clientId、可选 clientSecret 的 Desktop 客户端配置。')
  }
}

function sourcePath(appDir) {
  const explicit = process.env.TINKER_GOOGLE_AUTH_CONFIG
  if (explicit) return resolve(explicit)
  const local = join(appDir, 'resources', CONFIG_FILE)
  const candidates = [local]
  if (process.platform === 'darwin') {
    candidates.push(join(homedir(), 'Library', 'Application Support', 'Tinker Candidate', '.asci', CONFIG_FILE))
  }
  candidates.push(join(homedir(), '.asci', CONFIG_FILE))
  return candidates.find(existsSync) ?? local
}

/** 由 electron-builder 的 beforePack 具名 hook 调用，每次覆盖旧 stage。 */
export async function beforePack(context) {
  const staged = join(context.appDir, 'dist', CONFIG_FILE)
  rmSync(staged, { force: true })
  const config = readClient(sourcePath(context.appDir))
  mkdirSync(dirname(staged), { recursive: true })
  writeFileSync(staged, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  console.log('[Google 登录打包] 客户端配置已验证并准备完成')
}

/** 校验实际 Resources，防止 extraResources 遗漏或复制成另一份客户端配置。 */
export async function afterPack(context) {
  const staged = readClient(join(context.appDir, 'dist', CONFIG_FILE))
  const resources = context.packager.getResourcesDir(context.appOutDir)
  const bundled = readClient(join(resources, CONFIG_FILE))
  if (JSON.stringify(staged) !== JSON.stringify(bundled)) {
    throw new Error('Google 客户端配置与打包前验证的配置不一致，已阻止交付。')
  }
  console.log('[Google 登录打包] 安装包内客户端配置校验通过')
}
