/**
 * CapabilityPackPanel — 配置页能力包板块（Codex 风 master-detail，#414 CP-6）
 *
 * 能力包默认启用、不可禁用、不导入/卸载（Codex 风开箱即用）。两级结构（本地导航 state，
 * 不引路由）:
 *  - 一级列表（CapabilityPackList）:紧凑行（包名 + 一句话摘要 + 默认启用开关），整行可点
 *  - 二级详情（CapabilityPackDetail）:说明 + 完整说明 + Includes（场景 Agent / Skill / MCP 只读行）
 *
 * 无启停 toggle、无导入/卸载入口。manifest 校验失败的包仍可见，详情显示错误信息。
 * 包内偏好编辑 / Hero 示例 / Information 表（开发者/官网/隐私）当前裁掉（无对应数据，留后续）。
 */

import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  Lock,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { settingsTabAtom, settingsOpenAtom } from '@/atoms/settings-tab'
import { resolvePackSummary } from './capability-pack-utils.ts'
import { CONFIG_ROW_HOVER_CLASS } from './config-row-styles.ts'
import type { CapabilityPackListItem } from '@asci/shared'

interface CapabilityPackPanelProps {
  selectedPackId: string | null
  onSelectPack: (packId: string | null) => void
}

export function CapabilityPackPanel({
  selectedPackId,
  onSelectPack,
}: CapabilityPackPanelProps): React.ReactElement {
  const { t, i18n } = useT('config')
  const [packs, setPacks] = React.useState<CapabilityPackListItem[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'

  const reload = React.useCallback(async () => {
    try {
      const res = await window.electronAPI.capabilityPack.list()
      setPacks(res.packs)
      setLoadError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLoadError(msg)
      setPacks([])
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const visiblePacks = React.useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!packs || query.length === 0) return packs
    return packs.filter((pack) => {
      const summary = resolvePackSummary(pack, lang).toLocaleLowerCase()
      return pack.packId.toLocaleLowerCase().includes(query) || summary.includes(query)
    })
  }, [packs, search, lang])

  // 详情态:选中包仍存在则渲染详情（reload 后包消失则自动回列表）
  const selected = selectedPackId ? packs?.find((p) => p.packId === selectedPackId) ?? null : null
  if (selected) {
    return <CapabilityPackDetail pack={selected} />
  }

  return (
    <div className="pt-1">
      <div className="relative mb-10">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('capabilityPacks.search')}
          className="h-11 rounded-full border-border/70 bg-background pl-11 pr-4 text-sm shadow-sm"
        />
      </div>

      {packs === null && loadError === null ? (
        <div className="flex items-center gap-2 text-sm text-foreground/60 py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{t('capabilityPacks.loading')}</span>
        </div>
      ) : null}

      {loadError !== null ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <div className="font-medium">{t('capabilityPacks.loadError')}</div>
          <div className="mt-1 text-xs opacity-80">{loadError}</div>
        </div>
      ) : null}

      {packs !== null && visiblePacks?.length === 0 && loadError === null ? (
        <div className="rounded-lg border border-border/40 bg-muted/30 px-4 py-6 text-sm text-foreground/70">
          <div className="font-medium text-foreground">{t('capabilityPacks.empty')}</div>
          <p className="mt-2 text-xs leading-relaxed text-foreground/60">
            {t('capabilityPacks.emptyHint')}
          </p>
        </div>
      ) : null}

      {visiblePacks !== null && visiblePacks.length > 0 ? (
        <section>
          <div className="mb-6 flex items-center justify-between border-b border-border/45 pb-2">
            <h2 className="text-base font-semibold text-foreground">
              {t('capabilityPacks.heading')}
            </h2>
            <span className="text-sm tabular-nums text-muted-foreground">{visiblePacks.length}</span>
          </div>
          <ul className="grid grid-cols-1 gap-x-14 gap-y-5 md:grid-cols-2">
            {visiblePacks.map((pack) => (
              <CapabilityPackCard
                key={pack.packId}
                pack={pack}
                onClick={() => onSelectPack(pack.packId)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function AlwaysOnSwitch({ label }: { label: string }): React.ReactElement {
  return (
    <Switch checked disabled aria-label={label} className="shrink-0" />
  )
}

// ===== 一级:列表行 =====

function CapabilityPackCard({
  pack,
  onClick,
}: {
  pack: CapabilityPackListItem
  onClick: () => void
}): React.ReactElement {
  const { t, i18n } = useT('config')
  const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'

  return (
    <li
      className={cn(
        'group flex w-full items-center gap-2 rounded-xl transition-colors',
        pack.manifestValid
          ? CONFIG_ROW_HOVER_CLASS
          : 'bg-destructive/5 hover:bg-destructive/10',
      )}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center px-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-medium text-foreground">{pack.packId}</span>
            {!pack.manifestValid ? (
              <Badge tone="destructive" variant="soft" className="gap-1 shrink-0">
                <AlertCircle className="w-3 h-3" />
                {t('capabilityPacks.manifestErrorLabel')}
              </Badge>
            ) : null}
          </span>
          {pack.manifestValid ? (
            <span className="mt-0.5 block truncate text-sm text-muted-foreground">
              {resolvePackSummary(pack, lang)}
            </span>
          ) : null}
        </span>
      </button>
      {pack.manifestValid ? (
        <span className="flex shrink-0 items-center">
          <AlwaysOnSwitch label={t('capabilityPacks.defaultEnabledAria', { packId: pack.packId })} />
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/45 transition-colors hover:text-muted-foreground"
        aria-label={t('capabilityPacks.expandHint')}
      >
        <ChevronRight className="size-4" />
      </button>
    </li>
  )
}

// ===== 二级:详情页 =====

function CapabilityPackDetail({
  pack,
}: {
  pack: CapabilityPackListItem
}): React.ReactElement {
  const { t, i18n } = useT('config')
  const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)

  const openMcpSettings = (): void => {
    setSettingsTab('mcp')
    setSettingsOpen(true)
  }
  const includedCount = 1 + pack.skillRefs.length + pack.mcpRefs.length

  return (
    <div>
      <div className={capabilityPackDetailHeaderClassName()}>
        <span className="min-w-0">
          <span className={capabilityPackDetailTitleRowClassName()}>
            <h2 className={capabilityPackDetailTitleClassName()}>{pack.packId}</h2>
            {pack.manifestValid ? (
              <span className={capabilityPackDetailVersionClassName()}>v{pack.version}</span>
            ) : null}
          </span>
          {pack.manifestValid ? (
            <p className={capabilityPackDetailSummaryClassName()}>
              {resolvePackSummary(pack, lang) || t('capabilityPacks.noSummary')}
            </p>
          ) : null}
        </span>
        {pack.manifestValid ? (
          <span className="flex shrink-0 items-center justify-end">
            <AlwaysOnSwitch label={t('capabilityPacks.defaultEnabledAria', { packId: pack.packId })} />
          </span>
        ) : (
          <Badge tone="destructive" variant="soft" className="shrink-0 justify-self-end gap-1">
            <AlertCircle className="w-3 h-3" />
            {t('capabilityPacks.manifestErrorLabel')}
          </Badge>
        )}
      </div>

      {!pack.manifestValid ? (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          {pack.manifestError ? (
            <p className="text-xs text-destructive/90 break-all">{pack.manifestError}</p>
          ) : null}
          <p className="mt-2 text-xs text-foreground/60">{t('capabilityPacks.manifestErrorHint')}</p>
        </div>
      ) : (
        <>
          {/* 安全边界 #710：原"完整说明"展示 scenarioAgent.description 路由 prompt 全文，已移除；
              该字段不再下发 renderer（见 capability-pack-ipc.ts）。UI 仅展示 summaryI18n 摘要。 */}

          {/* Includes:场景 Agent / Skill / MCP 只读行 */}
          <section className="mt-12">
            <div className={capabilityPackIncludeHeaderClassName()}>
              <h3 className="text-base font-semibold text-foreground">
                {t('capabilityPacks.includes')}
              </h3>
              <span className="text-sm tabular-nums text-muted-foreground">{includedCount}</span>
            </div>
            <ul className={capabilityPackIncludeListClassName()}>
              <IncludeRow typeLabel={t('capabilityPacks.metaScenarioAgent')} value={pack.scenarioAgentName} />
              {pack.skillRefs.map((s) => (
                <IncludeRow
                  key={`s:${s}`}
                  typeLabel={t('capabilityPacks.metaSkills')}
                  value={s}
                  locked
                  lockedHint={t('capabilityPacks.skillLockedHint')}
                />
              ))}
              {pack.mcpRefs.map((m) => (
                <IncludeRow
                  key={`m:${m}`}
                  typeLabel={t('capabilityPacks.metaMcps')}
                  value={m}
                  onAction={openMcpSettings}
                  actionIcon={Settings}
                  actionLabel={t('capabilityPacks.openMcpSettings')}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}

function IncludeRow({
  typeLabel,
  value,
  locked,
  lockedHint,
  onAction,
  actionIcon: ActionIcon,
  actionLabel,
}: {
  typeLabel: string
  value: string
  locked?: boolean
  lockedHint?: string
  onAction?: () => void
  actionIcon?: LucideIcon
  actionLabel?: string
}): React.ReactElement {
  return (
    <li className={capabilityPackIncludeRowClassName()}>
      <div className={capabilityPackIncludeRowSurfaceClassName()}>
        <span className={capabilityPackIncludeNameClassName()}>{value}</span>
        <span className={capabilityPackIncludeTypeClassName()}>
          {typeLabel}
        </span>
        {locked ? (
          <span title={lockedHint} className="flex w-10 shrink-0 items-center justify-center">
            <Lock className="size-3.5 text-muted-foreground/50" />
          </span>
        ) : null}
        {onAction && ActionIcon ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onAction}
            aria-label={actionLabel}
            className="h-8 w-10 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          >
            <ActionIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export function capabilityPackDetailHeaderClassName(): string {
  return 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 pt-8'
}

export function capabilityPackDetailTitleRowClassName(): string {
  return 'flex min-w-0 items-baseline gap-2'
}

export function capabilityPackDetailTitleClassName(): string {
  return 'truncate text-2xl font-semibold leading-tight text-foreground'
}

export function capabilityPackDetailVersionClassName(): string {
  return 'shrink-0 text-base leading-tight tabular-nums text-muted-foreground'
}

export function capabilityPackDetailSummaryClassName(): string {
  return 'mt-2 max-w-2xl text-base text-muted-foreground'
}

export function capabilityPackIncludeRowClassName(): string {
  return 'group relative flex h-11 items-center border-b border-border/35'
}

export function capabilityPackIncludeRowSurfaceClassName(): string {
  return 'grid h-full w-full grid-cols-[minmax(0,16rem)_minmax(0,1fr)_2.5rem] items-center gap-3 bg-none px-2 transition-transform duration-150 group-hover:translate-x-0.5'
}

export function capabilityPackIncludeListClassName(): string {
  return ''
}

export function capabilityPackIncludeHeaderClassName(): string {
  return 'mb-2 grid grid-cols-[minmax(0,16rem)_minmax(0,1fr)_2.5rem] items-center gap-3 border-b border-border/45 px-2 pb-2 [&>h3]:col-span-2 [&>span]:justify-self-center'
}

export function capabilityPackIncludeNameClassName(): string {
  return 'min-w-0 truncate text-sm font-semibold text-foreground'
}

export function capabilityPackIncludeTypeClassName(): string {
  return 'min-w-0 truncate text-sm text-muted-foreground'
}
