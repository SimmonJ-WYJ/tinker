# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## Current and historical scope

`CONTEXT.md` defines the current Tinker vocabulary. Scientific domain definitions and version roadmaps are archived in [`docs/history/ASCI-CONTEXT.md`](../history/ASCI-CONTEXT.md). Consult them for historical data and compatibility, not as an instruction to restore retired workflows. Existing ADRs retain their original authors and decisions; resolve current-scope conflicts explicitly against the approved spec and code.

## File structure

This repo is single-context:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── ADR-000-common-convention.md
│   ├── ADR-001-local-storage.md
│   ├── ADR-002-server-stack.md
│   ├── ADR-003-ui-design-system-layering.md
│   └── ADR-004-left-nav-notes-entry.md
└── ...
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-002 (server stack) — but worth reopening because…_
