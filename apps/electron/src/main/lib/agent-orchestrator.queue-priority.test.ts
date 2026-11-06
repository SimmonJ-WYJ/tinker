import { describe, it, expect, mock } from 'bun:test'

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

const { resolveQueuePriority } = await import('./agent-orchestrator.ts')

describe('resolveQueuePriority', () => {
  it('打断走 now（抢占）', () => {
    expect(resolveQueuePriority(true)).toBe('now')
  })
  it('排队走 next（FIFO，当前 turn 后消费）', () => {
    expect(resolveQueuePriority(false)).toBe('next')
  })
  it('undefined 视为排队', () => {
    expect(resolveQueuePriority(undefined)).toBe('next')
  })
})
