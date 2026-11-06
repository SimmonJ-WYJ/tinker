/**
 * LibraryView - Zotero 文献库三栏视图
 *
 * 状态门控：
 * - Zotero 未运行 → 显示大 banner 引导启动
 * - Zotero 运行但远程未启用 → 显示 banner 引导去设置
 * - 就绪 → 渲染三栏
 *
 * 数据加载：
 * - 就绪后自动加载 collections
 * - items/detail 由子组件各自根据选中状态加载
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Play, ExternalLink, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GuardBanner as GuardBannerCard } from '@/components/common/GuardBanner'
import {
  libraryCollectionsAtom,
  libraryLoadingCollectionsAtom,
  libraryErrorAtom,
} from '@/atoms/library-atoms'
import { zoteroPingStatusAtom, zoteroInstallStatusAtom } from '@/atoms/zotero-atoms'
import { CollectionTree } from './CollectionTree'
import { ItemsList } from './ItemsList'
import { ItemDetailPanel } from './ItemDetailPanel'
import { openZoteroDownload, openZoteroRemoteDocs } from '@/components/agent/zotero-ready-gate'
import { useT } from '@/hooks/useT'

export function LibraryView(): React.ReactElement {
  const { t } = useT('library')
  const [pingStatus, setPingStatus] = useAtom(zoteroPingStatusAtom)
  const [installStatus, setInstallStatus] = useAtom(zoteroInstallStatusAtom)
  const setCollections = useSetAtom(libraryCollectionsAtom)
  const [loadingCollections, setLoadingCollections] = useAtom(libraryLoadingCollectionsAtom)
  const [error, setError] = useAtom(libraryErrorAtom)
  const [launching, setLaunching] = React.useState(false)

  /** 初次加载 + 定期刷新 ping；未运行时补一次安装探测，供 guard 区分未装/未启动 */
  React.useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const status = await window.electronAPI.zotero.ping()
        if (!cancelled) setPingStatus(status)
        if (!status.running) {
          const install = await window.electronAPI.zotero.detectInstall()
          if (!cancelled) setInstallStatus(install)
        }
      } catch {
        if (!cancelled) setPingStatus({ running: false, remoteEnabled: false })
      }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [setPingStatus, setInstallStatus])

  /** 就绪后加载 collections */
  React.useEffect(() => {
    if (!pingStatus.running || !pingStatus.remoteEnabled) return
    let cancelled = false
    const loadCollections = async (): Promise<void> => {
      setLoadingCollections(true)
      setError(null)
      try {
        const list = await window.electronAPI.zotero.library.listCollections()
        if (!cancelled) setCollections(list)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError({ type: 'unknown', message })
      } finally {
        if (!cancelled) setLoadingCollections(false)
      }
    }
    void loadCollections()
    return () => { cancelled = true }
  }, [pingStatus.running, pingStatus.remoteEnabled, setCollections, setLoadingCollections, setError])

  const handleLaunch = async (): Promise<void> => {
    setLaunching(true)
    try {
      const result = await window.electronAPI.zotero.launchApp()
      if (!result.success) {
        toast.error(t('toast.launchFailed'), {
          description: result.message ?? t('toast.launchFailedDesc'),
        })
        return
      }
      // 轮询等上线
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const status = await window.electronAPI.zotero.ping()
        setPingStatus(status)
        if (status.running) break
      }
    } finally {
      setLaunching(false)
    }
  }

  // ===== 状态门控 banners =====

  // 未运行 + 未安装 → 引导去官网下载（恢复旧行为，避免点启动只弹无出路 Toast）
  if (!pingStatus.running && !installStatus.installed) {
    return (
      <GuardBanner
        tone="warning"
        title={t('guard.needInstall.title')}
        description={t('guard.needInstall.description')}
        action={
          <Button size="sm" onClick={openZoteroDownload}>
            <Download size={14} />
            <span>{t('guard.needInstall.download')}</span>
          </Button>
        }
      />
    )
  }

  // 未运行但已安装 → 引导启动
  if (!pingStatus.running) {
    return (
      <GuardBanner
        tone="warning"
        title={t('guard.needLaunch.title')}
        description={t('guard.needLaunch.description')}
        action={
          <Button size="sm" onClick={handleLaunch} disabled={launching} data-spotlight-target="start-zotero">
            {launching ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            <span>{launching ? t('guard.needLaunch.launching') : t('guard.needLaunch.launch')}</span>
          </Button>
        }
      />
    )
  }

  if (!pingStatus.remoteEnabled) {
    return (
      <GuardBanner
        tone="warning"
        title={t('guard.needRemote.title')}
        description={t('guard.needRemote.description')}
        action={
          <Button size="sm" variant="outline" onClick={openZoteroRemoteDocs}>
            <ExternalLink size={13} />
            <span>{t('guard.needRemote.viewDocs')}</span>
          </Button>
        }
      />
    )
  }

  if (loadingCollections) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center titlebar-no-drag">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    )
  }

  if (error) {
    return (
      <GuardBanner
        tone="error"
        title={t('guard.loadFailed')}
        description={error.message}
      />
    )
  }

  // ===== 三栏布局 =====
  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <aside className="w-60 shrink-0 border-r border-border/50 overflow-auto scrollbar-thin">
        <CollectionTree />
      </aside>
      <section className="flex-[5] min-w-0 flex flex-col overflow-hidden">
        <ItemsList />
      </section>
      <aside className="flex-[6] min-w-0 border-l border-border/50 flex flex-col overflow-hidden">
        <ItemDetailPanel />
      </aside>
    </div>
  )
}

// ===== 子组件 =====

interface GuardBannerProps {
  tone: 'warning' | 'error'
  title: string
  description: string
  action?: React.ReactNode
}

function GuardBanner({ tone, title, description, action }: GuardBannerProps): React.ReactElement {
  // 卡片本体复用共享 GuardBanner；这里只补全屏居中外壳（文献库整页态）
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-8 titlebar-no-drag">
      <GuardBannerCard tone={tone} title={title} description={description} action={action} className="max-w-md w-full" />
    </div>
  )
}
