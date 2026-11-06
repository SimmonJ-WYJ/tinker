/**
 * officeparser 类型声明
 *
 * officeparser 不提供内置 TypeScript 类型，
 * 此声明覆盖项目中使用到的 API。
 */
declare module 'officeparser' {
  /** parseOfficeAsync 可选配置（仅覆盖项目用到的字段） */
  export interface OfficeParserConfig {
    /** 解压临时文件目录，必须预先存在；缺省为相对路径 officeParserTemp */
    tempFilesLocation?: string
    /** 出错时是否把日志输出到 console */
    outputErrorToConsole?: boolean
  }

  /**
   * 异步解析 Office 文档并提取纯文本
   *
   * 支持格式：DOCX, XLSX, PPTX, ODT, ODP, ODS
   *
   * @param filePath 文件的完整路径
   * @param config 可选配置（如显式指定 tempFilesLocation，见 #704）
   * @returns 提取的纯文本内容
   */
  export function parseOfficeAsync(filePath: string, config?: OfficeParserConfig): Promise<string>
}
