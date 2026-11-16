<a id="choice-banner-紧凑化设计-spec"></a>

# Compact Choice Banner Design Spec

> **Status**: draft · awaiting review
> **Related issue**: (to be opened)
> **Related PR**: (to be opened)
> **Domain language source of truth**: `CONTEXT.md` (no dedicated banner terminology yet; retain existing names)
> **Trigger**: execution/permission cards currently fill the conversation screen and need reshaping using Codex-style compact overlay cards.

---

<a id="1-问题与目标"></a>

## 1. Problem and Goals

<a id="11-现状"></a>

### 1.1 Current State

`PermissionBanner` appears when the Agent calls MCP / Bash / file tools, **replacing the input** at the bottom of `AgentView`:

- Title ("Confirmation required: zotero / zotero_list_collections")
- Subtitle ("Use tool: mcp__zotero__zotero_list_collections")
- Tool preview (command / file path / JSON arguments, max-h 120px)
- Decision reason (hard rule / AI decision, optional)
- 3 options (Allow / Deny / Always allow this session), each 36px high
- Queue suffix ("+N queued")
- Keyboard footer (↑↓ navigate / ↵ confirm / 1-3 direct selection / esc terminate)

Typical measured height ≈ 180–240px, **visually crowding conversation messages above** and feeling overwhelming.

<a id="12-目标"></a>

### 1.2 Goals

Turn `PermissionBanner` into a **compact overlay card**:

1. Hug content height (no min-height): ordinary ≈ 130px, with preview ≈ 160px, dangerous with tooltip still ≈ 130px
2. Retain input-replacement mode (`!hasBannerOverlay && <Input>`), without z-index layering
3. Increase density: merge tool name into title, remove subtitle, move reason to tooltip, cap preview at 60px
4. Add bottom-right **confirm button** (label = focused option's verb; button turns red in danger state with Deny focused)
5. Refresh 3 sibling banners sharing the shell: `AskUserBanner`, `ExitPlanModeBanner`, `LitReviewDirectionsBanner`

<a id="13-非目标"></a>

### 1.3 Non-goals

- No IPC / permission service / state-atom changes (`PermissionRequest` shape and `PERMISSION_RESPOND` response channel unchanged)
- No z-index layering between banner and input (considered input above card, ultimately returned to replacement)
- No `ToolActivityItem` / message-stream tool-result rendering changes (separate visual system/task)
- No animation polish (fade / slide-up, etc. deferred to v2)
- No redesign of `ConfirmDangerousModal` (reuse only)

---

<a id="2-决策回顾"></a>

## 2. Decision Review

| Item | Decision | Alternatives and Rejection Reasons |
|---|---|---|
| **Scope** | Change shared shell (`ChoiceCardShell` + `choice-tokens.ts`), refreshing all 4 banners | PermissionBanner body alone offers limited changes; corners/borders/footer come from shell |
| **Branch** | `alex-20260603` (based on main), PR → main | UI-main would lose real IPC data-flow validation |
| **Input relationship** | Replace input (retain current behavior) | Input layered above card adds implementation/keyboard complexity and weakens blocking-decision semantics |
| **Option arrangement** | Vertical (retain 3 rows, height 36→28px) | Horizontal layout degrades poorly on narrow screens and mismatches existing keyboard model |
| **Height** | Hug content, no min-height | Fixed 80–90px overflows with previews / multiple queued requests |
| **Keyboard** | Retain global listeners (1/2/3 / ↑↓ / ↵ / Esc); replacement input avoids focus conflict | — |
| **Information** | Remove subtitle · tool in title · reason → tooltip · always-allow explanation → tooltip · preview 120→60px | Keeping all information overloads; aggressive horizontal buttons hide Bash/file arguments |
| **Confirm button** | Bottom-right; focused option verb; red only for danger + focused Deny, otherwise dark | Always "Confirm" conveys little; always red over-warns in ordinary states |

---

<a id="3-视觉规格"></a>

## 3. Visual Specification

<a id="31-整卡结构"></a>

### 3.1 Card Structure

```
┌──────────────────────────────────────────────┐
│ Confirm  zotero / zotero_list_collections   │  ← title row (hdr)
│              · Dangerous: ⚠ prefix; reason tooltip ⓘ on right
├──────────────────────────────────────────────┤
│ git fetch origin main                        │  ← optional preview (prv)
├──────────────────────────────────────────────┤
│ 1  Allow                                      │  ← option row (opt × N)
│ 2  Deny                                       │     focused row: bg-muted/40
│ 3  Always allow this session                  │     disabled row: opacity-45
├──────────────────────────────────────────────┤
│ ↑↓Navigate 1-3Select EscTerminate [Allow ↵]   │  ← footer (ftr)
└──────────────────────────────────────────────┘
```

<a id="32-尺寸-token落-choice-tokensts"></a>

### 3.2 Size Tokens (in `choice-tokens.ts`)

| Token | Current | New |
|---|---|---|
| Overall `shellClass` padding | `p-3 / px-3 py-2` | `p-0` (children control it) |
| Title-row padding | `px-3 pt-2 pb-1` | `px-3 py-2` (unified) |
| Title font size | `text-sm font-semibold` | Retain `text-sm font-semibold` (13px) |
| Tool name | `text-xs text-muted-foreground font-mono` | Retain |
| Subtitle | Present | **Remove** |
| Preview max-h | `120px` | `60px` |
| Preview font size | `text-xs font-mono` | Retain, `px-3 py-1` |
| Option row height | `h-9 px-3` | `min-h-7 px-3 py-1.5` (about 28px) |
| Option separators | `divide-y` | Retain; color `border-muted/40` |
| Footer padding | `border-t px-3 py-1.5` | `border-t pl-3 pr-2 py-1.5` (space for button at right) |
| Footer font size | `text-[11px]` | Retain |
| Confirm button | **New** | `h-7 px-3 text-xs font-medium rounded` |

<a id="33-颜色-token沿用现有语义-token无-tailwind-palette-硬编码"></a>

### 3.3 Color Tokens (Existing Semantic Tokens, No Hardcoded Tailwind Palette)

- Ordinary: shell `bg-card border-border`; button `bg-foreground text-background hover:bg-foreground/90`
- Dangerous: shell `border-destructive/60`; title `text-destructive`; button (Deny focused) `bg-destructive text-destructive-foreground`
- Safe (if present): retain `border-emerald-500/50` (existing behavior; design.md can decide future token replacement)

> Follow CLAUDE.md §2 strictly: colors must use semantic tokens, no hardcoded Tailwind palette; brand-color exemptions require `// eslint-disable-next-line asci/no-tailwind-palette -- <理由>` (placeholder means reason).

<a id="34-tooltip-内容"></a>

### 3.4 Tooltip Content

| Trigger | Existing source | Tooltip content |
|---|---|---|
| "Decision reason ⓘ" at title right (only with hardRuleReason or decisionReason) | `permission.banner.reason.hardRule` / `permission.banner.reason.decision` | Full original text |
| "Always allow this session" option row | `permission.banner.alwaysAllowTooltip` | Existing copy |

Tooltip trigger: mouse hover **+ keyboard focus-visible** (accessible); use ShadcnUI `Tooltip`, with `open-on-focus` enabled by default, no custom implementation.

---

<a id="4-内容与-i18n-改动"></a>

## 4. Content and i18n Changes

<a id="41-现-key-处理appselectronsrcrendererlocalesenzhconversationinputjson"></a>

### 4.1 Existing Keys (`apps/electron/src/renderer/locales/{en,zh}/conversation/input.json`)

The actual "Use tool: xxx" subtitle comes from `banner.description.generic` (zh: `使用工具：{{tool}}` / en: `Use tool: {{tool}}`), rendered by `ToolPreview` when `toolInput` is empty and no `command` exists (`PermissionBanner.tsx:202`), rather than a dedicated subtitle key. Keep the key (other branches may use it), but change rendering: when fallback equals "Use tool: <tool already shown in title>", **leave body empty** so ChoiceCard goes directly to options.

| Key | Action |
|---|---|
| `banner.title.normal` "Confirmation required" | Retain |
| `banner.title.dangerous` "Dangerous action requires confirmation" | Retain |
| `banner.title.safe` "Confirm action" | Retain |
| `banner.action.allow` / `.deny` / `.alwaysAllowSession` | Retain |
| `banner.alwaysAllowTooltip` | Retain, use as tooltip |
| `banner.reason.hardRule` / `.decision` | Retain, use as tooltip |
| `banner.description.generic` "Use tool: {{tool}}" | Retain key (other entry points may use it); PermissionBanner **omits body** when generic fallback duplicates the title tool name |
| `banner.confirmButton` (new) | Default Chinese equivalent of "Confirm" (en: "Confirm") as fallback; runtime label comes from focused option |

<a id="42-现-key-处理appselectronsrcrendererlocalesenzhconversationpermissionjson"></a>

### 4.2 Existing Keys (`apps/electron/src/renderer/locales/{en,zh}/conversation/permission.json`)

| Key | Action |
|---|---|
| `choiceCard.keyboardHint.navigate` "Navigate" | Retain |
| `choiceCard.keyboardHint.confirm` "Confirm" | **Remove JSX usage** (move to button kbd `↵`); retain key for other banners |
| `choiceCard.keyboardHint.select` "Direct selection" | Retain |
| `choiceCard.keyboardHint.dismissTerminate` "Terminate" | Retain |
| `choiceCard.counter` `{{current}}/{{total}}` | Retain |
| Old `permission.title` / `permission.subtitle.tool` (legacy block) | Marked unused during exploration; untouched here, separate cleanup spec later |

<a id="43-双语守门"></a>

### 4.3 Bilingual Guard

- Add/remove keys in en + zh together
- `key-parity.test.ts` guards against missed translations

---

<a id="5-文件清单实现时落到这些文件"></a>

## 5. Implementation Files

| File | Change |
|---|---|
| `apps/electron/src/renderer/components/agent/choice/choice-tokens.ts` | Tighten size tokens, add `confirmButtonClass` |
| `apps/electron/src/renderer/components/agent/choice/ChoiceCardShell.tsx` | Rewrite footer: left hints + right confirm; accept `confirmLabel`, `confirmDanger`, `onConfirm`; remove `counter` slot (merge into hints or keep? §8 undecided) |
| `apps/electron/src/renderer/components/agent/choice/ChoiceCard.tsx` | Route Enter through shell `onConfirm`; notify shell to update label when focus changes |
| `apps/electron/src/renderer/components/agent/choice/KeyboardHintFooter.tsx` | Inline short text (no standalone keyboard-hint row; remove component or simplify to string builder) |
| `apps/electron/src/renderer/components/agent/PermissionBanner.tsx` | `ToolPreview` generic fallback returns `null` when duplicating tool name; preview max-h 60; reason moves from inline to tooltip; pass through ChoiceCard / shell `confirmLabel = focusedOption.label`, `confirmDanger = dangerLevel === 'dangerous' && focusedIdx === denyIdx` |
| `apps/electron/src/renderer/components/agent/AskUserBanner.tsx` | Adopt new shell props; integrate any free-text input above confirm button |
| `apps/electron/src/renderer/components/agent/ExitPlanModeBanner.tsx` | Adopt new shell props |
| `apps/electron/src/renderer/components/agent/LitReviewDirectionsBanner.tsx` | Adopt new shell props; for >5 options, add `max-h-[160px] overflow-y-auto` to shell listbox |
| `apps/electron/src/renderer/components/agent/permission/PermissionQueueList.tsx` | Unchanged (queue suffix already compact) |
| `apps/electron/src/renderer/locales/{en,zh}/conversation/input.json` | Remove `banner.subtitle.tool`; add `banner.confirmButton` fallback |
| `apps/electron/package.json` | Increment patch (`0.x.y → 0.x.(y+1)`) |
| `apps/electron/src/renderer/components/agent/choice/ChoiceCardShell.test.tsx` (new) | New-prop rendering snapshots + keyboard behavior |
| `apps/electron/src/renderer/components/agent/PermissionBanner.test.tsx` (add if absent) | Confirm label follows focusedIdx, danger colors switch, tooltip triggers |

---

<a id="6-实现注意点"></a>

## 6. Implementation Notes

<a id="61-ipc-&#45;数据流保持不变"></a>

### 6.1 IPC / Data Flow Unchanged

- Incoming: `useGlobalAgentListeners.ts:479-495` still consumes `permission_request` → `allPendingPermissionRequestsAtom`
- Outgoing: `PermissionBanner.respond` still calls `window.electronAPI.respondPermission({ requestId, behavior, alwaysAllow })`
- Termination: Esc still uses `handleDismiss` → flush queue + `stopAgent(sessionId)`

<a id="62-键盘模型不变"></a>

### 6.2 Keyboard Model Unchanged

- Global `keydown` listeners still registered by `ChoiceCard.tsx:85-116` and `ChoiceCardShell.tsx:38-53`
- Retain `skipInputElements` guard (other textarea / contentEditable elements may exist despite input replacement)
- Enter: previously direct `triggerSelect(focusedIdx)` → now shell `onConfirm`, which still calls `triggerSelect`
- `ConfirmDangerousModal` path unchanged

<a id="63-dev-only-不涉及"></a>

### 6.3 No Dev-Only Logic

No dev/prod branches; no `IS_DEV_MODE` / `ASCI_DEV` gate needed.

<a id="64-packages-解耦"></a>

### 6.4 Decoupled from packages/

Visual/i18n changes stay within `apps/electron/`, without coupling to `packages/shared` / `packages/core` / `packages/ui`.

---

<a id="7-测试矩阵"></a>

## 7. Test Matrix

<a id="71-单元-&#45;集成bun-test"></a>

### 7.1 Unit / Integration (Bun test)

| Case | Coverage |
|---|---|
| ChoiceCardShell ordinary rendering | Title / options / footer / confirm button all visible |
| ChoiceCardShell dangerous rendering | Shell `border-destructive/60`, title `text-destructive`, focused-deny button `bg-destructive` |
| ChoiceCard ↵ routing | Enter invokes shell `onConfirm`, then `triggerSelect(focusedIdx)` |
| ChoiceCard 1/2/3 direct selection | Number key triggers corresponding option |
| ChoiceCard ↑↓ navigation | `focusedIdx` cycles available options; label synchronizes |
| ChoiceCard Esc | Still calls `onDismiss` |
| PermissionBanner label synchronization | Focus changes update label ("Allow" → "Deny" → "Always allow this session") |
| PermissionBanner tooltip | With hardRuleReason, show `判定原因 ⓘ` (Decision reason ⓘ) at title right; hover/focus shows full text |
| PermissionBanner queue | N>1 shows `+N queued`, highest priority first |
| i18n key-parity | Synchronize en + zh additions/removals of `banner.subtitle.tool`, `banner.confirmButton` |

<a id="72-视觉手测bun-run-dev"></a>

### 7.2 Manual Visual Checks (`bun run dev`)

- Ordinary zotero / paper-search MCP call → card ≈ 130px, no subtitle, "Allow ↵" button
- Bash (git fetch / ls) → preview visible, card ≈ 160px
- Dangerous Bash (rm -rf triggers detect-dangerous-bash) → red border / ⚠ title / Deny focused / red button / always-allow disabled
- Queued requests (2 tool calls consecutively) → `+1 queued`, second promoted after first resolves
- Walk zh ↔ en once each → no raw keys, correct bilingual labels
- Golden paths for AskUserBanner / ExitPlanModeBanner / LitReviewDirectionsBanner → consistent appearance

### 7.3 reach

- `bun run typecheck` passes (including new prop types)
- `bun test` fully green (including `key-parity.test.ts`)
- `apps/electron/package.json` patch incremented

---

<a id="8-仍待实现期决策不阻塞-spec-approval"></a>

## 8. Implementation-Time Decisions (Do Not Block Spec Approval)

1. **Counter slot**: current shell shows `{{current}}/{{total}}` (e.g. "1/3 queued") beside title. Keep in new design? Default retain, move to queue suffix if crowded.
2. **Safe appearance**: current `dangerLevel === 'safe'` uses `border-emerald-500/50`. Retain here; switch when design system provides `--success`.
3. **Button hover/active**: existing ShadcnUI `Button` variant or minimal custom style? Default reuse ShadcnUI variant.

---

<a id="9-风险与回滚"></a>

## 9. Risks and Rollback

| Risk | Mitigation |
|---|---|
| Enter routing breaks existing PermissionBanner tests | Run existing `PermissionBanner.test.tsx` first; record behavioral differences in spec tests |
| Long sibling-banner listboxes (AskUser, etc.) make shell too tall | Add `max-h-[160px] overflow-y-auto` within shell (§5) |
| Long reason tooltip overflows | Existing ShadcnUI tooltip provides automatic max-width / wrapping |
| Missing translations | `key-parity.test.ts` guard; no merge if CI fails |
| design.md color rules change | All spec colors use semantic tokens for centralized replacement |
| Long focused-verb labels (e.g. "Always allow this session") overflow narrow renderer widths (<480px) | Add `max-w-[180px] truncate`; if truncation occurs, replace whole label with fallback "Confirm" |

Rollback: one PR commit; one revert restores current behavior.

---

<a id="10-交付检查done-when"></a>

## 10. Delivery Checks (Done When)

Per CLAUDE.md §8:

1. [ ] `bun run typecheck` passes
2. [ ] `bun test` passes (including `key-parity.test.ts`)
3. [ ] `apps/electron/package.json` patch incremented
4. [ ] One `simplify` skill review completed
5. [ ] All 4 banner golden paths + danger, queue, and long-preview boundaries checked in `bun run dev`
6. [ ] zh ↔ en switches show no raw keys
7. [ ] Ask user whether CLAUDE.md / README.md need synchronization (component implementation only, no documentation conventions changed; **not expected**)
8. [ ] No four-layer IPC synchronization involved
9. [ ] No SDK packaging configuration involved
