/**
 * 数据导出（DO-2，issue #419）—— IPC 通道 + 导出包清单类型
 *
 * 用户从 Settings 账户 tab 一键导出全部本地研究数据为 zip **导出包**，
 * 内容符合 O1 对象标准（schema/objects/*.schema.json）且导出时经 ajv 校验。
 *
 * `ExportManifest` 是导出包内 manifest.json 的类型——它同样经
 * `scripts/generate-object-schemas.ts` 生成 schema/manifest.schema.json，
 * 导入方先读清单再解析数据文件。
 *
 * 领域语言见 CONTEXT.md §数据所有权；设计见 docs/specs/data-export-do2-spec.md。
 */

export const DATA_EXPORT_IPC_CHANNELS = {
  /** 弹 Save As 选路径 → 全量读取 → ajv 校验 → 打 zip；校验失败中止不落盘 */
  EXPORT_MY_DATA: 'dataExport:exportMyData',
} as const

/** 导出包内单个数据文件的清单条目 */
export interface ExportManifestFileEntry {
  /** zip 内数据文件相对路径（如 `papers.json`） */
  path: string
  /** zip 内对应 schema 相对路径（如 `schema/objects/paper.schema.json`） */
  schema: string
  /** 该文件内的对象条数 */
  count: number
}

/** 导出包自描述清单（zip 内 manifest.json） */
export interface ExportManifest {
  /** 导出包格式版本；结构性变化时递增 */
  exportFormatVersion: 1
  /** 产出导出包的 ASCI 应用版本 */
  appVersion: string
  /** 导出时间（ISO 8601） */
  exportedAt: string
  /** 数据文件清单（文件 ↔ schema ↔ 计数） */
  files: ExportManifestFileEntry[]
  /** 非致命警告（如某综述正文文件缺失）；致命问题直接中止导出 */
  warnings: string[]
}

/** EXPORT_MY_DATA 响应：成功 / 用户取消 Save As / 失败（含 ajv 校验中止） */
export type ExportMyDataResult =
  | { status: 'ok'; filePath: string; objectCount: number }
  | { status: 'canceled' }
  | { status: 'error'; message: string }
