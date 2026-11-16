<a id="adr-007证据集数据模型从-11笔记的证据反转为多归属主题容器mn"></a>

# ADR-007: Reverse the Evidence-Set Data Model from 1:1 (a Note's Evidence) to Topic Containers with Multiple Memberships (M:N)

| Field | Content |
|------|------|
| **Status** | Proposed (direction + three open items + M:N multiple membership all decided 2026-06-01; awaiting product/engineering Lead's Accepted signature) |
| **Decision date** | 2026-06-01 (direction) |
| **Decision maker** | (to be filled; product/engineering Lead recommended) |
| **Hard decision deadline** | Before opening the implementation issue for 0.4 P2 “Evidence-set data model refactoring” |
| **Related** | 0.4 P2 (strengthen evidence sets + notes) · [CONTEXT.md evidence-set and note domain](../../CONTEXT.md) · v0.2 evidence-list data model refactoring |

---

<a id="一背景"></a>

## I. Background

v0.2 “Evidence-list refactoring” established a **strong 1:1 Note ⟷ EvidenceSet binding** (four-step single transaction for selection-to-note: note → evidence_set(1:1) → evidence_ref → evidence_set_refs; `evidence_sets.note_id` UNIQUE + ON DELETE CASCADE). In implementation, an evidence set = “one note + the evidence it cites.”

The 0.4 P2 retrospective exposed three user pain points, **all sharing one root**:

| User pain point | Implication |
|---|---|
| Existing sets can be selected for evidence additions only in Agent conversations | Details lack a “directly add evidence” entry |
| Cannot add notes to the current evidence set, only edit the single note | **Need 1 evidence set ⟷ N notes** (conflicts with 1:1) |
| Need tags + timestamps | Missing `tag` field (`created_at` exists but is underexposed) |

Together these mean users understand an evidence set as **a container for a research topic** (N notes + N evidence items + tags), rather than “one note's evidence.”

<a id="二决策维度"></a>

## II. Decision Dimension

The evidence set's **core metaphor**: “one note's evidence” (1:1, v0.2 implementation), or “a research topic container” (1:N)?

<a id="三候选方案"></a>

## III. Options

| | Conservative increment (1:1) | Reverse to topic container (1:N, **selected direction**) |
|---|---|---|
| Data model | Retain 1:1; add only `tag` / timestamp display + add-evidence entry in details | Evidence set 1:N notes + 1:N evidence + tags + timestamps |
| Multiple notes | ❌ Still only 1 | ✅ Multiple notes per evidence set |
| User pain points | Partial solution; multiple notes unresolved | All three resolved |
| Migration cost | None | Migrate v0.2's old 1:1 data |
| Risk | Low, but limited ceiling; notes remain literature attachments | Medium; changes the core data model |

<a id="四决策"></a>

## IV. Decision

**Reverse to topic containers with multiple memberships (M:N): evidence set = research topic container (N notes + N evidence items + tags + timestamps), with each note/evidence item eligible to belong to multiple containers.**

Rationale: 1:1 was a technical constraint for v0.2's specific selection-to-note interaction, not the optimal product concept. Topic containers better match research intuition and address the three pain points' common root.

**Three open items were resolved through 0.4 P2 research-scenario requirements exploration** (see [evidence-set-research.md](../specs/evidence-set-research.md), deep-research 2026-06-01, high confidence from three-way adversarial validation):

| Open item | Conclusion | Basis |
|--------|------|------|
| (a) Are standalone notes valid? | **Yes**—standalone notes are durable first-class citizens (Zettelkasten permanent notes can exist without a source); do not copy “fleeting notes must be deleted / mandatory linking” rules; links are optional | Ahrens / zettelkasten.de |
| (b) Notes vs evidence: subordinate or parallel? | **Parallel (co-member)**—notes and evidence are peer members of topic containers, associated through citations/links, rather than evidence subordinate to notes | Review topic aggregation / Zettelkasten note→source citations |
| (c) Multi-container organization | **Flat + tags/bidirectional links**, with topics as emergent containers; **no rigid nested folders** | Luhmann bottom-up / semilattice |

**✅ Multiple membership (M:N) decided by PM (2026-06-01)**: one note/evidence item can belong to multiple topic containers (Luhmann semilattice), maintained once and reused in many places, matching the frequent research need for one paper to support multiple topics. Cost: both note⟷container and evidence⟷container need many-to-many associations, complicating membership UI. **Implementation recommendation**: implement M:N join tables immediately to avoid later migration; release multiple-membership UI incrementally.

<a id="五反转-&#45;影响"></a>

## V. Reversal / Impact

Reverses the strong 1:1 binding established by v0.2 “Evidence-list refactoring.” The `CONTEXT.md` evidence-set/note domain records this drift as **flagged ambiguity**, to resolve against the final model after this ADR is signed Accepted.

<a id="六后果"></a>

## VI. Consequences

- **Data model**: `evidence_sets.note_id` 1:1 → **M:N join tables** for both evidence set ⟷ note and evidence set ⟷ evidence (members may belong to multiple containers); add `tag`; expose timestamps in the frontend.
- **Migration**: smoothly migrate v0.2 users' 1:1 data to 1:N (each old evidence set becomes a container with 1 note).
- **Four-layer synchronization**: refactor repository / service / IPC (including `notes:*`, `evidenceSets:*` channels) / renderer throughout; this can also close the `createNote 未实现(T16)` gap (“createNote unimplemented,” T16) through notes in details / standalone notes.
- **Prerequisite**: finish P2 research-scenario requirements exploration first to avoid refactoring the wrong model.
