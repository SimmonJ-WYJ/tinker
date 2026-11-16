/** 工具包入口与渲染资源的构建隔离契约。 */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
test('普通工具入口即使 all-features 也不注入 QA 探针', () => {
  const entry = read('../src-tauri/src/bin/tinker-tools-preview.rs')
  expect(entry).toContain('None,')
  expect(entry).not.toContain('formal_native_qa')
})
test('工具 QA 有独立身份、独立入口和渲染目录', () => {
  const config = JSON.parse(read('../src-tauri/tauri.tools-qa.conf.json'))
  expect(config.identifier).toBe('com.tinker.tools-native-qa')
  expect(config.mainBinaryName).toBe('tinker-tools-native-qa')
  expect(config.build.frontendDist).toBe('../native-qa-dist')
  expect(read('../src-tauri/src/bin/tinker-tools-native-qa.rs')).toContain('run_tools_qa')
})
test('工具构建显式指定 Cargo binary 和完整配置', () => {
  const build = read('./build-tools-common.ts')
  expect(build).toContain('TAURI_CONFIG: JSON.stringify(config)')
  expect(build).toContain("'--bin', config.mainBinaryName")
  expect(build).toContain("qa ? 'formal-native-qa' : 'formal-preview'")
  expect(build).toContain("qa ? 'vite.native-qa.config.ts' : 'vite.formal.config.ts'")
})
