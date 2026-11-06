/**
 * 拷贝 resources/ → dist/resources/
 * 排除 *.test.ts 与未编译的 *.ts 源码（运行时只需要 *.cjs bundle、模型权重、品牌资源）
 * 跨平台替代 `cp -r resources dist/`
 */
import { cpSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const src = resolve(root, 'resources')
const dest = resolve(root, 'dist', 'resources')

// 先清空旧产物，避免上次构建残留（例如已被 filter 排除但旧版仍在的文件）
rmSync(dest, { recursive: true, force: true })

cpSync(src, dest, {
  recursive: true,
  filter: (source) => {
    if (source.endsWith('.test.ts')) return false
    if (source.endsWith('.ts.map')) return false
    // 普通 .ts 源码：仅编译期需要，运行时通过 *.cjs 加载
    if (source.endsWith('.ts')) return false
    return true
  },
})
