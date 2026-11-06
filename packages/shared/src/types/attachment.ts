/**
 * 附件相关类型定义
 *
 * 从 chat.ts 抽出，供 Agent、attachment-service、@asci/core 等
 * 保留模块复用。
 */

/** 文件附件 */
export interface FileAttachment {
  /** 附件唯一标识 */
  id: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** 相对路径: {conversationId}/{uuid}.ext */
  localPath: string
  /** 文件大小（字节） */
  size: number
}

/** 保存附件输入 */
export interface AttachmentSaveInput {
  /** 对话 ID */
  conversationId: string
  /** 原始文件名 */
  filename: string
  /** MIME 类型 */
  mediaType: string
  /** base64 编码的文件数据 */
  data: string
}

/** 保存附件结果 */
export interface AttachmentSaveResult {
  /** 保存后的附件信息 */
  attachment: FileAttachment
}

/** 文件选择对话框结果 */
export interface FileDialogResult {
  /** 选择的文件列表 */
  files: Array<{
    filename: string
    mediaType: string
    data: string
    size: number
  }>
}

// ===== IPC 通道常量 =====

/**
 * 附件相关 IPC 通道常量
 *
 * 历史通道值沿用 `chat:*` 前缀以保持运行时兼容（零 handler 值变更）。
 * 未来若要改名为 `attachment:*`，需同步主进程 handler / preload / renderer 调用点。
 */
export const ATTACHMENT_IPC_CHANNELS = {
  /** 保存附件到本地 */
  SAVE_ATTACHMENT: 'chat:save-attachment',
  /** 读取附件（返回 base64） */
  READ_ATTACHMENT: 'chat:read-attachment',
  /** 另存图片到用户选择的位置（原生 Save As 对话框） */
  SAVE_IMAGE_AS: 'chat:save-image-as',
  /** 保存应用内置资源文件到用户选择的位置（原生 Save As 对话框） */
  SAVE_RESOURCE_FILE_AS: 'chat:save-resource-file-as',
  /** 删除附件 */
  DELETE_ATTACHMENT: 'chat:delete-attachment',
  /** 打开文件选择对话框 */
  OPEN_FILE_DIALOG: 'chat:open-file-dialog',
  /** 提取附件文档的文本内容 */
  EXTRACT_ATTACHMENT_TEXT: 'chat:extract-attachment-text',
} as const
