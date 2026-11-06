import { defineConfig } from 'vite'
// 仅用于当前 macOS WebView 可行性验证；跨平台兼容性另行测试。
export default defineConfig({ base: './', build: { target: 'esnext' } })
