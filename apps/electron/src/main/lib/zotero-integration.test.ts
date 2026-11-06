import { test, expect, spyOn, afterEach } from 'bun:test'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as childProcess from 'node:child_process'
import { detectZoteroInstalled, launchZotero, validateZoteroPath } from './zotero-integration.ts'
import * as settingsService from './settings-service.ts'

const originalPlatform = process.platform
const originalPath = process.env.PATH

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

/** 让 getSettings 在测试里返回纯净配置，避免读到真实磁盘 */
function stubSettings(settings: Partial<import('../../types').AppSettings> = {}) {
  return spyOn(settingsService, 'getSettings').mockReturnValue({
    notificationsEnabled: true,
    ...settings,
  })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  process.env.PATH = originalPath
})

test('macOS: /Applications/Zotero.app 存在 → installed', () => {
  setPlatform('darwin')
  const settingsSpy = stubSettings()
  const spy = spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === '/Applications/Zotero.app')
  try {
    const result = detectZoteroInstalled()
    expect(result).toEqual({ installed: true, installedPath: '/Applications/Zotero.app', source: 'default' })
  } finally {
    spy.mockRestore(); settingsSpy.mockRestore()
  }
})

test('macOS: 没装 → installed=false', () => {
  setPlatform('darwin')
  const settingsSpy = stubSettings()
  const spy = spyOn(fs, 'existsSync').mockImplementation(() => false)
  try {
    expect(detectZoteroInstalled()).toEqual({ installed: false })
  } finally {
    spy.mockRestore(); settingsSpy.mockRestore()
  }
})

test('Windows: ProgramFiles\\Zotero\\zotero.exe 存在 → installed', () => {
  setPlatform('win32')
  const expected = 'C:\\Program Files\\Zotero\\zotero.exe'
  const settingsSpy = stubSettings()
  const prev = process.env.ProgramFiles
  process.env.ProgramFiles = 'C:\\Program Files'
  const spy = spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === expected)
  try {
    expect(detectZoteroInstalled()).toEqual({ installed: true, installedPath: expected, source: 'default' })
  } finally {
    spy.mockRestore(); settingsSpy.mockRestore()
    if (prev === undefined) delete process.env.ProgramFiles
    else process.env.ProgramFiles = prev
  }
})

test('Linux: 默认探测一律返回 installed=false（不在支持范围）', () => {
  setPlatform('linux')
  const settingsSpy = stubSettings()
  const spy = spyOn(fs, 'existsSync').mockImplementation(() => true)
  try {
    expect(detectZoteroInstalled()).toEqual({ installed: false })
  } finally {
    spy.mockRestore(); settingsSpy.mockRestore()
  }
})

// ===== 自定义路径优先 =====

test('detectZoteroInstalled 优先使用 settings.zoteroInstallPath（且存在）', () => {
  setPlatform('darwin')
  const custom = '/Volumes/External/Apps/Zotero.app'
  const settingsSpy = stubSettings({ zoteroInstallPath: custom })
  const spy = spyOn(fs, 'existsSync').mockImplementation((p) => {
    // 自定义路径与默认路径都"存在"也应当先返回 custom，验证优先级
    return String(p) === custom || String(p) === '/Applications/Zotero.app'
  })
  try {
    expect(detectZoteroInstalled()).toEqual({ installed: true, installedPath: custom, source: 'custom' })
  } finally {
    spy.mockRestore(); settingsSpy.mockRestore()
  }
})

test('detectZoteroInstalled 自定义路径不存在时回退到自动探测', () => {
  setPlatform('darwin')
  const settingsSpy = stubSettings({ zoteroInstallPath: '/non/existent/Zotero.app' })
  const spy = spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === '/Applications/Zotero.app')
  try {
    expect(detectZoteroInstalled()).toEqual({ installed: true, installedPath: '/Applications/Zotero.app', source: 'default' })
  } finally {
    spy.mockRestore(); settingsSpy.mockRestore()
  }
})

// ===== PATH fallback =====

test('Windows: 默认目录都没有但 PATH 里能找到 zotero.exe', () => {
  setPlatform('win32')
  // 测试在 macOS 主机跑，path.delimiter 仍是 ':'；用单条 dir 避开 'C:' 里的冒号被误切
  process.env.PATH = '/fake/zotero-bin'
  const settingsSpy = stubSettings()
  const existsSpy = spyOn(fs, 'existsSync').mockImplementation((p) => String(p).endsWith('/fake/zotero-bin/zotero.exe'))
  const statSpy = spyOn(fs, 'statSync').mockImplementation(() => ({ isFile: () => true }) as unknown as fs.Stats)
  try {
    const result = detectZoteroInstalled()
    expect(result.installed).toBe(true)
    expect(result.source).toBe('path')
    expect(result.installedPath).toContain('zotero.exe')
  } finally {
    existsSpy.mockRestore(); statSpy.mockRestore(); settingsSpy.mockRestore()
  }
})

test('macOS 即便 PATH 里有 zotero 也不走 PATH fallback（依赖 LaunchServices）', () => {
  setPlatform('darwin')
  process.env.PATH = '/custom/zotero-bin'
  const settingsSpy = stubSettings()
  const existsSpy = spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === '/custom/zotero-bin/zotero')
  const statSpy = spyOn(fs, 'statSync').mockImplementation(() => ({ isFile: () => true }) as unknown as fs.Stats)
  try {
    expect(detectZoteroInstalled()).toEqual({ installed: false })
  } finally {
    existsSpy.mockRestore(); statSpy.mockRestore(); settingsSpy.mockRestore()
  }
})

// ===== validateZoteroPath =====

test('validateZoteroPath: macOS 接受 .app 目录', () => {
  setPlatform('darwin')
  const p = '/Applications/Zotero.app'
  const existsSpy = spyOn(fs, 'existsSync').mockImplementation((q) => {
    const s = String(q)
    return s === p || s === '/Applications/Zotero.app/Contents/MacOS/zotero'
  })
  try {
    expect(validateZoteroPath(p)).toEqual({ valid: true, normalizedPath: p })
  } finally {
    existsSpy.mockRestore()
  }
})

test('validateZoteroPath: macOS 选到 .app/Contents/MacOS/zotero 自动归一化为 .app', () => {
  setPlatform('darwin')
  const inner = '/Applications/Zotero.app/Contents/MacOS/zotero'
  const existsSpy = spyOn(fs, 'existsSync').mockImplementation(() => true)
  try {
    expect(validateZoteroPath(inner)).toEqual({ valid: true, normalizedPath: '/Applications/Zotero.app' })
  } finally {
    existsSpy.mockRestore()
  }
})

test('validateZoteroPath: 路径不存在 → not-exists', () => {
  setPlatform('darwin')
  const existsSpy = spyOn(fs, 'existsSync').mockImplementation(() => false)
  try {
    expect(validateZoteroPath('/nope')).toEqual({ valid: false, reason: 'not-exists' })
  } finally {
    existsSpy.mockRestore()
  }
})

test('validateZoteroPath: Linux 平台直接返回 platform-mismatch（不在支持范围）', () => {
  setPlatform('linux')
  const existsSpy = spyOn(fs, 'existsSync').mockImplementation(() => true)
  const statSpy = spyOn(fs, 'statSync').mockImplementation(() => ({ isFile: () => true }) as unknown as fs.Stats)
  try {
    expect(validateZoteroPath('/usr/bin/zotero')).toEqual({ valid: false, reason: 'platform-mismatch' })
  } finally {
    existsSpy.mockRestore(); statSpy.mockRestore()
  }
})

test('validateZoteroPath: Windows 选了非 .exe → platform-mismatch', () => {
  setPlatform('win32')
  const existsSpy = spyOn(fs, 'existsSync').mockImplementation(() => true)
  const statSpy = spyOn(fs, 'statSync').mockImplementation(() => ({ isFile: () => true }) as unknown as fs.Stats)
  try {
    const r = validateZoteroPath('C:\\Tools\\Zotero\\zotero')
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('platform-mismatch')
  } finally {
    existsSpy.mockRestore(); statSpy.mockRestore()
  }
})

// ===== launchZotero =====

interface FakeChild extends EventEmitter {
  unref: () => void
}

function makeFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild
  ee.unref = () => {}
  return ee
}

test('macOS launchZotero 优先用 LaunchServices（open -b bundleId）成功即返回 success', async () => {
  setPlatform('darwin')
  const settingsSpy = stubSettings()
  const child = makeFakeChild()
  const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(() => child as unknown as ReturnType<typeof childProcess.spawn>)
  const detectSpy = spyOn(fs, 'existsSync').mockImplementation(() => false)
  try {
    const promise = launchZotero()
    setImmediate(() => child.emit('exit', 0))
    const result = await promise
    expect(result).toEqual({ success: true })
    expect(spawnSpy).toHaveBeenCalledWith('open', ['-b', 'org.zotero.zotero'], { stdio: 'ignore' })
    // LaunchServices 命中后不应再走路径检测 / 第二次 spawn
    expect(spawnSpy).toHaveBeenCalledTimes(1)
  } finally {
    spawnSpy.mockRestore(); detectSpy.mockRestore(); settingsSpy.mockRestore()
  }
})

test('macOS launchZotero LaunchServices 失败时回退到路径 spawn', async () => {
  setPlatform('darwin')
  const settingsSpy = stubSettings()
  const lsChild = makeFakeChild()
  const fallbackChild = makeFakeChild()
  let call = 0
  const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(() => {
    call += 1
    return (call === 1 ? lsChild : fallbackChild) as unknown as ReturnType<typeof childProcess.spawn>
  })
  const detectSpy = spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === '/Applications/Zotero.app')
  try {
    const promise = launchZotero()
    // LaunchServices 退出码非 0 → 触发回退
    setImmediate(() => {
      lsChild.emit('exit', 1)
      setImmediate(() => fallbackChild.emit('spawn'))
    })
    const result = await promise
    expect(result).toEqual({ success: true })
    expect(spawnSpy).toHaveBeenCalledTimes(2)
    expect(spawnSpy.mock.calls[1]?.[0]).toBe('open')
    expect(spawnSpy.mock.calls[1]?.[1]).toEqual(['-a', '/Applications/Zotero.app'])
  } finally {
    spawnSpy.mockRestore(); detectSpy.mockRestore(); settingsSpy.mockRestore()
  }
})

test('macOS launchZotero LaunchServices 与路径都失败时返回未检测到', async () => {
  setPlatform('darwin')
  const settingsSpy = stubSettings()
  const lsChild = makeFakeChild()
  const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(() => lsChild as unknown as ReturnType<typeof childProcess.spawn>)
  const detectSpy = spyOn(fs, 'existsSync').mockImplementation(() => false)
  try {
    const promise = launchZotero()
    setImmediate(() => lsChild.emit('exit', 1))
    const result = await promise
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.message).toContain('未检测到')
    }
  } finally {
    spawnSpy.mockRestore(); detectSpy.mockRestore(); settingsSpy.mockRestore()
  }
})

test('Windows launchZotero spawn error 返回失败', async () => {
  setPlatform('win32')
  const settingsSpy = stubSettings()
  const child = makeFakeChild()
  const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(() => child as unknown as ReturnType<typeof childProcess.spawn>)
  const prev = process.env.ProgramFiles
  process.env.ProgramFiles = 'C:\\Program Files'
  const detectSpy = spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === 'C:\\Program Files\\Zotero\\zotero.exe')
  try {
    const promise = launchZotero()
    setImmediate(() => child.emit('error', new Error('ENOENT')))
    const result = await promise
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.message).toContain('启动失败')
    }
  } finally {
    spawnSpy.mockRestore(); detectSpy.mockRestore(); settingsSpy.mockRestore()
    if (prev === undefined) delete process.env.ProgramFiles
    else process.env.ProgramFiles = prev
  }
})
