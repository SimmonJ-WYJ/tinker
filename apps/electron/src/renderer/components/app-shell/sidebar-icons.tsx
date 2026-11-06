/**
 * 左侧边栏自定义图标（设计稿提供的 16×16 线性图标）。
 *
 * 统一约定：
 * - 颜色一律 `currentColor`（原稿里的 black / #0A0A0A 已替换），跟随所在菜单项的 text 色，
 *   选中态 / hover 态自动变色，无需额外处理；
 * - 去掉原稿的 <clipPath>（只是裁到 16×16 视框，等同 viewBox，无视觉影响），避免多图标同页 id 冲突；
 * - 描边 1.3、round 线帽线接，保持设计稿观感；尺寸默认 16，可用 className 覆盖（如 size-[18px]）。
 */
import * as React from 'react'

interface SidebarIconProps {
  size?: number
  className?: string
}

function baseProps(size: number, className?: string): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    className,
    'aria-hidden': true,
    focusable: false,
  }
}

const STROKE = {
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** 搜索 */
export function SearchIcon({ size = 16, className }: SidebarIconProps): React.ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M7 12.5C10.0376 12.5 12.5 10.0376 12.5 7C12.5 3.96243 10.0376 1.5 7 1.5C3.96243 1.5 1.5 3.96243 1.5 7C1.5 10.0376 3.96243 12.5 7 12.5Z" {...STROKE} />
      <path d="M14.5 14.5L11 11" {...STROKE} />
    </svg>
  )
}

/** 配置 */
export function ConfigurationIcon({ size = 16, className }: SidebarIconProps): React.ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M1.5 2.5V13.5C1.5 14.0523 1.94771 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94771 14.0523 1.5 13.5 1.5H2.5C1.94771 1.5 1.5 1.94771 1.5 2.5Z" {...STROKE} />
      <path d="M5.5 12V7" {...STROKE} />
      <path d="M5.5 7C6.32843 7 7 6.32843 7 5.5C7 4.67157 6.32843 4 5.5 4C4.67157 4 4 4.67157 4 5.5C4 6.32843 4.67157 7 5.5 7Z" {...STROKE} />
      <path d="M10.5 4V7" {...STROKE} />
      <path d="M10.5 10V12" {...STROKE} />
      <path d="M10.5 10C11.3284 10 12 9.32843 12 8.5C12 7.67157 11.3284 7 10.5 7C9.67157 7 9 7.67157 9 8.5C9 9.32843 9.67157 10 10.5 10Z" {...STROKE} />
    </svg>
  )
}

/** 文献库 */
export function LibraryIcon({ size = 16, className }: SidebarIconProps): React.ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M13.5 14.5H4C3.60218 14.5 3.22064 14.342 2.93934 14.0607C2.65804 13.7794 2.5 13.3978 2.5 13C2.5 12.6022 2.65804 12.2206 2.93934 11.9393C3.22064 11.658 3.60218 11.5 4 11.5H12.5C12.7652 11.5 13.0196 11.3946 13.2071 11.2071C13.3946 11.0196 13.5 10.7652 13.5 10.5V2.5C13.5 2.23478 13.3946 1.98043 13.2071 1.79289C13.0196 1.60536 12.7652 1.5 12.5 1.5H4C3.60901 1.49986 3.23342 1.65239 2.95324 1.92511C2.67305 2.19782 2.51043 2.56915 2.5 2.96V12.96" {...STROKE} />
      <path d="M6 5H10" {...STROKE} />
      <path d="M6 8H10" {...STROKE} />
      <path d="M12.5 11.5V14.5" {...STROKE} />
    </svg>
  )
}

/** 证据集 */
export function EvidenceIcon({ size = 16, className }: SidebarIconProps): React.ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M13.7188 13.5C13.7188 13.7652 13.6134 14.0196 13.4259 14.2071C13.2383 14.3946 12.984 14.5 12.7188 14.5H3.71875C3.45353 14.5 3.19918 14.3946 3.01164 14.2071C2.82411 14.0196 2.71875 13.7652 2.71875 13.5V2.5C2.71875 2.23478 2.82411 1.98043 3.01164 1.79289C3.19918 1.60536 3.45353 1.5 3.71875 1.5H9.30454C9.56975 1.5 9.82411 1.60536 10.0116 1.79289L13.4259 5.20711C13.6134 5.39464 13.7188 5.649 13.7188 5.91421V13.5Z" {...STROKE} />
      <path d="M8.77734 7.375H11.2773" {...STROKE} />
      <path d="M8.77734 10.8438H11.2773" {...STROKE} />
      <path d="M4.91016 10.7871L5.74805 11.625L7.14453 9.66992" {...STROKE} />
      <path d="M4.91016 7.25586L5.74805 8.09375L7.14453 6.13867" {...STROKE} />
    </svg>
  )
}

/** 新建任务 */
export function AddTaskIcon({ size = 16, className }: SidebarIconProps): React.ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" {...STROKE} />
      <path d="M8 5V11" {...STROKE} />
      <path d="M5 8H11" {...STROKE} />
    </svg>
  )
}

/** 折叠侧栏（矩形 + 左侧竖分隔线） */
export function FoldIcon({ size = 16, className }: SidebarIconProps): React.ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path d="M2.92308 13H13.0769C13.5867 13 14 12.6556 14 12.2308V3.76923C14 3.3444 13.5867 3 13.0769 3H2.92308C2.41328 3 2 3.3444 2 3.76923V12.2308C2 12.6556 2.41328 13 2.92308 13Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 3V13" stroke="currentColor" />
    </svg>
  )
}

/**
 * 项目（工作区切换器的文件夹标）。原稿为填充式：folder + 角标 + 中部加号镂空。
 * 主体填 currentColor、角标降透明度还原双色层次；加号镂空靠 fill-rule=evenodd 透出底色。
 */
export function ProjectIcon({ size = 16, className }: SidebarIconProps): React.ReactElement {
  return (
    <svg {...baseProps(size, className)}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.18345 1.49994C6.52332 1.49185 6.85595 1.59947 7.12675 1.80527C7.39945 2.01253 7.5932 2.30766 7.67544 2.64015L7.89039 3.49994H13.5C13.8978 3.49994 14.2794 3.65797 14.5607 3.93928C14.842 4.22058 15 4.60211 15 4.99994V12.9999C15 13.3978 14.842 13.7793 14.5607 14.0606C14.2794 14.3419 13.8978 14.4999 13.5 14.4999H2.5C2.10217 14.4999 1.72064 14.3419 1.43934 14.0606C1.15804 13.7793 1 13.3978 1 12.9999V2.99994C1 2.60211 1.15804 2.22058 1.43934 1.93928C1.72064 1.65797 2.10218 1.49994 2.5 1.49994H6.18345ZM5.5 8.25C5.08579 8.25 4.75 8.58579 4.75 9C4.75 9.41421 5.08579 9.75 5.5 9.75H10.5C10.9142 9.75 11.25 9.41421 11.25 9C11.25 8.58579 10.9142 8.25 10.5 8.25H5.5Z"
        fill="currentColor"
      />
      <path
        d="M1 2.8C1 1.80589 1.80589 1 2.8 1H5.5C6.88071 1 8 2.11929 8 3.5H1V2.8Z"
        fill="currentColor"
        opacity={0.55}
      />
    </svg>
  )
}
