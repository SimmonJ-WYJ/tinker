# Architecture Decision Records (ADR)

This directory contains ASCI Architecture Decision Records.

<a id="什么是-adr"></a>

## What is an ADR

An ADR is a lightweight document recording why a choice was made. Each describes one specific architectural decision, its background, considered alternatives, and reasons for the final choice.

**An ADR is more than a research document**: It must include research + review + decision maker + decision record. Once signed, the conclusion governs implementation; changes require ADR revision (create a new ADR or mark the original Superseded).

<a id="状态约定"></a>

## Status conventions

- **Proposed**: Proposal raised, research or review in progress
- **Accepted**: Decision signed, implementation begins
- **Deprecated**: Decision abandoned without replacement
- **Superseded by ADR-XXX**: Replaced by a new decision

<a id="索引"></a>

## Index

| # | Title | Status | Hard decision deadline |
|---|------|------|---------------|
| [ADR-000](./ADR-000-common-convention.md) | Collaboration conventions (branch / commit / PR) | Accepted | None |
| [ADR-001](./ADR-001-local-storage.md) | Local storage backend selection | Proposed | Before opening the 0.2 V6e issue |
| [ADR-002](./ADR-002-server-stack.md) | Server backend stack selection | Proposed | Before 0.3 starts (end of 0.2 Week 1) |
| [ADR-003](./ADR-003-ui-design-system-layering.md) | UI design system layering | Proposed (Draft) | Before writing `docs/design.md` and enforcing ESLint palette-color restrictions |
| [ADR-004](./ADR-004-left-nav-notes-entry.md) | LeftSidebar “Notes” entry | Accepted (2026-05-18, lexa) | Before opening the 0.2 V6a implementation issue |
| [ADR-005](./ADR-005-opensci-identity-provider.md) | OPENSCI as sole identity provider | Proposed | Before opening implementation issues for the 0.3 account epic |
| [ADR-006](./ADR-006-ui-framework-extension-boundary.md) | UI framework library extension boundary (registerable right-side renderer) | Proposed | Before opening the 0.4 P1 UI framework implementation issue |
| [ADR-007](./ADR-007-evidence-set-topic-container.md) | Evidence sets → multiple-membership topic containers (M:N) | Proposed | Before opening the 0.4 P2 data-model refactor issue |
| [ADR-008](./ADR-008-supervisor-autonomous-orchestration.md) | Orchestrator → Supervisor autonomously orchestrates multiple packs | Proposed | Before opening the 0.4 P3 Supervisor/default-page implementation issue |
| [ADR-009](./ADR-009-o1-schema-generation.md) | Generate O1 object-standard schema from TS interfaces (reject dual zod sources / handwriting) | Proposed | Schema becomes an external contract on release (#419 / #243) |
| [ADR-010](./ADR-010-evidence-driven-scoring-agent.md) | Five-dimensional F22 → evidence-driven relevance-led scoring (score), coupled and parallel with F22 | Accepted (2026-06-04, lee) | Before switching search-panel sorting to score (implemented) |
| [ADR-011](./ADR-011-telemetry-architecture.md) | Telemetry instrumentation architecture (three layers / main-process aggregation / timezone-region determination / EU residency) | Accepted (2026-06-02) | Before implementing the 0.3 instrumentation epic (#416/#426/#427) |
| [ADR-012](./ADR-012-local-embedding-vector-index.md) | Local ONNX embeddings for literature vector index | Accepted (2026-06-02, alan) | Before landing `feat/vector-store-evidence` |
| [ADR-013](./ADR-013-literature-relevance-service.md) | Literature search data service (partly self-built layers) | Proposed | Before opening 0.5 literature data-service implementation issues; extends ADR-002 |
| [ADR-014](./ADR-014-non-api-sources-and-demand-driven-fill.md) | Non-API source integration + demand-driven corpus filling | Proposed | Before opening 0.5 literature data-service implementation issues; extends ADR-013 |

<a id="命名约定"></a>

## Naming convention

`ADR-XXX-<short-kebab-slug>.md`, where XXX is a three-digit number; technical decisions increment from 001.

`ADR-000` is a meta-ADR governing collaboration (branch / commit / PR), independent of any specific technical decision; it always appears first in the index.

<a id="编写模板"></a>

## Authoring template

Each ADR should include these sections:

1. **Metadata**: Status, date, decision maker, author, related documents
2. **Background**: Decision motivation, problem, constraints, decision timing
3. **Decision dimensions / granularity**: Key questions to evaluate
4. **Alternatives**: Pros/cons and assessment against each dimension
5. **Rejected alternatives** (optional): Explicit exclusions and reasons
6. **Decision**: Final conclusion + principal reasons
7. **Consequences**: Positive / negative outcomes, risks, follow-up actions

<a id="与-milestone-文档的关系"></a>

## Relationship to milestone documents

- [`ya-docs/milestones/0.2/north-star.md`](../../ya-docs/milestones/0.2/north-star.md) §6 F1 / F3 describe hard decision deadlines and coverage dimensions for ADR-001 / ADR-002 in this directory
- [`ya-docs/milestones/0.3/north-star.md`](../../ya-docs/milestones/0.3/north-star.md) §2 cites ADR-002 as the server implementation basis
