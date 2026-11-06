import { describe, expect, mock, test } from 'bun:test'

// stub electron —— bun runtime 无 Electron context，orchestrator 间接导入 safeStorage/app/BrowserWindow
mock.module('electron', () => ({
  app: {
    getPath: () => '/tmp',
    getName: () => 'ASCI',
    isPackaged: false,
    on: () => {},
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
  BrowserWindow: class {
    static getAllWindows() { return [] }
    static fromWebContents() { return null }
  },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
  shell: { openExternal: () => {}, openPath: () => {} },
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) },
  nativeTheme: { shouldUseDarkColors: false, on: () => {} },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
}))

const { shouldDenyReadForPdfDocumentBlock, isLikelyPdfDocumentBlockIncompatibility } = await import('./agent-orchestrator.ts')

describe('shouldDenyReadForPdfDocumentBlock', () => {
  test('Read on .pdf + 渠道不支持 → 应拒绝', () => {
    expect(
      shouldDenyReadForPdfDocumentBlock({
        toolName: 'Read',
        input: { file_path: '/tmp/asci-small-rootcause.pdf' },
        supportsPdfDocumentBlock: false,
      }),
    ).toBe(true)
  })

  test('Read on .pdf + 渠道支持 → 放行', () => {
    expect(
      shouldDenyReadForPdfDocumentBlock({
        toolName: 'Read',
        input: { file_path: '/tmp/foo.pdf' },
        supportsPdfDocumentBlock: true,
      }),
    ).toBe(false)
  })

  test('Read on 非 .pdf → 放行（任何渠道）', () => {
    expect(
      shouldDenyReadForPdfDocumentBlock({
        toolName: 'Read',
        input: { file_path: '/tmp/foo.txt' },
        supportsPdfDocumentBlock: false,
      }),
    ).toBe(false)
  })

  test('扩展名大小写不敏感', () => {
    expect(
      shouldDenyReadForPdfDocumentBlock({
        toolName: 'Read',
        input: { file_path: '/tmp/Foo.PDF' },
        supportsPdfDocumentBlock: false,
      }),
    ).toBe(true)
  })

  test('其他工具 → 放行', () => {
    expect(
      shouldDenyReadForPdfDocumentBlock({
        toolName: 'Write',
        input: { file_path: '/tmp/foo.pdf' },
        supportsPdfDocumentBlock: false,
      }),
    ).toBe(false)
  })

  test('file_path 缺失 → 放行（不阻挡 SDK 自身参数校验）', () => {
    expect(
      shouldDenyReadForPdfDocumentBlock({
        toolName: 'Read',
        input: {},
        supportsPdfDocumentBlock: false,
      }),
    ).toBe(false)
  })
})

describe('isLikelyPdfDocumentBlockIncompatibility', () => {
  test('5xx + 渠道不支持 → 命中', () => {
    expect(
      isLikelyPdfDocumentBlockIncompatibility({
        statusCode: 500,
        providerSupportsPdfDocumentBlock: false,
      }),
    ).toBe(true)
  })

  test('5xx + 渠道支持 → 不命中（认为是真的服务端错误）', () => {
    expect(
      isLikelyPdfDocumentBlockIncompatibility({
        statusCode: 503,
        providerSupportsPdfDocumentBlock: true,
      }),
    ).toBe(false)
  })

  test('4xx → 不命中', () => {
    expect(
      isLikelyPdfDocumentBlockIncompatibility({
        statusCode: 429,
        providerSupportsPdfDocumentBlock: false,
      }),
    ).toBe(false)
  })

  test('statusCode 缺失 → 不命中', () => {
    expect(
      isLikelyPdfDocumentBlockIncompatibility({
        statusCode: undefined,
        providerSupportsPdfDocumentBlock: false,
      }),
    ).toBe(false)
  })

  test('599 边界 → 命中', () => {
    expect(
      isLikelyPdfDocumentBlockIncompatibility({
        statusCode: 599,
        providerSupportsPdfDocumentBlock: false,
      }),
    ).toBe(true)
  })

  test('600（超出 5xx 上限） → 不命中', () => {
    expect(
      isLikelyPdfDocumentBlockIncompatibility({
        statusCode: 600,
        providerSupportsPdfDocumentBlock: false,
      }),
    ).toBe(false)
  })
})
