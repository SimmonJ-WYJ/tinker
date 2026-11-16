> Historical research specification: preserves old designs and data semantics, not requirements for current new features or restored runtime wiring. Active research capabilities are being retired in batches under the [retirement specification](./2026-11-10-research-retirement.md); corresponding execution records determine actual completion and unaccepted scope.

<a id="zotero-设置页简化-spec"></a>

# Zotero Settings Simplification Spec

> **Status**: draft · awaiting review
> **Related issue**: (none yet)
> **Related PR**: (to be opened)
> **Target branch**: `main`
> **Domain language source of truth**: this spec (no new terminology)
> **Change scope**: renderer + i18n copy only; no IPC, main-process, or Zotero detection changes

---

<a id="1-背景"></a>

## 1. Background

<a id="11-现状问题"></a>

### 1.1 Current Problems

Settings → Zotero tab has excessive information density in the default state (Zotero correctly detected):

- **7 rows** permanently expanded: Agent access / OCR / ASR / installation location / data directory / PDF sync / generate structured TXT
- Each row has 1–3 lines of secondary description
- Both path rows additionally have input + browse + save, consuming the most vertical space
- 99% of users use the default installation location; **almost all this space provides useless information**

<a id="12-目标"></a>

### 1.2 Goal

In the default scenario, show **only Zotero settings users regularly toggle**, minimizing wording per row. Retain repair capabilities in exceptional cases (detection failure).

---

<a id="2-现状结构事实参考"></a>

## 2. Current Structure (Factual Reference)

Source: `apps/electron/src/renderer/components/settings/ZoteroSettings.tsx` (778 lines, already large)

Currently arranged in this order within a single `<SettingsSection title="Zotero 文献库">` (title means “Zotero Library”):

| Order | Content | Control |
|---|---|---|
| 1 | Zotero Agent access (including status pill + launch / documentation buttons) | Main toggle |
| 2 | Image recognition (OCR) | Child toggle + “Built-in” badge |
| 3 | Speech recognition (ASR) | Child toggle + “1GB download required” badge |
| 4 | Zotero installation location | input + Browse + Save + currently detected location copy |
| 5 | Zotero data directory | input + Browse + Save |
| 6 | PDF sync | Sync now button |
| 7 | Generate structured TXT (experimental) | Generate all button |
| — | `<ZoteroMediaPanel />` `<ZoteroArticlePanel />` | Child panels (**unchanged this round**) |

i18n: namespace `settings`, key root `zotero.*`, file `locales/{en,zh}/settings/zotero.json`.

---

<a id="3-设计方案b-&#45;a-组合"></a>

## 3. Design: B + A Combination

<a id="31-默认视图99-场景"></a>

### 3.1 Default View (99% of Cases)

Show only **three core toggles** + one **“Advanced” collapsible row**:

```
┌─ Zotero Library ─────────────────────────────┐
│  Local paper search/PDF reading, local only  │
│                                            │
│  [Row] Agent access       [Connected] [ON]   │
│        Allow Agent to call Zotero           │
│                                            │
│  [Row] Image recognition OCR [Built-in] [ON] │
│        Extract text from image attachments  │
│                                            │
│  [Row] Speech recognition ASR [1GB] [OFF]    │
│        Transcribe audio attachments         │
│                                            │
│  ┌─ ▶ Advanced · Paths / Sync / Experiments ┐│
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

Design details:

- **Remove the “Zotero” prefix from headings**: the section is already called “Zotero Library”; repeating “Zotero Agent access” / “Zotero installation location” / “Zotero data directory” in each row adds noise. Use “Agent access” / “Installation location” / “Data directory”
- **Shorten secondary copy**: replace full sentences with short hints; zh target ≤ 14 Chinese characters / en target ≤ 6 words (e.g. the Chinese equivalent of “Allow agent to call Zotero” / “Allow agent to call Zotero”)
- **Keep status pills**: “Connected to Zotero” → “Connected” (also removing the Zotero prefix)
- **OCR / ASR badge copy**: retain “Built-in”; “1GB download required” → “1GB” (the badge is already in the ASR row, so its meaning is clear)

<a id="32-展开高级"></a>

### 3.2 Expanded “Advanced”

Clicking the “Advanced” row expands 4 items:

| Item | Secondary-copy strategy when hidden by default |
|---|---|
| Installation location | Default placeholder + detected-status secondary copy; display current value for nondefault locations |
| Data directory | Empty placeholder + “Default” hint |
| PDF sync | One sentence, “Detect PDF changes in the Zotero library,” + Sync now button |
| Structured TXT (experimental) | One-sentence description + Generate all button |

Keep `ZoteroMediaPanel` / `ZoteroArticlePanel` unchanged (attachment-parsing parameters; assess further simplification separately).

<a id="33-自动展开规则trade-off-消解"></a>

### 3.3 Automatic Expansion Rules (Resolving the Tradeoff)

**The “Advanced” group starts expanded by default when any of these apply**:

1. Zotero was not detected automatically (`installPath` detection status is not `detected-default`)
2. The user configured nonempty `installPath` (i.e. `installPath !== ''`, even if equal to the default path; an **explicit** user setting deserves visibility)
3. The user configured nonempty `dataDir`

The “Advanced” row also turns yellow (warning token), with copy “⚠ Automatically expanded — check installation location.”

> **Design intent**: impose the extra click for path repair only when users actually need to fix a path, rather than routinely.

<a id="34-折叠状态记忆"></a>

### 3.4 Remember Collapse State

Persist user-triggered expansion/collapse (Jotai atom + local JSON configuration) for the next visit. However, §3.3's “not detected/nondefault value” rules **override** remembered state: even if previously collapsed, a subsequent problem forces expansion.

---

<a id="4-实现范围"></a>

## 4. Implementation Scope

### 4.1 In scope

- Rearrange `apps/electron/src/renderer/components/settings/ZoteroSettings.tsx`
  - Extract an `<AdvancedGroup>` child component (Radix `Collapsible` wrapper)
  - Also extract inline `ZoteroSubCapabilityRow` / `ZoteroModuleRow` / `ConnectionMasterRow` / `StatusPill` / `CapabilityPill` into separate files (**reduce the 778-line file's size** without rewriting logic)
- Update copy keys in `locales/{en,zh}/settings/zotero.json` together
- Add a collapse-state atom (`zoteroAdvancedOpenAtom`), persisted in the existing settings file

<a id="42-out-of-scope不做"></a>

### 4.2 Out of Scope

- No Zotero detection / path IPC logic changes
- No OCR / ASR start/stop business logic changes
- Keep `ZoteroMediaPanel` / `ZoteroArticlePanel` unchanged
- No new UI component-library dependencies (Radix Collapsible is already a dependency)

---

<a id="5-验收"></a>

## 5. Acceptance

| # | Criterion |
|---|---|
| 1 | Default (Zotero detected + default user path) Settings Zotero tab shows only 4 rows in the viewport: section header + Agent access + OCR + ASR + one “Advanced” collapsible row |
| 2 | Collapsed-state copy is correct in zh / en; `key-parity.test.ts` passes |
| 3 | Zotero detection failure (simulate by uninstalling Zotero or changing its path) automatically expands “Advanced” + yellow warning |
| 4 | Manually expand → leave Settings → return; expansion persists |
| 5 | `bun run typecheck` + `bun test` pass |
| 6 | In `bun run dev`, exercise light / dark themes and zh / en with no raw keys |

---

<a id="6-待确认开-spec-review-时一并定"></a>

## 6. Open Questions (Decide During Spec Review)

1. ~~**PR target branch**~~: decided as `main`
2. **Also simplify `ZoteroMediaPanel` / `ZoteroArticlePanel`?** Each has 150–290 lines and may contain redundant logic, but these attachment-parsing parameter panels are less relevant to this page-simplicity goal. Recommend leaving them unchanged.
3. **Should structured TXT (experimental) remain?** Collapsing reduces this row's prominence and further obscures “Generate all”; consider moving it to a separate “Experimental features” section?
