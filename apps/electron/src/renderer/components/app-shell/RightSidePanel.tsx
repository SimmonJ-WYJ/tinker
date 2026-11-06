/**
 * 右侧边栏壳子 —— Tab 化容器。
 * 实际渲染由 RightPanelTabHost 接管（包含 TabBar + TabContent）。
 */
import * as React from 'react'
import { RightPanelTabHost } from './RightPanelTabHost'

export function RightSidePanel(): React.ReactElement | null {
  return <RightPanelTabHost />
}
