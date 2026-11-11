/** 仅为本机构建的新预览 app 完成资源签名，不安装或修改其它应用。 */
import { resolve } from 'node:path'
import { existsSync, readdirSync, rmSync } from 'node:fs'
const target = process.env.CARGO_TARGET_DIR ?? resolve(import.meta.dir, '../src-tauri/target')
const bundle = resolve(target, 'debug/bundle/macos/Tinker Formal Preview.app')
if (process.platform === 'darwin') {
  const identity = Bun.spawnSync(['/usr/bin/plutil', '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', resolve(bundle, 'Contents/Info.plist')])
  if (identity.exitCode !== 0 || identity.stdout.toString().trim() !== 'com.tinker.formal-preview') throw new Error('不是新正式预览包')
  const executables = resolve(bundle, 'Contents/MacOS')
  for (const name of readdirSync(executables)) {
    // cargo-tauri 会带入同 Cargo package 的其它 binary；此 app 只运行自己的宿主。
    if (name === 'tinker-runtime') rmSync(resolve(executables, name))
    else if (name !== 'tinker-formal-preview') throw new Error('预览包出现未知 executable')
  }
  for (const resource of ['LICENSE', 'NOTICE']) {
    if (!existsSync(resolve(bundle, 'Contents/Resources', resource))) throw new Error(`缺少分发资源：${resource}`)
  }
  for (const args of [['--force', '--deep', '--sign', '-', bundle], ['--verify', '--deep', '--strict', '--verbose=2', bundle]]) {
    const result = Bun.spawnSync(['/usr/bin/codesign', ...args], { stdout: 'inherit', stderr: 'inherit' })
    if (result.exitCode !== 0) process.exit(result.exitCode)
  }
}
