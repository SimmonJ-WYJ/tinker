<a id="milestones-目录公约"></a>

# Milestones Directory Convention

> This convention governs directory structure and filenames in `docs/milestones/` and `ya-docs/milestones/`, ensuring that "discussion → finalization → team sharing" requires no path rewrites.

---

<a id="1-目录结构"></a>

## 1. Directory Structure

```
docs/milestones/                 # Team-shared, tracked in git
  README.md                      # ← This file: directory convention
  0.1/
    north-star.md
  0.2/
    north-star.md                # ← Sole main entry for this version
    moat-analysis.md             # Attachment: moat analysis (Tiger Nick)
    milestone-review.md          # Attachment: version review (Tiger Nick)
  0.3/
    north-star.md

ya-docs/milestones/              # Local discussion, ignored by .gitignore
  0.1/                           # Exactly mirrors docs/milestones/
  0.2/
  0.3/
```

English guide to the preserved tree comments: docs/milestones is team-shared and tracked in git; README is this directory convention; each north-star is that version's sole main entry; moat-analysis and milestone-review are attachments by Tiger Nick. ya-docs/milestones is the local gitignored discussion area, exactly mirroring the docs structure.

**Two hard rules**:

1. **Each version directory has exactly one `north-star.md`**: The version summary/main entry. All north-star goal changes converge in this file.
2. **All other `.md` files are attachments**, flat alongside `north-star.md`, without further subdirectories. Reference them from `north-star.md` using relative links `./xxx.md` as needed.

Common attachment names (choose as needed; not all required):

| Filename | Purpose |
|--------|------|
| `north-star.md` | **Sole main entry**, final goals and audit criteria for this version |
| `moat-analysis.md` | Moat / strategic positioning analysis (Eagle Nick / Tiger Nick) |
| `milestone-review.md` | Version review / SWOT / CLEAR (Tiger Nick) |
| `{topic}-research.md` | Topic research (Eagle Nick) |
| `{topic}-spec.md` | Design specification (Fox Nick) |
| `feedback-{date}.md` | Feedback consolidation (Cat Nick) |

Attachment names **have no version prefix**: They already reside in a version directory.

---

<a id="2-引用约定"></a>

## 2. Reference Conventions

| Scenario | Syntax |
|------|------|
| Same-version attachment links | `[moat-analysis.md](./moat-analysis.md)` |
| north-star linking another version's attachment | `[moat-analysis.md](../0.2/moat-analysis.md)` |
| Cross-version anchored link | `[0.2 开放标准 O1](../0.2/north-star.md#对象标准开放护城河-p0)` (preserved example: "0.2 Open Standards O1") |

For cross-version links, follow GitHub slug rules: Retain Chinese characters, remove parentheses, replace spaces with `-`, lowercase everything.

---

<a id="3-命名空间冲突防御"></a>

## 3. Namespace Collision Prevention

**Audit criterion IDs in different sections of one version must not collide**. Examples:
- ❌ §IV "Version Updates" uses `O1/O2/O3`, while §VI "Open Object Standards" also uses `O1/O2/O3`
- ✅ Change the former to `UP1/UP2/UP3` (Update), retaining `O1/O2/O3` (Open) for the latter
- ✅ §II "Design Constraints" uses `D1/D2/D3`; §VI "Data Ownership" changes to `DO1-DO4` (Data Ownership)

**IDs may repeat across versions** because anchored links explicitly identify `../0.2/north-star.md#xxx`.

---

<a id="4-工作流讨论-&#45;定稿"></a>

## 4. Workflow: Discussion → Finalization

<a id="第一稿"></a>

### First Draft
- Write directly in `ya-docs/milestones/{version}/{file}.md`.
- Agent strategy outputs (such as Tiger Nick's `moat-analysis.md`) also go directly in `ya-docs/milestones/{version}/`, without detouring through `ya-docs/{version}/{agent-name}/`.
  - Exception: Agent working papers **that will not enter a milestone** (research notes, process drafts) still follow `.claude/CLAUDE.md` into `ya-docs/{version}/{agent-name}/`.
  - Decision rule: Will `north-star.md` cite this document? Yes → milestones/ directly; no → agent directory.

<a id="修订"></a>

### Revision
- To revise an already published version:
  ```bash
  cp -r docs/milestones/{version}/ ya-docs/milestones/{version}/
  ```
  Edit and discuss in ya-docs.

<a id="定稿"></a>

### Finalization
- After completing changes:
  ```bash
  cp -r ya-docs/milestones/{version}/* docs/milestones/{version}/
  ```
  Identical paths → no reference changes. git diff appears in docs.

<a id="不变量"></a>

### Invariant
- At any time, relative path sets from `find docs/milestones -type f` and `find ya-docs/milestones -type f` should satisfy `ya-docs ⊇ docs` (ya-docs may contain additional discussion drafts, but every existing docs file should have an identically named and structured counterpart as a working draft or synchronized copy).

---

<a id="5-不做的事"></a>

## 5. Exclusions

- ❌ No attachment-type subdirectories (`strategy/`, `research/`), avoiding empty directories and excessive nesting.
- ❌ No "draft/under discussion" labels in docs/milestones/: Drafts stay in ya-docs; only finalized content enters docs.
- ❌ No `ya-docs/...` references: docs links are public, and gitignored paths break them.

---

<a id="6-跨批次-summary-与团队同步交付物"></a>

## 6. Cross-batch Summaries and Team Synchronization Deliverables

Discussions spanning multiple versions (such as planning 0.2 + 0.3 together) produce multiple derivative documents. Distinguish two types with separate workflows.

<a id="61-文件分类与位置"></a>

### 6.1 File Types and Locations

| File | Nature | Location |
|------|------|------|
| `summary-v<起>-v<止>.md` | Discussion record (feasibility assessment, action list, internal PM narrative); placeholders mean start/end | **Only** `ya-docs/milestones/` root |
| `asci-v<起>-v<止>-overview.html` | Integrated team synchronization deliverable (version planning + product prototype in one page) | **Both** `ya-docs/` + `docs/milestones/` roots |

Naming rules:
- Cross-version batch: `asci-v<起始版>-v<结束版>-overview.html` (e.g. `asci-v0.2-v0.3-overview.html`); placeholders mean starting/ending version
- Single-version batch: `asci-v<版本>-overview.html` (e.g. `asci-v0.4-overview.html`); placeholder means version
- Consistent `asci-v` prefix groups files automatically when sorted
- **Never overwrite or rename** older HTML / markdown summaries; preserve historical decision records
- Historical naming: Early v0.2 / v0.3 batches had two files, `summary-v<起>-v<止>.html` (planning visualization) + `prototypes-v<起>-v<止>.html` (product prototypes); merged on 2026-05-14 into single-page `asci-v<起>-v<止>-overview.html`

<a id="62-生命周期"></a>

### 6.2 Lifecycle

- **Markdown summaries** align discussion and **enter ya-docs/ only**: They contain feasibility assessment / reordering rationale / internal PM narrative, not public material
- **HTML deliverables** are team-facing finished outputs, **synchronized to docs/** for everyone to access
- After discussion finalizes, absorb all summary decisions into each version's `north-star.md` (north-star is the sole authority)

<a id="63-与-north-star-的边界"></a>

### 6.3 Boundary with north-star

- north-star = Authority for one version's "what to do + how to verify"
- summary = Cross-version discussion record of "why this split + overall feasibility + reordering rationale"
- HTML deliverable = Visualization based on summary §I version planning, **introducing no decisions absent from north-star**
- north-star prevails for overlapping content
