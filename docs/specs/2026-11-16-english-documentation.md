# English Documentation Conversion Plan

**Goal:** Convert all repository documentation and historical GitHub PR titles and descriptions to English, as explicitly requested by the user on 2026-11-16.
**Baseline:** main 9e01941adb9b3d478f03b7a1b7d3fc7a1087a227, after merged PR #23.
**Execution:** Use dispatching-parallel-agents for independent, explicitly assigned document sets. Workers edit only their manifest files and never mutate Git state. Root integrates and publishes.

## Constraints

- Preserve meaning, chronology, architecture boundaries, measured results, limitations, URLs, paths, command lines, IDs, numbers, license terms and original attribution.
- Translate explanatory prose, tables, headings, image labels and repository contribution instructions. Preserve literal code, recorded logs, identifiers and original evidence. Chinese product screenshots remain original evidence.
- Runtime prompts/skills, product locale JSON, test fixtures and legal LICENSE/NOTICE files are not prose-document translation targets and must remain byte-identical.
- Keep filenames stable. Root preserves historical heading anchors and checks cross-document links after translation.
- User-facing conversation and product UI language remain unchanged. GitHub documentation and PR titles/descriptions use English, overriding older Chinese PR-copy instructions.
- Preserve unrelated work and all user data. No application, protocol, model, credential, installation or migration behavior changes.
- Root owns commits, branch changes, GitHub edits and PR publication. Workers must not stage, commit, push or operate external services.

## Work

- [x] Translate Root-assigned README, CLAUDE, CONTEXT, PR flow and GitHub templates.
- [x] Translate document manifests docs-1 through docs-6, including current specifications, historical archives, feedback and reports.
- [x] Translate every repository PR title and body that contains Chinese prose. Preserve links, statuses, author identity and technical evidence.
- [x] Preserve original heading anchors, check prose-language coverage and audit literals, numeric results, URLs and scope.
- [x] Run documentation/token/link guards and local verification. Normal publication hooks run during push, with final receipts reported on the delivery PR. Do not present translation checks as application runtime tests.
- [x] Review the final documentation diff and prepare the authorized English-titled Draft PR publication. Record actual remote SHA/checks on the delivery PR, without merging or installing.

## Expanded Archive Inventory

- Include all four original feedback files under `docs/feedback/0.1/raw/`, retaining filenames and their historical status.
- Include extensionless Industrial Automation and Product summary research documents under `docs/0.2/Genspark product research/`.
- Include the nine HTML documentation prototypes directly under `docs/0.2/`, the milestone overview HTML, and both HTML prototypes under `docs/specs/0.4.0/assets/`. Translate human-facing text without redesigning their archived behavior.
- Original screenshots, executable examples, literal user/test input, paths and technical identifiers remain evidence rather than prose to rewrite. Translation does not change archived claims into current implementation or acceptance claims.
- Historical PR metadata is backed up before updates. All 23 existing PRs were translated and read back, preserving state, merge status, and head/base references.

## Result Record

See [English documentation conversion](../reports/2026-11-16-english-documentation.md) for scope, language/literal exceptions, local results, historical PR updates, and rollback. The delivery PR records final publication and remote CI state.
