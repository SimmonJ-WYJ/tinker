/**
 * dev 模式门控原语（仅渲染进程）
 *
 * 「有效 dev 模式」= `import.meta.env.DEV || debugModeAtom`：
 * - `import.meta.env.DEV` 仅 Vite dev server 运行期为 true；任何 `vite build` 产物（含打包后的
 *   .pkg/.exe 与本地 electron:start 冒烟）恒为 false。
 * - `debugModeAtom` 是用户在「关于」页连点版本号解锁后手动开启的运行期开关，持久化于 localStorage；
 *   开启后即便生产构建也让有效 dev 模式为 true。
 *
 * ⚠️ tree-shaking 契约变化：因门控值含运行期 atom 读取（非纯编译期常量），dev-only 代码**不再被
 * 生产构建剥离**，而是打进产物、按 atom 运行期门控。这是支持「prod 里手动开 Debug」的必要代价。
 * 仅影响 dev 门控；下方 `LOGIN_ENABLED` / `LoginEnabled` 仍是编译期常量，仍被 tree-shaking。
 *
 * 为何不用 main 进程的 `process.env.ASCI_DEV`：
 * 1. 作用域隔离 —— ASCI_DEV 是 main / 子进程 env，contextIsolation 下渲染进程读不到 process.env；
 *    要在 renderer 用它必须新增 preload 桥接 / IPC，多一层 wiring 且违背本原语"零 IPC"初衷。
 * 2. 语义不同 —— ASCI_DEV / app.isPackaged 表达"未打包"（electron:start 冒烟下为 dev）；
 *    import.meta.env.DEV 表达"Vite dev server"（electron:start 跑 build 产物时为 false）。本原语取后者。
 *
 * 用法分工：
 * - React 组件内：`useIsDevMode()`（反应式，随 atom 翻转自动重渲染）或 `<DevOnly>` 包裹。
 * - 非 React / 回调 / 模块初始化：`getIsDevMode()`（一次性读取默认 store）。
 * - main 进程 dev 门控继续用 ASCI_DEV / app.isPackaged。
 *
 * ⚠️ 限制：仅启动时执行一次的逻辑（如 Sentry 初始化）读取 `getIsDevMode()` 后，运行期切换 Debug
 * 不会重新生效，需重启应用。
 */
import * as React from 'react'
import { useAtomValue, getDefaultStore } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

/**
 * 运行期 Debug 模式开关（持久化于 localStorage）：默认 false。
 * 用户在「关于」页连点版本号 5 次解锁开关后手动开启；开启后即便生产构建也让有效 dev 模式为 true。
 */
export const debugModeAtom = atomWithStorage<boolean>('asci.debugMode', false)

/** 有效 dev 模式（React hook，反应式）：Vite dev server 运行期 或 Debug 开关开启时为 true。 */
export function useIsDevMode(): boolean {
  const debugMode = useAtomValue(debugModeAtom)
  return import.meta.env.DEV || debugMode
}

/** 有效 dev 模式（非 React 一次性读取）：供模块初始化 / 回调使用，读取 jotai 默认 store。 */
export function getIsDevMode(): boolean {
  return import.meta.env.DEV || getDefaultStore().get(debugModeAtom)
}

/** dev-only 包裹组件：有效 dev 模式为 false 时渲染 null；随 Debug 开关运行期翻转自动重渲染。 */
export function DevOnly({ children }: { children: React.ReactNode }): React.ReactElement | null {
  return useIsDevMode() ? <>{children}</> : null
}

/** Vite define 注入的全局登录开关；默认 true，仅 `bun run dev:skip-login` 时为 false。 */
declare const __LOGIN_ENABLED__: boolean

/** 全局登录开关（渲染侧编译期常量）：默认开启，仅 `bun run dev:skip-login` 时为 false；生产打包恒 true。 */
export const LOGIN_ENABLED: boolean = __LOGIN_ENABLED__

/** 登录门控包裹组件：未启用登录时渲染 null（dev:skip-login 构建被 tree-shaking 移除）。 */
export function LoginEnabled({ children }: { children: React.ReactNode }): React.ReactElement | null {
  return LOGIN_ENABLED ? <>{children}</> : null
}
