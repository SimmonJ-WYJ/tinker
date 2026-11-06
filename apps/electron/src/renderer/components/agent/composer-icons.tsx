/**
 * 输入框底部工具条图标（设计稿提供的线性图标）。
 *
 * - PlusIcon：新增/附件（+）
 * - TapIcon：智能审批（单指点按）
 * - ClipboardCheckIcon：完全自动（剪贴板打勾）
 * - TaskListIcon：计划模式（任务清单）
 *
 * 颜色一律 currentColor（原稿 black / #737373 已替换），跟随容器 text 色；尺寸由 className 控制。
 */
import * as React from 'react'

interface IconProps {
  className?: string
}

const SVG = {
  fill: 'none' as const,
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: false,
}
const STROKE = { stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** 新增 / 附件（+） */
export function PlusIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg viewBox="0 0 11 11" {...SVG} className={className}>
      <path d="M0 5H11V6H0V5Z" fill="currentColor" />
      <path d="M5 0H6V11H5V0Z" fill="currentColor" />
    </svg>
  )
}

/** 智能审批（单指点按） */
export function TapIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg viewBox="0 0 14 14" {...SVG} className={className}>
      <path d="M12 13.421V10.6222C12 9.2184 10.862 8.08042 9.45823 8.08042H7.25057V3.95561C7.25057 3.29974 6.71889 2.76807 6.06303 2.76807C5.40716 2.76807 4.87549 3.29974 4.87549 3.95561L4.87548 9.36262L4.47947 9.43715C3.27536 9.66376 2.70234 11.054 3.39706 12.0632L3.55679 12.2953L4.33075 13.421" {...STROKE} />
      <path d="M2.61143 4.95764C2.55079 4.69698 2.51874 4.42536 2.51874 4.14624C2.51874 2.17617 4.11581 0.579102 6.08588 0.579102C8.05596 0.579102 9.65302 2.17617 9.65302 4.14624C9.65302 4.42536 9.62096 4.69698 9.56034 4.95764" {...STROKE} />
    </svg>
  )
}

/** 完全自动（剪贴板打勾） */
export function ClipboardCheckIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg viewBox="0 0 14 14" {...SVG} className={className}>
      <path d="M8.5 0.5H5.5C4.94772 0.5 4.5 0.947715 4.5 1.5V2C4.5 2.55228 4.94772 3 5.5 3H8.5C9.05228 3 9.5 2.55228 9.5 2V1.5C9.5 0.947715 9.05228 0.5 8.5 0.5Z" {...STROKE} />
      <path d="M9.75 1.5H11.25C11.5152 1.5 11.7696 1.60536 11.9571 1.79289C12.1446 1.98043 12.25 2.23478 12.25 2.5V12.5C12.25 12.7652 12.1446 13.0196 11.9571 13.2071C11.7696 13.3946 11.5152 13.5 11.25 13.5H2.75C2.48478 13.5 2.23043 13.3946 2.04289 13.2071C1.85536 13.0196 1.75 12.7652 1.75 12.5V2.5C1.75 2.23478 1.85536 1.98043 2.04289 1.79289C2.23043 1.60536 2.48478 1.5 2.75 1.5H4.25" {...STROKE} />
      <path d="M5 9L6.5 10L9.5 6" {...STROKE} />
    </svg>
  )
}

/** 管理渠道与模型（数据库 + 设置齿轮） */
export function DatabaseSettingIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg viewBox="0 0 16 16" {...SVG} className={className}>
      <path d="M7.27374 5.63833C10.2493 5.63833 12.6615 4.70854 12.6615 3.5616C12.6615 2.41465 10.2493 1.48486 7.27374 1.48486C4.29816 1.48486 1.88599 2.41465 1.88599 3.5616C1.88599 4.70854 4.29816 5.63833 7.27374 5.63833Z" {...STROKE} />
      <path d="M12.6615 5.89295V3.56152" {...STROKE} />
      <path d="M1.88599 3.56152V10.1836C1.88599 11.2327 3.8925 12.0669 6.50075 12.2321" {...STROKE} />
      <path d="M1.88599 6.87256C1.88599 7.93678 3.99746 8.81519 6.65194 8.90393" {...STROKE} />
      <path d="M11.6525 7.3623V8.83169" {...STROKE} />
      <path d="M8.6843 9.07666L9.95776 9.81135" {...STROKE} />
      <path d="M8.6843 12.5052L9.95776 11.7705" {...STROKE} />
      <path d="M11.6525 14.2194V12.75" {...STROKE} />
      <path d="M14.6207 12.5052L13.3472 11.7705" {...STROKE} />
      <path d="M14.6207 9.07666L13.3472 9.81135" {...STROKE} />
      <path d="M11.6525 12.7504C12.7345 12.7504 13.6117 11.8733 13.6117 10.7912C13.6117 9.70919 12.7345 8.83203 11.6525 8.83203C10.5705 8.83203 9.6933 9.70919 9.6933 10.7912C9.6933 11.8733 10.5705 12.7504 11.6525 12.7504Z" {...STROKE} />
    </svg>
  )
}

/**
 * 发送（圆形上箭头）。圆底 fill=currentColor（由按钮 text 色控制：默认浅灰、有输入变黑），
 * 箭头恒为白色。
 */
export function SubmitIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg viewBox="0 0 32 32" {...SVG} className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="M16 32C20.2435 32 24.3131 30.3143 27.3137 27.3137C30.3143 24.3131 32 20.2435 32 16C32 11.7565 30.3143 7.68687 27.3137 4.68629C24.3131 1.68571 20.2435 0 16 0C11.7565 0 7.68687 1.68571 4.68629 4.68629C1.68571 7.68687 0 11.7565 0 16C0 20.2435 1.68571 24.3131 4.68629 27.3137C7.68687 30.3143 11.7565 32 16 32Z" fill="currentColor" />
      <path d="M15.837 10.1336L15.837 21.793" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21.5407 16.3481L16.2264 10.311C16.1778 10.2559 16.1179 10.2117 16.0509 10.1814C15.9838 10.1511 15.9111 10.1355 15.8376 10.1355C15.764 10.1355 15.6913 10.1511 15.6242 10.1814C15.5572 10.2117 15.4973 10.2559 15.4487 10.311L10.1333 16.3481" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 计划模式（任务清单） */
export function TaskListIcon({ className }: IconProps): React.ReactElement {
  return (
    <svg viewBox="0 0 14 14" {...SVG} className={className}>
      <path d="M12.7188 12.5C12.7188 12.7652 12.6134 13.0196 12.4259 13.2071C12.2383 13.3946 11.984 13.5 11.7188 13.5H2.71875C2.45353 13.5 2.19918 13.3946 2.01164 13.2071C1.82411 13.0196 1.71875 12.7652 1.71875 12.5V1.5C1.71875 1.23478 1.82411 0.98043 2.01164 0.792893C2.19918 0.605357 2.45353 0.5 2.71875 0.5H8.30454C8.56975 0.5 8.82411 0.605357 9.01164 0.792893L12.4259 4.20711C12.6134 4.39464 12.7188 4.649 12.7188 4.91421V12.5Z" {...STROKE} />
      <path d="M6.77734 6.375H10.2773" {...STROKE} />
      <path d="M4.5 6.375H5" {...STROKE} />
      <path d="M6.77734 9.84375H10.2773" {...STROKE} />
      <path d="M4.5 9.84375H5" {...STROKE} />
    </svg>
  )
}
