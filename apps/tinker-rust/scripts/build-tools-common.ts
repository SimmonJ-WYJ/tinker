/** direct Cargo 固定入口和完整配置；组装并验证本批独立工具包。 */
import { resolve } from 'node:path'
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import ordinary from '../src-tauri/tauri.tools.conf.json'
import nativeQA from '../src-tauri/tauri.tools-qa.conf.json'
import { createToolsStaging } from './tools-staging.ts'
export function buildTools(qa: boolean): void {
  const config = qa ? nativeQA : ordinary
  const renderer = Bun.spawnSync(['bunx', 'vite', 'build', '--config', qa ? 'vite.native-qa.config.ts' : 'vite.formal.config.ts'], { cwd: resolve(import.meta.dir, '../../electron'), stdout: 'inherit', stderr: 'inherit' })
  if (renderer.exitCode !== 0) process.exit(renderer.exitCode)
  const appRoot = resolve(import.meta.dir, '..')
  const target = process.env.CARGO_TARGET_DIR ?? resolve(appRoot, 'src-tauri/target')
  const executable = resolve(target, `debug/${config.mainBinaryName}`)
  // 只移除本批命名的输出；防止旧 cargo-tauri 已覆盖此文件、Cargo 却判定 Fresh。
  rmSync(executable, { force: true })
  const build = Bun.spawnSync(['cargo', 'build', '--offline', '--features', qa ? 'formal-native-qa' : 'formal-preview', '--bin', config.mainBinaryName], {
    cwd: resolve(appRoot, 'src-tauri'), stdout: 'inherit', stderr: 'inherit',
    env: { ...process.env, TAURI_CONFIG: JSON.stringify(config) },
  })
  if (build.exitCode !== 0) process.exit(build.exitCode)
  if (process.platform === 'darwin') {
    const symbols = Bun.spawnSync(['/usr/bin/nm', executable])
    if (symbols.exitCode !== 0 || !symbols.stdout.toString().includes(`${config.mainBinaryName.replaceAll('-', '_')}4main`)) throw new Error('正式宿主入口符号缺失')
    if (!qa && /formal_native_qa|NATIVE_QA_EARLY|QA evidence directory/.test(symbols.stdout.toString())) throw new Error('普通工具包包含 QA 符号')
    const architecture = Bun.spawnSync(['/usr/bin/lipo', '-archs', executable])
    if (architecture.exitCode !== 0 || architecture.stdout.toString().trim() !== (process.arch === 'x64' ? 'x86_64' : process.arch)) throw new Error('工具包架构与构建宿主不匹配')
    // 新产物在系统 tmp 组装，避免 Documents 文件提供器反复添加 FinderInfo。
    const staging = createToolsStaging()
    const bundle = resolve(staging, `${config.productName}.app`)
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
      CFBundleName: config.productName, CFBundleDisplayName: config.productName,
      CFBundlePackageType: 'APPL', CFBundleInfoDictionaryVersion: '6.0', CFBundleIconFile: 'icon.icns',
      CFBundleShortVersionString: config.version, CFBundleVersion: config.version,
      LSMinimumSystemVersion: config.bundle.macOS.minimumSystemVersion, NSPrincipalClass: 'NSApplication',
    }
    const entries = Object.entries(values).map(([key, value]) => `<key>${key}</key><string>${escapeXml(value)}</string>`).join('\n')
    writeFileSync(resolve(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${entries}\n<key>NSHighResolutionCapable</key><true/>\n</dict></plist>\n`)
    const names = readdirSync(macos)
    if (names.length !== 1 || names[0] !== config.mainBinaryName) throw new Error('工具包出现未知 executable')
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
    console.log(`工具预览包：${bundle}`)
  }
}
