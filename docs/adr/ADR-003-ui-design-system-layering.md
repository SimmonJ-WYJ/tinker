<a id="adr-003ui-设计系统分层"></a>

# ADR-003: UI Design System Layering

| Field | Content |
|------|------|
| **Status** | Accepted (Option B) |
| **Hard decision deadline** | Before drafting `docs/design.md` and before P0 introduces ESLint palette-color blocking |
| **Decision date** | 2026-05-20 |
| **Decision maker** | Riting |
| **Author** | Yannik |
| **Related** | [CLAUDE.md §2 UI rules](../../CLAUDE.md), this session's three-layer UI analysis, reference-project screenshots (Multica/AINEOS-like), sign-off issues [#170](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/170) / [#291](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/291), subsequent PR chain [#292](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/292)–[#298](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/298), spin-off [#299](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/299) |

---

<a id="一背景"></a>

## 1. Background

<a id="触发"></a>

### Trigger

A 2026-05-12 session analyzed ASCI's UI across specification / implementation / injection layers, concluding:

- **Specification**: `CLAUDE.md §2` contains only "ShadcnUI style, cards+shadows instead of borders, richly colored themes"; no centralized design specification.
- **Implementation**: `components/ui/` (17 shadcn components) + `components/settings/primitives/` (13 + `SettingsUIConstants.ts`) are solid, but tokens and non-token styles (utilities, theme overrides, special-case hacks) all mix in one 796-line `apps/electron/src/renderer/styles/globals.css`, without clear boundaries.
- **Injection**: strict TS + typed i18n completion + `key-parity.test.ts` guard **copy**, but **no visual guard exists**: ≥124 hardcoded Tailwind palette colors (`bg-red-500 / bg-green-500 / bg-zinc-900 / border-blue-500/60 ...`) across 15+ files. The apparent correctness of ocean / forest / slate's 6 alternative themes is illusory; those hardcoded colors do not follow nondefault themes.

Strong reference projects usually separate UI design systems into four clear layers: **specification (design.md) / implementation (tokens.css) / injection (globals.css) / workflow (plans/specs treat design.md as truth)**. This ADR decides whether and how ASCI adopts similar layering.

<a id="项目级硬约束"></a>

### Project-Level Hard Constraints

- CLAUDE.md §2: ShadcnUI style, cards+shadows instead of borders, richly colored themes (retain)
- CLAUDE.md §7.3: all packages `"type": "module"`, imports include `.ts` extensions (affects direct CSS import from packages/ui)
- Current monorepo: `packages/ui/` has only React components (code-block / mermaid-block / hooks), no styles directory
- Existing 7 themes switch through CSS variables + body classes (`.dark / .theme-ocean-light / .theme-ocean-dark / .theme-forest-* / .theme-slate-*`); refactoring must preserve this

---

<a id="二决策维度"></a>

## 2. Decision Dimensions

| Dimension | Key question |
|------|---------|
| **Single source of truth** | Where are semantic definitions of colors / spacing / radii / shadows / state colors, and which is authoritative? |
| **Code/document consistency** | How do human-readable specs and machine-readable tokens stay synchronized without drift? |
| **Theme safety** | How to verify all 7 themes preserve correct colors—visual inspection, lint, VRT? |
| **Adoption cost** | UI developers' cognitive load: how many files to consult and what to import by default? |
| **Future Web compatibility** | Can tokens be shared across future Web/mobile apps? |
| **Agent / newcomer readability** | Can an Agent use tokens correctly from one file; is there one source of truth for onboarding? |
| **Refactor disruption** | Does layering require widespread import/build changes? |
| **Guards** | Are lint/tests included to prevent new hardcoding? |

---

<a id="三候选方案"></a>

## 3. Options

<a id="方案-a四层分层规范-&#45;实现-&#45;注入-&#45;工作流token-下沉到-packagesuistyles"></a>

### Option A: Four Layers (Specification / Implementation / Injection / Workflow), Tokens in `packages/ui/styles/`

Reference screenshot project structure:

```
packages/ui/
  styles/
    tokens.css          # Implementation: CSS-variable truth (7 themes, state colors, spacing, radii, etc.)
    base.css            # base layer（border-border、body bg/fg）
docs/
  design.md             # Specification: human/Agent constitution—token dictionary, component rules, antipatterns
  adr/ADR-003-*.md      # This document
apps/electron/src/renderer/styles/
  globals.css           # Injection: import @asci/ui/styles/tokens.css + project utilities (scrollbar-* / mask-fade-y / titlebar-drag-region, etc.)
```

Workflow: state in `CLAUDE.md §2 UI` and `docs/superpowers/specs/*` templates: visual decisions follow design.md; tokens follow packages/ui/styles/tokens.css.

- **Pros**:
  - Clearest truth: specification in design.md, tokens in tokens.css, injection only concerns where wrappers are needed
  - Prepares a shared-token interface for Web / multiple apps (`packages/ui` is the natural consumption point)
  - Agents need only read `packages/ui/styles/tokens.css` for tokens
- **Cons**:
  - Largest scope: split globals.css (796 lines), change packages/ui build output (verify Vite can import plain CSS from workspace packages)
  - Overengineered short-term for one app; only apps/electron consumes it today
  - Ownership of `packages/ui/styles` changes is less clear than a single file in team work
- **Dimension ratings**: truth 🟢 / consistency 🟡 (lint still needed) / theme safety 🟡 / adoption 🟡 / Web 🟢 / Agent readability 🟢 / disruption 🔴 / guards 🟡

<a id="方案-b三层分层规范-&#45;实现-&#45;注入token-保留在-appselectron但拆文件"></a>

### Option B: Three Layers (Specification / Implementation / Injection), Tokens Stay in `apps/electron`, but **Split Files**

Do not add `packages/ui/styles/`; split `globals.css` into files:

```
apps/electron/src/renderer/styles/
  tokens.css            # Implementation: CSS variables for 7 themes
  base.css              # Base layer + body styles
  utilities.css         # Project utilities: scrollbar / mask-fade-y / shadow-minimal / shell-bg, etc.
  theme-overrides.css   # Theme-specific component details (mode-slider / session-item-selected / tabbar-bg, etc.)
  globals.css           # Injection: @import chain + three @tailwind directives only
docs/
  design.md             # Specification
```

- **Pros**:
  - Moderate scope: no monorepo package-boundary changes, only split within `apps/electron/src/renderer/styles/`
  - Clear responsibilities for tokens vs utilities vs theme overrides
  - Still fills the specification gap through design.md
- **Cons**:
  - No interface for future Web / multiple apps; later Web work requires migration
  - Tokens and React components live in different packages, weakening the component-as-design-system model
- **Dimension ratings**: truth 🟢 / consistency 🟡 / theme safety 🟡 / adoption 🟢 / Web 🔴 / Agent readability 🟢 / disruption 🟡 / guards 🟡

<a id="方案-c仅补规范层-&#45;守门不动实现注入结构"></a>

### Option C: Add Specification + Guards Only, Leave Implementation/Injection Structure

Keep the single `apps/electron/src/renderer/styles/globals.css` file; do only two things:

1. Write `docs/design.md` as specification (token dictionary, component rules, antipattern list)
2. Add ESLint rules blocking hardcoded palette colors (`bg-(red|blue|green|...)-\d+`, etc.)
3. Add header comments locating tokens/utilities in globals.css as manual sections

- **Pros**:
  - Smallest scope: achievable in 0.5–1 days
  - No new build dependencies or packaging impact
  - Specification + incremental guards already address off-theme colors
- **Cons**:
  - globals.css remains one 796-line file, with unchanged long-term maintenance burden
  - No future Web interface
  - Tokens and utilities remain mixed, blurring design-system versus project-hack boundaries
- **Dimension ratings**: truth 🟡 / consistency 🟡 / theme safety 🟡 / adoption 🟢 / Web 🔴 / Agent readability 🟡 / disruption 🟢 / guards 🟢

---

<a id="四已排除方案"></a>

## 4. Rejected Options

- **D: Copy the reference monorepo layout wholesale (web + desktop sharing packages/ui)** — excessive alignment without current ASCI Web plans. Option A's `packages/ui/styles/` provides an entry for a future Web app; add `apps/web` then.
- **E: Rewrite tokens using Tailwind v4 `@theme`** — Electron + Vite compatibility remains unsettled as of 2026-05; too invasive for existing CSS-variable + v3 setup and the 0.2 milestone window.
- **F: Abandon semantic tokens for Tailwind palette everywhere** — directly conflicts with CLAUDE.md §2's multitheme requirement and invalidates 7 existing themes.

---

<a id="五决策"></a>

## 5. Decision

**Choose Option B** (three layers / split token files inside `apps/electron` / add `docs/design.md`).

<a id="投票记录issue-170"></a>

### Voting Record (Issue #170)

| Role | Vote | Key reasoning |
|------|----|---------|
| @xela-G (UI designer) | B | Existing `design(1).md` draft can be adapted to ASCI; add `--success` / `--warning` state tokens |
| @itpretty (frontend developer) | B | Repository measured 125 palette hardcodes / 44 files; A's short-term value does not justify cost without a second consumer; C keeps growing; B transitions painlessly to A later |
| @pantsbang-yannik (draft author) | B | Matches draft recommendation; also decided to remove 6 extended themes' dead code, retaining light + dark only |

<a id="升-a-条款"></a>

### Upgrade-to-A Clause

If 0.3 locks in Web plans, skip the intermediate state and upgrade directly to A (move tokens into `packages/ui/styles/`). B's separated `tokens.css` can migrate as a whole without refactoring content again. @liningftp reevaluates while drafting 0.3 north-star.

<a id="后续-pr-链按依赖序"></a>

### Follow-Up PR Chain (Dependency Order)

| # | Content | Owner | Status |
|---|------|------|------|
| #291 | B-1 ADR-003 sign-off + CLAUDE.md wording + versions (this PR) | @itpretty | In progress |
| #292 | B-2 split 6 files + semantic tokens + tailwind extend + postcss-import | @itpretty | Not started |
| #293 | B-3 migrate tool-result-renderers hardcodes → tokens (~31 / 7 files) | @itpretty | Await B-2 |
| #294 | B-4 migrate settings & forms (~20 / 6 files, parallel with B-5) | @itpretty | Await B-2 |
| #295 | B-5 migrate remaining business components (~74 / 28 files, parallel with B-4) | @itpretty | Await B-2 |
| #296 | B-6 ESLint palette blocking + CI gate | @itpretty | Await B-3/4/5 |
| #297 | B-7 draft ASCI-specific `docs/design.md` | @xela-G | Alongside B-2 |
| #298 | B-8 `token-parity.test.ts` guards design.md ↔ tokens.css | @itpretty | Await B-2/B-7 |

<a id="spin-off独立不阻塞-b-链"></a>

### Spin-Off (Independent, Does Not Block B)

- **#299**: Wire system-preference-driven `.dark` toggle (settings + IPC + atom + UI + i18n synchronized across four layers). Actually connect dark mode.

---

<a id="六后果"></a>

## 6. Consequences

<a id="共同后果无论选-a-&#45;b-&#45;c"></a>

### Shared Consequences (A / B / C)

- Add `docs/design.md` (specification with token dictionary, component rules, antipatterns, pre-commit checks)
- Add ESLint guard prohibiting Tailwind palette colors in className (`bg|text|border-(red|blue|green|gray|yellow|slate|zinc|amber|orange|emerald|cyan|sky|indigo|violet|purple|pink|rose)-\d+`)
- Add two token groups `--success / --warning` (+2 lines per 7 themes), providing semantic replacements for 124 hardcodes
- Migrate 124 hardcodes into semantic tokens through file-specific PRs, estimated 1–2 days
- Update `CLAUDE.md §2 UI`: colors must use tokens, no Tailwind palette colors; see `docs/design.md`

<a id="方案-a-额外后果"></a>

### Additional Consequences of A

- Verify Vite + Electron renderer can `import '@asci/ui/styles/tokens.css'` from a workspace package (theoretically yes; packaging smoke test needed)
- `packages/ui/package.json` must export `./styles/*`
- Increment `apps/electron` and `packages/ui` versions together

<a id="方案-b-额外后果"></a>

### Additional Consequences of B

- Connect split files with `@import`; verify Vite + PostCSS processing does not change `@tailwind base/components/utilities` injection order
- Decide whether 7 themes' detail overrides (`mode-slider / session-item-selected / tabbar-bg`) remain in `theme-overrides.css` or move to component CSS modules / styled className

<a id="方案-c-额外后果"></a>

### Additional Consequences of C

- globals.css stays single-file with navigation comments; new tokens may still accidentally alter utility sections
- Another ADR may be needed for future splitting

<a id="风险"></a>

### Risks

| Risk | Mitigation |
|------|------|
| PostCSS `@import` order breaks Tailwind layers after splitting | Run `bun run electron:build` smoke check and manually switch zh↔en/themes in settings |
| Migration of 124 hardcodes introduces regressions | File-specific PRs; check target components in all 7 themes under `bun run dev` |
| ESLint incorrectly blocks valid cases (e.g. semantically meaningful diff colors in `tool-result-renderers`) | Allowlist + `docs/design.md` antipattern list requiring dedicated tokens for exceptions such as diff-row backgrounds |
| design.md drifts from tokens.css | Explicit token truth = `<path>/tokens.css` at design.md top; dictionary table lists CSS-variable names individually |

<a id="后续动作"></a>

### Follow-Up Actions

1. Sign this ADR → ✅ #291 (this PR)
2. Implement selected file structure → #292 (B-2)
3. Write `docs/design.md` (recommend ui-designer Agent Quenik for initial draft) → #297 (B-7)
4. Add ESLint rule → #296 (B-6)
5. Migrate hardcodes through file-specific PRs → #293 / #294 / #295 (B-3/4/5)
6. Add token-parity guard → #298 (B-8)
7. Wire dark toggle → #299 (spin-off)
8. (Optional) Storybook / Playwright VRT for light + dark screenshot regression

---

<a id="七实际执行轨迹透明度说明"></a>

## 7. Actual Execution Timeline (Transparency)

This ADR is **partly retrospective**:

| Date | Event |
|------|------|
| 2026-05-12 | Yannik proposed three-layer UI analysis and drafted ADR-003 |
| 2026-04-18 (before sign-off) | Commit [`99c45ea4`](https://github.com/OPENSCI-Labs/ASCI-Alpha/commit/99c45ea4), translated title "refactor: remove theme switching and brand Logo downloads (phase 4)," had already removed 6 extended themes' dead code and `renderer/atoms/theme.ts` / `AppearanceSettings.tsx` / `AppSettings.themeMode` / `ThemeStyle` / `GET_SYSTEM_THEME` IPC, totaling 1173 lines |
| 2026-05-13 | @itpretty confirmed in #170 that dead-code cleanup was complete; the earlier commit absorbed globals.css cleanup from original B-1 scope |
| 2026-05-20 | All three votes collected (@xela-G / @itpretty / @pantsbang-yannik chose B); ADR signed off |

**Relationship to [ADR-000](./ADR-000-common-convention.md) collaboration rules**: violates the decision-first expectation. Commit 99c45ea4 cleaned dead code 32 days before ADR sign-off because phase-4 refactoring and ADR-003 discussion ran in parallel, and cleanup converged faster than review. Record publicly following [ADR-001](./ADR-001-local-storage.md)'s decision-timeline template; future ADRs must be signed before implementation.

**Impact on follow-up PRs**: B-1 (#291) now only finishes documentation (ADR sign-off + CLAUDE.md L44 wording + version increment); B-2 onward follows the plan without structural impact.
