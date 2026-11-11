/** 仅可信启动器可选择隔离预览；在导入旧服务前执行，失败绝不回落。 */
import { lstatSync, readFileSync, existsSync, realpathSync, readdirSync, constants, accessSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
export interface DesktopPreviewConfig { root: string; binary: string; profilesFile: string; compatHome: string }
const fail = (): never => { throw new Error('DESKTOP_PREVIEW_CONFIG') }
function regular(path: string, max: number): void {
  const s = lstatSync(path)
  if (!s.isFile() || s.nlink !== 1 || s.size > max || (s.mode & 0o022) !== 0 || realpathSync(path) !== path) fail()
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  return value as Record<string, unknown>
}
function safeOwnedTree(root:string):void {
  if(!existsSync(root)) return
  const pending=[root];let entries=0
  while(pending.length) {
    const path=pending.pop()!
    if(++entries>4096) fail()
    const stat=lstatSync(path)
    if(stat.isSymbolicLink() || realpathSync(path)!==path || (stat.mode & 0o022)!==0) fail()
    if(stat.isDirectory()) pending.push(...readdirSync(path).map(name=>join(path,name)))
    else if(!stat.isFile() || stat.nlink!==1 || stat.size>16*1024*1024) fail()
  }
}
export function resolveDesktopPreview(env: NodeJS.ProcessEnv, packaged: boolean): DesktopPreviewConfig | null {
  if (env.TINKER_DESKTOP_RUNTIME === undefined) return null
  try {
    if (packaged || env.TINKER_DESKTOP_RUNTIME !== 'rust-preview') fail()
    const root = env.TINKER_DESKTOP_ROOT ?? ''
    const binary = env.TINKER_DESKTOP_BINARY ?? ''
    const profilesFile = env.TINKER_DESKTOP_PROFILES ?? ''
    const compatHome = env.ASCI_CONFIG_HOME ?? ''
    if (!isAbsolute(root) || realpathSync(root) !== root || !basename(root).startsWith('tinker-desktop-preview-')) fail()
    if (![realpathSync(tmpdir()), realpathSync('/tmp')].includes(dirname(root))) fail()
    const stat = lstatSync(root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) fail()
    if (compatHome !== join(root, 'electron-compat') || profilesFile !== join(root, 'profiles.json')) fail()
    regular(join(root, 'preview.json'), 4096)
    const marker = object(JSON.parse(readFileSync(join(root, 'preview.json'), 'utf8')))
    if (Object.keys(marker).sort().join() !== 'kind,root,version' || marker.version !== 1 || marker.kind !== 'tinker-rust-preview' || marker.root !== root) fail()
    for (const entry of readdirSync(root)) {
      if (!['preview.json', 'profiles.json', 'runtime', 'electron-compat', 'chromium', 'desktop-runtime-v1', 'deliverables'].includes(entry)) fail()
      if (lstatSync(join(root, entry)).isSymbolicLink()) fail()
    }
    if (!isAbsolute(binary)) fail()
    regular(binary, 512 * 1024 * 1024)
    accessSync(binary, constants.X_OK)
    safeOwnedTree(compatHome)
    safeOwnedTree(join(root,'deliverables'))
    regular(profilesFile, 1024 * 1024)
    const profiles: unknown = JSON.parse(readFileSync(profilesFile, 'utf8'))
    if (!Array.isArray(profiles) || profiles.length === 0 || profiles.length > 128) fail()
    const ids = new Set<string>()
    for (const raw of profiles as unknown[]) {
      const p = object(raw)
      if (Object.keys(p).some(k => !['profileId', 'label', 'configRevision', 'protocol', 'models', 'endpoint', 'key'].includes(k))) fail()
      for (const k of ['profileId', 'configRevision']) if (typeof p[k] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(p[k] as string)) fail()
      if (ids.has(p.profileId as string)) fail()
      ids.add(p.profileId as string)
      if (typeof p.label !== 'string' || typeof p.key !== 'string' || !p.key || typeof p.endpoint !== 'string') fail()
      if (p.protocol !== 'openai-chat' && p.protocol !== 'anthropic-messages') fail()
      const url = new URL(p.endpoint as string)
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) fail()
      if (!Array.isArray(p.models) || !p.models.length || p.models.length > 128) fail()
      for (const rawModel of p.models as unknown[]) {
        const m = object(rawModel)
        if (typeof m.modelId !== 'string' || !m.modelId || typeof m.label !== 'string' || !Array.isArray(m.supportedEfforts) || m.supportedEfforts.some(e => !['low', 'medium', 'high', 'max'].includes(e))) fail()
      }
    }
    return { root, binary, profilesFile, compatHome }
  } catch { return fail() }
}
