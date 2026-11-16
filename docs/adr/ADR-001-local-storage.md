<a id="adr-001本地存储后端选型"></a>

# ADR-001: Local Storage Backend Selection

| Field | Content |
|------|------|
| **Status** | Accepted |
| **Hard decision deadline** | Before opening the 0.2 V6e issue |
| **Decision date** | 2026-05-20 |
| **Decision maker** | liningftp |
| **Author** | Dev D |
| **Related** | [0.2 north-star §VI F3](../milestones/0.2/north-star.md), PR [#284](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/284), issue [#214](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/214) / [#221](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/221) / [#222](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/222) / [#235](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/235) |

---

<a id="决策时间线透明度说明"></a>

## Decision Timeline (Transparency Note)

This ADR is **retrospective documentation**: SQLite was already implemented in PR [#284](https://github.com/OPENSCI-Labs/ASCI-Alpha/pull/284) (merged 2026-05-19); this ADR (signed 2026-05-20) formalizes that existing state.

Reason for the reversed sequence: A-1 (#214), A-2 (#221), and this ADR (#215) were scheduled in parallel in 0.2 Week 1. The SQLite direction converged and was implemented during PR #284 review without waiting for ADR signature.

Relationship to [ADR-000](./ADR-000-common-convention.md) collaboration conventions: this violates the expectation of deciding first. This exception is recorded publicly here; all subsequent ADRs must be signed before implementation.

---

<a id="一背景"></a>

## I. Background

The 0.2 milestone introduces the research object model (Paper / EvidenceRef / Note / EvidenceSet / CitationRelation / Proposal / Review). V6e requires “with 100+ Notes, the response time for reverse-querying associated Notes by Paper is independent of total Note count.” This needs **secondary indexes**, unavailable with plain JSON files.

This ADR selects ASCI desktop's local storage backend from 0.2 onward. Once signed, its conclusion governs subsequent implementation; changes require ADR revision.

**Trigger constraint**: ADR-001 must finish before starting V6e implementation issues (#222 A-3 / #235 C-7); otherwise V6e cannot be verified.

**Project-level hard constraints (from old CLAUDE.md §2, revised with this ADR)**:
- Local-first (JSON configuration / JSONL logs)
- Old wording: “no local database”—conflicts with V6e indexing needs; this ADR revises that principle (see §IV's relationship to CLAUDE.md §2)
- Avoid defaulting to localStorage (retained)

---

<a id="二决策维度"></a>

## II. Decision Dimensions

| Dimension | Key question |
|------|---------|
| **Performance** | Query/write latency baselines at 100+ / 1k+ / 10k+ EvidenceRefs |
| **Indexing** | Native secondary indexes, multi-relation joins, full-text search |
| **Cross-platform** | macOS / Windows / Linux consistency; native binary packaging needed? |
| **Backup/recovery** | File copies vs database dumps; single file vs directory tree |
| **Upgrade migration** | Schema evolution strategy and old-version data migration |
| **Offline-first** | Reliability fully offline |
| **Agent SDK compatibility** | Blocking Electron main process; concurrency with SDK subprocesses |
| **Electron packaging cost** | Binary size and code-signing impact |
| **Consistency with CLAUDE.md §2** | Fit with existing local-first / no database / JSON configuration constraints; if not, is reconsidering the principle justified? |

---

<a id="三候选方案"></a>

## III. Options

<a id="方案-ajson-文件-&#45;自写-indexer"></a>

### Option A: JSON Files + Custom Indexer

- **Advantages**: human-readable / zero dependencies / consistent with existing `~/.asci/` style / backup by file copy
- **Disadvantages**: V6e reverse lookup at 100+ Notes needs a custom indexer; at 1k+ / 10k+, index consistency, concurrent writes, and crash recovery must all be reinvented; schema migration also needs custom implementation
- **Eight-dimensional assessment**:
  - Performance ✗ (rewrite indexer at 10k+)
  - Indexing ✗ (no native support)
  - Cross-platform ✓
  - Backup ✓ (directory tree copy)
  - Upgrade migration: custom (high cost)
  - Offline ✓
  - Agent SDK compatibility ✓
  - Electron packaging ✓ (zero native dependencies)

<a id="方案-bsqlitebetter-sqlite3-&#45;bunsqlite"></a>

### Option B: SQLite (better-sqlite3 / bun:sqlite)

- **Advantages**: native B-tree + partial indexes, ACID, WAL read/write concurrency, PRAGMA `user_version` migration, mature Electron ecosystem, `bun:sqlite` substitute for tests, CHECK constraints enforce business invariants
- **Disadvantages**: native bindings add Electron packaging cost (Windows requires `bun run rebuild`); better-sqlite3 is incompatible with Bun's test runtime ([bun#4290](https://github.com/oven-sh/bun/issues/4290)), requiring a driver-agnostic abstraction (`MigrationDb` interface)
- **Eight-dimensional assessment**:
  - Performance ✓ (B-tree + partial indexes)
  - Indexing ✓ (native)
  - Cross-platform ✓ (Windows rebuild needed)
  - Backup: single `.db` + WAL sidecars (`.db-wal` / `.db-shm`)
  - Upgrade migration: `user_version` + transactional incremental migrations
  - Offline ✓
  - Agent SDK compatibility ✓ (synchronous main-process access, without blocking renderer or SDK subprocesses)
  - Electron packaging: +~2MB native

<a id="方案-cduckdb"></a>

### Option C: DuckDB

OLAP advantages do not benefit V6e single-table reverse lookup; few Electron integrations, unverified Bun compatibility, and a substantially smaller community than SQLite. **Rejected**.

<a id="方案-d自定义二进制格式-&#45;自实现-indexer"></a>

### Option D: Custom Binary Format + Custom Indexer

Reinvents the wheel; incompatible with 0.2's window (ADR required by end of Week 1, A-2/A-3 in Week 2); extremely high migration cost. **Rejected**.

<a id="方案-e其他"></a>

### Option E: Other

Research into LMDB / RxDB / NeDB found insufficient benefit to overcome SQLite's maturity and Electron ecosystem. **Rejected**.

---

<a id="四决策"></a>

## IV. Decision

<a id="拍板结论"></a>

### Final Decision

| Item | Decision | Main rationale |
|---|------|---------|
| Storage backend | **SQLite** (production `better-sqlite3` / tests `bun:sqlite`) | Only option meeting V6e index performance, synchronous Electron same-process access, and 0.2 timing constraints together |
| Indexing strategy | B-tree + partial indexes (`WHERE col IS NOT NULL`) | See `apps/electron/src/main/lib/objects/migrations/001-initial.sql` (L33-35 / L55-58 etc.); index all FK association keys so V6e reverse lookup uses indexes rather than scans |
| Backup format | File copy of `~/.asci/objects.db` + `.db-wal` + `.db-shm` sidecars | Portable single file; backup SOP must include WAL sidecars to avoid losing uncheckpointed data |
| Upgrade migration | PRAGMA `user_version` + transactional incremental migrations | See `apps/electron/src/main/lib/objects/migration-runner.ts`; driver-agnostic `MigrationDb` shares SQL between production/tests; pre-launch may edit `001-initial.sql`, post-launch is append-only |

<a id="与-claudemd-2-不采用本地数据库-原则的关系"></a>

### Relationship to CLAUDE.md §2's “No Local Database” Principle

CLAUDE.md §2 was revised with this ADR to the following (English translation):

> **Storage**: local-first: JSON configuration, JSONL append-only logs; SQLite only for **relational / large structured data** (better-sqlite3, synchronous main-process access, files under `~/.asci/`); avoid defaulting to localStorage.

This matches the ADR: **SQLite is strictly limited to the object-model layer** (`~/.asci/objects.db`); `channels.json` / `agent-sessions.json` / JSONL logs remain unchanged. New storage needs outside relational / large structured data still default to JSON / JSONL.

---

<a id="五后果"></a>

## V. Consequences

<a id="正向后果"></a>

### Positive Consequences

- V6e P3 query performance can meet requirements; #222 / #235 unblocked
- Clear migration path (`user_version`) provides a standard entry for future schema evolution
- Driver-agnostic `MigrationDb` preserves the ability to replace the underlying driver
- `bun:sqlite` enables object-layer cases under `bun test` (PR #284 already includes 27 objects subset tests)
- WAL supports read/write concurrency; synchronous main-process access does not block the renderer

<a id="负向后果-&#45;风险"></a>

### Negative Consequences / Risks

- Native bindings add ~2MB to Electron; Windows needs `bun run rebuild` after initial `bun install` (recorded in CLAUDE.md)
- WAL sidecars are easily omitted from backups → 0.2 backup SOP must explicitly include `.db-wal` / `.db-shm`
- Implementation-before-ADR precedent: this exception is public; future ADRs must be signed before implementation
- Code signing: macOS / Windows native bindings passed smoke tests in PR #284's existing build pipeline; future SDK / better-sqlite3 upgrades require new smoke tests

<a id="后续动作"></a>

### Follow-up Actions

- [x] A-1 (#214) fully implemented (PR #284)
- [x] A-2 (#221) schema + initialization implemented (PR #284)
- [x] CLAUDE.md §2 principle revised (PR #284 / subsequent PR)
- [ ] A-2 follow-up: repository functions + softDelete API + four-layer IPC synchronization
- [ ] A-3 (#222) query interface—unblocked after ADR signature
- [ ] C-7 (#235) V6e performance load test—unblocked after ADR signature
- [ ] 0.1 → 0.2 data migration script design (separate issue)
- [x] README.md §123 “no local database” revised (included in this PR)
