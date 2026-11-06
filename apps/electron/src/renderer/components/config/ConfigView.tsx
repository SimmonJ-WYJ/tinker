/**
 * ConfigView — 配置页主视图（spec §6.4）
 *
 * 0.3 §三-C 落地的"独立配置入口"，与文献库 / 笔记平级。承载能力包板块（只读展示）
 * 与 Skill 板块（启停 / 来源 / 过滤 / 反向链接，#421）。
 */

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/hooks/useT'
import {
  tabStripChipClassNames,
  tabStripLabelClassNames,
  tabStripRootClassNames,
} from '@/components/tabs/tab-strip-primitives'
import { CapabilityPackPanel } from './CapabilityPackPanel'
import { SkillPanel } from './SkillPanel'

export type ConfigTab = 'capabilityPacks' | 'skills'

export function configContentContainerClassName(className = ''): string {
  return ['mx-auto w-full max-w-[720px] px-8', className].filter(Boolean).join(' ')
}

export function shouldShowConfigTitle(
  activeTab: ConfigTab,
  selectedCapabilityPackId: string | null,
): boolean {
  return activeTab !== 'capabilityPacks' || selectedCapabilityPackId === null
}

export function ConfigView(): React.ReactElement {
  const { t } = useT('config')
  const [tab, setTab] = React.useState<ConfigTab>('capabilityPacks')
  const [selectedCapabilityPackId, setSelectedCapabilityPackId] = React.useState<string | null>(null)
  const showTitle = shouldShowConfigTitle(tab, selectedCapabilityPackId)

  const handleTabChange = React.useCallback((next: ConfigTab): void => {
    setTab(next)
    if (next !== 'capabilityPacks') {
      setSelectedCapabilityPackId(null)
    }
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="select-none">
        <ConfigTabs
          activeTab={tab}
          detailMode={selectedCapabilityPackId ? 'capabilityPack' : null}
          detailLabel={selectedCapabilityPackId ?? undefined}
          onBackFromCapabilityDetail={() => setSelectedCapabilityPackId(null)}
          onChange={handleTabChange}
        />
        {showTitle ? (
          <div className={configContentContainerClassName('pb-4 pt-8 titlebar-drag-region')}>
            <h1 className="text-2xl font-semibold leading-tight text-foreground">{t('title')}</h1>
            <p className="mt-1 text-base text-muted-foreground">{t('subtitle')}</p>
          </div>
        ) : null}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className={configContentContainerClassName('pb-10')}>
          {tab === 'capabilityPacks' ? (
            <CapabilityPackPanel
              selectedPackId={selectedCapabilityPackId}
              onSelectPack={setSelectedCapabilityPackId}
            />
          ) : (
            <SkillPanel />
          )}
        </div>
      </div>
    </div>
  )
}

interface ConfigTabsProps {
  activeTab: ConfigTab
  detailMode?: 'capabilityPack' | null
  detailLabel?: string
  onBackFromCapabilityDetail?: () => void
  onChange: (tab: ConfigTab) => void
}

export function ConfigTabs({
  activeTab,
  detailMode = null,
  detailLabel,
  onBackFromCapabilityDetail,
  onChange,
}: ConfigTabsProps): React.ReactElement {
  const { t } = useT('config')

  if (detailMode === 'capabilityPack' && detailLabel) {
    return (
      <div className="p-2.5" data-config-tabs-shell>
        <nav
          aria-label={t('title')}
          className="flex h-[30px] items-center gap-2 bg-content-area titlebar-drag-region"
        >
          <button
            type="button"
            aria-label={t('capabilityPacks.backToList')}
            onClick={() => onBackFromCapabilityDetail?.()}
            className="h-[30px] cursor-pointer select-none rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors titlebar-no-drag hover:bg-foreground/[0.05] hover:text-foreground"
          >
            {t('tabs.capabilityPacks')}
          </button>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          <span
            aria-current="page"
            className="min-w-0 truncate px-1 text-sm font-medium text-foreground titlebar-no-drag"
          >
            {detailLabel}
          </span>
        </nav>
      </div>
    )
  }

  return (
    <div className="p-2.5" data-config-tabs-shell>
      <nav
        aria-label={t('title')}
        className={tabStripRootClassNames('h-[30px]')}
      >
        <ConfigTabChip
          active={activeTab === 'capabilityPacks'}
          ariaLabel={detailMode === 'capabilityPack' ? t('capabilityPacks.backToList') : undefined}
          onClick={() => {
            if (detailMode === 'capabilityPack') {
              onBackFromCapabilityDetail?.()
              return
            }
            onChange('capabilityPacks')
          }}
        >
          {t('tabs.capabilityPacks')}
        </ConfigTabChip>
        <ConfigTabChip
          active={activeTab === 'skills'}
          onClick={() => onChange('skills')}
        >
          {t('tabs.skills')}
        </ConfigTabChip>
      </nav>
    </div>
  )
}

interface ConfigTabChipProps {
  active: boolean
  ariaLabel?: string
  onClick: () => void
  children: React.ReactNode
}

function ConfigTabChip({
  active,
  ariaLabel,
  onClick,
  children,
}: ConfigTabChipProps): React.ReactElement {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      className={tabStripChipClassNames({ active, size: 'compact' })}
    >
      <span className={tabStripLabelClassNames(active)}>
        {children}
      </span>
    </button>
  )
}
