<a id="citationrelation-废弃移除-&#45;导出契约-&#45;死代码清理"></a>

# Retiring and Removing CitationRelation: Export Contract + Dead Code Cleanup

> **Status**: implemented · awaiting PR review
> **Related issue**: #718 (CitationRelation exists in the export contract but has no UI persistence path, so exports are always empty arrays)
> **Related PR**: #814
> **Domain language source of truth**: `CONTEXT.md` §Data Ownership; `docs/specs/data-export-do2-spec.md`

<a id="1-背景与决策"></a>

## 1. Background and Decision

Issue #718 identified the root cause: the CitationRelation chain (schema declaration + export read + UI write path)
is missing its write link: the `citation_relations` table is always empty, and DO-2's exported
`citation-relations.json` is always `[]`, falsely fulfilling the data contract.

Product decision (0.4 iteration): **retire CitationRelation**, following the issue's proposed
“remove from the contract” approach; since it is retired rather than temporarily retained, also remove dead code without production callers.
Git history retains the full implementation for recovery if the feature returns.

<a id="2-移除范围"></a>

## 2. Removal Scope

<a id="21-导出契约do-2issue-核心"></a>

### 2.1 Export Contract (DO-2, the Issue's Core)

- `export-service.ts`: `EXPORT_TARGETS` 6 → 5 (remove the `citation-relations.json`
  entry and schema / repository imports). The zip no longer contains `citation-relations.json`
  or `schema/objects/citation-relation.schema.json`
- `exportFormatVersion` remains `1`: the manifest `files` array is data-driven; importers parse
  the manifest, so one fewer file type is not a structural change. `manifest.schema.json` has no per-type
  enum and needs no change

<a id="22-类型与事件ascishared"></a>

### 2.2 Types and Events (`@asci/shared`)

- Delete `types/objects/citation-relation.ts` (`CitationRelation` /
  `CitationRelationType`) and its barrel re-export
- From the `ObjectKind` union, remove the `'citation-relation'` literal
- From `workspace-events.ts`, remove `citationRelation.created` (verified to have no subscribers;
  emitted only by the repository itself)

<a id="23-主进程数据层"></a>

### 2.3 Main-Process Data Layer

- Delete `repositories/citation-relation-repository.ts` (`createCitationRelation`
  has no production callers, the root cause of #718)
- From `query-service.ts`, delete `queryCitationRelationsByPaper` (called only by tests,
  with no IPC handler / renderer consumers)
- From `internal/mappers.ts`, delete `CitationRelationRow` / `citationRelationFromRow`

<a id="24-schema-生成"></a>

### 2.4 Schema Generation

- From `scripts/generate-object-schemas.ts`, remove the `CitationRelation` generation entry,
  delete `schema/objects/citation-relation.schema.json`, and rerun the generator
- `proposal.schema.json` changes as a consequence of narrowing `ObjectKind` (expected,
  guarded by `generate-object-schemas.test.ts`)

<a id="25-注释-&#45;文案"></a>

### 2.5 Comments / Copy

- Clean up outdated comments in `ItemDetailPanel.tsx` / `session-evidence-atoms.ts`
  (the session-only mockup UI mentioned in the issue no longer exists; only comments remain)
- Remove references to the deleted type name from review-demo legend copy (en/zh `library/core.json`)
  (no keys added or removed, no key-parity impact)
- In the event table in `docs/agents/architecture.md`, remove the `citationRelation.created` row

<a id="3-明确不动的范围"></a>

## 3. Explicitly Unchanged Scope

| Scope | Reason |
|------|------|
| `citation_relations` table (`001-initial.sql`) | Published migrations cannot change; dropping the table requires a new DROP migration, and an empty table is harmless. Retain its raw SQL DDL tests in `object-store.test.ts` with the table |
| Proposal's `kind: 'citation-relation'` (`ProposalKind` / proposal.schema.json enum / capability-pack zod / proposals table CHECK constraint) | The entire Proposal feature was removed in 0.3; its schema remains only for documentation. Changes affect capability-pack contracts and DB CHECK constraints and need a separate case |
| Entire citation-graph family (visualization) | Transient visualization, unrelated to persisted CitationRelation objects, and actively used |
| Historical documents (north-star / milestone-review / ADR / 0.3.0 PRD) | Do not rewrite historical records; append removal notes only to `data-export-do2-spec.md` |

<a id="4-验收"></a>

## 4. Acceptance

1. `bun run typecheck` + `bun test` pass (including schema-generation guard tests)
2. Manual: Settings → Export My Data → zip contains 5 data-file types + manifest without
   citation-relations entries; ajv revalidation passes
3. Exact repository-wide `CitationRelation` search finds only historical documents (docs/milestones, ADR,
   0.3.0 PRD), Proposal kind enums, `citation_relations` DDL and its raw SQL tests,
   and retirement tombstone comments left by this change (such as header comments in workspace-events.ts /
   export-service.ts / types/index.ts)
