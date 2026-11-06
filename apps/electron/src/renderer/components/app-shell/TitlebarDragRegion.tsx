// apps/electron/src/renderer/components/app-shell/TitlebarDragRegion.tsx
/**
 * TitlebarDragRegion — 无边框窗口顶部 50px 可拖动标题栏带
 *
 * 复用 styles/utilities.css 的 .titlebar-drag-region（-webkit-app-region: drag），
 * 固定在窗口顶部，承载窗口拖动 + macOS 红绿灯区。
 * 主界面（AppShell）与登录前界面（AuthSplash / LoginPage）共用，避免内联重复。
 */

import * as React from 'react'

export function TitlebarDragRegion(): React.ReactElement {
  return <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-50" />
}
