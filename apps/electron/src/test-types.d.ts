/**
 * bun:test 模块增强：把 @testing-library/jest-dom 的 Matchers 注入 bun:test 的
 * Matchers 接口，让 .test.tsx 中 `expect(...).toHaveTextContent(...)` 等断言
 * 通过 tsc 严格检查。
 *
 * 直接内联 jest-dom 官方提供的 declare module 'bun:test' 增强片段
 * （等同于其包内 types/bun.d.ts，但避免 subpath 不在 exports 中的解析问题）。
 */
import { type expect } from 'bun:test'
import { type TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

export {}

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
