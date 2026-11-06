/**
 * 媒体识别结果缓存类型
 *
 * 一个缓存条目 = 一份图片描述或音频转写的结果 + 足够的元数据判定命中。
 * 缓存命中条件：(itemKey, attachmentKey, modelId) 唯一，且 entry.mtime === 当前文件 mtime。
 */
export interface MediaCacheEntry {
  type: 'audio' | 'image'
  itemKey: string          // Zotero library item key
  attachmentKey: string    // Zotero attachment key
  modelId: string          // 'qwen3-asr-0.6b' / 'claude-sonnet-4-6' 等
  mtime: number            // POSIX ms，文件最后修改时间（缓存键一部分）
  result: string           // 音频转写 / 图片描述的最终文本
  recognizedAt: number     // POSIX ms，识别完成时间戳
  durationMs: number       // 识别耗时（不是音频时长）
  sourceSize: number       // 源文件字节数
  /** OCR 工具存储的逐行信息（文本 / 置信度 / bbox）；非 OCR 结果可省略 */
  lines?: Array<{
    text: string
    confidence: number
    bbox: { x: number; y: number; width: number; height: number }
  }>
}

/**
 * MCP 工具向 Agent 返回错误的统一协议。
 */
export interface MediaToolError {
  code: string             // UPPER_SNAKE_CASE，如 'WEIGHTS_MISSING' / 'VISION_NOT_SUPPORTED'
  message: string          // 面向用户的中文描述
  details?: unknown        // 原始错误上下文（开发调试用，不保证稳定结构）
  retryable?: boolean      // 是否值得重试；默认 false
}

/**
 * 缓存统计信息（供设置面板展示）。
 */
export interface MediaCacheStats {
  entryCount: number
  totalBytes: number
}

// ===== ASR 权重下载状态 =====

/**
 * ASR 模型权重的生命期状态。
 *
 * missing       → 本机无权重文件
 * downloading   → 正在从远端拉 tar.bz2
 * extracting    → 下载完成，正在解压
 * verifying     → 校验解压后的 model.int8.onnx + tokens.txt 是否齐全
 * ready         → 已就绪，modelPath 可用
 * error         → 出错，error 字段带信息，可重试
 */
export type AsrWeightState = 'missing' | 'downloading' | 'extracting' | 'verifying' | 'ready' | 'error'

export interface AsrWeightProgress {
  /** 下载阶段 = download；解压阶段 = extract */
  phase: 'download' | 'extract'
  bytesDone: number
  bytesTotal?: number
  /** 预估剩余秒数；首包/抽搐时可能缺失 */
  etaSeconds?: number
}

export interface AsrWeightStatus {
  /** 唯一标识，也是缓存目录名的一部分 */
  modelId: string
  /** 面向用户的名字 */
  displayName: string
  /** 下载源 URL（tar.bz2） */
  sourceUrl: string
  /** 解压后文件总大小（字节，估算） */
  expectedBytes: number
  state: AsrWeightState
  progress?: AsrWeightProgress
  error?: string
  /** 就绪时：模型根目录绝对路径 */
  modelPath?: string
}

/**
 * ASR 权重管理 IPC 通道
 */
export const ASR_WEIGHTS_IPC_CHANNELS = {
  /** 渲染进程主动查一次状态 */
  GET_STATUS: 'asr-weights:get-status',
  /** 触发下载（若未就绪） */
  DOWNLOAD: 'asr-weights:download',
  /** 取消正在进行的下载 */
  CANCEL: 'asr-weights:cancel',
  /** 删除已下载的权重 */
  DELETE: 'asr-weights:delete',
  /** 主进程推送状态变更事件 */
  STATUS_CHANGED: 'asr-weights:status-changed',
} as const
export type AsrWeightsIpcChannel = typeof ASR_WEIGHTS_IPC_CHANNELS[keyof typeof ASR_WEIGHTS_IPC_CHANNELS]
