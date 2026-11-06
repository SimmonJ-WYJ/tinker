/**
 * 媒体缓存相关 IPC 通道常量
 *
 * 渠道由主进程实现（direct 读写磁盘），渲染进程通过 window.electronAPI.mediaCache.* 调用。
 * 音频 / 权重下载相关通道留到 P2 再加。
 */
export const MEDIA_IPC_CHANNELS = {
  CACHE_STATS: 'media-cache:stats',
  CACHE_CLEAR: 'media-cache:clear',
} as const

export type MediaIpcChannel = typeof MEDIA_IPC_CHANNELS[keyof typeof MEDIA_IPC_CHANNELS]
