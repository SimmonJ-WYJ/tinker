<a id="adr-004leftsidebar-笔记-入口"></a>

# ADR-004: LeftSidebar Notes Entry

| Field | Content |
|------|------|
| **Status** | Accepted |
| **Hard decision deadline** | Before creating the 0.2 V6a implementation issue (global sidebar notes entry and list) |
| **Decision date** | 2026-05-18 |
| **Decision maker** | lexa (Alex) |
| **Author** | Alex |
| **Related** | [0.2 §3-2 V6a / V6b / V6c](../../ya-docs/milestones/0.2/north-star.md#section-3-2), [0.3 §3-C.2 Independent Configuration Page](../../ya-docs/milestones/0.3/north-star.md#三-c-2-独立配置页左侧-sidebar), `feedback_left_nav_adr.md` (new left-navigation entries require an ADR first) |

---

<a id="一背景"></a>

## 1. Background

<a id="触发"></a>

### Trigger

0.2 §3-2 V6a requires (English translation):

> A visible sidebar Notes entry displaying all current Notes (with search support).

This is mandatory for 0.2. The user's hard rule (memory `feedback_left_nav_adr.md`): **Write an ADR before adding entries to the LeftSidebar top menu / main-process menu / tray**. This ADR fulfills that prerequisite.

> **Terminology clarification**: The original memory says “top menu.” This ADR uses **LeftSidebar main menu area** to distinguish it from the macOS system menu bar. Both refer to the same object: the `SidebarMenuItem` group below the project switcher and above the session list in `LeftSidebar.tsx:427-460` (currently 4 entries: Search / Configuration / Library / New Task).

<a id="当前-leftsidebar-入口结构"></a>

### Current LeftSidebar Entry Structure

The retained original menu lists Search (dialog, preserving activeView), Configuration (Settings → channels tab), Library (activeView = 'library', three-column Zotero), and New Task (new agent session), in that order.

```
Main menu (order):
  Search       (Search dialog, preserve activeView)
  Configuration       (open Settings → channels tab)
  Library     (activeView = 'library', three-column Zotero)
  New Task   (open new agent session)
```

`activeViewAtom` currently has only two states: `'conversations' | 'library'`. A notes-list view requires expansion.

<a id="03-&#45;04-阶段的并行变化"></a>

### Parallel Changes in 0.3 / 0.4

| Source | Change | Impact on This ADR |
|------|------|----------------|
| 0.3 §3-C.2 | New left Configuration entry containing Skill + Capability Pack sections | Adds **another** left secondary entry; distinguish it clearly from Notes (Agent capabilities vs. research objects) |
| 0.3 §3-C.3 | Remove the Configuration tab from Settings dialog; move contents to left Configuration page | No impact on Notes (notes were never in Settings) |
| 0.4 §3-D | Redesign default page (central chat input + coordinating Agent), dissolving New Task entry | LeftSidebar main menu may shrink overall; consider whether Notes remains a main-menu entry after 0.4 |

<a id="未来全局对象列表的扩展位"></a>

### Expansion Space for Future Global Object Lists

0.2 has 5 core objects: Paper / EvidenceRef / Note / EvidenceSet / CitationRelation. Paper already lives in Library; among the other four:

- **Note**: Subject of this ADR.
- **EvidenceSet**: 0.2 §3-2 V6 requires searching associated Notes within evidence sets, implying detail access and potentially a future global Evidence Sets list.
- **CitationRelation**: 0.2 §3-1 V2/V2a/V2b already displays both directions in Paper details; may not need a standalone global view.
- **EvidenceRef**: Naturally embedded in reviews/Paper views; no separate entry required.

**Peers of the LeftSidebar Notes entry may expand later (e.g. an Evidence Sets entry)**. This ADR decides not only to add Notes but also the **namespace and expansion strategy** for this class of entry.

<a id="项目级硬约束"></a>

### Project Hard Constraints

- CLAUDE.md §2 state rules: Jotai manages state centrally; no new global state library → expand `activeViewAtom`.
- CLAUDE.md §5 IPC convention: No IPC in this ADR (notes are local-first; ADR-001 decides storage backend; this ADR decides entry placement only).
- 0.3 §3-C.0 system foundation vs. Agent ecosystem distinction: Settings dialog = shared cross-scenario resources/credentials; left Configuration page = Skills + capability packs; **neither is a research object**. Notes represent a third category (research objects, object CRUD views).

---

<a id="二决策维度"></a>

## 2. Decision Dimensions

| Dimension | Key Question |
|------|---------|
| **Mental category** | Are Notes peers of Library (research-object view) or Configuration (management panel)? |
| **Future expansion** | When global Evidence Sets and other views arrive late in 0.2 / in 0.3, add top-level entries or aggregate in a Knowledge Base container? |
| **0.4 compatibility** | How does Notes transition if the main menu shrinks after the default-page redesign? |
| **Routing / state** | Expand `activeViewAtom`, introduce routing, or add a Library sub-tab? |
| **Collapsed state** | How does the collapsed LeftSidebar icon layout accommodate Notes? |
| **Empty-state visibility** | Is the entry still prominent before any notes exist (affecting 0.3 §7 L2 activation)? |
| **Visual distinction from 0.3 Configuration page** | Can users distinguish the two left secondary entries within 30s (required by 0.2 §3-4 X1.2)? |

---

<a id="三候选方案"></a>

## 3. Alternatives

<a id="方案-a主菜单区新增独立笔记入口与文献库平级"></a>

### Option A: Independent Notes Entry in the Main Menu (Peer of Library)

The original diagram places Notes between Library and New Task, following Search and Configuration.

```
Main menu (new order):
  Search
  Configuration
  Library
  Notes ← new
  New Task
```

- Expand `activeViewAtom` to `'conversations' | 'library' | 'notes'`.
- Create `NotesView.tsx`: Three columns = left filters (Paper / kind / hypothesisStatus) + middle notes list (search + items) + right Note details or preview.
- Reuse the #4 NoteDetailDialog view layer (potentially embedded in the right column rather than a dialog).
- Collapsed state: Keep lucide `NotebookPen` in the vertical icon column.

**Advantages**:
- Clear mental model: Like Library, Notes are research objects users expect to access directly.
- Fallback for 0.2 §0 Agent-led principle (global view of all manually written notes / hypotheses).
- 0.3 §7 L2 / L3 activation requires a prominent Notes entry (users can find their first note in main navigation).
- Clear distinction from 0.3 §3-C Configuration: Configuration represents Agent capabilities; Notes represent research objects.

**Disadvantages**:
- Main menu grows from 4 to 5 entries, crowding collapsed icons.
- Adding a future global EvidenceSet view reaches 6 entries → requires another decision (expansion strategy below).
- A new `NotesView` page requires more work than embedding within Library.

<a id="方案-b嵌入-library-视图加-sub-tab-切换"></a>

### Option B: Embed in Library with Sub-Tab Switching

Keep the LeftSidebar main menu unchanged. Add sub-tabs inside Library:

The original diagram shows Library containing Papers / Notes / Hypotheses tabs.

```
Library
  └─ [Papers][Notes][Hypotheses]  ← tabs within Library
```

- No `activeViewAtom` expansion.
- Add a LibraryView top tab bar for Papers / Notes / Hypotheses.
- Notes tab renders a searchable notes list.

**Advantages**:
- Smallest scope; left navigation structure unchanged.
- No impact on the 0.4 default-page redesign (main menu unchanged).
- Natural metaphor of notes following papers (notes always attach to Paper / EvidenceSet).

**Disadvantages**:
- Mental coupling: Finding notes requires Library → Notes instead of direct Notes access, one extra layer.
- Library is currently a three-column Zotero view; sub-tabs rewrite LibraryView, so actual changes are substantial.
- 0.3 §7 L2 guidance (“Have a thought about this passage? Write it down,” English translation) → L3 (“See what is worth keeping,” English translation) needs prominent notes access; internal tabs are insufficiently visible.
- Hypotheses are notes with hypothesis kind; a Hypotheses sub-tab implies a separate object type.
- Poor fit for future global EvidenceSet expansion (adding Evidence Sets inside Library would overload it).

<a id="方案-c引入科研对象二级容器主菜单区加单一入口知识库"></a>

### Option C: Research-Object Secondary Container, Single Knowledge Base Main Entry

The original diagram adds Knowledge Base between Configuration and Library; its sidebar contains Notes, then future Evidence Sets and a hypothesis subset.

```
Main menu:
  Search
  Configuration
  Knowledge Base ← new (container entry)
  Library
  New Task

Inside Knowledge Base (sidebar on entry):
  └─ Notes
  └─ Evidence Sets (late 0.2)
  └─ Hypotheses (late 0.2 hypothesis subset)
```

- One top-level Knowledge Base entry containing multiple research-object subviews.
- Keep Library independent at the top level (its Zotero-tool identity differs from Knowledge Base object metadata).

**Advantages**:
- Main menu does not grow with each new object type.
- Future global EvidenceSet / CitationRelation views can attach directly to Knowledge Base.
- Mirrors 0.3 §3-C Configuration structure (a container for Skill / capability pack sections).

**Disadvantages**:
- Only Notes exists as a child in 0.2; a container is premature abstraction.
- Unfamiliar mental model: distinguishing Knowledge Base from Library requires education (X1.2-style validation may fail).
- Naming difficulty: Knowledge Base / Object Library / My Research are all insufficiently intuitive.
- Adds one click of depth.

<a id="方案-d不加左侧栏入口仅在-settings-数据导出-&#45;paper-详情侧栏暴露"></a>

### Option D: No Sidebar Entry; Expose Only through Settings Export + Paper Details

- Users can view all notes only by Settings → Data → exporting JSON and reading it themselves.
- Working access uses Paper / EvidenceSet details.

**Advantages**:
- Zero sidebar changes.

**Disadvantages**:
- **Directly violates mandatory V6a** (a visible sidebar Notes entry is required in 0.2).
- Rejected.

---

<a id="四已排除方案"></a>

## 4. Rejected Options

- **D**: Directly violates V6a requirements.
- **E: Add Notes to Configuration (new left entry from 0.3 §3-C)**: Configuration manages Skills / capability packs, unlike Notes object CRUD; this breaks 0.3 §3-C.0's system-foundation vs. Agent-ecosystem distinction.
- **F: Replace the sidebar entry with Command Palette (⌘K) access**: Violates V6a's literal visible-sidebar-entry requirement; Command Palette does not exist in 0.2.

---

<a id="五决策"></a>

## 5. Decision

**Adopt A**: Add independent Notes in the LeftSidebar main menu, peer of Library (order: Search / Configuration / Library / **Notes** / New Task).

Decision maker: lexa (Alex), signed 2026-05-18.

Reasons:

1. **Literal V6a requirement**: The spec explicitly says sidebar Notes entry; A fulfills it most directly.
2. **Activation requires prominence**: 0.3 §7 L2 / L3 guidance depends on finding notes in main navigation after writing them; B's sub-tabs hide them too much.
3. **Manageable object count in 0.2**: Only Notes currently needs a global view; C's container abstraction is premature.
4. **Future expansion fallback**: If Evidence Sets needs its own entry late in 0.3 and the menu reaches 6 items, consider C's container then, supported by X1.2-style user-validation evidence.
5. **0.4 compatibility**: The default-page redesign primarily affects New Task; Notes can remain a research-object sidebar entry.

<a id="扩展策略"></a>

### Expansion Strategy

**When the sidebar main menu reaches ≥ 6 entries**, evaluate container structure. Criteria:
- ≥ 3 entries in the same mental category (research objects) → upgrade (global Notes + Evidence Sets + Citation Graph views).
- ≤ 2 same-category entries → keep flat.

---

<a id="六后果"></a>

## 6. Consequences

<a id="共同后果任一方案"></a>

### Shared Consequences (Any Option)

- Expand `activeViewAtom` (A directly adds `'notes'`; B adds internal sub-tab state).
- Create `NotesView.tsx` (A) or extend `LibraryView.tsx` (B).
- Add Notes navigation text under nav / sidebar i18n namespaces, synchronized zh + en.
- Update collapsed layout (A adds NotebookPen to vertical icons; B unchanged).
- Increment `apps/electron/package.json` patch.

<a id="方案-a-额外后果"></a>

### Additional Consequences of A

- LeftSidebar main menu grows from 4 to 5 entries; visually verify collapsed icon stacking remains comfortable.
- Evaluate `NotesView.tsx` three-column layout: left filters / middle list / right details → embed existing NoteDetailDialog or rewrite as a non-dialog component.
- Cross-Paper reverse Note lookup performance (V6e: response time independent of 100+ Notes) depends on ADR-001 storage choice; UI may prototype with mocks first.

<a id="方案-b-额外后果"></a>

### Additional Consequences of B

- Rewrite LibraryView as a tabbed container; assess continued fit of three-column Zotero layout.
- Decide whether left collection tree remains when switching to Notes (Zotero collections are unrelated).
- Adjust 0.3 §7 L2/L3 guidance trigger from global Notes entry to Library → Notes tab.

<a id="风险"></a>

### Risks

| Risk | Mitigation |
|------|------|
| Five main-menu entries confuse Settings vs. Configuration page (0.3 §3-C left entry) vs. Notes | Add Notes to 0.2 §3-4 X1.2 user validation to test recognition of all three left secondary entries |
| Whether Notes remains visible when empty | UI walkthrough: show guidance + a button to select a Library paper and write a first note, rather than hiding access |
| Notes placement changes after 0.4 default-page redesign | At 0.4 start, change this ADR from Accepted to Superseded by ADR-XXX (default-page layout) |
| ADR-001 unsigned, blocking V6e performance requirements | Complete Notes UI with mocks; integrate actual V6e queries after ADR-001 implementation |

<a id="后续动作决策签字后"></a>

### Follow-Up (After Decision Signature)

1. Create `NotesView.tsx` (or LibraryView sub-tabs) + atoms in a worktree.
2. Reuse #1 / #4 / #6 note prototype components (make mocks work first).
3. Add LeftSidebar entry + collapsed icon.
4. Complete bilingual i18n keys + passing key-parity tests.
5. Extend 0.2 §3-4 X1.2 validation to test recognition of Notes entry.
6. Take the V6a issue, await ADR-001 decision → switch to real storage queries.
