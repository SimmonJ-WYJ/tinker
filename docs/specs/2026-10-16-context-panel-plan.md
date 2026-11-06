# Context management implementation plan

Goal: make context capacity, compaction, retained material and actual summary visible and usable.

- [x] Add persisted per-session retained excerpts and compaction reports, with bounded validated data.
- [x] Inject retained excerpts into subsequent model prompts; pass explicit focus instructions to native /compact; capture the actual PostCompact summary including automatic compaction.
- [x] Replace hover debug popup with click-operated accessible capacity panel: usage, choose/edit/remove retained excerpts, real working/success/error states, expandable summary, optional token diagnostics.
- [x] Keep historical messages and reading position intact; remove synthetic /compact chat bubble and duplicate compaction spinner.
- [x] Test retention validation, prompt assembly, hook/report persistence and panel state transitions; build main/preload and inspect real application.

No fabricated token breakdown, progress percentage, or estimated post-compaction capacity. Retained excerpts are explicit additional context, not a promise that unselected history is deleted. Reports use SDK-provided summaries and usage only.

## Validation

12 focused tests for retention/panel/candidate extraction and 21 conversation rendering regressions passed. Electron TypeScript check, lint, main and preload builds passed. Native /compact in a separate QA session returned a real 6,609-character PostCompact summary containing the retained verification fact. The extra model request after compaction received upstream HTTP 403; no valid post-compaction usage was accepted. Empty/zero usage is explicitly rejected. The QA session and its retained data were removed.

Native command references: https://code.claude.com/docs/zh-CN/commands ; installed SDK PostCompactHookInput supplies compact_summary.
