/** 固定独立渠道入口；原 UI、owned 临时组装和签名，无安装或产品入口切换。 */
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import ordinary from '../src-tauri/tauri.channels.conf.json'
import nativeQA from '../src-tauri/tauri.channels-qa.conf.json'
import { mkdtempSync, statfsSync } from 'node:fs'
export function buildChannels(qa: boolean, keychainAcceptance = false): void {
  if (keychainAcceptance && (qa || process.platform !== 'darwin')) throw new Error('钥匙串验收仅支持独立 macOS 普通宿主')
  const features = qa ? 'custom-protocol,formal-native-qa' : keychainAcceptance ? 'custom-protocol,keychain-acceptance' : 'custom-protocol,formal-preview'
  const config = qa ? nativeQA : ordinary
  const requireSpace = () => { const disk=statfsSync(resolve(import.meta.dir)); if(disk.bavail * disk.bsize < 4 * 1024 ** 3) throw new Error('可用空间低于 4 GiB，停止新构建') }
  requireSpace()
  const renderer = Bun.spawnSync(['bunx', '--no-install', 'vite', 'build', '--config', 'vite.formal.config.ts'], { cwd: resolve(import.meta.dir, '../../electron'), stdout: 'inherit', stderr: 'inherit' })
  if (renderer.exitCode !== 0) process.exit(renderer.exitCode)
  const appRoot = resolve(import.meta.dir, '..')
  const target = process.env.CARGO_TARGET_DIR ?? resolve(appRoot, 'src-tauri/target')
  const executable = resolve(target, `debug/${config.mainBinaryName}`)
  requireSpace()
  const build = Bun.spawnSync(['cargo', 'build', '--offline', '--no-default-features', '--features', features, '--bin', config.mainBinaryName], {
    cwd: resolve(appRoot, 'src-tauri'), stdout: 'inherit', stderr: 'inherit',
    env: { ...process.env, TAURI_CONFIG: JSON.stringify(config) },
  })
  if (build.exitCode !== 0) process.exit(build.exitCode)
  if (process.platform === 'darwin') {
    const symbols = Bun.spawnSync(['/usr/bin/nm', executable])
    if (symbols.exitCode !== 0 || !symbols.stdout.toString().includes(`${config.mainBinaryName.replaceAll('-', '_')}4main`)) throw new Error('正式宿主入口符号缺失')
    if (!qa && /formal_native_qa|NATIVE_QA_EARLY|QA evidence directory|QA_SECRET_ONE|vault_fake|channels_owned_qa/.test(symbols.stdout.toString())) throw new Error('普通渠道包包含 QA 符号')
    const architecture = Bun.spawnSync(['/usr/bin/lipo', '-archs', executable])
    if (architecture.exitCode !== 0 || architecture.stdout.toString().trim() !== (process.arch === 'x64' ? 'x86_64' : process.arch)) throw new Error('渠道包架构与构建宿主不匹配')
    // 新产物在系统 tmp 组装，避免 Documents 文件提供器反复添加 FinderInfo。
    const staging = mkdtempSync('/private/tmp/tinker-tauri-channels-package-')
    const bundleName = keychainAcceptance ? 'Tinker Keychain Acceptance' : config.productName
    const bundle = resolve(staging, `${bundleName}.app`)
    const contents = resolve(bundle, 'Contents')
    const macos = resolve(contents, 'MacOS')
    const resources = resolve(contents, 'Resources')
    mkdirSync(macos, { recursive: true }); mkdirSync(resources, { recursive: true })
    copyFileSync(executable, resolve(macos, config.mainBinaryName))
    copyFileSync(resolve(appRoot, '../electron/resources/icon.icns'), resolve(resources, 'icon.icns'))
    for (const name of ['LICENSE', 'NOTICE']) copyFileSync(resolve(appRoot, '../..', name), resolve(resources, name))
    const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const values: Record<string, string> = {
      CFBundleExecutable: config.mainBinaryName, CFBundleIdentifier: config.identifier,
      CFBundleName: bundleName, CFBundleDisplayName: bundleName,
      CFBundlePackageType: 'APPL', CFBundleInfoDictionaryVersion: '6.0', CFBundleIconFile: 'icon.icns',
      CFBundleShortVersionString: config.version, CFBundleVersion: config.version,
      LSMinimumSystemVersion: config.bundle.macOS.minimumSystemVersion, NSPrincipalClass: 'NSApplication',
    }
    const entries = Object.entries(values).map(([key, value]) => `<key>${key}</key><string>${escapeXml(value)}</string>`).join('\n')
    writeFileSync(resolve(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${entries}\n<key>NSHighResolutionCapable</key><true/>\n</dict></plist>\n`)
    const names = readdirSync(macos)
    if (names.length !== 1 || names[0] !== config.mainBinaryName) throw new Error('渠道包出现未知 executable')
    // Documents 文件提供器可能给新目录附加 FinderInfo；只清理此 owned 产物的显示元数据。
    const finderInfo = Bun.spawnSync(['/usr/bin/xattr', '-p', 'com.apple.FinderInfo', bundle])
    if (finderInfo.exitCode === 0) {
      const clean = Bun.spawnSync(['/usr/bin/xattr', '-d', 'com.apple.FinderInfo', bundle], { stdout: 'inherit', stderr: 'inherit' })
      if (clean.exitCode !== 0) process.exit(clean.exitCode)
    }
    for (const args of [['--force', '--deep', '--sign', '-', bundle], ['--verify', '--deep', '--strict', '--verbose=2', bundle]]) {
      const result = Bun.spawnSync(['/usr/bin/codesign', ...args], { stdout: 'inherit', stderr: 'inherit' })
      if (result.exitCode !== 0) process.exit(result.exitCode)
    }
    console.log(`渠道预览包：${bundle}`)
  }
}
