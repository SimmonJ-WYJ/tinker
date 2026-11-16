# English Documentation Conversion

## Scope and Baseline

- User request: English repository documentation, including archived material and historical PR titles/descriptions.
- Verified merged PR #23 and main `9e01941adb9b3d478f03b7a1b7d3fc7a1087a227` before editing.
- Work branch: `docs/english-documentation`, reusing the existing isolated worktree. Other development checkouts and their uncommitted work were not edited.
- Translation covers 192 existing Markdown files, two extensionless research documents, and 12 archived HTML documentation prototypes. It also translates 104 explanatory comment lines in seven configuration/disabled-workflow files. An eighth inspected configuration had no Chinese comments and required no change.
- README, CLAUDE, CONTEXT, contribution rules, issue/PR templates, current specifications, historical research roadmaps, original feedback, architecture documents, and acceptance reports are included.
- GitHub About text was already English. The repository has no Wiki or Releases requiring description translation.

## What Was Preserved

- Historical chronology, planned versus implemented status, priorities, dependencies, test measurements, failed/unrun checks, source SHAs, signing limits, and rollback boundaries.
- Existing filenames, paths, URLs, identifiers, schemas, user/test input literals, executable examples, and recorded logs. Descriptive diagrams and human-facing HTML labels are translated without executing historical instructions.
- Original screenshots and other visual evidence. Chinese in a screenshot is not replaced or represented as newly tested English UI.
- All seven protected legal files, attribution, runtime skills/prompts, locale resources, test fixtures, application execution source, data formats, and user data.
- Production Electron defaults, the isolated Rust/Tauri boundary, installed applications, and credentials. This documentation change performs no migration, installation, native UI operation, or paid model call.
- The repository's normal commit hook may update workspace version fields. Any such changes must be version-only metadata and are checked separately from executable source.

## English Policy

- Repository prose, PR titles/descriptions, and PR review reports use English, as explicitly requested by the user.
- User conversation remains Chinese. Existing code-comment/log language conventions, bilingual product UI, and Agent output-language routing remain unchanged.
- Historical policy discussions remain historical. Active contribution instructions explicitly supersede the former Chinese PR-copy requirement.

## Compatibility and Coverage Checks

| Check | Evidence |
| --- | --- |
| Markdown coverage | 192 files, 2626 original headings, no missing historical heading targets |
| Prose language | No Chinese prose remains outside literal/code/path/anchor evidence in the audited Markdown set |
| Legacy links | Added 2427 legacy heading aliases, preserving original external bookmarks and internal fragments |
| Anchor representation | Double hyphens in alias attributes use HTML character references where necessary, preserving decoded IDs without creating false CSS-token matches |
| Technical literals | Original inline literals retained, except translated descriptive conversation-flow notation and the equivalent pasted-text threshold formula |
| Descriptive diagrams | Translated diagrams/trees and Mermaid display labels while retaining technical paths, values, node identities, and executable examples |
| HTML archives | All 12 preserve tag structure, nontext attributes, CSS mechanics, and JavaScript syntax/structure while translating human-facing strings |
| Inline handlers | 89 HTML-decoded handlers parse successfully and retain syntax structure and identifiers |
| Residual HTML Chinese | Eight lines of exact data-tag/data-tags lookup keys remain in the evidence-set prototype, with English visible labels |
| Configuration | Noncomment configuration/command content unchanged, including disabled workflow extensions and permissions |
| Legal/source guard | Seven legal files unchanged, no unexpected application changes or added credential-like values |

## Local Verification

| Run | Result and limit |
| --- | --- |
| `bun run typecheck` | All six workspaces passed |
| `bun run lint` | Exit 0 |
| Initial full default `bun test` | 3502 passed, four existing skips, one unchanged runtime-wrapper test exceeded its original 5-second limit |
| Runtime-wrapper isolation | Two passed, zero failed, with original timeout and no source/test changes |
| Interrupted serial attempt | Lost its execution session without a final summary, not counted as passing |
| Recorded serial suite | 3502 passed, five skipped, zero failed. Four skips are existing bundled-rg cases. The additional Rust integration skipped because that isolated invocation lacked the build-cache path |
| Existing Rust-process router integration with cache path restored | One passed, zero failed. Uses synthetic data/local mock HTTP, not a real online model |
| Final design-token parity | Two passed, zero failed after correcting the legacy-anchor representation |
| Final diff formatting | `git diff --check` passed |
| Independent reviews | Historical PR translations and sampled repository semantics reviewed. No Critical or Important findings. Minor wording/spacing findings corrected |

- An initial token-parity check exposed CSS-looking strings in newly generated legacy anchors. The fix changes HTML encoding only. Tests and token definitions were not weakened or changed.
- An initial inline-handler audit used a raw attribute regex and produced false parse errors. The final audit uses HTML-decoded attributes and reports zero errors.
- HTML checks are static. This batch does not claim rendered prototype acceptance or new native/product UI verification.
- No Rust implementation changed, so no new Rust compilation, native package, installer, or real-service acceptance is claimed.
- Normal pre-push hooks run full typecheck/Bun checks again during publication. The actual final hook output, branch SHA, Draft PR state, and remote CI records are reported on the delivery PR, separately from the runs above.

## Historical PR Updates

- All 23 existing PR titles/descriptions were translated and read back through the authorized GitHub CLI.
- Preserved every original URL, backtick-delimited literal, checkbox sequence, author identity, state, merge status, and head/base reference.
- No PR was merged, reopened, closed, or converted between Draft and ready as part of translation. Historical delivery language remains evidence of the original batch rather than a claim of new testing.
- Existing pinned historical links still point to their original commits. Git history and historical commit objects were not rewritten.
- Original and English snapshots plus verified per-PR receipts are saved locally in the sibling `english-docs-checks-20261116` directory. They are not user session data and contain no model credentials.

## Publication and Rollback

- Publish only the reviewed documentation branch as a Draft PR. Do not merge, deploy, install, or replace an application.
- File rollback: revert this documentation commit through a normal reviewable commit. No user-data reverse migration is required.
- Metadata rollback is independent of Git: restore only each PR's `title` and `body` from the saved `github-prs-before.json`, verify the current metadata first, and leave state, author, merge data, and refs untouched.
- Keep the isolated worktree and local review/verification receipts for follow-up. Do not remove other worktrees, caches, installers, or user files.
