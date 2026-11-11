/** QA-only renderer probe；不修改原 App/样式/正式构建。 */
import { mergeConfig } from 'vite'
import { resolve } from 'node:path'
import formal from './vite.formal.config.ts'
export default mergeConfig(formal, {
  plugins: [{ name: 'owned-native-qa', transformIndexHtml: { order: 'pre', handler: (html: string) => html.replace('./entry.ts', './qa-entry.ts') } }],
  build: { outDir: resolve(__dirname, '../tinker-rust/native-qa-dist') },
})
