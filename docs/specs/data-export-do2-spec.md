<a id="数据导出do-2spec一键导出-zip-&#45;ajv-校验"></a>

# Data Export (DO-2) Spec: One-Click ZIP Export + ajv Validation

> **Status**: implemented · awaiting PR review (produced in grill session 2026-06-02, implemented the same day)
> **Change (2026-07-02)**: CitationRelation retired in 0.4 (#718), narrowing export from 6 types to 5
> (remove `citation-relations.json` and embedded `citation-relation.schema.json`; `exportFormatVersion`
> remains 1). See [`0.4.0/remove-citation-relation-spec.md`](./0.4.0/remove-citation-relation-spec.md);
> the body below retains the historical 6-type definition.
> **Related issues**: #419 (DO-2) · #243 (O1 documentation, unblocked on the schema itself by this spec) · #214 (A-1, source of schema deferral decision)
> **Related PR**: to be opened (branch `feat/issue-419-do2-export-zip`)
> **Domain language source of truth**: [`CONTEXT.md`](../../CONTEXT.md) Data Ownership section
> **PRD source**: [`docs/specs/0.3.0/0.3.0-prd.md`](./0.3.0/0.3.0-prd.md) Epic 4 slice 4.2

---

<a id="1-目标与验收"></a>

## 1. Goal and Acceptance

Users click “Export my data” in Settings' account tab → receive a ZIP **export package** containing all 6 persistent research object types, conforming to **O1 object standards** (open JSON Schema) and passing ajv at export. The data uses an industry-parseable standard format rather than a private dump (GDPR Art.20 portability).

| # | Acceptance (from issue / PRD) |
|---|------|
| DO-2 | Click “Export my data” → receive ZIP → pass ajv validation against O1 schemas |
| DO-O1 | Object JSON Schemas accessible in repository `schema/`, covering all exported types |

<a id="2-关键决策grill-会话裁决"></a>

## 2. Key Decisions (Grill Session)

| # | Decision point | Decision | Rationale |
|---|--------|------|------|
| D1 | Ownership of schemas themselves | **Include in this branch** (#419 no longer waits for #243) | Actual dependency is schemas → #419 export / #243 documentation; schemas were unclaimed. Integrate export and schemas in one PR, giving ajv a real validation target. Once unblocked, #243 only documents README |
| D2 | Schema generation | **`ts-json-schema-generator` from TS interfaces** (option A researched in `objects/index.ts` header) | TS remains the single source of truth; option B (zod) violates `@asci/shared` zero-runtime-dependency principle |
| D3 | Soft-deleted objects | **Export all, retain `visibility`** | Export is complete portability rather than a view; excluding soft-deleted objects leaves dangling EvidenceRef IDs; schema already includes three states |
| D4 | File granularity | **One JSON array file per type** | Matches Zotero and other export conventions, parseable in one line in any language; research data scale (MB) poses no memory pressure |
| D5 | ajv failure behavior | **Abort export + explicit error** (failed object type/ID), no partial ZIP | Validation failure = data/schema drift, a bug; drift tests catch it in CI, so production occurrence is rare; preserve the promise that exports comply |
| D6 | ZIP / ajv choice | **fflate 0.8.x** (ZIP) + **ajv 8.x**, both bundled into `main.cjs` (not external) | fflate is zero-dependency pure JS with one-step `zipSync`; yazl requires stream assembly, archiver/jszip have heavy, old dependency trees |
| D7 | Interaction | **Synchronous IPC**: button → `showSaveDialog` → loading → toast + `shell.showItemInFolder` | Matches existing `SAVE_IMAGE_AS`; MB-scale data takes <1s, requiring no progress-event channel |
| D8 | Scope | Workspace `papers.jsonl` **excluded** (Agent-session output, not O1 objects); Proposal **gets schema only, no export** (removed from 0.3, see PRD Epic 3 Out of Scope) | Issue lists exactly 6 export types; generating schemas for all 7 costs nothing and serves #243. Note: `proposals` table exists (001-initial.sql), but functionality is outside 0.3; issue defines export scope |

<a id="3-代码事实设计依据"></a>

## 3. Code Facts (Design Basis)

- TS types for 6 object types: `packages/shared/src/types/objects/*.ts` (7 objects + `common.ts` primitives)
- Storage: SQLite `~/.asci/asci.db` (`papers` / `evidence_refs` / `notes` / `evidence_sets` / `citation_relations` / `reviews` + `evidence_set_refs` join table); repositories in `apps/electron/src/main/lib/objects/repositories/` already flatten joins into TS types (e.g. `EvidenceSet.evidenceRefIds`)
- External Review bodies: `Review.bodyPath` is an **absolute path** (or fallback `~/.asci/reviews/{id}.{md,html}` if empty)
- Only EvidenceSet is isolated by `workspaceId` (export spans all workspaces and retains this field)
- `ObjectId` is a branded string (`common.ts:12`); schema generation needs postprocessing to `{"type":"string"}`
- No current ZIP / ajv dependency; Save As follows `ATTACHMENT_IPC_CHANNELS.SAVE_IMAGE_AS` in `ipc.ts`

<a id="4-设计"></a>

## 4. Design

<a id="41-o1-schema-生成仓库根-schema"></a>

### 4.1 O1 Schema Generation (Repository Root `schema/`)

The tree comment specifies schema only for Proposal, whose feature was removed from 0.3.

```
schema/objects/
  paper.schema.json
  evidence-ref.schema.json
  note.schema.json
  evidence-set.schema.json
  citation-relation.schema.json
  review.schema.json
  proposal.schema.json        # Schema only, no export (Proposal removed from 0.3)
```

- Generator: `scripts/generate-object-schemas.ts` (root devDependency `ts-json-schema-generator`)
  - Input `packages/shared/src/types/objects/index.ts`; emit independent `*.schema.json` per object
  - Postprocess `ObjectId` (branded string) → `{"type":"string"}`; `$id` like `https://opensci.io/asci/schema/objects/paper.schema.json`; draft-07 (generator native output, supported by ajv 8 by default)
  - Also generate `schema/manifest.schema.json` (`ExportManifest`, source `packages/shared/src/types/data-export.ts`), so importers validate the manifest before parsing data
  - **Language-neutral**: `jsDoc: 'none'`; no schema `description`, structure only; TS Chinese comments define field semantics (`"description"` guard in drift tests)
- **Drift guard test**: `scripts/generate-object-schemas.test.ts`—regenerated output ≡ committed files; TS type changes without schema regeneration fail CI

<a id="42-导出服务主进程"></a>

### 4.2 Export Service (Main Process)

New file `apps/electron/src/main/lib/objects/export-service.ts`:

1. Read all data through 6 repositories (including soft deletes; EvidenceSet across all workspaces)
2. Validate each record with ajv (schemas inlined through esbuild `--loader:.json` or text imports); any failure → throw error with `{ kind, id, errors }`, **write nothing to disk**
3. Review bodies: read `bodyPath` / fallback paths, store as `reviews/bodies/{id}.{md,html}` in package; **rewrite `bodyPath` in exported JSON to package-relative paths**, avoiding disclosure of user filesystem structure; missing bodies become empty with manifest `warnings`
4. Assemble with `fflate.zipSync` → write to the user's save-dialog path

<a id="43-导出包结构"></a>

### 4.3 Export Package Structure

Tree comments specify rewritten package-relative Review bodyPath and self-describing O1 schema copies for offline validation.

```
asci-export-2026-06-02.zip
├── manifest.json            # exportFormatVersion / appVersion / exportedAt /
│                            # files[{path, schema, count}] / warnings[]
├── papers.json              # Paper[]
├── notes.json               # Note[]
├── evidence-refs.json       # EvidenceRef[]
├── evidence-sets.json       # EvidenceSet[]
├── citation-relations.json  # CitationRelation[]
├── reviews.json             # Review[] (bodyPath rewritten package-relative)
├── reviews/bodies/{id}.md|html
└── schema/                  # O1 schema copies (self-describing, offline validation)
```

<a id="44-ipc-四联"></a>

### 4.4 Four-Layer IPC

| Layer | Location | Content |
|----|------|------|
| Constants + types | `packages/shared/src/types/data-export.ts` | `DATA_EXPORT_IPC_CHANNELS.EXPORT_MY_DATA`; `ExportMyDataResult = { status: 'ok', filePath, counts } \| { status: 'canceled' } \| { status: 'error', message }` |
| main | `apps/electron/src/main/ipc.ts` | Handler: `dialog.showSaveDialog` (default `asci-export-<date>.zip`) → `export-service` → `shell.showItemInFolder` on success |
| preload | `apps/electron/src/preload/index.ts` | `exportMyData(): Promise<ExportMyDataResult>` |
| renderer | `ProfileSettings.tsx` | Button call + loading / toast |

<a id="45-ui-与-i18n"></a>

### 4.5 UI and i18n

- Add a “Data export” card to the account tab in `apps/electron/src/renderer/components/settings/ProfileSettings.tsx`: explanatory copy (scope + one sentence about open standards) + “Export my data” button
- i18n: `profile.dataExport.*` under `settings` ns, synchronize en + zh (key-parity guard)

<a id="46-测试"></a>

### 4.6 Tests

| Test | Verification |
|------|------|
| Schema drift (`bun test`) | Generated ≡ committed; no TS↔schema drift |
| export-service unit tests | Seed 6 types in bun:sqlite memory DB (including soft deletes + Review without body) → export → unzip and assert structure / manifest counts / bodyPath rewriting / all ajv passes |
| Validation failure | Insert invalid row → assert abort, no disk output, error includes kind+id |

<a id="5-实现计划"></a>

## 5. Implementation Plan

1. **Phase 1 — schemas**: generator + 7 schemas + drift tests (unblock #243, independently reviewable)
2. **Phase 2 — export service**: fflate/ajv dependencies + export-service + unit tests
3. **Phase 3 — IPC + UI**: four layers + ProfileSettings card + i18n en/zh
4. **Finish**: `typecheck` / `bun test` / `dist:fast` smoke test (verify fflate in main.cjs); version increments: `packages/shared`, `apps/electron` (+ root `package.json` if adding devDependency)

## 6. Out of Scope

- Import / restore (export ≠ backup, see CONTEXT.md)
- DO-3 account deletion (another slice in the same Epic)
- Workspace `papers.jsonl`, Agent conversation records, Skill / MCP configuration
- Separate schema repository, third-party SDK release (V1)
- Progress-event channel (unneeded at this data scale; add for future large libraries)

<a id="7-残留开放问题"></a>

## 7. Remaining Open Questions

- ~~Should `manifest.json` also have a schema?~~ Added: `schema/manifest.schema.json`, same generator + drift guard
- `exportedAt` / ZIP filename dates may use system time (no determinism requirement)
