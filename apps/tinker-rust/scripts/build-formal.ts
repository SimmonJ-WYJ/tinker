/** direct Cargo 指定真实入口，再组装本机预览包，避免 CLI 重命名 default-run。 */
import { resolve } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import config from '../src-tauri/tauri.formal.conf.json'
const appRoot = resolve(import.meta.dir, '..')
const target = process.env.CARGO_TARGET_DIR ?? resolve(appRoot, 'src-tauri/target')
const executable = resolve(target, 'debug/tinker-formal-preview')
// 只移除本批命名的输出；防止旧 cargo-tauri 已覆盖此文件、Cargo 却判定 Fresh。
rmSync(executable, { force: true })
const build = Bun.spawnSync(['cargo', 'build', '--offline', '--features', 'formal-preview', '--bin', 'tinker-formal-preview'], {
  cwd: resolve(appRoot, 'src-tauri'), stdout: 'inherit', stderr: 'inherit',
  env: { ...process.env, TAURI_CONFIG: JSON.stringify(config) },
})
if (build.exitCode !== 0) process.exit(build.exitCode)
if (process.platform === 'darwin') {
  const symbols = Bun.spawnSync(['/usr/bin/nm', executable])
  if (symbols.exitCode !== 0 || !symbols.stdout.toString().includes('tinker_formal_preview4main')) throw new Error('正式宿主入口符号缺失')
  const bundle = resolve(target, 'debug/bundle/macos/Tinker Formal Preview.app')
  const contents = resolve(bundle, 'Contents')
  const macos = resolve(contents, 'MacOS')
  const resources = resolve(contents, 'Resources')
  if (existsSync(resolve(contents, 'Info.plist'))) {
    const identity = Bun.spawnSync(['/usr/bin/plutil', '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', resolve(contents, 'Info.plist')])
    if (identity.exitCode !== 0 || identity.stdout.toString().trim() !== config.identifier) throw new Error('输出路径不是正式预览包')
  }
  mkdirSync(macos, { recursive: true }); mkdirSync(resources, { recursive: true })
  copyFileSync(executable, resolve(macos, 'tinker-formal-preview'))
  copyFileSync(resolve(appRoot, '../electron/resources/icon.icns'), resolve(resources, 'icon.icns'))
  for (const name of ['LICENSE', 'NOTICE']) copyFileSync(resolve(appRoot, '../..', name), resolve(resources, name))
  const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const values: Record<string, string> = {
    CFBundleExecutable: 'tinker-formal-preview', CFBundleIdentifier: config.identifier,
    CFBundleName: config.productName, CFBundleDisplayName: config.productName,
    CFBundlePackageType: 'APPL', CFBundleInfoDictionaryVersion: '6.0', CFBundleIconFile: 'icon.icns',
    CFBundleShortVersionString: config.version, CFBundleVersion: config.version,
    LSMinimumSystemVersion: config.bundle.macOS.minimumSystemVersion, NSPrincipalClass: 'NSApplication',
  }
  const entries = Object.entries(values).map(([key, value]) => `<key>${key}</key><string>${escapeXml(value)}</string>`).join('\n')
  writeFileSync(resolve(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${entries}\n<key>NSHighResolutionCapable</key><true/>\n</dict></plist>\n`)
  const seal = Bun.spawnSync(['bun', resolve(import.meta.dir, 'package-formal.ts')], { stdout: 'inherit', stderr: 'inherit' })
  if (seal.exitCode !== 0) process.exit(seal.exitCode)
  console.log(`正式预览包：${bundle}`)
}
