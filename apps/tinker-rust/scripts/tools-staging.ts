/** 每次构建分配独占 0700 目录；不复用或遍历旧 bundle 的子路径。 */
import { mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
export function createToolsStaging(parent = '/private/tmp'): string {
  return mkdtempSync(resolve(parent, 'tinker-tauri-tools-package-'))
}
