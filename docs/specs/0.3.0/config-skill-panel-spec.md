<a id="配置页-skill-板块-specconfig-skill-panel"></a>

# Configuration Skill Panel Spec (Config Skill Panel)

> **Status**: draft · awaiting review
> **Related issue**: #421 (Epic 2 slice 2.2 / CP-2)
> **Related PR**: (fill in when opened)
> **Input dependencies**: #414 (2 built-in packs A3 contract integration, CLOSED) · `docs/specs/0.3.0/0.3.0-prd.md` §1 (capability packs vs Skills)/§Epic 2 · `docs/specs/capability-package-spec.md`
> **Domain language source of truth**: 0.3.0-prd.md §1 "Capability packs vs Skills"

---

<a id="1-概述与定位"></a>

## 1. Overview and Positioning

The **Skill section** on the left-side Configuration page (existing [`ConfigView`](../../../apps/electron/src/renderer/components/config/ConfigView.tsx)). Currently a `comingSoon` placeholder; this spec delivers a working panel:

- Show **all Skills** in the current workspace, labeled with **two source categories** (built-in / from capability packs)
- Per-Skill **enable/disable** toggle
- Filter by **source / status** + search
- **Backlinks** from each Skill to capability packs referencing it
- Peer to the capability-pack section; Settings no longer manages Skills (remove duplicate entry points)

<a id="11-non-scope明确不做"></a>

### 1.1 Non-scope (Explicit Exclusions)

- ❌ No "Import from another workspace / Sync from source" entry (PRD §199: `importSource` is internal, not exposed as user installation)
- ❌ No user-installed third-party Skills (outside 0.3)
- ❌ No bulk enable/disable (`skills.json` already has `header.*` keys, but #421 AC does not require it, YAGNI)
- ❌ No delete action (toggles suffice; deletion is advanced management, outside this slice)
- ❌ No "Open folder" button (no current `shell.openPath` IPC; adding it requires four-layer synchronization and is not required by AC, YAGNI)

<a id="2-关键设计决策"></a>

## 2. Key Design Decisions

<a id="21-来源两类由能力包交叉引用派生不读-importsource"></a>

### 2.1 Derive the Two Source Categories from Pack Cross-References (Do Not Read `importSource`)

`importSource` on `SkillMeta` is internal workspace-sync metadata that the PRD explicitly keeps hidden. Determine source by cross-referencing capability packs:

```
Referenced by a pack's manifest.skillRefs → source = 'capability-package' (from pack)
Otherwise                               → source = 'builtin' (built-in)
```

**Benefits**: zero backend changes; same source as backlinks (same refIndex).

<a id="22-反向链接-&#45;同一份交叉引用自动随能力包刷新满足-ac3"></a>

### 2.2 Backlinks = Same Cross-Reference, Automatically Refreshed with Packs (AC3)

Derive "Used by which packs" from the same reverse index. Fetch again and rebuild on mount / `CAPABILITIES_CHANGED`, so backlinks update automatically after pack uninstall/switch, without extra logic.

<a id="23-来自能力包的-skill-锁定为开启不可单独禁用"></a>

### 2.3 Skills from Capability Packs Are Locked On and Cannot Be Disabled Individually

Capability packs are enabled by default, cannot be disabled, and work out of the box (#414 Codex style). Individually disabling referenced Skills would leave packs missing capabilities and unable to work, contradicting non-disableability. Therefore:

- Skills **from capability packs** (`usedByPacks.length > 0`) → disabled toggle, managed by pack; show 🔒 + tooltip "Provided by a capability pack, enabled by default and cannot be disabled individually." Also defensively block in `onToggle`.
- **Built-in** Skills (no valid pack references) → freely enable/disable.

> This gives the two source categories and backlinks actual constraint semantics rather than display-only meaning.
> Boundary: if a pack references a Skill already disabled on disk (inconsistent data), the switch truthfully reflects `enabled` while remaining locked; fixing that inconsistency is outside this panel's responsibility.
> Packs with invalid manifests do not count as references (`buildSkillRefIndex` skips them); their referenced Skills are treated as built-in and toggleable because invalid packs provide no capabilities.

<a id="3-架构与数据流"></a>

## 3. Architecture and Data Flow

**Zero new IPC**—reuse existing channels:

| Data | Channel / API | Current state |
|------|-----------|------|
| Skill list (active+inactive) | `window.electronAPI.getWorkspaceSkills(slug)` → `agent:get-skills` | ✅ Existing |
| Per-Skill toggle | `window.electronAPI.toggleWorkspaceSkill(slug, skillSlug, enabled)` → `agent:toggle-skill` | ✅ Existing |
| Skill directory (open folder) | `window.electronAPI.getWorkspaceSkillsDir(slug)` → `agent:get-skills-dir` | ✅ Existing |
| Capability-pack list (including `skillRefs[]`) | `window.electronAPI.capabilityPack.list()` | ✅ Existing |
| Current workspace slug | `currentAgentWorkspaceIdAtom` | ✅ Existing |
| Capability-change event | `onCapabilitiesChanged` (`CAPABILITIES_CHANGED`) | ✅ Existing |

**Data flow**:

```
Mount / CAPABILITIES_CHANGED →
  Parallel [ capabilityPack.list(), getWorkspaceSkills(currentWorkspaceId) ]
  → Build refIndex: Map<skillSlug, packId[]>
  → Derive SkillRowVM { ...skillMeta, source, usedByPacks }
  → Render (apply search / sourceFilter / statusFilter)
```

<a id="4-组件单元单一职责"></a>

## 4. Component Units (Single Responsibility)

| Unit | Responsibility | Dependencies |
|------|------|------|
| `SkillPanel` (new `components/config/SkillPanel.tsx`) | Fetch data, maintain `search`/`sourceFilter`/`statusFilter` state, subscribe to `CAPABILITIES_CHANGED`, loading/error/empty states | `currentAgentWorkspaceIdAtom`, `electronAPI`, `useT('skills')` |
| `SkillRow` (subcomponent in same file) | Per-Skill row: name (`nameI18n[lang] ?? name`), description, source badge, inline `usedByPacks` chips, `Switch` toggle | props |
| `filterSkills(skills, {search, source, status})` (pure, unit-testable) | Filtering | None |
| `buildSkillRefIndex(packs)` (pure, unit-testable) | Build `Map<skillSlug, packId[]>` | None |

Align three states, cards/shadows, and semantic tokens with existing [`CapabilityPackPanel`](../../../apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx).

<a id="5-交互已确认"></a>

## 5. Interaction (Confirmed)

- Top: search input (`view.searchAll`)
- Two chip-filter groups:
  - **Source**: All / Built-in / From capability pack
  - **Status**: All / Enabled / Disabled (reuse `view.filter.*`)
- List: each row shows source badge + inline backlink chips (Skills `来自能力包`—from capability packs—show "Used by: Pack A, Pack B"; `系统内置`—built-in—show source badge only) + enable/disable `Switch`
- Toggle: call `toggleWorkspaceSkill` + optimistic update; on failure roll back + inline error + refetch to reconcile

<a id="6-错误处理"></a>

## 6. Error Handling

| Scenario | Handling |
|------|------|
| Empty `currentWorkspaceId` | Show "No active workspace" without calling API |
| `getWorkspaceSkills` / `list()` throws | Error state (match CapabilityPackPanel `loadError` styling) |
| `toggleWorkspaceSkill` fails | Roll back toggle + inline error + reload to reconcile |
| Empty list | Empty state (`view.empty.category`) |
| Empty after filtering | `view.empty.filtered` |

<a id="7-i18nen-&#45;zh-同步skills-ns"></a>

## 7. i18n (Synchronize en + zh, `skills` Namespace)

The `skills` namespace already has most keys (`view.*`/`row.*`/`filter.*`/`categories.*`). Add:

- `source.builtin` = Chinese equivalent of Built-in / Built-in
- `source.fromPack` = Chinese equivalent of From capability pack / From capability pack
- Source filter labels: `view.filter.sourceAll` / `sourceBuiltin` / `sourceFromPack` (or reuse `source.*`)
- `view.usedBy` = Chinese equivalent of Used by: {{packs}} / Used by: {{packs}}

`skillsPanel.comingSoon` in `config.json` is no longer referenced → delete in en+zh together. Changes guarded by `key-parity.test.ts`.

<a id="8-测试bddtdd"></a>

## 8. Tests (BDD/TDD)

- `filterSkills` pure-function unit tests: search / source / status / combinations
- `buildSkillRefIndex` pure-function unit tests: multiple packs referencing one skill, no references, empty list
- Manually check component golden path in `bun run dev` + switch zh↔en without raw keys

<a id="9-ac-映射"></a>

## 9. AC Mapping

| AC | Satisfaction |
|----|---------|
| Show all Skills with sources | `getWorkspaceSkills` × `refIndex` derives source |
| Individual toggles + source/status filters | `toggleWorkspaceSkill` + `filterSkills` |
| Backlinks update with capability packs | `CAPABILITIES_CHANGED` triggers reload automatically |
| No duplicate Settings entry | Review to confirm (inspection shows `settings-tab.ts` no longer has agent/skill tabs, likely already satisfied; explain in PR) |

<a id="10-受影响包-&#45;版本"></a>

## 10. Affected Packages / Versions

- `apps/electron`: add `SkillPanel.tsx`, change `ConfigView.tsx`, locale `skills`/`config`, add pure-function tests → `package.json` patch +1 (once, only when opening PR)
