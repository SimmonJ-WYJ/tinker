/**
 * Zotero 集成的渲染端状态
 */

import { atom } from 'jotai'
import type { ZoteroPingStatus, ZoteroInstallStatus } from '@asci/shared'
import type { ItemSummary } from '@asci/core/zotero'

// 是否启用 Zotero 集成
export const zoteroEnabledAtom = atom<boolean>(false)

// Zotero 本地服务的 ping 状态
export const zoteroPingStatusAtom = atom<ZoteroPingStatus>({ running: false, remoteEnabled: false })

// Zotero 安装检测状态
export const zoteroInstallStatusAtom = atom<ZoteroInstallStatus>({ installed: false })

// Zotero 数据目录路径（null 表示未配置）
export const zoteroDataDirAtom = atom<string | null>(null)

// Zotero 设置页"高级"组用户记忆的展开状态（默认 false）。
// 由组件在挂载时从 settings 拉取并写回；自动展开条件命中时 UI 会强制覆盖此值
export const zoteroAdvancedOpenAtom = atom<boolean>(false)

// Zotero mention 条目元数据缓存（key → ItemSummary）
// 选中时写入，发送时回读，避免多次调 LIB_GET_ITEM
export const zoteroMentionItemCacheAtom = atom<Map<string, ItemSummary>>(new Map())

// 是否已连通 Zotero：启用 + 客户端运行中 + 远程连接已开启
export const zoteroConnectedAtom = atom<boolean>((get) => {
  const enabled = get(zoteroEnabledAtom)
  const ping = get(zoteroPingStatusAtom)
  return enabled && ping.running && ping.remoteEnabled
})

// ===== 初始化 =====

/**
 * 从主进程加载 Zotero 集成状态
 */
export async function initializeZoteroSettings(
  setEnabled: (enabled: boolean) => void,
  setDataDir: (dir: string | null) => void,
  setInstallStatus: (status: ZoteroInstallStatus) => void,
  setPingStatus: (status: ZoteroPingStatus) => void,
): Promise<void> {
  try {
    const [settings, dataDir, install, ping] = await Promise.all([
      window.electronAPI.getSettings(),
      window.electronAPI.zotero.getDataDir(),
      window.electronAPI.zotero.detectInstall(),
      window.electronAPI.zotero.ping(),
    ])
    setEnabled(settings.zoteroEnabled ?? false)
    setDataDir(dataDir)
    setInstallStatus(install)
    setPingStatus(ping)
  } catch (error) {
    console.error('[Zotero] 初始化失败:', error)
  }
}
