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

const { AgentOrchestrator } = await import('./agent-orchestrator.ts')

describe('AgentOrchestrator.setAuthService', () => {
  it('暴露 setAuthService 用于主进程接线（接受 null 表示未绑定）', () => {
    // 仅验证 API 形状，不构造完整依赖
    expect(typeof AgentOrchestrator.prototype.setAuthService).toBe('function')
  })
})
