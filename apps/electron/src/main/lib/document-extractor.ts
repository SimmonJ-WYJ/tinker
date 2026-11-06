/**
 * 文档文本提取（纯函数）
 *
 * 只依赖 Node 内置模块 + npm 解析库，不依赖 Electron。
 * 这样可以被 Zotero MCP 子进程 bundle 使用（MCP 跑在 Node 进程，拿不到 electron）。
 *
 * 支持的格式：
 * - PDF → pdf-parse
 * - DOC → word-extractor（旧版 Word）
 * - DOCX/XLSX/PPTX/ODP/ODS/ODT → officeparser
 * - TXT/MD/CSV/JSON/XML/HTML/JS/TS/PY 等 → 直接 UTF-8 读取
 */

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

// ===== 文件类型分类 =====

/** officeparser 支持的格式 */
const OFFICE_EXTENSIONS = new Set([
  '.docx', '.xlsx', '.pptx',
  '.odt', '.odp', '.ods',
])

/** 纯文本格式（直接 UTF-8 读取） */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html',
  '.js', '.ts', '.py', '.yaml', '.yml', '.toml',
  '.log', '.ini', '.cfg', '.conf', '.sh', '.bat',
  '.css', '.scss', '.less', '.sql', '.graphql',
  '.env', '.gitignore', '.dockerfile',
])

/** 所有支持文档解析的扩展名（不含图片） */
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([
  '.pdf', '.doc',
  ...OFFICE_EXTENSIONS,
  ...TEXT_EXTENSIONS,
])

export function isSupportedDocumentExtension(ext: string): boolean {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(ext.toLowerCase())
}

/** MIME 类型层面是否是可解析文档（图片/音频排除，其余按扩展名判定） */
export function isDocumentAttachment(mediaType: string): boolean {
  return !mediaType.startsWith('image/') && !mediaType.startsWith('audio/')
}

/**
 * 从文件中提取纯文本内容
 *
 * - .pdf → pdf-parse
 * - .doc → word-extractor
 * - .docx/.xlsx/.pptx/.odt/.odp/.ods → officeparser
 * - .txt/.md/... → 直接 UTF-8 读取
 * - 未知格式 → 尝试按文本读
 */
export async function extractTextFromFile(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()

  if (ext === '.pdf') return extractPdf(filePath)
  if (ext === '.doc') return extractDoc(filePath)
  if (OFFICE_EXTENSIONS.has(ext)) return extractOffice(filePath)
  if (TEXT_EXTENSIONS.has(ext)) return readFileSync(filePath, 'utf-8')

  console.warn(`[文档解析] 未知格式 ${ext}，尝试作为文本读取: ${filePath}`)
  return readFileSync(filePath, 'utf-8')
}

async function extractPdf(filePath: string): Promise<string> {
  // pdf-parse@1.1.1 的 index.js 顶层有一段 debug 代码：当 `!module.parent` 时
  // 会同步执行 `Fs.readFileSync('./test/data/05-versions-space.pdf')`，被 esbuild
  // 打进 main.cjs 后 module.parent 总为空，导致首次加载即抛 ENOENT。
  // 这里直接 import 内部 lib 绕开 index.js 的 debug 块。
  // @ts-expect-error pdf-parse 的 @types 包没有为 lib 子路径提供声明
  const pdfParseModule = (await import('pdf-parse/lib/pdf-parse.js')) as {
    default: typeof import('pdf-parse')
  }
  const pdfParse = pdfParseModule.default
  const buffer = readFileSync(filePath)
  const result = await pdfParse(buffer)
  console.log(`[文档解析] PDF 提取完成: ${result.numpages} 页, ${result.text.length} 字符`)
  return result.text
}

async function extractDoc(filePath: string): Promise<string> {
  const WordExtractor = (await import('word-extractor')).default
  const extractor = new WordExtractor()
  const extracted = await extractor.extract(filePath)
  const text = extracted.getBody()
  console.log(`[文档解析] DOC 提取完成: ${text.length} 字符`)
  return text
}

async function extractOffice(filePath: string): Promise<string> {
  const officeParser = await import('officeparser')
  // officeparser 默认把解压临时文件写到相对路径 officeParserTemp/tempfiles，
  // Electron 打包 / 沙箱 / cwd 变化下该相对目录不存在或不可写 → mkdir ENOENT（#704）。
  // 显式指定系统 tmpdir 下的一次性目录（mkdtempSync 即创建，满足 officeparser
  // 对 tempFilesLocation 必须预先存在的要求；officeparser 解析后会自清临时文件，
  // 残留的 mkdtemp 父目录交给系统 tmp 清理）。本文件无 Electron 依赖（MCP 子进程复用），
  // 故只用 node 内置 os.tmpdir，不引入 config-paths。
  const tempRoot = mkdtempSync(join(tmpdir(), 'asci-officeparser-'))
  const text = await officeParser.parseOfficeAsync(filePath, { tempFilesLocation: tempRoot })
  console.log(`[文档解析] Office 提取完成: ${text.length} 字符`)
  return text
}
