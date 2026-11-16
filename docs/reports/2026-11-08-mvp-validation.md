<a id="mvp-修复验证记录"></a>

# MVP Fix Validation Record

Baseline main `0cbdd72cd2f9717358b766a85d2f7c0f7762bd84`. This round uses the existing Electron / React 18.3.1 / TypeScript production stack, without switching to Rust/Tauri or generating/installing a new package. Repository automation updated the Electron package version to 0.1.610.

<a id="已实现"></a>

## Implemented

- Ordinary explicit image generation, reference-image editing, and regular consecutive requests are authorized from the current original user message, without an extra billing/permission card solely because of the host tool. Default one image; quantity parsing covers output requirements only, not reference-image counts.
- Troubleshooting discussions, pricing questions, reported speech, coding tasks, negation, and quoted content cannot automatically authorize. Unknown intent and requests beyond scope still require confirmation; tools are not globally allowlisted and dangerous operations are not enabled.
- Valid uploaded/generated references in the current session undergo path, actual file type, size, and selected-version validation. `latest` is pinned to the available version at the start of the current user turn and cannot drift when new images are generated.
- The hook, canUseTool, and actual MCP handler share scope validation. The existing ledger remains in use; duplicate requests do not add billable calls. Cancellation, old calls, and late approval cannot inherit new-turn authorization.
- `next` queues without cancelling current generation; `now` revokes old authorization only after successful soft interruption. Turns switch according to the actual SDK user echo corresponding to the UUID registered in this round. Injection failure, historical/initial/retry UUIDs, and old-request isolation are handled.
- Image cards default to bilingual model attribution only, retaining preview, edit, save, comparison, and missing-file/parent-version notices; underlying references and version data remain.
- Owned login pages and loopback callback copy use bilingual Tinker resources; duplicate start/cancel clicks, late responses, unmounting, and exceptional-state cleanup are fixed. External Google configuration and compatibility paths/IDs remain unchanged.
- Fixed existing workspace lock metadata/source-version mismatch, enabling frozen installation without third-party dependency upgrades.

<a id="自动检查"></a>

## Automated Checks

| Check | Result |
|---|---|
| Repository-wide `bun run lint` | Passed, exit 0 |
| Full monorepo `bun run typecheck` | All six workspaces exited 0 |
| Repository-wide `bun test` | 3287 pass, 0 skip, 0 fail, 369 files, 44.50 seconds |
| `bun run electron:build` | Passed, exit 0 |
| Image authorization/execution/queue checks | 99 pass, 0 fail, already included in repository-wide results; not added again |
| Google loopback and login components | Synthetic local HTTP callbacks and bilingual components passed, without accessing Google |
| Frozen installation | 1303 installs / 1273 packages, unchanged, exit 0 |
| Lockfile third-party graph | 1395 complete package records including URL/integrity structurally identical to HEAD; only workspace metadata changed |
| `git diff --check` | Passed |

Tests use newly created temporary configuration and runtime roots, without real tokens or image-generation channels. Actual adapters and MCP handlers were verified through isolated subprocesses injecting fake SDK messages, fake networking, and attachment writes, with six fake API calls total; this does not constitute actual-service connectivity acceptance.

<a id="桌面-ui-验证"></a>

## Desktop UI Validation

Reused a temporary Electron 39.5.1 QA shell loading this build's main/preload/renderer. Configuration, runtime, and Chromium data all reside in temporary directories; external networking, protocol registration, and global shortcuts are blocked. No user shell profile is read and no installed user app is launched.

| Scenario | English | Chinese |
|---|---|---|
| Tinker login branding and Google entry | Passed | Passed |
| Double-clicking start sends one fake OAuth IPC | Passed | Passed |
| Waiting state, duplicate cancellation, return to login | Passed | Passed |
| Concise image model attribution without stacked cost details | Passed | Passed |
| Open/close enlarged preview | Passed | Passed |
| Add/remove selected-image edit references | Passed | Passed |
| Save IPC and parent/current-version comparison | Passed | Passed |
| Escape closes comparison | Passed | Passed |

UI results total two fake login starts, two cancellations, and two fake saves, with no duplicate sends. Visual screenshots use synthetic images and empty account data, saved in `docs/qa/2026-11-08-mvp`. Hidden-window screenshots disable transitions to avoid intermediate fade-in frames; not all motion was verified. Login uses the actual production route; image components load in an isolated renderer fixture, so these results do not establish acceptance of an entire real user session after completed generation.

<a id="审查"></a>

## Review

Independent read-only review and simplify/reuse checks complete. After fixes for intent misclassification, authorization expansion through reference counts, queue consumption, and UUID/old-call issues, no Critical or Important items remain. New state is concentrated in shared pure rules and a small host coordination module, reusing the existing ledger, image index, and path validation without parallel billing or storage implementations. Readability cleanup of single-line statements in new modules is a nonblocking follow-up.

<a id="尚未完成"></a>

## Outstanding

- No actual Google authorization, paid image generation, model execution, or user-data session restoration; no claim that all manual first-round MVP flows were accepted.
- When the CLI merges multiple `next` messages, conservatively use the last actually consumed and registered original user message, without accumulating earlier authorization; ambiguity can still require precise confirmation.
- The existing in-stream append API carries only text; new attachments and explicit selected-image metadata were not extended. Editing a selected fixed version was validated through ordinary `sendMessage`, which cannot be extrapolated to all compound in-stream input.
- External Google consent-screen branding was neither verified nor modified; internal `~/.asci`, compatibility protocols, and tool IDs remain.
- Separate uncommitted Rust/Tauri/React work in Tinker 2 remains in place, without item-by-item migration; see the audit report.
- No Rust native build or whole-machine performance comparison; this round changes no Rust source and provides no memory-improvement conclusion.

Remote branch, commit, draft PR, and checks/status/Actions state are verified separately after publication; local passes are not remote CI passes. The installed version, real data, and keys remain unchanged.
