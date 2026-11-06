/**
 * ArtifactPanel — 右侧面板 "Artifact" tab 内容（A4 phase4）
 *
 * 能力包运行后的产物（图表 / 表格 / 报告等）出口。
 * 当前为 placeholder：能力包的产物发布通路（capability-pack runtime 写出 artifact）
 * 尚未落地；本组件先占住 UI 位置，后续接入 artifact 注册中心后展开列表渲染。
 */
import * as React from 'react'
import { useT } from '@/hooks/useT'

export function ArtifactPanel(): React.ReactElement {
  const { t } = useT('chrome')

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center">
      <div className="max-w-xs space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          {t('sidePanel.artifact.emptyTitle')}
        </p>
        <p className="text-xs text-muted-foreground/70">
          {t('sidePanel.artifact.emptyHint')}
        </p>
      </div>
    </div>
  )
}
