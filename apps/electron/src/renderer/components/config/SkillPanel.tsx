/**
 * SkillPanel — 配置页 Skill 板块（#421 CP-2）
 *
 * 展示当前工作区所有 Skill，标注来源两类（系统内置 / 来自能力包，由能力包 skillRefs
 * 交叉引用派生）、单 Skill 启停、按来源/状态过滤 + 搜索、被哪些能力包引用的反向链接。
 * 零新增 IPC：复用 getWorkspaceSkills + capabilityPack.list；收到 CAPABILITIES_CHANGED
 * 时重新拉取，反向链接随能力包自动刷新。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, Lock, Puzzle, Search } from 'lucide-react'
import type { SkillMeta } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { agentWorkspacesAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import {
  buildSkillRefIndex,
  deriveSkillSource,
  filterSkills,
  resolveSkillName,
  resolveWorkspaceSlug,
  type SkillSource,
  type SourceFilter,
  type StatusFilter,
} from './skill-panel-utils.ts'
import { CONFIG_ROW_HOVER_CLASS } from './config-row-styles.ts'

const SOURCE_OPTIONS = [
  { value: 'all', i18nKey: 'view.sourceFilter.all' },
  { value: 'builtin', i18nKey: 'view.sourceFilter.builtin' },
  { value: 'capability-package', i18nKey: 'view.sourceFilter.fromPack' },
] as const satisfies ReadonlyArray<{ value: SourceFilter; i18nKey: string }>

const STATUS_OPTIONS = [
  { value: 'all', i18nKey: 'view.filter.all' },
  { value: 'enabled', i18nKey: 'view.filter.enabled' },
  { value: 'disabled', i18nKey: 'view.filter.disabled' },
] as const satisfies ReadonlyArray<{ value: StatusFilter; i18nKey: string }>

export function SkillPanel(): React.ReactElement {
  const { t, i18n } = useT('skills')
  const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  // currentAgentWorkspaceIdAtom 持有 id，Skill IPC 需要 slug —— 这里解析映射，
  // 否则会用 id 当 slug 查到不存在目录返回空列表（配置页为全局视图，回退默认工作区）
  const workspaceSlug = React.useMemo(
    () => resolveWorkspaceSlug(workspaceId, workspaces),
    [workspaceId, workspaces],
  )

  const [skills, setSkills] = React.useState<SkillMeta[] | null>(null)
  // refIndex = skillSlug → 引用它的能力包；由 capabilityPack.list 派生后直接落地，
  // 避免额外保留原始 packs 状态（来源/反向链接均只依赖 refIndex）
  const [refIndex, setRefIndex] = React.useState<Map<string, string[]>>(() => new Map())
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [source, setSource] = React.useState<SourceFilter>('all')
  const [status, setStatus] = React.useState<StatusFilter>('all')
  const [busySlug, setBusySlug] = React.useState<string | null>(null)
  // 当前打开详情弹窗的 skill slug；null = 无弹窗
  const [selectedSlug, setSelectedSlug] = React.useState<string | null>(null)

  const reload = React.useCallback(async () => {
    if (!workspaceSlug) {
      setSkills([])
      return
    }
    try {
      const [skillList, packRes] = await Promise.all([
        window.electronAPI.getWorkspaceSkills(workspaceSlug),
        window.electronAPI.capabilityPack.list(),
      ])
      setSkills(skillList)
      setRefIndex(buildSkillRefIndex(packRes.packs))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
      setSkills([])
    }
  }, [workspaceSlug])

  // 初次加载 + 能力包变更时重新拉取（反向链接随之刷新）
  React.useEffect(() => {
    void reload()
    return window.electronAPI.onCapabilitiesChanged(() => {
      void reload()
    })
  }, [reload])

  // 过滤后预计算每行视图模型（来源 / 反向链接 / 锁定），避免渲染时重复 refIndex 查找。
  // 按名称固定排序（与 enabled 无关）：保证开/关一个 Skill 时它原地变状态、不跳位
  // ——IPC 可能按"启用优先"返回、切换又会触发 reload，故顺序在渲染层稳定化。
  const visibleRows = React.useMemo(() => {
    if (!skills) return []
    return filterSkills(skills, refIndex, { search, source, status })
      .map((skill) => {
        const usedByPacks = refIndex.get(skill.slug) ?? []
        return {
          skill,
          name: resolveSkillName(skill, lang),
          source: deriveSkillSource(skill.slug, refIndex),
          usedByPacks,
          // 被能力包引用的 Skill 由能力包托管：能力包默认启用、不可禁用（#414），
          // 故其 Skill 也不可单独禁用，否则会破坏开箱即用的能力包
          locked: usedByPacks.length > 0,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [skills, refIndex, search, source, status, lang])

  // 详情弹窗的视图模型：独立从 skills + refIndex 派生（不依赖当前过滤，过滤变动时弹窗数据稳定）
  const selected = React.useMemo(() => {
    if (!selectedSlug || !skills) return null
    const skill = skills.find((s) => s.slug === selectedSlug)
    if (!skill) return null
    const usedByPacks = refIndex.get(skill.slug) ?? []
    return { skill, source: deriveSkillSource(skill.slug, refIndex), usedByPacks, locked: usedByPacks.length > 0 }
  }, [selectedSlug, skills, refIndex])

  const onToggle = React.useCallback(
    async (skill: SkillMeta, next: boolean): Promise<void> => {
      // 被能力包引用的 Skill 锁定为开启，不接受切换（防御性，UI 也已禁用开关）
      if (!workspaceSlug || refIndex.has(skill.slug)) return
      setBusySlug(skill.slug)
      setSkills((prev) => prev?.map((s) => (s.slug === skill.slug ? { ...s, enabled: next } : s)) ?? prev)
      try {
        await window.electronAPI.toggleWorkspaceSkill(workspaceSlug, skill.slug, next)
      } catch {
        setSkills((prev) => prev?.map((s) => (s.slug === skill.slug ? { ...s, enabled: !next } : s)) ?? prev)
        setLoadError(t('view.toggleError'))
        void reload()
      } finally {
        setBusySlug(null)
      }
    },
    [workspaceSlug, refIndex, t, reload],
  )

  if (!workspaceSlug) {
    return <div className="pt-10 text-sm text-foreground/60">{t('view.noWorkspace')}</div>
  }

  const filtersActive = search !== '' || source !== 'all' || status !== 'all'

  // 主筛选「状态」计数：基于全量 skills（主维度给全貌，不受次级来源影响）
  const statusCounts = React.useMemo(() => {
    const list = skills ?? []
    return {
      all: list.length,
      enabled: list.filter((s) => s.enabled).length,
      disabled: list.filter((s) => !s.enabled).length,
    } as Record<StatusFilter, number>
  }, [skills])

  // 次级筛选「来源」计数：随当前状态联动（在已选状态的范围内统计各来源），体现"次级"从属关系
  const sourceCounts = React.useMemo(() => {
    const list = (skills ?? []).filter((s) =>
      status === 'all' ? true : status === 'enabled' ? s.enabled : !s.enabled,
    )
    const fromPack = list.filter((s) => refIndex.has(s.slug)).length
    return {
      all: list.length,
      builtin: list.length - fromPack,
      'capability-package': fromPack,
    } as Record<SourceFilter, number>
  }, [skills, refIndex, status])

  return (
    <div className="pt-4">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-foreground">{t('view.heading')}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{t('view.description')}</p>
      </div>

      <div className="mb-8 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative w-full max-w-[620px]">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('view.searchAll')}
              className="h-11 w-full rounded-full border-border/70 bg-background pl-11 pr-4 text-sm shadow-sm"
            />
          </div>

          <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
            <SelectTrigger className="h-11 w-auto min-w-36 rounded-full border-border/70 bg-background px-4 text-sm shadow-sm">
              <span>
                {t(SOURCE_OPTIONS.find((o) => o.value === source)!.i18nKey)}
                <span className="ml-1.5 tabular-nums text-muted-foreground">{sourceCounts[source]}</span>
              </span>
            </SelectTrigger>
            <SelectContent align="start">
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-sm">
                  <span>
                    {t(o.i18nKey)}
                    <span className="ml-1.5 tabular-nums text-muted-foreground">{sourceCounts[o.value]}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: t(o.i18nKey) }))}
            value={status}
            onChange={setStatus}
            counts={statusCounts}
          />

          <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">
            {visibleRows.length} {t('view.resultUnit')} · {filtersActive ? t('view.resultStateFiltered') : t('view.resultStateAll')}
          </span>
        </div>
      </div>

      {loadError ? (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <div className="font-medium">{t('view.loadError')}</div>
          <div className="mt-1 text-xs opacity-80">{loadError}</div>
        </div>
      ) : null}

      {skills === null && !loadError ? (
        <div
          role="status"
          aria-label={t('view.heading')}
          className="flex items-center gap-2 py-8 text-sm text-foreground/60"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}

      {skills !== null && visibleRows.length === 0 ? (
        <div className="rounded-lg border border-border/40 bg-muted/30 px-4 py-6 text-sm text-foreground/70">
          {filtersActive ? t('view.empty.filtered') : t('view.empty.category')}
        </div>
      ) : null}

      {visibleRows.length > 0 ? (
        <section>
          <div className="mb-4 flex items-center justify-between border-b border-border/45 pb-3">
            <h3 className="text-base font-semibold text-foreground">{t('view.heading')}</h3>
            <span className="text-sm tabular-nums text-muted-foreground">{visibleRows.length}</span>
          </div>
          <ul className="grid grid-cols-1 gap-x-14 gap-y-5 md:grid-cols-2">
            {visibleRows.map(({ skill, name, source: skillSource, locked }) => (
              <SkillCard
                key={skill.slug}
                skill={skill}
                name={name}
                source={skillSource}
                locked={locked}
                busy={busySlug === skill.slug}
                onToggle={(next) => void onToggle(skill, next)}
                onOpen={() => setSelectedSlug(skill.slug)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <SkillDetailDialog
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelectedSlug(null) }}
        vm={selected}
        name={selected ? resolveSkillName(selected.skill, lang) : ''}
        busy={selected ? busySlug === selected.skill.slug : false}
        onToggle={(next) => { if (selected) void onToggle(selected.skill, next) }}
      />
    </div>
  )
}

/**
 * Segmented — 单维度分段控件（来源 / 状态各一个）。带框分组,让"两个独立单选维度"
 * 一眼区分；选中段填充背景,其余 muted；每段尾随该分组计数。纯展示(label/count 由父级算好)。
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  counts,
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
  counts: Record<T, number>
}): React.ReactElement {
  return (
    <div className="inline-flex items-center rounded-full bg-muted/55 p-1">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-8 items-center rounded-full px-3 text-sm transition-colors',
              active
                ? 'bg-background font-semibold text-foreground shadow-sm'
                : 'text-foreground/60 hover:text-foreground',
            )}
          >
            <span>{opt.label}</span>
            <span className="ml-1.5 tabular-nums text-sm opacity-60">{counts[opt.value]}</span>
          </button>
        )
      })}
    </div>
  )
}

// ===== 一级:列表行（点击开详情弹窗） =====

function SkillCard({
  skill,
  name,
  source,
  locked,
  busy,
  onToggle,
  onOpen,
}: {
  skill: SkillMeta
  name: string
  source: SkillSource
  locked: boolean
  busy: boolean
  onToggle: (next: boolean) => void
  onOpen: () => void
}): React.ReactElement {
  const { t } = useT('skills')
  // SKILL.md frontmatter 里的引号常被转义为 \"，展示还原为 "
  const desc = skill.description?.replace(/\\"/g, '"') ?? ''
  return (
    <li>
      {/* 整卡禁用态变灰（原地，不重排、不消失）；左侧可点区进详情弹窗，右侧开关外露直接启停 */}
      <div
        className={cn(
          'group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors',
          CONFIG_ROW_HOVER_CLASS,
          !skill.enabled && !locked && 'opacity-55',
        )}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm ring-1 ring-border/55">
            <Puzzle className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-base font-medium text-foreground">{name}</span>
              <span
                className={cn(
                  'shrink-0 rounded-md px-1.5 py-0.5 text-sm font-medium',
                  source === 'builtin' ? 'bg-muted text-foreground/60' : 'bg-primary/10 text-primary',
                )}
              >
                {source === 'builtin' ? t('view.sourceBadge.builtin') : t('view.sourceBadge.fromPack')}
              </span>
            </span>
            {desc ? (
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">{desc}</span>
            ) : null}
          </span>
        </button>

        {/* 外露开关：来自能力包→锁定🔒；其余可直接启停（与左侧按钮为同级，点击不会触发详情） */}
        {locked ? (
          <span className="mt-2 flex shrink-0 items-center gap-1.5 text-foreground/40" title={t('view.lockedByPack')}>
            <Lock className="size-3.5" aria-hidden />
            <Switch checked={skill.enabled} aria-label={t('view.lockedByPack')} disabled />
          </span>
        ) : (
          <span className="mt-2 shrink-0">
            <Switch checked={skill.enabled} disabled={busy} onCheckedChange={onToggle} aria-label={name} />
          </span>
        )}
      </div>
    </li>
  )
}

// ===== 二级:详情弹窗 =====

interface SkillDetailVM {
  skill: SkillMeta
  source: SkillSource
  usedByPacks: string[]
  locked: boolean
}

function SkillDetailDialog({
  open,
  onOpenChange,
  vm,
  name,
  busy,
  onToggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  vm: SkillDetailVM | null
  name: string
  busy: boolean
  onToggle: (next: boolean) => void
}): React.ReactElement {
  const { t } = useT('skills')
  const desc = vm?.skill.description?.replace(/\\"/g, '"') ?? ''
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{name}</DialogTitle>
        </DialogHeader>
        {vm ? (
          <div className="space-y-3 py-1">
            {/* 来源徽章 + 启停开关（来自能力包→锁定） */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs font-medium',
                  vm.source === 'builtin' ? 'bg-muted text-foreground/60' : 'bg-primary/10 text-primary',
                )}
              >
                {vm.source === 'builtin' ? t('view.sourceBadge.builtin') : t('view.sourceBadge.fromPack')}
              </span>
              <span className="ml-auto">
                {vm.locked ? (
                  <span className="flex items-center gap-1.5 text-foreground/40" title={t('view.lockedByPack')}>
                    <Lock className="size-3.5" aria-hidden />
                    <Switch checked={vm.skill.enabled} aria-label={t('view.lockedByPack')} disabled />
                  </span>
                ) : (
                  <Switch checked={vm.skill.enabled} disabled={busy} onCheckedChange={onToggle} />
                )}
              </span>
            </div>

            {/* 完整描述 */}
            {desc ? (
              <p className="text-sm leading-relaxed text-foreground/70 whitespace-pre-wrap">{desc}</p>
            ) : null}

            {/* 反向链接:被哪些能力包使用 */}
            {vm.usedByPacks.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground/50">
                <span>{t('view.usedBy')}</span>
                {vm.usedByPacks.map((packId) => (
                  <span key={packId} className="rounded-md bg-muted px-1.5 py-0.5 text-foreground/70">
                    {packId}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
