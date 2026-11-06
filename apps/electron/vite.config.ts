import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

// 仅在生产构建注入 CSP meta，避免开发期 Vite HMR / React Refresh 依赖 `unsafe-eval` 触发警告
function productionCspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' 仅放行 WebAssembly.instantiate（Shiki 的 oniguruma 引擎需要），不放行 JS eval
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // blob: 放行 pdf.js 经 Blob URL 加载 PDF（getDocument(blobUrl) 走 connect-src 抓取）；
    // 打包后缺它会被 CSP 拦掉导致 Library PDF 卡在 Loading（dev 无 CSP 故不复现）
    "connect-src 'self' https: wss: blob:",
    "media-src 'self' data: blob:",
    "frame-src 'self' http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    name: 'asci-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
    },
  }
}

export default defineConfig({
  plugins: [react(), productionCspPlugin()],
  define: {
    __TINKER_CANDIDATE__: JSON.stringify(process.env.TINKER_CANDIDATE === '1'),
    __APP_VERSION__: JSON.stringify(pkg.version),
    // 全局登录开关：默认开启，仅 `bun run dev:skip-login`（ASCI_SKIP_LOGIN=1）时为 false。
    // 普通 vite dev / vite build（生产打包）env 未设置 → 注入 true，登录链路保留进产物。
    __LOGIN_ENABLED__: JSON.stringify(process.env.ASCI_SKIP_LOGIN !== '1'),
  },
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    // renderer 只跑在 Electron 39 内置的现代 Chromium 里，无需向 chrome87 等老浏览器降级
    // （vite 默认 target）。显式 esnext 既贴合实际运行环境，也规避 esbuild 0.28 对对象
    // 解构降级到旧 target 时误报 "destructuring not supported yet" 的 bug（安全升级前置）。
    target: 'esnext',
  },
  // dev 依赖预打包（optimizeDeps）默认走 Vite 的 `modules` baseline（chrome87/es2020…），
  // 不受 build.target 影响；esbuild 0.28 在该旧 target 下会对第三方包（@tiptap/@radix-ui）
  // 的对象解构误报 "destructuring not supported yet"。renderer 只跑在 Electron 现代
  // Chromium，这里同样拉到 esnext，与 build.target 对齐，规避该 bug。
  optimizeDeps: {
    include: ['thinking-orbs'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  resolve: {
    // Workspace packages must share the renderer's React hook dispatcher.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@/types': resolve(__dirname, 'src/types'),
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // 确保使用指定端口，如被占用则报错
    open: false,
  },
})
