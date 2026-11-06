/**
 * pdfjs-dist 主进程加载封装（单例 + dynamic import）
 *
 * 1) pdfjs-dist@5.x 的 legacy build 只有 ESM（pdf.mjs）；主进程被 esbuild 打成 CJS，
 *    用 dynamic import 异步装载与 document-extractor.ts 加载 pdf-parse 的模式同构。
 * 2) 主进程没有 Worker 环境（也无法用 Vite 的 ?url import），统一传 disableWorker: true，
 *    pdfjs 会在当前线程做解析；纯文本抽取是 CPU 友好的，无需另开 worker_threads。
 * 3) 缓存模块引用，避免每次 parse 重新 import。
 */

// 类型导入不会触发运行时副作用；运行时通过 dynamic import 实际加载
import type * as PdfjsType from 'pdfjs-dist'

type PdfjsModule = typeof PdfjsType

let cached: PdfjsModule | null = null

export async function getPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached
  const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfjsModule & {
    default?: PdfjsModule
  }
  cached = (mod.default ?? mod) as PdfjsModule
  return cached
}
