<a id="标签族语义规范-specbadge-&#45;chip-semantic-specification"></a>

# Tag Family Semantic Specification (Badge / Chip Semantic Specification)

> **Status**: draft · awaiting review
> **Related issue**: (to be added, B-5 / [#295](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/295) palette consolidation series)
> **Related PR**: (to be opened)
> **Domain language source of truth**: this spec defines tag-family (tag / badge / chip) terminology; after implementation, incorporate into `docs/design.md` §6.1 + new §8.4
> **Related references**: [`settings-style-unification-spec.md`](./settings-style-unification-spec.md) · [`typography-unification-spec.md`](./typography-unification-spec.md)

---

<a id="1-背景与动机"></a>

## 1. Background and Motivation

Tag-like visual elements (tag / badge / chip / pill / label) currently use **5 coexisting recipes**, without a unified semantic entry:

| Recipe | Location | Style |
|---|---|---|
| `Badge` (shadcn base) | `components/ui/badge.tsx` | Single `variant` axis, primarily **solid**, missing success/warning |
| `SettingsPill` | `components/settings/primitives/SettingsPill.tsx` | Separate `tone` axis, **soft `/10`** |
| `Button` `chip` variant | `components/ui/button.tsx` | Capsule button |
| Inline chip | `components/ai-elements/inline-label-style.ts` | **14px**, follows body text, neutral background |
| Handwritten className at call sites | SessionPaperCard / LeftSidebar / NodeInspector / McpSection … | Soft, with divergent opacity/radii |

<a id="11-已识别的不一致点规范化动机"></a>

### 1.1 Identified Inconsistencies (Motivation for Standardization)

- **A. Three soft-opacity recipes**: the same success green appears as `bg-success/10` (SettingsPill / RelevanceBadge / McpSection / EvidenceSet), `bg-success/15` (SessionPaperCard JCR/IF, ScoreBadge), and `border-success text-success` (NodeInspector outline), with three visual weights.
- **B. info alternates solid ↔ soft**: `Badge variant="info"` is solid `bg-info`, whereas LeftSidebar / McpSection / ScoreBadge / SessionPaperCard use soft `bg-info/10~/15`. LeftSidebar even overrides `<Badge variant="info">` with soft className, rendering variant meaningless.
- **C. Divergent destructive opacity**: `/5` (ToolActivityItem) vs `/10` (SettingsPill / McpServerForm) vs `/15` (SessionPaperCard Q4).
- **D. Radius documentation ↔ implementation conflict**: `design.md` §6.1 requires inline badges/tags to use `rounded-sm` (2px), but most implementation uses `rounded-md` (6px).
- **E. Two font-size tracks**: semantic labels use `text-badge` (12px), whereas inline chips (`inline-label-style.ts`), CitationBadge, and StarterChips each hardcode 14px.
- **F. Missing variants**: `Badge` lacks success/warning, forcing every green/yellow call site to write className—the root of A/B/C.
- **G. Colors bypass tokens**: CitationBadge uses hardcoded hex such as `#fde68a` / `#78350f`, unresponsive to theme changes.

---

<a id="2-设计目标"></a>

## 2. Design Goals

1. Consolidate 5 recipes into **one semantic entry**: a two-axis `tone × variant` `Badge` component + shared inline-chip styles.
2. Establish an authoritative `design.md` section (variant×`tone` matrix + constraints for two categories + exceptions + antipatterns), correcting §6.1's outdated `rounded-sm` rule.
3. Migrate handwritten className call sites to components/tokens, resolving A–G.

**Non-goals**: no new color tokens (reuse `--success` / `--warning` / `--info` / `--destructive` / `--primary` / `--muted`); no `Button` `chip` variant changes (it is a button rather than display label); ESLint enforcement belongs to B-6 ([#296](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/296)).

---

<a id="3-规范模型写进-designmd-的内容"></a>

## 3. Specification Model (Content for design.md)

**Tags = two orthogonal axes × two categories.**

<a id="31-类别一语义标签semantic-badge"></a>

### 3.1 Category One: Semantic Badge

Standalone semantic color blocks (Q1 quartile, MCP enabled status, relevance scores, node status…).

**Shared base**: `inline-flex items-center rounded-md px-2.5 py-0.5 text-badge font-normal` (12px / 6px radius).

**Axis one — tone (semantic color)**: `neutral` (default) / `primary` / `info` / `success` / `warning` / `destructive`

**Axis two — variant (form)**: `soft` (default) / `solid` / `outline`

**tone × variant matrix** (soft background opacity uniformly **`/10`**):

| tone \ variant | `soft` (default) | `solid` | `outline` |
|---|---|---|---|
| `neutral` | `bg-muted text-muted-foreground` | `bg-muted text-foreground` | `border border-border text-muted-foreground` |
| `primary` | `bg-primary/10 text-primary` | `bg-primary text-primary-foreground` | `border border-primary text-primary` |
| `info` | `bg-info/10 text-info` | `bg-info text-info-foreground` | `border border-info text-info` |
| `success` | `bg-success/10 text-success` | `bg-success text-success-foreground` | `border border-success text-success` |
| `warning` | `bg-warning/10 text-warning` | `bg-warning text-warning-foreground` | `border border-warning text-warning` |
| `destructive` | `bg-destructive/10 text-destructive` | `bg-destructive text-destructive-foreground` | `border border-destructive text-destructive` |

> Why soft `/10`: most common in existing code (SettingsPill / RelevanceBadge / McpSection / EvidenceSet), consistent with shadcn soft conventions, with sufficient contrast in light/dark themes.

<a id="32-类别二行内-chipinline-chip"></a>

### 3.2 Category Two: Inline Chip

Short capsules within body/conversation text (FilePathChip / DoiChip / keyword chips / CitationBadge). Constraints differ from semantic badges:

- Font size **14px** (follows body text rather than 12px `text-badge`), extending the body minimum in [`min-font-size-14px-spec.md`](./min-font-size-14px-spec.md).
- `rounded-md` (6px), neutral `bg-muted-foreground/15`; add hover states when clickable.
- Consolidate the source of truth into `components/ai-elements/inline-label-style.ts` (`INLINE_LABEL_CLASS` etc.); all inline branches reference it rather than assemble their own.

<a id="33-形态例外明确记入规范非违规"></a>

### 3.3 Shape Exceptions (Explicitly Specified, Not Violations)

These are outside semantic badges and retain `rounded-full`:

- **Count indicators / `+N`** (EvidenceSetBadgeStack)
- **Status dots** (UpdateBadge dot)
- **Starter capsule buttons** (StarterChips—buttons with pill shapes)

Name these as non-semantic-label exceptions to avoid false radius-inconsistency findings.

<a id="34-反模式清单designmd-九-新增条目"></a>

### 3.4 Antipatterns (New Entries in design.md §IX)

| Antipattern | Correction |
|---|---|
| Handwritten `bg-success/15` / `bg-info/15` semantic colors | Use `<Badge tone=... variant="soft">`, uniform `/10` |
| `<Badge variant="info">` overridden to soft with className | Use `<Badge tone="info" variant="soft">` |
| Hardcoded tag hex (e.g. `#fde68a`) | Use semantic tokens for theme responsiveness |
| Semantic badges at 14px / inline chips at 12px | Semantic badges `text-badge`(12), inline chips 14px; keep separate |

---

<a id="4-组件与迁移落地"></a>

## 4. Components and Migration

<a id="41-改造-componentsuibadgetsx"></a>

### 4.1 Update `components/ui/badge.tsx`

Upgrade single-axis `variant` to two-axis `tone × variant` cva. Original pseudocode comments identify the example and map compoundVariants to §3.1 classNames.

```tsx
// 伪代码示意
const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2.5 py-0.5 text-badge font-normal transition-colors focus:outline-none",
  {
    variants: {
      tone: { neutral, primary, info, success, warning, destructive },
      variant: { soft, solid, outline },
    },
    compoundVariants: [ /* tone × variant → §3.1 矩阵的 className */ ],
    defaultVariants: { tone: "neutral", variant: "soft" },
  }
)
```

- `BadgeProps` exposes `tone` + `variant`, removing old single-axis `variant: default|secondary|destructive|info|outline`.
- This breaks the old API; since migration is in scope, rewrite all `<Badge variant=...>` call sites together (4.3).
- Only one `size` for now (no `sm/lg`, YAGNI).

<a id="42-settingspill-并入-badge"></a>

### 4.2 Merge SettingsPill into Badge

`SettingsPill` tones (neutral/success/warning/destructive, soft `/10`) are a subset of new Badge → **delete SettingsPill**, migrating call sites to `<Badge tone=... variant="soft">`.
Preserve: if settings visuals depend on SettingsPill's fixed `h-6 leading-[1]`, check whether Badge's default `py-0.5` matches height. If not, add `className="h-6"` at call sites rather than a Badge size axis.

<a id="43-迁移调用点探查到的代表迁移时以-grep-全量为准"></a>

### 4.3 Migrate Call Sites (Representative Findings; Use Full grep During Migration)

| Call site | Current | After migration |
|---|---|---|
| SessionPaperCard JCR quartiles `:352` | Five handwritten `bg-success/15 …` levels | `<Badge tone=... variant="soft">` (`/15`→`/10`) |
| SessionPaperCard IF bands `:362` | Three handwritten `/15` levels | Same as above |
| LeftSidebar Zotero badge `:496` | `<Badge variant="info">` overridden to soft | `<Badge tone="info" variant="soft">` |
| NodeInspector node status `:146/152` | `variant="outline"` + `border-success/warning` | `<Badge tone=success/warning variant="outline">` |
| McpSection status `:228/235` | `bg-info/10` `bg-success/10` `bg-muted` | `<Badge tone=... variant="soft">` |
| All SettingsPill call sites | `<SettingsPill tone=...>` | `<Badge tone=... variant="soft">` |
| SetHeader unpersisted warning `:25` | `bg-warning/10 text-warning` | `<Badge tone="warning" variant="soft">` |
| ToolActivityItem error `:120` | `bg-destructive/5` (lighter) | `<Badge tone="destructive" variant="soft">` (uniform `/10`) |
| AccountMenu DevBypass `:130` | `bg-warning/15` | `<Badge tone="warning" variant="soft">` |
| Inline: FilePathChip / DoiChip / keyword chip | Already/partly shared | Uniform `inline-label-style.ts` |
| CitationBadge `:68` | Hardcoded hex, 14px | Tokens (inline-chip style, amber→`warning` soft or neutral, decide during migration) |
| EvidenceSetBadgeStack `+N` `:44` | `variant="chip"` | Count exception; retain `rounded-full`, §3.3 |

> **RelevanceBadge / ScoreBadge / RELEVANCE_COLORS** use the dedicated five-level `--relevance-*` gradient tokens (listed in design.md §3.4). These are score scales rather than general semantic tones and **do not merge** into Badge's tone axis; align radii/font sizes with §3.1 (`rounded-md` / `text-badge`).

<a id="44-designmd-文档改动"></a>

### 4.4 design.md Changes

1. **Add §8.4 “Tag Family (Badge / Chip) Semantics”**: §3.1 matrix + §3.2 inline-chip constraints + §3.3 exceptions.
2. **Correct §6.1 radius table**: `rounded-sm | 2 | 内嵌 badge / tag` (inline badge/tag) → semantic badges / inline chips use `rounded-md` (6px); remove the `rounded-sm` row or revise its purpose if otherwise unused.
3. **§IX antipattern list**: add §3.4 entries.
4. **§8.1 component list**: update Badge description to two-axis tone×variant; synchronize the 17-component list semantically (SettingsPill removed).
5. **§XIII known deviations**: mark UpdateBadge / CitationBadge palette hardcoding resolved after migration.

---

<a id="5-验收标准done-when"></a>

## 5. Acceptance Criteria (Done When)

1. [ ] `bun run typecheck` passes.
2. [ ] `bun test` passes (including `key-parity`; no new copy this round, so zero key additions/removals).
3. [ ] grep finds no remaining `bg-success/15`, `bg-info/15`, `bg-destructive/5`, or hex literals in label contexts.
4. [ ] Two-axis `Badge` cva implemented; `SettingsPill` deleted, zero references.
5. [ ] All inline chips use `inline-label-style.ts`.
6. [ ] `design.md` §6.1 / §8.1 / §8.4 / §IX / §XIII synchronized; §3.1 matrix matches `tokens.css` semantic colors one-to-one.
7. [ ] `apps/electron` `package.json` patch incremented (once when opening the PR).
8. [ ] In `bun run dev`, switch light/dark + zh/en and inspect paper-card quartile tags / MCP status / settings pills / sidebar badges / conversation inline chips; no visual regressions or raw keys.
9. [ ] Complete one `simplify` / `@code-simplifier` review.

---

<a id="6-风险与开放问题"></a>

## 6. Risks and Open Questions

- **CitationBadge amber → which tone**: currently amber-200 background (review citation indicator). Decide during migration: `warning` soft or neutral chip? Prefer neutral (citations are not warnings); confirm before implementation.
- **SettingsPill equal height**: see §4.2; verify Badge's default height preserves settings alignment during migration.
- **Breaking Badge API**: migrate all repository `<Badge variant=...>` sites at once; no compatibility shim for old variants during migration, avoiding parallel APIs.
