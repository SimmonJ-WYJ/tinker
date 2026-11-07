import { RESEARCH_UI_ENABLED } from '@/lib/product-surface'
/**
 * SettingsPanel - 设置面板
 *
 * 顶部 Header（标题 + 关闭按钮）+ 下方（左侧扁平导航 + 右侧 ScrollArea 内容区域）。
 * 左导航扁平排列，按"日常 → 技术 → 运维"顺序，"关于"落底。
 * 切 tab 时同步写 settingsLastTabAtom，下次打开默认回到此 tab。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { cn } from '@/lib/utils'
import { Settings, Radio, Info, Globe, X, Keyboard, BookMarked, UserCircle, Archive, Database, Server } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { settingsTabAtom } from '@/atoms/settings-tab'
import type { SettingsTab } from '@/atoms/settings-tab'
import { settingsLastTabAtom } from '@/atoms/settings-last-tab'
import { ChannelSettings } from './ChannelSettings'
import { GeneralSettings } from './GeneralSettings'
import { ProfileSettings } from './ProfileSettings'
import { ProxySettings } from './ProxySettings'
import { AboutSettings } from './AboutSettings'
import { McpTab } from './McpTab'
import { DataCollectionTab } from './DataCollectionTab'
import { ShortcutSettings } from './ShortcutSettings'
import { ArchivedSettings } from './ArchivedSettings'
import { ZoteroSettings } from './ZoteroSettings'
import { UpdateBadge } from '@/components/app-shell/UpdateBadge'
import { useT } from '@/hooks/useT'

/** 单个 Tab 子项定义 */
interface TabItem {
  id: SettingsTab
  label: string
  icon: React.ReactNode
}

/** 根据标签页 id 渲染对应内容 */
function renderTabContent(tab: SettingsTab): React.ReactElement {
  switch (tab) {
    case 'profile':
      return <ProfileSettings />
    case 'general':
      return <GeneralSettings />
    case 'channels':
      return <ChannelSettings />
    case 'proxy':
      return <ProxySettings />
    case 'mcp':
      return <McpTab />
    case 'datacollection':
      return <DataCollectionTab />
    case 'about':
      return <AboutSettings />
    case 'shortcuts':
      return <ShortcutSettings />
    case 'archived':
      return <ArchivedSettings />
    case 'zotero':
      return <ZoteroSettings />
  }
}

interface SettingsPanelProps {
  onClose?: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps): React.ReactElement {
  const { t } = useT('settings')
  const [activeTab, setActiveTab] = useAtom(settingsTabAtom)
  const setLastTab = useSetAtom(settingsLastTabAtom)

  // 渲染兜底：activeTab 在 null 状态下（Dialog 还没完成 restore）显示 profile
  const renderTab: SettingsTab = activeTab ?? 'profile'

  const items = React.useMemo<TabItem[]>(
    () => [
      { id: 'profile', label: t('panel.tabs.profile'), icon: <UserCircle size={16} /> },
      ...(RESEARCH_UI_ENABLED ? [{ id: 'zotero' as const, label: t('panel.tabs.zotero'), icon: <BookMarked size={16} /> }] : []),
      { id: 'general', label: t('panel.tabs.general'), icon: <Settings size={16} /> },
      { id: 'shortcuts', label: t('panel.tabs.shortcuts'), icon: <Keyboard size={16} /> },
      { id: 'proxy', label: t('panel.tabs.proxy'), icon: <Globe size={16} /> },
      { id: 'channels', label: t('panel.tabs.channels'), icon: <Radio size={16} /> },
      { id: 'mcp', label: t('panel.tabs.mcp'), icon: <Server size={16} /> },
      { id: 'datacollection', label: t('panel.tabs.dataCollection'), icon: <Database size={16} /> },
      { id: 'archived', label: t('panel.tabs.archived'), icon: <Archive size={16} /> },
      { id: 'about', label: t('panel.tabs.about'), icon: <Info size={16} /> },
    ],
    [t],
  )

  // 当前 tab 标题；找不到则兜底为面板标题
  const activeTabLabel = React.useMemo(() => {
    const hit = items.find((item) => item.id === renderTab)
    return hit ? hit.label : renderTab === 'zotero' ? t('panel.tabs.zotero') : t('panel.title')
  }, [items, renderTab, t])

  const handleTabClick = (id: SettingsTab): void => {
    setActiveTab(id)
    setLastTab(id)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部 Header 栏 */}
      <div className="h-12 flex items-center justify-between px-5 border-b border-border/50 flex-shrink-0">
        <h2 className="text-sm font-medium text-foreground">{activeTabLabel}</h2>
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            data-spotlight-target="settings-close"
            className="size-auto p-1.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted"
          >
            <X size={16} />
          </Button>
        )}
      </div>

      {/* 下方主体：左导航 + 右内容 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧 Tab 扁平导航 */}
        <div className="w-[200px] border-r border-border/50 pt-2 px-2 flex-shrink-0">
          <nav className="flex flex-col gap-0.5">
            {items.map((tab) => (
              <Button
                key={tab.id}
                variant="ghost"
                size="row"
                onClick={() => handleTabClick(tab.id)}
                className={cn(
                  'rounded-md min-w-0',
                  renderTab === tab.id
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {tab.icon}
                <span className="flex-1 min-w-0 truncate text-left">{tab.label}</span>
                {tab.id === 'about' && <UpdateBadge variant="dot" />}
              </Button>
            ))}
          </nav>
        </div>

        {/* 右侧内容区域 - 浅灰背景，与卡片白色形成层级区分 */}
        <ScrollArea className="flex-1 bg-muted/30">
          <div className="px-6 py-4">
            {renderTabContent(renderTab)}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
