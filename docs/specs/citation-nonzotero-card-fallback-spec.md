<a id="引用来源点击非-zotero-论文兜底打开摘要卡片"></a>

# Citation/source clicks: open an abstract card as fallback for non-Zotero papers

> Status: Implementation in progress
> Related issue: (to be added)
> Related PR: (to be added)
> Domain-language source of truth: `CONTEXT.md`
> Related specs: [`doi-paper-jump-spec.md`](./doi-paper-jump-spec.md), [`conversation-trace-claim-spec.md`](./conversation-trace-claim-spec.md)

<a id="背景与问题"></a>

## Background and problem

Clicking “View original / Jump to source” on citations `[N]` (including `<quote>`) in review / Q&A output or evidence entries in evidence sets produces two poor experiences for papers **outside the Zotero library**:

- **Conversation `[N]` badge**: When a local PDF cannot be resolved (`no-zotero-key` / `paper-not-found` / `no-pdf`), only a toast appears and the view scrolls back to §7 References; users see no paper content.
- **Evidence-set “Jump to source” button**: Visibility checks only `sourcePaper.state === 'present'`, but the click handler `handleSelectPaperRef` requires a nonempty `zoteroKey`, otherwise it executes `return`. The enabled button **does nothing when clicked** (silent no-op), which is more confusing than a toast.

Root cause: Opening the original PDF and highlighting a quote strongly depends on local Zotero attachments. Non-Zotero papers (mostly fetched from OpenAlex, with metadata + abstract only) have no available PDF.

<a id="目标"></a>

## Goal

For non-Zotero paper citation / source clicks, consistently **open an abstract card as fallback** (OpenAlex/crossref metadata: title, abstract, authors, DOI, `Add to Zotero`, Citation graph), replacing silent no-ops or toast-only feedback. **Show no toast** (consistent with §7 DOI chips; opening the card itself provides feedback). Do not change Zotero synchronization; changes are concentrated in the renderer.

Behavior for papers **in Zotero with a local PDF remains unchanged** (open PDF + highlight quote).

<a id="行为契约"></a>

## Behavior contract

| Entry point | In Zotero (with PDF) | Outside Zotero / no PDF |
|------|---------------------|----------------------|
| Conversation `[N]` badge | Open PDF in right panel + highlight quote (unchanged) | Open abstract card in right panel (`useOpenDoiInRightPanel(doi)` three-level fallback, never a dead end); scroll back to §7 only if doi is absent |
| Evidence-set “Jump to source” | Fullscreen PDF overlay + highlight quote (unchanged) | Fullscreen abstract-card overlay (`PaperDetailRenderer`, mapping local `Paper` fields to `PaperRecord`, no network) |
| §7 DOI chip | Abstract card / PDF (unchanged) | Abstract card (unchanged) |

<a id="实现"></a>

## Implementation

<a id="-对话流-n-badge-&#45;componentsai-elementsmessagetsx"></a>

### ① Conversation `[N]` badge — `components/ai-elements/message.tsx`

`handleCitationTrace`: Keep trying the Zotero PDF first. When `openEvidence(...)` returns `!ok`, replace `toast + jumpToReferenceN` with `void openDoi(doi)` (`useOpenDoiInRightPanel`) to open an abstract card as fallback. If `doi` is missing, retain `jumpToReferenceN` (preserving scroll-to-§7 semantics). The `.catch` safety net uses `jumpToReferenceN`.

<a id="-证据集jump-to-source-componentslibrarynotesviewtsx"></a>

### ② Evidence-set “Jump to source” — `components/library/NotesView.tsx`

- `handleSelectPaperRef`: Remove `if (!zoteroKey) return`. With `zoteroKey` → existing `NotesViewPdfOverlay`; without `zoteroKey` → set new `paperCardTarget` (map `sourcePaper.ref: Paper` to `PaperRecord`).
- Add `NotesViewPaperOverlay`: Reuse the fullscreen Dialog form of `FilePreviewOverlay`, rendering `PaperDetailRenderer` inside. Evidence Sets is an independent view without an agent session; `openInRightPanel` is a no-op here, so an in-view overlay is required (as with “Jump to review”).
- `Paper → PaperRecord` mapping: Take `title/authors/year/venue/doi/abstract` directly; `ts=nowIso()`, `query=null`, `source='evidence-set'`, `url=null`.

### ③ i18n —— `locales/{en,zh}/conversation/panels.json`

Remove defunct `citation.trace.{noPdf,paperNotFound,noZoteroKey,failed}` (referenced only by message.tsx, all obsolete after this change). Remove in en + zh together, guarded by `key-parity`.

<a id="非目标"></a>

## Non-goals

- Do not add a one-click Add to Zotero → wait for sync → automatically open PDF flow (a larger change for separate discussion).
- Do not change Zotero synchronization or the main-process resolution cascade.

<a id="验证"></a>

## Validation

- `bun run typecheck` / `bun test` (including `key-parity`).
- Manual: Click a non-Zotero citation `[N]` in Q&A output → abstract card in right panel; click a Zotero citation → PDF + highlight (regression). In evidence sets, click “Jump to source” for non-Zotero evidence → abstract-card overlay; Zotero evidence → PDF overlay (regression). Run once in each zh↔en language with no raw keys.
