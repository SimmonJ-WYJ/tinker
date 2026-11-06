/**
 * Zotero 就绪门控 —— 「加入 Zotero」类弹窗共用
 *
 * 弹窗打开时先检测 Zotero 状态，再决定渲染 picker 还是引导：
 *   - running + remoteEnabled → ready（调用方渲染选位置 picker）
 *   - running + !remoteEnabled → needRemote（去 Zotero 设置开启远程连接）
 *   - !running + installed     → needLaunch（「启动 Zotero」，连上后自动 onReady）
 *   - !running + !installed    → needInstall（「前往官网下载」）
 *
 * 避免 Zotero 未运行/未安装时直接弹"选位置"导致 listCollections 失败。
 * useZoteroReadyGate 管状态与启动；ZoteroNotReadyGuard 渲染非就绪态的引导块。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { Play, Download, ExternalLink, Loader2 } from 'lucide-react'
import { useAtom } from 'jotai'
import { Button } from '@/components/ui/button'
import { GuardBanner } from '@/components/common/GuardBanner'
import { zoteroPingStatusAtom, zoteroInstallStatusAtom } from '@/atoms/zotero-atoms'
import { useT } from '@/hooks/useT'

export const ZOTERO_DOWNLOAD_URL = 'https://www.zotero.org/download/'
export const REMOTE_DOCS_URL = 'https://www.zotero.org/support/preferences/advanced#local_api'

/**
 * 打开 Zotero 官网下载页（外部浏览器）。
 * 走 openExternal（主进程 http/https 白名单校验）并捕获异常，避免渲染端裸 window.open。
 */
export function openZoteroDownload(): void {
  void window.electronAPI.openExternal(ZOTERO_DOWNLOAD_URL).catch((err) =>
    console.warn('[Zotero] openExternal 下载页失败:', err))
}

/** 打开 Zotero 远程连接文档页（外部浏览器，同样走 openExternal + 异常捕获）。 */
export function openZoteroRemoteDocs(): void {
  void window.electronAPI.openExternal(REMOTE_DOCS_URL).catch((err) =>
    console.warn('[Zotero] openExternal 文档页失败:', err))
}

export type ZoteroGate = 'checking' | 'needInstall' | 'needLaunch' | 'needRemote' | 'ready'

interface ZoteroReadyGate {
  gate: ZoteroGate
  launching: boolean
  handleLaunch: () => Promise<void>
}

/**
 * 弹窗 open 时检测 Zotero 状态。就绪（含启动后连上）时调用 onReady（通常是拉 collection）。
 * onReady 必须用 useCallback 稳定，避免重复触发。
 */
export function useZoteroReadyGate(open: boolean, onReady: () => void | Promise<void>): ZoteroReadyGate {
  const { t } = useT('library')
  const [pingStatus, setPingStatus] = useAtom(zoteroPingStatusAtom)
  const [installStatus, setInstallStatus] = useAtom(zoteroInstallStatusAtom)
  const [checking, setChecking] = React.useState(false)
  const [launching, setLaunching] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setChecking(true)
    let cancelled = false
    void (async () => {
      try {
        const ping = await window.electronAPI.zotero.ping()
        if (cancelled) return
        setPingStatus(ping)
        if (ping.running && ping.remoteEnabled) {
          await onReady()
        } else if (!ping.running) {
          const install = await window.electronAPI.zotero.detectInstall()
          if (!cancelled) setInstallStatus(install)
        }
      } catch (err) {
        console.warn('[Zotero] 状态检测失败:', err)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, onReady, setPingStatus, setInstallStatus])

  const handleLaunch = React.useCallback(async () => {
    setLaunching(true)
    try {
      const result = await window.electronAPI.zotero.launchApp()
      if (!result.success) {
        toast.error(t('toast.launchFailed'), { description: result.message ?? t('toast.launchFailedDesc') })
        return
      }
      let latest = await window.electronAPI.zotero.ping()
      setPingStatus(latest)
      for (let i = 0; i < 10 && !latest.running; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        latest = await window.electronAPI.zotero.ping()
        setPingStatus(latest)
      }
      if (latest.running && latest.remoteEnabled) {
        await onReady()
      }
    } finally {
      setLaunching(false)
    }
  }, [onReady, setPingStatus, t])

  const gate: ZoteroGate = checking
    ? 'checking'
    : !pingStatus.running && !installStatus.installed
      ? 'needInstall'
      : !pingStatus.running
        ? 'needLaunch'
        : !pingStatus.remoteEnabled
          ? 'needRemote'
          : 'ready'

  return { gate, launching, handleLaunch }
}

/** 非就绪态引导块；gate==='ready' 时返回 null（由调用方渲染 picker）。 */
export function ZoteroNotReadyGuard({
  gate,
  launching,
  onLaunch,
}: {
  gate: ZoteroGate
  launching: boolean
  onLaunch: () => void
}): React.ReactElement | null {
  const { t } = useT('library')

  if (gate === 'ready') return null

  if (gate === 'checking') {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (gate === 'needInstall') {
    return (
      <GuardBanner
        tone="warning"
        title={t('guard.needInstall.title')}
        description={t('guard.needInstall.description')}
        action={
          <Button size="sm" onClick={openZoteroDownload}>
            <Download className="size-3.5" />
            <span>{t('guard.needInstall.download')}</span>
          </Button>
        }
      />
    )
  }

  if (gate === 'needLaunch') {
    return (
      <GuardBanner
        tone="warning"
        title={t('guard.needLaunch.title')}
        description={t('guard.needLaunch.description')}
        action={
          <Button size="sm" onClick={onLaunch} disabled={launching}>
            {launching ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            <span>{launching ? t('guard.needLaunch.launching') : t('guard.needLaunch.launch')}</span>
          </Button>
        }
      />
    )
  }

  // needRemote
  return (
    <GuardBanner
      tone="warning"
      title={t('guard.needRemote.title')}
      description={t('guard.needRemote.description')}
      action={
        <Button size="sm" variant="outline" onClick={openZoteroRemoteDocs}>
          <ExternalLink className="size-3.5" />
          <span>{t('guard.needRemote.viewDocs')}</span>
        </Button>
      }
    />
  )
}
