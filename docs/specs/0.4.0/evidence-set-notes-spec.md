<a id="证据集笔记基础体验-specevidence-set-as-topic-container"></a>

# Evidence Set / Notes Basic Experience Spec (Evidence Set as Topic Container)

> **Status**: draft · design finalized (2026-06-25 grill converged Q1–Q8; see §3 decision table / §5) · awaiting review
> **Related milestone**: [`docs/milestones/0.4/north-star.md`](../../milestones/0.4/north-star.md) §2 (P2 evidence-set/notes basics, EN1–EN5)
> **Related PRD**: [`docs/specs/0.4.0/0.4.0-prd.md`](./0.4.0-prd.md) Epic 2
> **Related issue**: [#709](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/709) (prerequisite for retaining Epic1 [#708](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/708) outputs)
> **Domain language source of truth**: `CONTEXT.md` Evidence Sets and Notes domain + §2 here
> **Related ADR**: [`ADR-007`](../../adr/ADR-007-evidence-set-topic-container.md) (1:1 → M:N evidence-set topic containers, **core prerequisite**)
> **Related specs**: [`at-mention-evidence-set-spec.md`](../at-mention-evidence-set-spec.md) (@ reference stack, reused evidence picker) · [`research-gap-spec.md`](./research-gap-spec.md) §5.6 (Epic1 output retention, EN5)
> **Interaction prototype**: [`assets/evidence-set-notes-prototype.html`](./assets/evidence-set-notes-prototype.html) (actual ASCI tokens; view A evidence-set page supports golden path, view B Sheet drawer)
>
> 📌 This spec governs Epic2 design + implementation plan; north-star EN1–EN5 govern goals/acceptance; ADR-007 governs data-model direction.

---

<a id="1-概述与定位"></a>

## 1. Overview and Positioning

**Evidence-set/notes basics**: reverse v0.2's "1 set = 1 note" into a **research-topic container**, containing **multiple notes + multiple evidence items as peers**. Details support adding/managing each anytime and retaining Epic1 research-gap outputs.

Three positioning points:

1. **Existing improvement, low-risk increment** — reuse `notes:*` / `evidenceSets:*` channels and evidence-set service; no new view framework, details remain a Sheet with internal reorganization.
2. **Aligned mental model** — evidence set = container of materials around a topic; notes = annotations inside, peer members alongside evidence. Notes are no longer literature appendages, highlight-only, or limited to one.
3. **Complete data model now, phased UI** — directly implement **M:N joins** per ADR-007 to avoid later migration; **multi-container membership UI is excluded this release**. Minimum: add anytime, allow multiple items.

---

<a id="2-领域语言"></a>

## 2. Domain Language

No new terminology; retain CONTEXT.md Evidence Sets and Notes domain and align existing terms with containers:

| Term | Definition | Source |
|------|------|------|
| Evidence set (topic container) | User's container for materials around a topic; N notes + N evidence items + tags | CONTEXT.md / ADR-007 |
| Note | **User annotation** inside a container, **peer member** to evidence; freely created without highlights, multiple allowed | CONTEXT.md |
| EvidenceRef | **Traceable reference** to a source object (paper passage / review sentence / conversation message), including anchor + quoted `snapshotText` | CONTEXT.md |
| Co-member | Equal membership of notes and evidence; each can be added/removed independently | ADR-007 |
| Tag | Container-level label for library filtering; multiple tags per container | ADR-007 §6 |

> Retain Epic1: outputs become **comparison table → 1 structured note**, **each selected gap/conflict → 1 traceable evidence item**.

---

<a id="3-决策总表讨论结论一览"></a>

## 3. Decision Table (Discussion Conclusions)

| Layer | Decision | Conclusion |
|----|--------|------|
| Surface | Details | **Retain singleton Sheet, reorganize internally** (low risk); `NotesView` right details and Sheet **share** a member-layout component |
| Layout | Peer notes/evidence | **Two stacked sections**: Notes + Evidence, each with count + separate "+ Add" action (Epic1 outputs go into corresponding sections) |
| Data | Model reversal | **Notes↔sets**: 1:1 `note_id` → new `evidence_set_notes` M:N join; **evidence↔sets** already `evidence_set_refs` M:N, unchanged |
| Interaction | Add note | Inline **free note** in details (type directly, no highlight dependency; fill `createNote` gap) |
| Interaction | Add evidence | **Library-object picker** (papers/reviews/conversations), **preserving traceability**; **object-level references** (representative-source snapshotText fallback, §5.4); precise passage anchors retain highlighting |
| Interaction | Deletion | **Evidence = remove from this set** (unlink, keep source in library, soft-delete orphan ref); **note = delete** (soft-delete `visibility='deleted'`, recoverable) |
| Scope | Tags | **Complete**: container tag chips (display/add/remove) + library filtering (**multiselect + OR**); expose created_at timestamps |
| Scope | Multi-membership UI | **Excluded this release** (M:N data ready, UI later) |
| Boundary | Release scope | `#709` (topic-container backbone) + **absorb `#539`** (save correct content into evidence sets); `#461` separate, `#718`/`#446`/`#493` separate |
| Data | `#539` fix | **No new extraction** (`attachPaperRefsForMessage` already extracts `{paper,snippet,anchor}`); **remove "saved from conversation" placeholder note** (container starts with 0 notes), list extracted evidence in Evidence |
| Interaction | Conversation evidence | Keep Q&A as `conversation` evidence co-members; add **show conversation evidence toggle** in Evidence (set-level preference; data remains stored) |
| Interaction | Highlight-created notes | **Mechanical port, equivalent behavior**: each highlight creates note + single-member container (`note_id`→`evidence_set_notes`, `persisted=0`); container proliferation deferred to 0.5 |
| Data | Container persistence | NotesView lists only `persisted=1`; temporary highlight/Agent sets remain `persisted=0`; **explicit topic containers start at `persisted=1`**, saved upon creation without another save step |

---

<a id="4-用户流程对应原型"></a>

## 4. User Flows (Prototype)

```
View A · Evidence-set page (NotesView, main surface)
  Left: containers (name/tag/note·evidence counts/time) + top tag filter
  Right: details = stacked peer Notes / Evidence sections
     ＋Add note → inline textarea creates free note (EN1/EN2)
     ＋Add evidence → library picker (paper/review/conversation) → retain provenance (EN1/EN3)
     Note 🗑=delete, recoverable / Evidence ⊘=remove from set, source remains in library (EN4)
     Evidence "Go to original/review/conversation↗" → provenance
     Epic1 retention: structured comparison note (Notes) + selected gaps (Evidence), "From research gaps" badge (EN5)
     Bottom "Find research gaps" entry (Epic1 integration)

View B · Sheet drawer (open paper's evidence-set membership badge)
  Drawer uses the same Notes / Evidence layout as view A right details (shared component)
```

---

<a id="5-详细设计"></a>

## 5. Detailed Design

<a id="51-数据模型反转核心-&#45;adr-007-落地"></a>

### 5.1 Data Model Reversal (Core · ADR-007 Implementation)

**Key fact**: `evidence_set_refs` is already an M:N join (`set_id, ref_id, position`), allowing multiple evidence items; **only the note side needs reversal** (`evidence_sets.note_id` 1:1 UNIQUE + ON DELETE CASCADE).

| Change | Current (001-initial.sql) | Target |
|---|---|---|
| Notes↔sets | `evidence_sets.note_id TEXT UNIQUE REFERENCES notes(id) ON DELETE CASCADE` | New `evidence_set_notes(set_id, note_id, position)`, PK`(set_id,position)` + `idx(note_id)`, mirroring `evidence_set_refs`, M:N |
| Cascade | Delete note → CASCADE delete set | Remove; note deletion only removes join row + soft-deletes note |
| CHECK | `source ↔ note_id` coupling (user-highlight requires nonempty note, etc.) | Remove constraint (note_id leaves primary table); retain `persisted ↔ name/saved_at` |
| Evidence↔sets | `evidence_set_refs` (M:N) | Unchanged |
| Tags | None | New `evidence_set_tags(set_id, tag)`, PK`(set_id,tag)` + `idx(tag)` (multiple tags per set) |
| Timestamps | `created_at` exists but hidden | Expose in container header + member cards |

**Migration `003-evidence-set-topic-container.sql`** (SQLite table rebuild): new `evidence_sets` without `note_id`/source↔note_id CHECK → copy data → create `evidence_set_notes`, backfill each old set's `note_id` as join at `position=0` (no backfill for `agent-assembled` without note) → create `evidence_set_tags` → drop old/rename. **Each old evidence set becomes a one-note container** (ADR-007 §6 migration requirement).

Retain `EvidenceSetSource`'s `source` column for creation provenance; remove only its CHECK coupling to `note_id`.

<a id="52-详情版面sheet-内部重排-&#45;notesview-容器化-&#45;共享组件"></a>

### 5.2 Details Layout (Reorganized Sheet + Container-Based NotesView · Shared Component)

- New **`EvidenceSetMembers`** replaces retired `PairedCardsList`: Notes above + Evidence below, each with count, "+ Add," and member cards. **Shared by `EvidenceSetDetailSheet` drawer and `NotesView` right details** to avoid duplicate rendering.
- **Extend container `SetHeader`**: name (inline rename ✎) + tag chips (including "+ Tag") + created/updated timestamps.
- **`NotesView` left list: note-centric → container-centric**: "1 note = 1 row" becomes **1 container = 1 row**, showing name · tags · note/evidence counts · time. Multiple notes per set necessarily invalidate 1:1 lists.
- Shadow cards without outlines (thin borders in dark mode), neutral gray; only semantic color: "From research gaps" items use warning amber left strip + badge linking provenance.

<a id="53-补笔记自由笔记"></a>

### 5.3 Add Notes (Free Notes)

- Notes "+ Add note" expands an inline textarea; type and save a **free note** independent of highlights or a particular evidence item.
- Fill existing direct `createNote` gap (ADR-007 §6); new `evidenceSets:addNote` channel creates note + `evidence_set_notes` join transactionally.
- Existing highlight paths (`createNoteFromPaperHighlight` / `createNoteFromReviewHighlight`) receive a **mechanical, behavior-equivalent port**: after removing `note_id`, replace "pass `noteId` when creating set" with "create set + `evidence_set_notes` join at position=0." Highlighting still creates note + **single-member container** (`persisted=0`) + paper/review ref. This is equivalent behavior, not zero change: removing `note_id` **requires rewriting** (earlier "unchanged" wording was wrong, corrected after 2026-06-25 grill). One-container-per-highlight proliferation waits for 0.5 (add highlights to existing containers).

<a id="54-补证据引用库对象-&#45;溯源"></a>

### 5.4 Add Evidence (Library References + Traceability)

- Evidence "+ Add evidence" opens **library-object picker** (reuse `AddToEvidenceSetDialog` / @-mention style, with paper/review/conversation segments) → select item → create `evidence_ref` (`source_kind` already supports paper/review/conversation) + `evidence_set_refs` join → new `evidenceSets:addEvidence`.
- **Traceability (EN3 / Story5)**: evidence cards retain anchors; "Go to original/review/conversation ↗" reuses existing navigation (`Anchor` two-layer location + `snapshotText`).
- **Precise passage anchors** retain highlighting (details add object-level references; users highlight originals to add precise passages).
- **Object-level snapshotText (hard Anchor contract)**: `Anchor.snapshotText` is always required (the anchor's core; see `packages/shared/src/types/anchor.ts`); only `locationData` is optional acceleration. Without a specific passage, **fall back to representative source text**: paper title (or first abstract paragraph), review chapter title, conversation Q&A snapshot (already a passage). Leave `locationData` empty; navigation opens source top. Replace prototype `addEvidence()` placeholder `"…relevant passage…"` with that fallback. Dedup key `source.id|snapshotText` remains valid (same object-level reference → same dedup key).

<a id="55-删除语义区分措辞-&#45;en4"></a>

### 5.5 Deletion Semantics (Distinct Wording · EN4)

| Member | Button | Behavior |
|---|---|---|
| Evidence | "Remove from this set" | Delete `evidence_set_refs` join; **keep source paper/review in library** (evidence is a reference); soft-delete orphan ref (`visibility='deleted'`). **Without multi-membership UI, every ref has one owner, so removal always orphans and soft-deletes**; checking other memberships is forward logic for 0.5 |
| Note | "Delete note" | Soft-delete note (`visibility='deleted'`, recoverable) + delete join |

Both operate at join-row level, naturally satisfying EN4: removing one member leaves others intact.

<a id="56-tag容器级-&#45;库筛选"></a>

### 5.6 Tags (Container-Level + Library Filters)

- Container header: tag chips + "+ Tag"; add/remove via new `evidenceSets:setTags` (writes `evidence_set_tags`).
- `NotesView` top-left tag filter: **multiselect chips with OR**—show containers matching any selected tag. (Prototype `filterTag()` is a single-select placeholder; implementation uses multi + OR.)
- Container-based `listSummary` / `notes.listAll` returns `tags: string[]` and supports optional `tagFilter`.

<a id="57-epic1-沉淀契约en5-&#45;gm6-&#45;与-research-gap-spec-56-对齐"></a>

### 5.7 Epic1 Output Contract (EN5 / GM6 · Aligned with research-gap-spec §5.6)

- Entire comparison table → **1 structured note** (table in body, **Notes section**) → `evidenceSets:addNote`.
- Each selected gap/conflict → **1 traceable evidence item** (**Evidence section**) → `evidenceSets:addEvidence`; Epic1 defines gap anchors.
- This spec ensures members save/read back completely and in order (EN5/GM6), without defining table/gap internals.

---

<a id="6-复用点与扩展点摸排结论带文件路径"></a>

## 6. Reuse and Extensions (Inspection Results with Paths)

**Reuse (Ready to Use)**
| Object | File |
|------|------|
| Evidence↔set M:N joins | `evidence_set_refs` (`001-initial.sql`, already M:N) |
| Evidence-set aggregate query | `apps/electron/src/main/lib/objects/query-service.ts` (`queryEvidenceSetDetail`) |
| Evidence-picker pattern | `apps/electron/src/renderer/components/library/dialogs/AddToEvidenceSetDialog.tsx` · @-mention stack `at-mention-*` |
| Provenance anchors | `packages/shared/src/types/anchor.ts` · `types/objects/evidence-ref.ts` |
| Highlight-created notes | `apps/electron/src/main/lib/notes-service.ts` (`createNoteFrom*Highlight`, retained) |

**Modify**
| Object | File | Change |
|------|------|------|
| Schema | `apps/electron/src/main/lib/objects/migrations/` (new `003-*.sql`) | §5.1 |
| Evidence-set repositories | `objects/repositories/evidence-set-repository.ts` · `note-repository.ts` | Joins, tags, remove 1:1 assumptions |
| Detail aggregation | `objects/query-service.ts` | `EvidenceSetDetail.note` → `notes: Note[]` + `tags: string[]` (multiple-note aggregation) |
| Services | `evidence-set-service.ts` · `notes-service.ts` | `addNote / removeNote / addEvidence / removeEvidence / setTags` |
| Types | `packages/shared/src/types/objects/evidence-set.ts` · `types/evidence-sets.ts` · `types/notes.ts` | Multiple-note `EvidenceSetDetail` + tags; new channel constants |
| Detail container | `renderer/components/library/EvidenceSetDetailSheet.tsx` · `evidence-set-detail/SetHeader.tsx` | Adopt `EvidenceSetMembers` + tags + rename |
| Evidence-set page | `renderer/components/library/NotesView.tsx` | Container list + tag filtering |

**Add**
- `renderer/components/library/evidence-set-detail/EvidenceSetMembers.tsx` (peer Notes/Evidence sections shared by Sheet and NotesView).

**Retire**
- `evidence-set-detail/PairedCardsList.tsx` (paired/merged note-paper cards no longer match peer co-members).

---

<a id="7-ipc-四联同步-&#45;迁移"></a>

## 7. Four-Layer IPC Synchronization + Migration

New/modified channels (shared constants+types → main `ipc.ts` → preload → renderer):

| Channel | Purpose |
|---|---|
| `evidenceSets:addNote` | Create free note in container (note + join, transactional) |
| `evidenceSets:removeNote` | Soft-delete note + delete join |
| `evidenceSets:addEvidence` | Reference library object, creating ref + join |
| `evidenceSets:removeEvidence` | Delete join (retain source in library) |
| `evidenceSets:setTags` | Add/remove container tags |
| `evidenceSets:getDetail` (modify) | Return `notes: Note[]` + `tags: string[]` |
| `evidenceSets:listSummary` / `notes:listAll` (modify) | Return `tags`, support `tagFilter` |

**Migration**: `003-evidence-set-topic-container.sql` rebuild + old 1:1 backfill (§5.1); dev uses `~/.asci-dev`; verify readback once each in dev/prod.

---

<a id="8-验收映射北极星-en1en5"></a>

## 8. Acceptance (North-Star EN1–EN5)

| Audit | Acceptance |
|------|------|
| EN1 | Add evidence and note directly in details once each (without Agent conversation) |
| EN2 | Add 2+ notes to one set and read all back |
| EN3 | Notes/evidence are peers, independently manageable; any evidence navigates successfully to paper passage/review sentence/conversation message |
| EN4 | Delete one note/evidence item while retaining all other members intact |
| EN5 | Epic1 outputs (structured comparison-table note + selected gap evidence) persist/read back fully in order (same as GM6) |

---

## 9. Out of Scope

- Multi-membership UI (one note/evidence in multiple containers) → later; M:N data is prepared.
- Bidirectional links / knowledge graphs, collaboration/sharing, dedicated evidence-set export format → excluded (PRD Epic2 Out of Scope).
- Direct precise-passage evidence creation → retain highlighting; details create object-level references.
- Rich-text notes / attachments → excluded; free notes remain plain text using existing note body.
- `#461` (session Add Papers panel does not sync Zotero deletions) → **separate issue**: evidence sets are protected by the policy that Zotero paper deletion does not delete `papers` rows (`zotero-paper-sync.ts`, no dangling refs); actual work is Zotero sync + session-paper panel refresh, orthogonal to containers (2026-06-25 grill).
- Container proliferation (one single-member container per highlight) → not solved now; add highlights to existing containers / truly uncontained notes → 0.5.
- List "Search evidence sets" field (prototype `es-search`) → placeholder only this release; revisit at larger container scale.
- "Find research gaps" belongs to Epic1 [#708](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/708): retain entry only, no analysis workflow here.

---

<a id="10-依赖与实施顺序"></a>

## 10. Dependencies and Implementation Order

```
Prerequisite: ADR-007 Accepted (data-model direction)

tracer bullet：
  1. schema 003 migration (joins + tags + old-data backfill) + repository reads/writes
  2. query-service: getDetail multiple-note + tag aggregation
  3. Services + four-layer IPC: addNote/removeNote/addEvidence/removeEvidence/setTags
  4. Renderer: shared EvidenceSetMembers → SetHeader(tag/rename) → Sheet → container NotesView + tag filter → retire PairedCardsList
  5. en+zh i18n (add/delete/remove/tag copy); typecheck + bun test + dev golden paths A/B; simplify review
```

Dependency: **Epic1 retention (GM6) ⬅ this Epic's addNote/addEvidence**; multi-membership UI does not block this release.

---

<a id="11-风险"></a>

## 11. Risks

| Risk | Mitigation |
|---|---|
| Core-model migration damages old data | Standard SQLite rebuild + readback validation once each dev/prod; add migration `bun test` cases |
| Broad impact from `NotesView` note-centric→container-centric | Extract shared `EvidenceSetMembers` first, decouple list/details, retain `notes:*` semantics |
| Confused deletion removes library paper | Strict wording (Remove from this set vs Delete note); second confirmation only for note deletion |
| Limited tag value with single membership | Container tags + library filters now; cross-container tag organization arrives with multi-membership UI (0.5) |
