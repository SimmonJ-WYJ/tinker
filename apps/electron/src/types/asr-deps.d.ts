/**
 * ASR 权重下载相关依赖的最小类型声明
 *
 * unbzip2-stream / tar 都没有内置 TypeScript 类型；
 * asr-weights-service.ts 仅用作通过 stream pipeline 的解压管道，
 * 这里提供最小可用声明，避免显式 any 引入到业务代码。
 */
declare module 'unbzip2-stream' {
  import type { Transform } from 'node:stream'
  function unbzip2Stream(): Transform
  export default unbzip2Stream
}

declare module 'tar' {
  import type { Writable } from 'node:stream'
  interface ExtractOptions {
    cwd?: string
    strip?: number
    [key: string]: unknown
  }
  export function t(opts: { file: string; strict?: boolean; onReadEntry: (entry: { path: string; size: number; type: string; linkpath: string }) => void }): Promise<void>
  export function x(opts: ExtractOptions): Writable
}
