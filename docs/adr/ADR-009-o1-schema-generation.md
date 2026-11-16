<a id="adr-009o1-对象标准-schema-从-ts-interface-生成拒绝-zod-双源-&#45;手写"></a>

# ADR-009: Generate O1 Object Standard Schemas from TS Interfaces (Reject Dual Zod Sources / Handwriting)

| Field | Content |
|------|------|
| **Status** | Proposed (decided in grill session 2026-06-02; becomes Accepted with #419 PR review) |
| **Decision date** | 2026-06-02 |
| **Hard constraint at decision time** | Once published, schemas become external contracts (#243 documentation + embedded copies in export packages); changing generation strategy afterward requires the breaking change process |
| **Related** | issue #419 (DO-2 export) · #243 (O1 documentation) · #214 (A-1 deferred decision source) · [data-export-do2-spec.md](../specs/data-export-do2-spec.md) · [CONTEXT.md data ownership domain](../../CONTEXT.md) |

---

<a id="一背景"></a>

## 1. Background

0.2 §Open Object Standards (O1/O2/O3) requires core object formats to become open standards in the BibTeX / Zotero CSL ecosystem niche.
#214 (A-1) delivered the TS types themselves but explicitly deferred `schema/objects/*.schema.json`: the sole consumer then was
TS types themselves, making handwritten dual sources pure overhead (decision recorded in the header comment of `packages/shared/src/types/objects/index.ts`).

0.3 Epic 4 DO-2 (#419) introduces the first real consumer: export packages must pass ajv validation against O1 schemas. This triggers
reevaluation; schemas must be implemented and the generation strategy settled.

<a id="二候选方案"></a>

## 2. Alternatives

| | A: Generate with `ts-json-schema-generator` (**selected**) | B: Rewrite interfaces as zod | C: Handwritten schemas |
|---|---|---|---|
| Source of truth | TS types are the sole source; schemas are derived | zod schemas become the source; TS types are inferred | Dual sources (TS + JSON Schema maintained separately) |
| `@asci/shared` runtime dependencies | Zero (generator is a root devDependency) | ❌ Adds a zod runtime dependency, violating the zero-dependency principle | Zero |
| Drift risk | Drift guard tests intercept it (regeneration ≡ committed output) | No drift (same source) | ❌ Manual synchronization inevitably drifts |
| Migration cost | Zero (types unchanged) | Rewrite all 7 objects + repository-wide import impact | Zero |

<a id="三决策"></a>

## 3. Decision

**Choose A**: `scripts/generate-object-schemas.ts` uses `ts-json-schema-generator` to generate
`schema/objects/*.schema.json` (tracked) from `packages/shared/src/types/objects/`,
with drift guard tests preventing TS ↔ schema drift.

Key points:

1. TS types remain the sole source of truth; schemas are build artifacts but **tracked in the repository** (external developers can consume them without running the generator).
2. Branded types (`ObjectId`) are reduced to `{"type":"string"}` during postprocessing: branding prevents misuse at TS compile time and is outside the external contract.
3. **Language neutral**: The generator uses `jsDoc: 'none'`; schemas **emit no `description`**, carrying structure only.
   Field semantics are defined by Chinese TS interface comments (visible in the IDE, satisfying CLAUDE.md's hard rule “comments in Chinese,” English translation).
   External open contracts remain language neutral, keeping Chinese out of the external standard and avoiding bilingual maintenance. Drift tests add a `not.toContain('"description"')` guard.
4. The central reason for rejecting zod is the `@asci/shared` zero-runtime-dependency principle, rather than tool quality (consumers satisfy runtime validation needs with ajv).
5. If a strong need for runtime validation and types to share a source emerges (such as comprehensive IPC boundary validation), reopen this decision; migration costs are already documented.
