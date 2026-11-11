/** 在任何旧服务初始化前验证 opt-in；默认仍加载原主进程。 */
import { app } from 'electron'
import { resolveDesktopPreview } from './lib/desktop-runtime/config.ts'
const preview = resolveDesktopPreview(process.env,app.isPackaged)
if (preview) {
  void import('./lib/desktop-runtime/bootstrap.ts').then(({startDesktopPreview})=>startDesktopPreview(preview)).catch(()=>{console.error('DESKTOP_PREVIEW_START');app.exit(1)})
} else {
  require('./index.ts')
}
