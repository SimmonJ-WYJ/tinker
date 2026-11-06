/**
 * 结果输出卡片图标（设计稿提供的 20×20 Streamline 线性图标）。
 *
 * 用于 Agent 产物卡片(ArtifactCard)与研究空白结果卡片,按结果类型区分:
 *   代码类别 → CodeFileIcon / HTML → WebIcon / 文本 → TextFileIcon / 研究空白洞察 → TelescopeIcon。
 *
 * 约定:颜色一律 `currentColor`(原稿 #9B9B9B 已替换),跟随容器 text 色;描边 1.5、round 线帽线接;
 * 尺寸由 className 控制(如 size-5),不写死 width/height。
 */
import * as React from 'react'

interface IconProps {
  className?: string
}

const SVG = {
  viewBox: '0 0 20 20',
  fill: 'none' as const,
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: false,
}
const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** 代码类别（文件 + 尖括号） */
export function CodeFileIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...SVG} className={className}>
      <path d="M16.875 16.875C16.875 17.2065 16.7432 17.5245 16.5089 17.7589C16.2745 17.9932 15.9565 18.125 15.625 18.125H4.375C4.04348 18.125 3.72554 17.9932 3.49111 17.7589C3.2567 17.5245 3.125 17.2065 3.125 16.875V3.125C3.125 2.79348 3.2567 2.47554 3.49111 2.24112C3.72554 2.0067 4.04348 1.875 4.375 1.875H12.5L16.875 6.25V16.875Z" {...STROKE} />
      <path d="M8.125 14.375L5.625 11.875L8.125 9.375" {...STROKE} />
      <path d="M11.875 14.375L14.375 11.875L11.875 9.375" {...STROKE} />
    </svg>
  )
}

/** HTML / 网页（地球） */
export function WebIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...SVG} className={className}>
      <path d="M10 18.125C14.4874 18.125 18.125 14.4874 18.125 10C18.125 5.51269 14.4874 1.875 10 1.875C5.51269 1.875 1.875 5.51269 1.875 10C1.875 14.4874 5.51269 18.125 10 18.125Z" {...STROKE} />
      <path d="M1.875 10H18.125" {...STROKE} />
      <path d="M13.125 10C12.9715 12.9712 11.8771 15.8166 10 18.125C8.1229 15.8166 7.0285 12.9712 6.875 10C7.0285 7.02876 8.1229 4.18331 10 1.875C11.8771 4.18331 12.9715 7.02876 13.125 10Z" {...STROKE} />
    </svg>
  )
}

/** 文本（文件 + 文本行） */
export function TextFileIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...SVG} className={className}>
      <path d="M16.875 16.875C16.875 17.2065 16.7432 17.5245 16.5089 17.7589C16.2745 17.9932 15.9565 18.125 15.625 18.125H4.375C4.04348 18.125 3.72554 17.9932 3.49111 17.7589C3.2567 17.5245 3.125 17.2065 3.125 16.875V3.125C3.125 2.79348 3.2567 2.47554 3.49111 2.24112C3.72554 2.0067 4.04348 1.875 4.375 1.875H12.5L16.875 6.25V16.875Z" {...STROKE} />
      <path d="M7 7.5H12.5" {...STROKE} />
      <path d="M7 10.5H12.5" {...STROKE} />
      <path d="M7 13.5H12.5" {...STROKE} />
    </svg>
  )
}

/** 研究空白洞察（望远镜） */
export function TelescopeIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg {...SVG} className={className}>
      <path d="M6.67394 7.26782L2.14981 8.91657" {...STROKE} />
      <path d="M3.24905 11.9328L7.77319 10.2841" {...STROKE} />
      <path d="M6.39923 6.51383L8.04799 11.0379L18.125 8.21967L15.9268 2.1875L6.39923 6.51383Z" {...STROKE} />
      <path d="M8.12134 17.8124L11.2463 10.1434L14.3714 17.8124" {...STROKE} />
      <path d="M1.875 8.1626L3.52375 12.6867" {...STROKE} />
    </svg>
  )
}
