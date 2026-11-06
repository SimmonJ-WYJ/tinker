/**
 * bun:test 模块增强：把 @testing-library/jest-dom 的 Matchers 注入 bun:test 的
 * Matchers 接口，让本包 .test.tsx 中 `expect(...).toHaveTextContent(...)` 等断言
 * 通过 tsc 严格检查。
 *
 * 与 apps/electron/src/test-types.d.ts 同款声明（类型增强，非 re-export）。
 */
import { type expect } from 'bun:test'
import { type TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

export {}

declare module 'bun:test' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T = unknown>
    extends TestingLibraryMatchers<ReturnType<typeof expect.stringContaining>, T> {}
}
