/** 独立原生正式 UI 构建；不改变 Electron 默认配置和产物。 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import pkg from './package.json' with { type: 'json' }
export default defineConfig({
  root: resolve(__dirname, 'src/tauri-formal'), base: './', plugins: [react()],
  define: { __TINKER_CANDIDATE__: 'false', __APP_VERSION__: JSON.stringify(pkg.version), __LOGIN_ENABLED__: 'false' },
  resolve: { dedupe: ['react', 'react-dom', 'jotai'], alias: {
    '@sentry/electron/renderer': resolve(__dirname, 'src/tauri-formal/sentry-adapter.ts'),
    '@/types': resolve(__dirname, 'src/types'), '@': resolve(__dirname, 'src/renderer'),
  } },
  css: { postcss: resolve(__dirname, 'postcss.config.js') },
  build: { target: 'esnext', outDir: resolve(__dirname, '../tinker-rust/formal-dist'), emptyOutDir: true },
})
