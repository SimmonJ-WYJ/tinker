<a id="全站字体收敛-spectypography-unification"></a>

# Site-wide Typography Unification Spec (Typography Unification)

> **Status**: Draft · Awaiting review
> **Related issue**: (None)
> **Related PR**: #470
> **Related document**: [`docs/design.md §4 / §九`](../design.md) (typography source of truth; this spec implements it; section IX)
> **Domain source of truth**: Three typography constraints in `docs/design.md`: no serif · no monospace · no italics

---

<a id="1-背景与目标"></a>

## 1. Background and Goals

<a id="11-现状"></a>

### 1.1 Current State
- `docs/design.md` §4 established site-wide sans-serif typography (commit `6ab84640`), while §IX added anti-pattern guards for `font-mono` / `italic` / `font-serif`
- Renderer code still has many violations: 80 `font-mono` classNames (33 files), 11 `italic` classNames (9 files, excluding 4 non-UI markdown-parser references in `lib/citation-references.ts` and 1 in untracked `SessionPapersStatsBar.tsx:125`; see §2.2), and 1 explicit CSS monospace stack (`components.css:18`)

<a id="12-目标"></a>

### 1.2 Goals
- Remove all renderer violations so runtime UI truly uses one font family (system sans-serif stack)
- Add defensive Tailwind config fallbacks so accidental future `font-mono` / `font-serif` still render sans-serif (visually silent)
- No web fonts; no font-declaration changes in main-process preview iframes, default-skills templates, or fixtures

<a id="13-非目标"></a>

### 1.3 Non-goals
- No ESLint enforcement in this PR (following design.md §XIII palette rules: migrate existing usage before lint, avoiding snowballing conflicts from introducing rules and migration together)
- No color-token changes in `tokens.css`
- No main-process `file-preview-service.ts` changes (internal plaintext / csv preview iframe styles)
- No `default-skills/*` HTML template changes (Skills determine their artifact typography independently of ASCI UI rules)

---

<a id="2-范围"></a>

## 2. Scope

<a id="21-in-scope必动"></a>

### 2.1 In Scope (Required Changes)
| Path | Category |
|---|---|
| `apps/electron/src/renderer/**/*.{tsx,ts,css}` | All classNames + CSS font declarations |
| `apps/electron/tailwind.config.js` | Defensive fontFamily override |
| `apps/electron/src/renderer/styles/components.css` | `.code-block-wrapper pre.shiki` font declaration |
| `apps/electron/package.json` | patch +1 |

<a id="22-out-of-scope不动"></a>

### 2.2 Out of Scope (Unchanged)
| Path | Reason |
|---|---|
| `apps/electron/src/main/lib/file-preview-service.ts` | Main-injected preview-iframe inline CSS belongs to embedded content rendering, not React UI; optional separate PR |
| `apps/electron/default-skills/**/*.html` | Skill artifacts are autonomous; 'Lora' / 'Poppins' / 'SF Mono', etc. are Skill design choices |
| `apps/electron/resources/ocr-mcp/*.test.ts` | SVG font-family assembled in test fixtures, no production-UI effect |
| `apps/electron/src/renderer/lib/citation-references.ts` | `italic` occurs in markdown parser variables, regex literals, and comments, not UI classNames |
| `apps/electron/src/renderer/components/agent/SessionPapersStatsBar.tsx` | Currently untracked, belonging to other unfinished work; its `italic` violation belongs to that file’s later PR; untouched here |

---

<a id="3-变更清单"></a>

## 3. Change List

<a id="31-css1-处"></a>

### 3.1 CSS (1 Location)
**`apps/electron/src/renderer/styles/components.css:18`**
```diff
- font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
```
Delete this line directly. Retain existing `font-family: inherit` in the same `pre.shiki code` block, inheriting the unified sans stack from body.

<a id="32-tailwind-config1-处防御兜底"></a>

### 3.2 Tailwind Config (1 Defensive Fallback)
**`apps/electron/tailwind.config.js`**: Add inside `theme.extend`:
```js
fontFamily: {
  sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
  serif: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
  mono: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
}
```
All three keys use one stack: Accidental future `font-mono` or `font-serif` still renders sans-serif, visually silent.

<a id="33-classname-删除92-处"></a>

### 3.3 className Removal (92 Locations)

<a id="331-font-mono-&#45;8033-文件"></a>

#### 3.3.1 `font-mono` × 80 (33 Files)
Distribution:
- `components/agent/tool-result-renderers/*` — 9 files (bash / edit / grep / read / write results)
- `components/settings/*` — 5 files (API keys / channels / paths)
- `components/preview/renderers/*` — 5 files (file preview renderers)
- `components/library/*` — 3 files
- `components/agent/choice/*` — 3 files
- `components/library/evidence-set-detail/*` — 2 files
- `components/agent/*` — 2 files
- `components/{config,app-shell,ai-elements,agent/permission}/*` — 1 file each

Action: Remove `font-mono` and excess adjacent spaces from each className string, without replacement.

<a id="332-italic-&#45;119-文件已排除-untracked-的-sessionpapersstatsbar"></a>

#### 3.3.2 `italic` × 11 (9 Files, Excluding Untracked SessionPapersStatsBar)
By use:

| Pattern | Files | Current className | Retained after deletion |
|---|---|---|---|
| Quotation `<blockquote>` ×7 | `EvidenceTraceCard` / `EvidenceCard` / `AddNoteDialog` / `AddReviewNoteDialog` / `PaperNotesPanel` / `NoteDetailDialog`(×2) | `border-l-2 ... italic text-foreground/8x` | `border-l-2` + `text-foreground/8x` already convey quotation |
| Empty-state placeholders ×4 | `SDKMessageRenderer` / `SetNotesTab` / `MemberPapersNotesTab`(×2) | `text-xs italic text-muted-foreground/60` | `text-xs` + `text-muted-foreground/60` already convey secondary status |

Action: Remove each `italic` without replacement classNames. Retained tokens fully cover the visual semantics.

<a id="34-版本号"></a>

### 3.4 Version
`apps/electron/package.json` patch +1 (actual value follows the implementation baseline).

---

<a id="4-pr-与分支策略"></a>

## 4. PR and Branch Strategy

- Branch: `refactor/typography-unification`, based on local `main` HEAD (already includes design.md commit `6ab84640`)
- Single PR → `main`, historical title literal: `refactor(typography): 全站字体收敛——单一无衬线栈 + 删除 font-mono / italic` (English: unify typography with one sans-serif stack and remove font-mono / italic). Current PR titles/descriptions must use English under the 2026-11-16 documentation policy.
- Squash merge (combine PR commits into one)
- PR description must link this spec (`docs/specs/typography-unification-spec.md`)

---

<a id="5-验证"></a>

## 5. Validation

<a id="51-强制"></a>

### 5.1 Required
- `bun run typecheck` — 0 errors
- `bun test` — All pass; i18n guards such as key-parity / ChannelSettings remain intact

<a id="52-手动-smokebun-run-dev"></a>

### 5.2 Manual Smoke (`bun run dev`)
Required surfaces:

| Surface | Content | Key observation |
|---|---|---|
| Chat Shiki code blocks | Agent emits triple-backtick code | Sans font, indentation retained, no font-size collapse |
| tool-result-renderers | Exercise bash/edit/grep/read/write | diff `+/-` clear; line numbers readable |
| Settings → Channels | Channel rows / API keys | Paths / redacted keys readable |
| Renderer file previews | Each renderer type | No broken text layout |
| ChoiceCard | Each risk level | Text remains clear |

<a id="53-我无法自验的部分"></a>

### 5.3 Surfaces I Cannot Self-verify
Many of the 33 components are on edge paths (some tool-result renderers appear only through specific IPC), so each cannot be entered. List unvisited surfaces in the PR description for reviewer/user follow-up.

---

<a id="6-已知视觉后果用户已-accept"></a>

## 6. Known Visual Consequences (Accepted by User)

| Item | Change | Functional impact |
|---|---|---|
| Code character width | Monospace becomes variable-width | Indentation visible, loose column alignment |
| diff `+/-` layout | Markers clear, code columns misaligned | Added/deleted lines remain identifiable |
| grep hits | Line/column/snippet sections misaligned | Text search results remain readable |
| bash output (ls / tables) | Distorted column alignment | Complete text retained |
| Inline code (backtick text) | Visual density changes | Readability unchanged |

No functional breakage; only visual density and column alignment change.

---

## 7. Done-when

- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (>= 1870 pass)
- [ ] Renderer grep for `font-mono` classNames = 0
- [ ] Renderer JSX grep for `italic` classNames = 0 (retain 4 in `lib/citation-references.ts`; 1 untracked `SessionPapersStatsBar.tsx`, §2.2)
- [ ] `components.css` no longer contains `'Fira Code'` / `'Cascadia Code'` / `'JetBrains Mono'` / `monospace`
- [ ] `tailwind.config.js` has all three `fontFamily.{sans,serif,mono}` keys
- [ ] `apps/electron/package.json` patch +1
- [ ] §5.2 key surfaces dev-smoked
- [ ] PR description lists unverified surfaces; reviewer decides whether blocking
- [ ] PR link entered into spec status line

---

<a id="8-风险与缓解"></a>

## 8. Risks and Mitigation

| Risk | Mitigation |
|---|---|
| `font-mono` required for layout (ASCII art / preformatted tables) | Observe §5.2 surfaces during smoke; if broken, handle with dedicated tokens without restoring `font-mono` |
| Removing `italic` weakens blockquote/body distinction | §3.3.2 confirms retained semantic tokens per location; if still weak at review, lightly adjust e.g. `text-foreground/65` |
| Hidden monospace references in `tokens.css` / `theme-overrides.css` outside scope | Reviewer searches repository for `monospace|Fira|Cascadia|JetBrains|Consolas` after spec completion |

---

<a id="9-实施计划implementation-plan"></a>

## 9. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all `font-mono` / `italic` className from `apps/electron/src/renderer`, remove the explicit monospace stack in `components.css`, and add a defensive Tailwind `fontFamily` override — so ASCI's runtime UI renders with a single sans-serif font family in every surface.

**Architecture:** 9 tasks proceed linearly: defensive layer → `font-mono` cleanup in 6 domains → italic cleanup → validation / publication. One commit per domain helps review; finally squash into main.

**Tech Stack:** Tailwind 3 / React 18 / TypeScript / Bun test.

---

<a id="task-1-防御层tailwind-&#45;componentscss"></a>

### Task 1: Defensive Layer (Tailwind + components.css)

**Files:**
- Modify: Insert `fontFamily` after `apps/electron/tailwind.config.js:104`
- Modify: Remove 1 line at `apps/electron/src/renderer/styles/components.css:18`

- [ ] **Step 1: grep Current Monospace Remnants (Locking Baseline)**

```bash
grep -n "Fira Code\|Cascadia\|JetBrains\|Consolas\|monospace" apps/electron/src/renderer/styles/components.css
```
Expected output:
```
18:    font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
```

- [ ] **Step 2: Delete components.css Line 18**

Use Edit tool on `apps/electron/src/renderer/styles/components.css`:
```diff
   .code-block-wrapper pre.shiki {
-    font-family: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
     background-color: hsl(var(--code-bg)) !important;
   }
```

- [ ] **Step 3: Verify No Monospace Remnants in components.css**

```bash
grep -n "Fira Code\|Cascadia\|JetBrains\|Consolas\|monospace" apps/electron/src/renderer/styles/components.css
```
Expected output: (empty)

- [ ] **Step 4: Add Defensive fontFamily Override to tailwind.config.js**

Use Edit tool on `apps/electron/tailwind.config.js`, inserting after `theme.extend.colors` and before `keyframes`:
```js
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        serif: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
```

- [ ] **Step 5: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 6: commit**

```bash
git add apps/electron/tailwind.config.js apps/electron/src/renderer/styles/components.css
git commit -m "refactor(typography): 防御层——Tailwind sans/serif/mono 同栈 + 删 Shiki monospace"
```

---

<a id="task-2-tool-result-renderers-font-mono-清算9-文件22-处"></a>

### Task 2: tool-result-renderers `font-mono` Cleanup (9 Files, 22 Locations)

**Files (modify):**
- `apps/electron/src/renderer/components/agent/tool-result-renderers/read-result.tsx:65,76,98`
- `.../default-result.tsx:35,51,54,70`
- `.../bash-result.tsx:41`
- `.../grep-result.tsx:83,97,123,127`
- `.../web-search-result.tsx:67,81,103`
- `.../write-result.tsx:25,51`
- `.../edit-result.tsx:29,55`
- `.../glob-result.tsx:19,36`
- `.../web-fetch-result.tsx:19`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/tool-result-renderers/ | wc -l
```
Expected output: `22`

- [ ] **Step 2: Remove Every `font-mono` Token**

Deletion rule: In className strings (`"..."` / clsx first argument `'...'` / template literals), delete `font-mono` plus one preceding space. If first in the string, delete it and one following space.

**Example 1** (inline className string) — `read-result.tsx:65`:
```diff
-      <pre className="rounded-md p-3 text-[12px] font-mono text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
+      <pre className="rounded-md p-3 text-[12px] text-destructive/80 bg-destructive/5 whitespace-pre-wrap break-all overflow-x-auto">
```

**Example 2** (first clsx array entry) — `bash-result.tsx:41`:
```diff
-        'rounded-md font-mono text-[12px] leading-relaxed overflow-x-auto',
+        'rounded-md text-[12px] leading-relaxed overflow-x-auto',
```

**Example 3** (font-mono-leading className) — `grep-result.tsx:127`:
```diff
-            <div className="font-mono text-[12px]">
+            <div className="text-[12px]">
```

Repeat for each file:line in this task’s Files list. Edit calls should use the full `font-mono` line as `old_string`, with necessary context, for unique matching.

- [ ] **Step 3: Verify Zero Remnants**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/tool-result-renderers/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/agent/tool-result-renderers
git commit -m "refactor(typography): tool-result-renderers 删 font-mono (22 处 / 9 文件)"
```

---

<a id="task-3-settings-font-mono-清算5-文件7-处"></a>

### Task 3: settings `font-mono` Cleanup (5 Files, 7 Locations)

**Files (modify):**
- `apps/electron/src/renderer/components/settings/AboutSettings.tsx:382`
- `.../SkillCategoryView.tsx:492`
- `.../VersionHistory.tsx:170`
- `.../ShortcutSettings.tsx:176,385`
- `.../McpServerForm.tsx:320,355`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/settings/ | wc -l
```
Expected output: `7`

- [ ] **Step 2: Edit Each Location Using Task 2 §Step 2**

Special note: `McpServerForm.tsx:320/355` has long Textarea classNames with `font-mono` at the end; remove the preceding space.

- [ ] **Step 3: Verify Zero Remnants**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/settings/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/settings
git commit -m "refactor(typography): settings 删 font-mono (7 处 / 5 文件)"
```

---

<a id="task-4-previewrenderers-font-mono-清算5-文件18-处"></a>

### Task 4: preview/renderers `font-mono` Cleanup (5 Files, 18 Locations)

**Files (modify):**
- `apps/electron/src/renderer/components/preview/renderers/NotebookRenderer.tsx:62,79,83`
- `.../PaperDetailRenderer.tsx:168,183,196,209,255,258,261,264`
- `.../CodeRenderer.tsx:68`
- `.../PaperEntryDetailPanel.tsx:151,154,158`
- `.../CsvRenderer.tsx:76,125,140`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/preview/renderers/ | wc -l
```
Expected output: `18`

- [ ] **Step 2: Edit Each Location Using Task 2 §Step 2**

Special note: `PaperDetailRenderer.tsx` has 8 locations, mostly `<dd className="font-mono text-[10.5px] text-foreground">`; remove `font-mono`, retain other tokens. `CsvRenderer.tsx` is a table container; resulting uneven columns were accepted in §6.

- [ ] **Step 3: Verify Zero Remnants**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/preview/renderers/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/preview/renderers
git commit -m "refactor(typography): preview/renderers 删 font-mono (18 处 / 5 文件)"
```

---

<a id="task-5-library-&#45;evidence-set-detail-font-mono-清算5-文件10-处"></a>

### Task 5: library + evidence-set-detail `font-mono` Cleanup (5 Files, 10 Locations)

**Files (modify):**
- `apps/electron/src/renderer/components/library/ItemDetailPanel.tsx:200,215,229,243`
- `.../NotesView.tsx:596,610`
- `.../NoteDetailDialog.tsx:171,184`
- `.../evidence-set-detail/AddPapersToSetDialog.tsx:87`
- `.../evidence-set-detail/MemberPapersTab.tsx:105`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/library/ | wc -l
```
Expected output: `10`

- [ ] **Step 2: Edit Each Location Using Task 2 §Step 2**

`NoteDetailDialog.tsx`: Remove only `font-mono`; leave its `italic` for Task 8.

- [ ] **Step 3: Verify Zero Remnants**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/library/ | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/library
git commit -m "refactor(typography): library 删 font-mono (10 处 / 5 文件)"
```

---

<a id="task-6-agent-choice-&#45;permission-&#45;messages-font-mono-清算6-文件12-处"></a>

### Task 6: agent (choice / permission / messages) `font-mono` Cleanup (6 Files, 12 Locations)

**Files (modify):**
- `apps/electron/src/renderer/components/agent/choice/ChoiceCard.tsx:156`
- `.../choice/ChoiceCardShell.tsx:60,63`
- `.../choice/choice-tokens.ts:27,29`
- `.../PermissionBanner.tsx:194,215,227,229`
- `.../AgentMessages.tsx:371`
- `.../permission/PermissionQueueList.tsx:61,64`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/ --include="*.tsx" --include="*.ts" | grep -v "tool-result-renderers" | wc -l
```
Expected output: `12`

- [ ] **Step 2: Edit Each Location Using Task 2 §Step 2**

Note: `choice-tokens.ts` is not .tsx but its className strings are equivalent. `PermissionBanner.tsx:194` is module-level constant `PRE_CLASS`:
```diff
-const PRE_CLASS = 'text-xs font-mono bg-background/50 rounded px-2 py-1.5 ...'
+const PRE_CLASS = 'text-xs bg-background/50 rounded px-2 py-1.5 ...'
```

- [ ] **Step 3: Verify Zero Remnants**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/agent/ --include="*.tsx" --include="*.ts" | grep -v "tool-result-renderers" | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/agent/choice apps/electron/src/renderer/components/agent/permission apps/electron/src/renderer/components/agent/PermissionBanner.tsx apps/electron/src/renderer/components/agent/AgentMessages.tsx
git commit -m "refactor(typography): agent choice/permission/messages 删 font-mono (12 处 / 6 文件)"
```

---

<a id="task-7-config-&#45;app-shell-&#45;ai-elements-font-mono-清算3-文件11-处"></a>

### Task 7: config + app-shell + ai-elements `font-mono` Cleanup (3 Files, 11 Locations)

**Files (modify):**
- `apps/electron/src/renderer/components/config/CapabilityPackPanel.tsx:93,149,160,167,169,173`
- `apps/electron/src/renderer/components/app-shell/SearchDialog.tsx:303,404,408,412`
- `apps/electron/src/renderer/components/ai-elements/rich-text-input.tsx:459`

- [ ] **Step 1: baseline grep**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/components/{config,app-shell,ai-elements}/ | wc -l
```
Expected output: `11`

- [ ] **Step 2: Edit Each Location Using Task 2 §Step 2**

All 4 `SearchDialog.tsx` locations are on `<kbd>`; key hints remain readable, with `bg-foreground/[0.06]` and padding conveying visual meaning.

- [ ] **Step 3: Verify Zero font-mono Throughout Renderer**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/ --include="*.tsx" --include="*.ts" --include="*.css" | wc -l
```
Expected output: `0`

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 5: commit**

```bash
git add apps/electron/src/renderer/components/config apps/electron/src/renderer/components/app-shell apps/electron/src/renderer/components/ai-elements
git commit -m "refactor(typography): config/app-shell/ai-elements 删 font-mono (11 处 / 3 文件) — 全 renderer font-mono 清零"
```

---

<a id="task-8-italic-classname-清算9-文件11-处"></a>

### Task 8: `italic` className Cleanup (9 Files, 11 Locations)

**Files (modify):**
- `apps/electron/src/renderer/components/review-demo/EvidenceTraceCard.tsx:87`
- `.../review-demo/EvidenceCard.tsx:70`
- `.../review-demo/AddNoteDialog.tsx:84`
- `.../review-demo/AddReviewNoteDialog.tsx:94`
- `.../library/PaperNotesPanel.tsx:516`
- `.../library/NoteDetailDialog.tsx:116,197`
- `.../agent/SDKMessageRenderer.tsx:946`
- `.../library/evidence-set-detail/SetNotesTab.tsx:130`
- `.../library/evidence-set-detail/MemberPapersNotesTab.tsx:84,88`

**Skip (Unchanged):**
- `apps/electron/src/renderer/lib/citation-references.ts:104,111,112,113` — Markdown parsing, not className references
- `apps/electron/src/renderer/components/agent/SessionPapersStatsBar.tsx:125` — Untracked; belongs to a later PR for that file

- [ ] **Step 1: Baseline grep (JSX)**

```bash
grep -rEn "\bitalic\b" apps/electron/src/renderer/components/ --include="*.tsx" | wc -l
```
Expected output: `11`

- [ ] **Step 2: Remove Every `italic` Token**

Same rules as Task 2 §Step 2, targeting `italic`.

**Example 1** (quotation `<blockquote>`) — `EvidenceCard.tsx:70`:
```diff
-        <blockquote className="border-l-2 border-border pl-3 py-1 italic text-sm text-foreground/80 leading-relaxed">
+        <blockquote className="border-l-2 border-border pl-3 py-1 text-sm text-foreground/80 leading-relaxed">
```

**Example 2** (empty-state placeholder) — `SDKMessageRenderer.tsx:946`:
```diff
-          <div className="px-2 py-3 text-xs italic text-muted-foreground/60">
+          <div className="px-2 py-3 text-xs text-muted-foreground/60">
```

Repeat for every file:line in this task’s Files list.

- [ ] **Step 3: Verify Zero Remnants (Regex Boundaries Avoid Matching `italic` in Variable Names)**

```bash
grep -rEn "\bitalic\b" apps/electron/src/renderer/components/ --include="*.tsx" | wc -l
```
Expected output: `0`

- [ ] **Step 4: Confirm 4 citation-references.ts and 1 SessionPapersStatsBar.tsx References Remain (Retained / Excluded by Design)**

```bash
grep -En "\bitalic\b" apps/electron/src/renderer/lib/citation-references.ts | wc -l
```
Expected output: `4`

```bash
grep -En "\bitalic\b" apps/electron/src/renderer/components/agent/SessionPapersStatsBar.tsx 2>/dev/null | wc -l
```
Expected output: `1` (whether already committed by user or still untracked)

- [ ] **Step 5: typecheck**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 6: commit**

```bash
git add apps/electron/src/renderer/components/review-demo apps/electron/src/renderer/components/library apps/electron/src/renderer/components/agent/SDKMessageRenderer.tsx
git commit -m "refactor(typography): 删 11 处 italic className (review-demo / library / agent)"
```

---

<a id="task-9-版本号-&#45;全量验证-&#45;push-&#45;pr"></a>

### Task 9: Version + Full Validation + Push + PR

**Files (modify):**
- `apps/electron/package.json`（patch +1）

- [ ] **Step 1: Read Current Version**

```bash
grep -E '"version"' apps/electron/package.json
```
Read the baseline version (`0.1.401` or newer at baseline; call it X.Y.Z, targeting X.Y.(Z+1)).

- [ ] **Step 2: bump patch**

Use Edit tool on `apps/electron/package.json`: Change `"version": "X.Y.Z"` to `"version": "X.Y.(Z+1)"`.

- [ ] **Step 3: typecheck (Full Coverage)**

```bash
bun run typecheck
```
Expected: 4 packages all `Exited with code 0`.

- [ ] **Step 4: Full bun test (Including key-parity)**

```bash
bun test
```
Expected: ≥ 1870 pass / 0 fail。

- [ ] **Step 5: Renderer-wide Fallback grep (Final Self-check)**

```bash
grep -rEn "font-mono" apps/electron/src/renderer/ --include="*.tsx" --include="*.ts" --include="*.css" | wc -l
```
Expected: `0`

```bash
grep -rEn "\bitalic\b" apps/electron/src/renderer/components/ --include="*.tsx" | wc -l
```
Expected: `0`

```bash
grep -rEn "(Fira Code|Cascadia|JetBrains|Consolas|monospace)" apps/electron/src/renderer/ | wc -l
```
Expected: `0`

- [ ] **Step 6: Dev Smoke (Manual, Cannot Automate)**

```bash
bun run dev
```
After opening the app:
1. Have Agent emit triple-backtick code → verify Shiki is no longer monospace but retains indentation
2. Trigger bash / read / grep / edit / write → verify readable tool-result-renderer text
3. Settings → About / Channels / Skill Categories / Shortcuts → no broken text layout
4. File previews: Code / Notebook / Csv / Paper details → acceptable table-column alignment
5. ChoiceCard: Trigger any option-bearing tool → recognizable option text

Record visited items ✅ in PR description; explicitly list unvisited ones.

- [ ] **Step 7: bump commit**

```bash
git add apps/electron/package.json
git commit -m "chore(version): apps/electron patch +1 (typography refactor)"
```

- [ ] **Step 8: push**

```bash
git push -u origin refactor/typography-unification
```

- [ ] **Step 9: Open PR**

```bash
gh pr create --base main --title "refactor(typography): 全站字体收敛——单一无衬线栈 + 删除 font-mono / italic" --body "$(cat <<'EOF'
## Summary
- 落地 docs/design.md §4 字体硬约束三条：禁衬线 / 禁等宽 / 禁斜体
- 删 80 处 `font-mono` className（33 文件，6 个域）+ 11 处 `italic` className（9 文件）+ 1 行 `components.css` Shiki monospace 栈
- Tailwind config 防御性兜底：`fontFamily.sans/serif/mono` 三键同栈，未来手滑写 `font-mono` 静默无效
- 关联 spec：[`docs/specs/typography-unification-spec.md`](docs/specs/typography-unification-spec.md)

## Out-of-scope
- 主进程 `file-preview-service.ts`（plaintext / csv 预览 iframe）
- `default-skills/*` HTML 模板（skill 产物自治）
- untracked `SessionPapersStatsBar.tsx`（含 1 处 italic，由后续 PR 处理）

## Test plan
- [x] `bun run typecheck` 通过
- [x] `bun test` 通过（≥ 1870 pass）
- [x] grep 兜底：renderer 内 font-mono / italic / monospace 字体栈 = 0
- [ ] Dev smoke 关键面（详见 spec §5.2 / plan T9 Step 6）：reviewer 请按列表逐项确认
- [ ] 未走过的边缘 tool-result 路径：见下文

## Manually verified surfaces
（实施时填入；T9 Step 6 走过的勾选）

## Surfaces NOT manually verified
（实施时填入；reviewer 决定是否阻断 merge）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10: Fill Spec Status**

After PR creation yields N, use Edit to replace historical header literal `> **关联 PR**：TBD（refactor/typography-unification）` with `> **关联 PR**：#N` (Related PR). Then:

```bash
git add docs/specs/typography-unification-spec.md
git commit -m "docs(specs): 回填 typography-unification spec 关联 PR #N"
git push
```

---

## 10. Self-Review Notes

Implementer performs three fresh-eyes checks:

1. **Spec coverage**: Every §1–§8 category maps to a task (defense T1 / font-mono T2–T7 / italic T8 / version + validation + PR T9)
2. **Placeholder scan**: No "TBD" / "TODO" / vague wording in the plan; X.Y.Z in T9 Step 1 is read at implementation, not an unresolved placeholder
3. **Type / naming consistency**: No new functions/types, only string-level edits; no cross-task naming-drift risk

The fenced historical commit/PR commands retain their original Chinese literals as evidence. Their descriptions cover the defensive font stack and Shiki removal; per-domain font-mono/italic cleanup with the counts above; patch bump; and linked spec/status updates. The historical PR body records the three font constraints, 80 mono/11 italic/1 CSS removals, defensive fallback, unchanged iframe/Skill templates/untracked component, typecheck/tests/zero-remnant grep, manual-smoke checklist, verified/unverified surfaces, and Claude Code attribution. Current PR publication must use English; these preserved commands are archival examples, not instructions to execute.
