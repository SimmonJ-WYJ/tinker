<a id="settings-样式统一-spec"></a>

# Settings Style Unification Spec

> **Status**: Draft · Awaiting review
> **Related issue**: (None yet)
> **Related PR**: (To be opened, targeting `main`)
> **Target branch**: `main`
> **Baseline branch**: `alex-20260602-2` (already includes the Codex-style Card / Input / Button foundation rewrite)
> **Domain source of truth**: This spec (no new terms introduced)
> **Change scope**: Renderer + i18n (no new keys; inline copy stays unchanged); no IPC, main-process, or business-logic changes

---

<a id="1-背景"></a>

## 1. Background

The settings visual baseline recently changed to Codex style (thin borders replacing shadows, wider row padding, consistent Input/Button corner radii), but only **global base components** changed (`.settings-card` / `ui/input` / `ui/button` / `SettingsRow`); settings subpages with custom implementations were **not updated together**.

<a id="11-审计结论已扫-17-个-settings-子页面详见-pr-描述"></a>

### 1.1 Audit Findings (17 Settings Subpages Inspected; See PR Description)

**5 duplicate row implementations**:
- `ZoteroModuleRow` (ZoteroSettings.tsx)
- Custom rows in `ZoteroMediaPanel.tsx`
- Status-card rows in `ZoteroArticlePanel.tsx`
- UpdateCard rows in `AboutSettings.tsx`
- ThemeCardPicker container in `GeneralSettings.tsx`

Shared form: grid `[1fr_8rem]` + left (title + optional pill + description) + right (action). Two additions beyond `SettingsRow`: a pill slot and actions supporting complex controls (beyond Switch/Select).

**5 duplicate pill implementations**:
- `CapabilityPill` (built-in / built-in OCR badge in ZoteroSettings)
- `StatusPill` (ZoteroSettings status pill, with success/warning/destructive colors)
- `MetricPill` (ZoteroMediaPanel)
- Built-in badge / transport pill in `agent/McpSection.tsx`
- Status pill in `SkillCategoryView.tsx`

Shared form: `inline-flex h-6 items-center rounded-full bg-X/10 text-X px-2.5 text-xs font-medium leading-[1]`.

**30+ class inconsistencies requiring a sweep**:
- Old `px-4 py-3` row padding (should become `px-5 py-5`)
- Remaining `shadow-sm` / `shadow-xl`
- Handwritten `border-t border-border/50` (should be handled by `SettingsCard divided`)
- `h-7` / `h-8` Input / Button (should inherit new defaults `h-10` / `h-9`)
- `leading-snug` description text (should be `leading-relaxed`)

<a id="12-目标"></a>

### 1.2 Goals

1. Extract two shared primitives: `SettingsModuleRow` + `SettingsPill`, removing 5+5 duplicates
2. Sweep padding / shadow / border / old sizes / leading across all settings subpages
3. Make "open any settings page → visually consistent" easy to maintain

---

<a id="2-设计方案"></a>

## 2. Design

<a id="21-新-primitive-1settingsmodulerow"></a>

### 2.1 New Primitive 1: `SettingsModuleRow`

Location: `apps/electron/src/renderer/components/settings/primitives/SettingsModuleRow.tsx`

```tsx
interface SettingsModuleRowProps {
  /** 行标题 */
  title: string
  /** 标题右侧紧贴的 pill（可选） */
  pill?: React.ReactNode
  /** 描述（可选；string 或自定义节点） */
  description?: React.ReactNode
  /** 右侧 action 槽（Switch / Button / SegmentedControl / 进度条等） */
  action?: React.ReactNode
  /** 额外 className 覆盖容器 padding（如 contentClassName="py-2" 收紧高级折叠组内行） */
  className?: string
}
```

The preserved interface comments describe the row title, optional adjacent pill, optional description, right action slot (Switch / Button / SegmentedControl / progress bar), and container-padding override.

Implementation details:
- Container: `grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-5`
- Title block: `<div className="flex items-center gap-2 leading-none"><span title /><pill /></div>`
- Description block: `mt-2 text-sm leading-relaxed text-muted-foreground`, rendered only when description exists
- Action slot: `flex justify-end`

**Difference / boundary from existing `SettingsRow`**:
- Retain `SettingsRow` for simple "left label + right control" rows (no pill, short description); many Form fields fit this category
- Use `SettingsModuleRow` for "a capability / module" (title + status pill + longer description + complex action)

**5 duplicates to remove**: See §3.1 migration checklist

<a id="22-新-primitive-2settingspill"></a>

### 2.2 New Primitive 2: `SettingsPill`

Location: `apps/electron/src/renderer/components/settings/primitives/SettingsPill.tsx`

```tsx
type PillTone = 'neutral' | 'success' | 'warning' | 'destructive' | 'info'

interface SettingsPillProps {
  children: React.ReactNode
  tone?: PillTone  // 默认 'neutral'
  className?: string
}
```

The preserved inline comment identifies 'neutral' as the default.

Implementation details:
- Base: `inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium leading-[1]`
- Tone colors:
  - `neutral`: `bg-muted text-muted-foreground`
  - `success`: `bg-success/10 text-success`
  - `warning`: `bg-warning/10 text-warning`
  - `destructive`: `bg-destructive/10 text-destructive`
  - `info`: `bg-info/10 text-info` (use primary if the design tokens lack info)

**5 duplicates to remove**: `CapabilityPill` / `StatusPill` / `MetricPill` / built-in badge in `agent/McpSection` / status pill in `SkillCategoryView`.

<a id="23-sweep-规则不抽-primitive统一旧值"></a>

### 2.3 Sweep Rules (Standardize Old Values Without Extracting Primitives)

| Sweep item | Old → New | Affected files |
|---|---|---|
| Row padding | `px-4 py-3` → `px-5 py-4` (dense rows with descriptions) or `px-5 py-5` (standard rows with inputs) | ChannelForm, McpServerForm, AboutSettings.UpdateCard, GeneralSettings.ThemeCardPicker, SkillCategoryView.SkillItemRow, VersionHistory, ZoteroArticlePanel |
| Inline shadow | Remove `shadow-sm` / `shadow-xl` / `shadow-[...]` | GeneralSettings.SoundPicker, ProfileSettings.NameRow Popover, ShortcutSettings.ShortcutRecorder, ChannelSettings.ChannelRow logo, McpServerForm.textarea |
| Handwritten border separators | Chained rows with `border-t border-border/50` → `SettingsCard divided` | AgentRuntimeSection, AboutSettings.UpdateCard collapsible section, VersionHistory, ChannelForm sticky header |
| Old Input / Button sizes | `h-7` / `h-8` → inherit defaults (`h-9` button / `h-10` input) | ChannelForm custom model input, connection-test / fetch-model buttons; GeneralSettings.SelectTrigger / SoundPicker; ProfileSettings.NameRow edit state; ZoteroArticlePanel SelectTrigger; SkillCategoryView search box |
| Description leading | `leading-snug` → `leading-relaxed` | ZoteroMediaPanel description, ZoteroArticlePanel model.hint |

<a id="24-不做明确-out-of-scope"></a>

### 2.4 Explicitly Out of Scope

- `SettingsHintBox` / `SettingsClickableRow` / `SettingsCollapsibleRow` / `SettingsKeyValueTextarea`: Also worth extracting, but involve structural changes (interaction semantics / color-token extension / collapse-state management), clearer in separate PRs
- Settings interaction changes (switch placement / field order / descriptive copy)
- Theme / token changes
- List components outside settings (such as the right-side conversation list or literature-library list)

---

<a id="3-实施计划"></a>

## 3. Implementation Plan

<a id="31-迁移清单"></a>

### 3.1 Migration Checklist

Proceed "primitives first, callers second," with each step independently verifiable:

1. **Create `SettingsModuleRow`** + export from `primitives/index.ts`
2. **Create `SettingsPill`** + export
3. **Migrate ZoteroSettings**: Remove local `ZoteroModuleRow` / `CapabilityPill` / `StatusPill` components → use the new primitives throughout
4. **Migrate ZoteroMediaPanel + ZoteroArticlePanel**: Same approach
5. **Migrate AboutSettings.UpdateCard + GeneralSettings.ThemeCardPicker**: Replace custom rows with `SettingsModuleRow`
6. **Migrate pills in agent/McpSection + SkillCategoryView**: Use `SettingsPill`
7. **Sweep classes**: Update file by file using §2.3

<a id="32-受影响包"></a>

### 3.2 Affected Packages

- `apps/electron` 0.1.415 → 0.1.416 patch

---

<a id="4-验收"></a>

## 4. Acceptance

| # | Criterion |
|---|---|
| 1 | `bun run typecheck` passes |
| 2 | `bun test` passes (including bilingual key alignment in `key-parity.test.ts`; this spec changes no i18n keys, so it should pass naturally) |
| 3 | Visit all 17 settings subpages in `bun run dev`; switching light / dark themes shows no visual inconsistencies |
| 4 | grep confirms zero remnants of the removed 5 row + 5 pill implementations |
| 5 | Old padding / shadow / border / size sweep complete; grep for `px-4 py-3` / `shadow-sm` / `border-t border-border/50` under settings/ returns no matches (reasonable exceptions retained) |

---

<a id="5-待确认"></a>

## 5. Pending Confirmation

1. **`SettingsPill` `info` tone**: Add a `--info` color token or fall back to `primary`? The current design.md token table has no info color. Recommendation: **omit info tone for now**, adding it when a specific use case is clear
2. **Reasonable retention of `px-4 py-3`**: Some compact rows (such as SkillCategoryView chip filters) were intentionally dense. Should the sweep standardize everything to `py-4` or looser? Recommendation: **upgrade by default**, with commented exemptions for specially compact cases
3. **PR splitting**: Scope includes 5+5 primitive migrations + ~30 class deviations. May implementation split PRs midway (such as primitives + Zotero migration first, then the class sweep)? Recommendation: **1+2+3+4+6** in the first PR, **5+sweep** (§2.3 table) in the second, grouped by clear themes
