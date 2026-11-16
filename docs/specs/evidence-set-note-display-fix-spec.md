<a id="证据集-note-展示修复-specissue-446"></a>

# Evidence Set Note Display Fix Spec (issue #446)

> **Status**: Implemented · Awaiting PR review
> **Related issue**: #446 ([ops-feedback] adding a note under a library paper: evidence set list titles/subtitles and detail citations differ from expectations)
> **Related PR**: Not yet opened
> **Domain language source of truth**: `CONTEXT.md` (evidence set / Note / EvidenceRef / Anchor)

---

<a id="1-问题复核issue-三个症状-&#45;当前-main-现状"></a>

## 1. Problem Review (Three Issue Symptoms ↔ Current Main)

The issue screenshots came from an older packaged build (details still used a `NOTE` area + quote blocks; current main has evolved to
`PairedCardsList` paired cards). Item-by-item review on current main (`2647134f`):

| # | Issue symptom | Current main | Conclusion |
|---|-----------|---------------|------|
| 1 | Evidence set list primary title does not show user input (shows the paper title) | `NotesView.tsx` `NoteListItem` already uses `setName → note.content → 占位` (placeholder) (delivered in #556) | **Fixed**, regression verification only this round |
| 2 | List subtitle does not show the associated paper | Secondary row = first note.body paragraph; hidden entirely when it duplicates the primary title → no paper information in the list row (`sourceTitle` exists but is unused) | **Needs fix** |
| 3 | Note detail shows redundant quoted content | When no text is selected, the write path **fabricates** `sourceAnchor.snapshotText` from the first 200 body characters; since B3, `quote` is anchor.snapshotText → quote ≡ body prefix. `NoteDetailDialog` / `PaperNotesPanel.NoteCard` duplicate body text as a quote block; the fake quote is also used as a PDF navigation anchor (necessarily failing to locate it). **Existing data is polluted** | **Needs fix (root cause)** |

Fabrication sites (write paths):

- [usePaperNotes.ts:106-109](apps/electron/src/renderer/hooks/usePaperNotes.ts:106) —
  `snapshotText: (draft.quote ?? draft.content).slice(0, 200)`
- [NotesView.tsx:449-452](apps/electron/src/renderer/components/library/NotesView.tsx:449) —
  `snapshotText: (pending.quote || content).slice(0, 200)`

> Note: The current UI's direct-add-without-selection entry has been replaced by the Add Evidence Set dialog (the `createWithPaper`
> path has an empty anchor and is clean); ItemDetailPanel's inline blank-note branch (rect=null) no longer has a trigger.
> Fallback code remains, however, and old-version data remains in users' libraries; symptom #3 still affects existing data.

<a id="2-行为期望bdd"></a>

## 2. Expected Behavior (BDD)

1. **Create annotation from selected text** (abstract / PDF selection):
   - Evidence set list: primary title = note body (truncated); subtitle = source paper title.
   - Note details (NoteDetailDialog): quote block = selected original text (preserve behavior).
   - PDF navigation anchor = selected original text.
2. **Add Evidence Set → Create** (name + additional description):
   - List: primary title = set name; subtitle = source paper title.
   - Details: no quote block (anchor is already empty; preserve).
3. **Existing direct-add data** (quote polluted by body prefix):
   - Details / paper-page note cards no longer show quote blocks duplicating the body.
   - Fake quotes are no longer PDF location anchors.
4. Conversation-sourced evidence sets: list subtitle = “conversation name · first 20 question characters” (reuse existing `conversationSourceTitle`).

<a id="3-修复方案"></a>

## 3. Fix Approach

<a id="31-fix-副标题列表副行改为来源标题renderer"></a>

### 3.1 Fix Subtitles: Use Source Titles for List Secondary Rows (Renderer)

`NotesView.tsx` `NoteListItem`:

- Remove derivation from the first note.body paragraph; pass `note.sourceTitle` as secondary-row `preview`
  (paper → paper title; review → review title; conversation/none → existing `sourceTitle` fallback).
- Preserve primary-title logic (`setName → content → 占位`, ending with a placeholder).
- Deduplication guard: omit secondary rows when `sourceTitle === primaryTitle` (avoid duplicate lines when a set name equals its paper title).

Leave `PaperContainingEvidenceSetsPanel` unchanged (Referenced In is within paper details, so the paper context is clear;
continuing to show note summaries is more informative). Leave the `EvidenceSetCard` API unchanged (`preview` already means secondary row).

<a id="32-fix-引用伪造写入路径renderer"></a>

### 3.2 Fix Fabricated Quotes (Write Paths, Renderer)

Leave anchors empty without selected text; stop falling back to the body:

- `usePaperNotes.ts` createNote: `snapshotText: (draft.quote ?? '').slice(0, 200)`
- `NotesView.tsx` NotesViewPdfOverlay handleSave: `snapshotText: pending.quote.slice(0, 200)`
  (this flow always has a selection; explicitly remove the `|| content` fallback).
- Search all `snapshotText:` construction sites repository-wide, confirming no body fallbacks remain
  (`addPaperToEvidenceSet` / `createEvidenceSetWithPaper` already use empty strings, as expected).

Semantic basis: An anchor represents where text was selected in the original; note bodies are user-authored and cannot serve as location anchors.
`addPaperToEvidenceSet` already establishes the precedent “no selection → empty snapshotText.”

<a id="33-fix-存量数据治理查询层归一化main-进程"></a>

### 3.3 Fix Existing Data (Query-Layer Normalization, Main Process)

Avoid a DB migration; centralize fake-quote detection at query outputs:

Add a private helper in `query-service.ts`. Its retained Chinese comment explains that old versions generated anchor.snapshotText from the first 200 body characters without selection; matching body prefixes are treated as fabricated. Real paper quotes rarely match user-written prefixes, and hiding duplicates is acceptable even when they do.

```ts
/** 伪引文判定：旧版本无划词时用正文前 200 字兜底生成 anchor.snapshotText；
 *  正文以 quote 开头 → 视为伪造，按"无引文"返回。真实划词引文来自论文原文，
 *  与用户正文前缀重合的概率可忽略；即便重合，隐藏重复引用块也符合预期。 */
function sanitizeQuote(snapshot: string, noteBody: string): string {
  const q = snapshot.trim()
  if (q.length === 0) return ''
  return noteBody.trim().startsWith(q) ? '' : snapshot
}
```

Integrate at two outputs (both have the same row's note body):

- `queryNotesByPaper` ([query-service.ts:133](apps/electron/src/main/lib/objects/query-service.ts:133))
- `queryAllNotesWithPaper` ([query-service.ts:356](apps/electron/src/main/lib/objects/query-service.ts:356))

Benefits: Repairs all consumers together, including `NoteDetailDialog`, `PaperNotesPanel.NoteCard`, NotesView search, and PDF navigation anchors.
Read-side normalization only; reversible at any time with no data risk.

**Implementation addendum (expanded after review beyond the two outputs above)**:
- Apply `sanitizeQuote` only to **paper anchors** (gated by source kind): fallback fabrication occurred only in
  paper md anchor write paths. Conversation Q/A snapshots legitimately share their source with note bodies and are not treated as fake.
- Third leaking output `queryEvidenceSetDetail`: add derived read-only `quote` to `EvidenceRefWithSource` (`@asci/shared`)
  (the query-normalized value); **leave raw `ref.source.anchor` unchanged**
  (promote / export / `anchorContentHash` idempotency keys depend on the original). Consumers switch to `quote`:
  - `NotesView.onSelectPaperRef` (PairedCard → PDF positioning)
  - `evidence-set-context-block.ts` (`<excerpts>` agent injection, which would otherwise feed user-authored bodies
    to the Agent as original paper text).

**Alternative (not recommended)**: One-time migration cleaning `evidence_refs.source_anchor`.
This cures stored data but requires a migration with identical detection logic and greater risk; query normalization covers all visible symptoms.

<a id="34-不做的事"></a>

### 3.4 Out of Scope

- No note title field (the issue's “title” means the first body line; primary title = body already satisfies it).
- No changes to `EvidenceSetDetailSheet` / `PairedCardsList` (no quote blocks remain there; no symptom).
- No IPC contract changes (no channel/type changes, so four-way synchronization is not triggered).

<a id="4-测试与验收"></a>

## 4. Tests and Acceptance

- **Unit tests** (main process, `bun test`):
  - `sanitizeQuote`: empty string / real quote / fake body-prefix quote / prefix with whitespace differences.
  - `queryNotesByPaper` / `queryAllNotesWithPaper`: insert a fake-quote row → empty returned quote; real selection row → unchanged return.
- **Manual golden path** (`bun run dev`): Walk all 4 expected behaviors in §2;
  switch zh ↔ en to confirm no raw keys in subtitles (**zero new i18n keys** expected: source titles display directly).
- `bun run typecheck` passes.

<a id="5-影响面与版本"></a>

## 5. Impact and Version

- Changed package: `apps/electron` (2 renderer files + 1 main file) → patch +1 when opening the PR.
- No `packages/*` changes; no dependencies; no IPC / schema changes.

<a id="6-待确认open-questions"></a>

## 6. Open Questions

1. Standardize list secondary rows as source titles (including named sets): this replaces named sets' current first-paragraph additional description. Acceptable? (Recommendation: yes; list semantics become “what the set is + where it came from.”)
2. Normalize existing data at the query layer (recommended) or use a DB migration?
