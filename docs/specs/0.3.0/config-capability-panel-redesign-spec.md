<a id="配置页-能力包卡片重做codex-风用户向摘要-&#45;渐进展开"></a>

# Configuration capability-pack card redesign (Codex style: user-facing summary + progressive disclosure)

> Status: Design approved, implementation pending
> Related milestone: 0.3 (Epic 2 capability-pack configuration, `docs/specs/0.3.0/0.3.0-prd.md`)
> Related spec: `docs/specs/0.3.0/config-skill-panel-spec.md` (Skill section; this spec aligns visually with it)
> Domain-language source of truth: 0.3 PRD §1

<a id="背景与问题"></a>

## Background and problem

The configuration “Capability packs” section (`CapabilityPackPanel`) currently displays manifest `scenarioAgent.description` verbatim (English Agent routing prompts written for LLMs, e.g. `Route here whenever…` / `Turn 1 dispatches…` / `terminal_skill`). Problems:

1. **Descriptions are Agent routing prompts rather than user-facing capability introductions**: Users cannot understand them and do not need to.
2. **No progressive disclosure**: Entire long descriptions are expanded at once; two packs fill the screen and prevent quick scanning.
3. **Metadata uses `dl` key-value text**: Dense, hard to scan, and inconsistent with the Skill section.
4. **No ready-to-use state indication**: Users do not understand that omitting enable/disable switches is intentional (Codex-style enabled by default, cannot disable).

<a id="目标"></a>

## Goal

Align with the 0.3 PRD's Codex-style ready-to-use + read-only overview and Skill visuals: cards show a **user-facing one-sentence summary + progressive disclosure + built-in badge + tagged metadata**. Other behavior remains unchanged (packs remain enabled by default and cannot be disabled/uninstalled/imported).

Non-goals: Do not change Agent prompts (summary is UI-only and not injected into prompts); do not change the Skill section; do not change `schema/manifest.schema.json` (the data-export ExportManifest schema, unrelated to capability packs).

<a id="方案"></a>

## Approach

<a id="数据层p0用户向摘要-summaryi18n"></a>

### Data layer (P0: user-facing `summaryI18n`)

Follow Skill's `nameI18n` pattern (`{ zh?, en? }` embedded in manifest, sharing the pack definition source).

| Unit | Change |
|------|------|
| `packages/shared/src/schemas/capability-pack.ts` | Extend `CapabilityPackManifest` (`.strict()` zod) with `summaryI18n: z.object({ zh: z.string().optional(), en: z.string().optional() }).optional()` |
| `packages/shared/src/types/capability-pack-ipc.ts` | Extend `CapabilityPackListItem` with `summaryI18n?: { zh?: string; en?: string }` |
| `apps/electron/src/main/lib/capability-pack-service.ts` | Pass through `summaryI18n` during list conversion (only `manifestValid` packs) |
| `apps/electron/default-capability-packs/lit-review/manifest.json` | Add `summaryI18n` (one sentence in Chinese and English: Write a literature review from curated papers) |
| `apps/electron/default-capability-packs/lit-search/manifest.json` | Add `summaryI18n` (one sentence in Chinese and English: Search & discover papers by topic, author, or citations) |

Render fallback: `summaryI18n[lang] ?? description` (old packs / missing summaries still display description for backward compatibility). Extract pure function `resolvePackSummary(pack, lang)` (unit-testable).

<a id="ui-层codex-风-master-detail列表-&#45;详情页"></a>

### UI layer (Codex-style master-detail: list → detail page)

`CapabilityPackPanel` holds local navigation state `selectedPackId: string | null` (no router): `null` → list, otherwise → that pack's details. Back resets to `null`.

**Level 1 — List (`CapabilityPackList`)**: Compact cards; click anywhere to open details.
- Valid pack: `[图标] packId` (icon + packId) + one-sentence summary + `🔒 内置·默认启用` (Built-in · Enabled by default) badge + right chevron.
- Invalid pack (`!manifestValid`): Show a manifestError label; click details for full error information.

**Level 2 — Detail (`CapabilityPackDetail`)**:
- Top: `← 返回` (Back) + packId + `v{version}` + `内置·默认启用` (Built-in · Enabled by default) badge.
- **Description**: summary + “Full description” (original `description` / full Agent routing prompt, fully expanded on the detail page, not collapsible).
- **Includes** (read-only rows, Codex style):
  - Scenario Agent: `[Boxes] scenarioAgentName`
  - Each `skillRefs`: `[Puzzle] <slug>` (provided by pack → locked, cannot disable individually, trailing 🔒 hint)
  - Each `mcpRefs`: `[Plug] <name>` + ⚙ button → `setSettingsTab('mcp'); setSettingsOpen(true)` opens Settings MCP tab
- Invalid pack details: Full manifestError + manifestErrorHint; omit Includes.
- **Omit**: Hero sample bubbles, Information table (developer/website/privacy/ToS), in-pack preference editing (no corresponding data/IPC; defer).

**P2 badge** (list + detail): `🔒 内置·默认启用` (Built-in · Enabled by default), clarifying that omitting enable/disable switches is intentional.
**P4 alignment**: Match card density/badges/row styles to `SkillPanel`.
**Skill tab**: Keep current behavior (enable/disable/source/backlinks/filtering for system built-in Skills).

<a id="i18nappselectronsrcrendererlocalesenzhconfigjsonkey-parity-守门"></a>

### i18n (`apps/electron/src/renderer/locales/{en,zh}/config.json`, guarded by key-parity)

Add: `capabilityPacks.builtinBadge` (Built-in · Enabled by default), `capabilityPacks.fullDescription` (Full description), `capabilityPacks.back` (Back), `capabilityPacks.includes` (Includes), `capabilityPacks.skillLockedHint` (Provided by capability pack, enabled by default), `capabilityPacks.openMcpSettings` (MCP settings). Reuse existing `metaScenarioAgent` / `metaSkills` / `metaMcps` for chips/row labels.

<a id="数据流"></a>

## Data flow

```
manifest.summaryI18n
  → zod parse (capability-pack.ts, optional field)
  → capability-pack-service pass-through
  → CapabilityPackListItem.summaryI18n（IPC）
  → capabilityPack.list()
  → CapabilityPackPanel: resolvePackSummary(pack, lang) = summaryI18n[lang] ?? description
```

<a id="测试"></a>

## Tests

- `resolvePackSummary` pure-function unit tests: summaryI18n[lang] present / current language missing, fallback to other language or description / all missing, fallback to description.
- zod schema: Manifests with `summaryI18n` parse successfully, as do manifests without it (optional).
- key-parity: New config.json keys match between en/zh.
- Manual: `bun run dev` collapse/expand, zh↔en switching, invalid-pack branch.

<a id="受影响文件"></a>

## Affected files

- Modify: `packages/shared/src/schemas/capability-pack.ts`, `packages/shared/src/types/capability-pack-ipc.ts`, `apps/electron/src/main/lib/capability-pack-service.ts`, `apps/electron/default-capability-packs/{lit-review,lit-search}/manifest.json`, `apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx`, `locales/{en,zh}/config.json`
- Add: `resolvePackSummary` pure function (utils next to panel or in-file) + unit tests
