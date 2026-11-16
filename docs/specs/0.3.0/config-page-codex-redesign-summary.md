<a id="配置页-codex-风重做-&#45;改动总结"></a>

# Codex-Style Configuration Page Redesign — Change Summary

> Scope: Interaction/visual redesign of the Capability Pack and Skill sections on the configuration page (matching the Codex plugin marketplace's list→detail model).
> Related: 0.3 PRD Epic 2 (configurable capability packs), `config-capability-panel-redesign-spec.md`, `config-skill-panel-spec.md` (#421).
> Status: Implemented, local validation passed; no PR opened (version increment deferred until PR creation).

<a id="目标"></a>

## Goal

Replace raw backend manifest/SKILL metadata laid out across these two configuration sections with Codex-style **compact cards + progressive details**:
- Lists show concise user-facing information; full/technical details move to a second level (detail page / dialog).
- Make clear that “Built-in · Enabled by default” is intentional (absence of a toggle is not a missing feature).
- Separate primary/secondary filters in a compact space.

---

<a id="一能力包面板capabilitypackpanel"></a>

## 1. Capability Pack Panel (CapabilityPackPanel)

**Replace long cards with inline expansion with a grid list → detail page (master-detail).**

- **Data layer — add user-facing summary `summaryI18n`** (following Skill's `nameI18n` pattern, embedded `{ zh?, en? }` in the manifest):
  - `packages/shared/src/schemas/capability-pack.ts`: Add optional `summaryI18n` to Zod `CapabilityPackManifest`.
  - `packages/shared/src/types/capability-pack-ipc.ts`: Add `summaryI18n?` to `CapabilityPackListItem`.
  - `apps/electron/src/main/lib/capability-pack-service.ts`: Pass through list conversion.
  - Add one Chinese/English summary to each of the 2 built-in pack manifests (lit-review / lit-search).
  - Add pure function `resolvePackSummary(pack, lang)`: `summaryI18n[lang] → 另一语言 → description` fallback (other language, then description; backward compatible) + unit tests.
- **Primary list**: Responsive grid of compact cards (`[包名] + 一句话摘要 + 🔒 内置·默认启用 徽章`, meaning pack name + one-sentence summary + Built-in · Enabled by default badge); the whole card is clickable.
- **Secondary detail page** (local `selectedPackId` state, no routing): Back + pack name/version/badge + description + **Full description** (original Agent routing prompt) + **Includes** (read-only scenario Agent / Skill / MCP rows; MCP rows have ⚙ linking to Settings' MCP tab).
- **Removed**: Hero example bubbles, Information table (developer/website/privacy), and in-pack preference editing (no corresponding data; deferred).
- Key point: **Agent routing prompts are no longer shown directly as user descriptions** (moved into Full description on the detail page).

<a id="二skill-面板skillpanel"></a>

## 2. Skill Panel (SkillPanel)

**Replace a single rich-row column with grid cards → detail dialog, with exposed toggles, stable ordering, and layered filters.**

- **Grid list**: Responsive compact cards (`[Puzzle 图标] 名称 + 来源徽章 + 一行截断描述 + 外露开关`, meaning Puzzle icon + name + source badge + single-line truncated description + exposed toggle).
- **Toggle exposed on the card's right**: Enable/disable directly in the list (clicking the toggle only toggles); clicking elsewhere opens the detail dialog. Skills from capability packs have locked 🔒 toggles (cannot disable independently).
- **Disabled cards gray out in place**: Turning off grays the whole card via `opacity`; **no reordering, disappearing, or jumping**.
- **Stable sorting**: Render layer uses fixed name sorting (independent of enabled), fixing cards jumping into the disabled area and becoming hard to find after toggling.
- **Detail dialog** (`SkillDetailDialog`): Name + source badge + full description + backlinks (which capability packs use it) + enable/disable toggle (same locking logic).
- **Filter toolbar (compact single row)**:
  - Search + **Status (primary filter, segmented control)**: All/Enabled/Disabled, counts based on the full collection.
  - **Source (secondary filter, dropdown)**: All sources/System built-in/From capability packs; **counts follow status** (count each source within the selected status).
  - Trailing **result count**: `N 个 · 未筛选/已筛选` (N items · Unfiltered/Filtered).
  - Removed the old flat ghost chips + vertical dividers.

<a id="三i18nen-&#45;zhkey-parity-守门"></a>

## 3. i18n (en + zh, Key-Parity Guard)

- `config.json`: Added `builtinBadge` / `fullDescription` / `back` / `includes` / `skillLockedHint` / `openMcpSettings` for capability pack details (plus early unused expand/collapse placeholders).
- `skills.json`: Added `statusLabel` / `sourceLabel` / `resultUnit` / `resultStateAll` / `resultStateFiltered` for filters; disambiguated `filter.all` from “All” to “All statuses” in Chinese / English.

<a id="受影响文件"></a>

## Affected Files

The retained listing labels summaryI18n types, pass-through, summaries, and design specification alongside their original paths.

```
packages/shared/src/schemas/capability-pack.ts          (summaryI18n zod)
packages/shared/src/types/capability-pack-ipc.ts        (summaryI18n type)
apps/electron/src/main/lib/capability-pack-service.ts   (pass-through)
apps/electron/default-capability-packs/lit-review/manifest.json   (summary)
apps/electron/default-capability-packs/lit-search/manifest.json   (summary)
apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx  (list→detail)
apps/electron/src/renderer/components/config/capability-pack-utils.ts(+.test)  (resolvePackSummary)
apps/electron/src/renderer/components/config/SkillPanel.tsx  (grid+dialog+toolbar)
apps/electron/src/renderer/locales/{en,zh}/config.json
apps/electron/src/renderer/locales/{en,zh}/skills.json
docs/specs/0.3.0/config-capability-panel-redesign-spec.md  (design spec)
```

<a id="验证"></a>

## Validation

- `bun run typecheck`: All packages passed (note: missing `fflate` dependency after pull was installed during this work, unrelated to this change).
- `bun test`: Full suite passed (including bilingual i18n key parity and `resolvePackSummary` pure-function tests).
- `eslint`: Changed files clean.
- UI interactions manually checked individually in `bun run dev` (list↔details, dialogs, exposed toggles without position jumps, linked filters, zh↔en switching).

<a id="备注"></a>

## Notes

- Under updated CLAUDE.md, **versions increment once when opening the PR**; this batch did not bump versions.
- In-pack preference editing on capability pack details and Skill/capability pack Information metadata (developer/website/privacy/example prompts) were removed this round because corresponding data fields are absent; deferred pending manifest fields.
