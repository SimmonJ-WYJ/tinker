/**
 * bun test preload — 全局注入 happy-dom 与 jest-dom 扩展，
 * 让 apps/electron 下的 .test.tsx 可以 render React 组件。
 *
 * happy-dom 20.x 将 GlobalRegistrator 拆到独立子包 @happy-dom/global-registrator，
 * 因此从该子包导入。jest-dom 的 Matchers 类型增强通过 src/test-types.d.ts 注入。
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import * as matchers from '@testing-library/jest-dom/matchers'
import { expect } from 'bun:test'

if (typeof globalThis.window === 'undefined') {
  GlobalRegistrator.register()
}

// 使用标准模式，避免数学渲染器在合成 DOM 中产生无关兼容性告警。
if (!document.doctype) document.insertBefore(document.implementation.createDocumentType('html', '', ''), document.documentElement)
// happy-dom 尚未实现 compatMode；本测试文档已有 HTML doctype，补齐标准模式只读属性。
if (!document.compatMode) Object.defineProperty(document, 'compatMode', { value: 'CSS1Compat', configurable: true })

expect.extend(matchers as never)

// Vite define 的测试兜底：dev-mode.tsx 在模块求值期读取裸全局 __LOGIN_ENABLED__（由 Vite 编译期
// 注入，仅 vite.config.ts 定义）。bun test 不经 Vite，导入即 ReferenceError。按 Vite 同款语义在
// 全局对象上注入，使裸标识符可解析，让导入 dev-mode 的组件在 .test.tsx 中可被求值。
;(globalThis as Record<string, unknown>).__LOGIN_ENABLED__ = process.env.ASCI_SKIP_LOGIN !== '1'

// 让 useT('ns') 在 .test.tsx 中默认可解析；必须放在 GlobalRegistrator.register() 之后，
// 因 react-i18next 加载时可能触碰 document/window 全局。使用 top-level await dynamic import
// 以确保 happy-dom 已经注册 window/document。
await import('./src/renderer/lib/i18n.ts')
