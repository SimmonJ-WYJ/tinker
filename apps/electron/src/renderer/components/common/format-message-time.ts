/**
 * 格式化消息时间（简略写法）
 * - 今年：02/12 14:30
 * - 跨年：2025/02/12 14:30
 *
 * 实现已收敛到 @/utils/dayjs（统一走 dayjs）；此处仅为兼容旧导入路径转发。
 */
export { formatMessageTime } from '@/utils/dayjs'
