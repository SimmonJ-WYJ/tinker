/** 单独 QA binary，必须显式传递配置给 Cargo 宏，不能依赖宏参数文件名。 */
import { resolve } from 'node:path'
import config from '../src-tauri/tauri.qa.conf.json'
const result = Bun.spawnSync(['cargo', 'build', '--offline', '--features', 'formal-native-qa', '--bin', 'tinker-formal-native-qa'], {
  cwd: resolve(import.meta.dir, '../src-tauri'), stdout: 'inherit', stderr: 'inherit',
  env: { ...process.env, TAURI_CONFIG: JSON.stringify(config) },
})
process.exit(result.exitCode)
