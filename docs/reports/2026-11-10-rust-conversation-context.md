<a id="rust-多轮上下文迁移阶段报告"></a>

# Rust Multi-Turn Context Migration Stage Report

Status: Scoped implementation and automated validation complete; independent review passed; preparing safe-branch and Draft PR delivery. This does not establish whole-product or native-window acceptance.

<a id="基线与范围"></a>

## Baseline and Scope

- GitHub main: `4ca339592668581c1dc36abc9097fc9bf0aa1650`, already containing the previous HTTP/SSE migration.
- Branch: `feat/rust-conversation-context-audit`.
- Worktree: `/private/tmp/tinker-context-audit-20261110`.
- Design and acceptance: [Persistent Parent-Chain Specification](../specs/2026-11-10-rust-conversation-context.md).
- Parallel read-only audit: [ASCI and Research Retention Report](2026-11-10-legacy-research-audit.md); inventory applies only to the above main baseline.

This batch carries explicit parent execution references through the Tauri handler, controller, context reconstruction, HTTP messages, and existing event persistence. Only successfully completed parent chains can be inherited; branches remain isolated. Partial output from canceled, failed, or interrupted runs stays readable but is not sent as successful history. Exceeding explicit budgets is rejected without silent trimming.

Production Electron UI, features, entry points, dependencies, configuration paths, and installed versions remain unchanged. No real conversations/keys were read, external models called, charges incurred, or native acceptance windows operated. Research documentation and old features were audited only, not deleted; licenses, author attribution, compatible package names, and data paths remain.

<a id="兼容及降级边界"></a>

## Compatibility and Downgrade Boundaries

Original v1 logs and start/read/cancel DTOs remain. New continuation private v2 headers live in the `runs-v1/context-v2` subdirectory managed by the same RunStore and writer.lock. Old readers can still open root v1 logs; new continuations are temporarily invisible in older versions but not deleted, and become readable after upgrading again. If downgraded mixed writes produce duplicate IDs, the new version explicitly rejects conflicts rather than choosing a copy. Equal createdOrder across layouts is read deterministically, without claiming actual wall-clock ordering.

The default desktop entry remains an offline experiment. Implementations supporting only the old provider interface return `contextUnsupported` for multiple turns rather than claiming fixed simulated text understands context. A trusted HTTP host verifies actual message arrays through a synthetic service.

<a id="实际验证证据"></a>

## Actual Validation Evidence

| Check | Result |
|---|---|
| main Rust baseline | 118 top-level tests passed, 0 failed |
| Final full Rust regression | 141 top-level tests passed, 0 failed; 23 added, without double-counting subprocess helper results |
| Repository-wide Bun | 3463 passed, 0 failed, 384 files |
| Six-workspace typecheck | Passed |
| Repository-wide lint | Passed |
| Rust Lab Vite build | Passed |
| Electron build | Passed; not launched or installed |
| Rust fmt / clippy (all targets, warnings as errors) | Passed |
| Native binary build | Passed; Mach-O arm64, compilation only |
| Independent specification/quality review / simplify | Core behavior satisfies spec; no unresolved significant code issues; untested failure windows below |
| Independent research inventory replay | All files, regexes, counts, and resource sets match; zero differences |

Final Rust groups: library 70, HTTP protocol 7, transport 10, multi-turn IPC 6, history IPC 2, history library 4, original execution IPC 11, SDK history 12, conversation history 14, lifecycle 5. Tests use fake credentials, synthetic data, and local numeric loopback. HTTP messages serialize as separate user/assistant messages through the existing adapter and [official API](https://developers.openai.com/api/reference/resources/chat), without flattening history into one prompt.

<a id="已实测的关键行为"></a>

### Key Behaviors Actually Tested

- Real Tauri handler + MockRuntime + HTTP: two turns and a third after subprocess reopen, exact 1/3/5 role messages and Unicode content.
- Branching from the same parent inherits only the explicit parent chain even after another branch becomes latest.
- Duplicate sends from two threads and after restart create no new requests; changes to input/scenario/parent or start/continue mode explicitly conflict.
- Second-turn cancellation, 503, timeout, stream break, reflected configuration key, and process exit23: partial output remains; failed turns cannot be parents; restart interruption does not replay model side effects.
- More than 16 ancestors, 512KiB total content, or invalid parent chains are rejected without child logs; exact boundaries, UTF-8, control characters, quotes, and actual outbound bodies above 16KiB are covered.
- Synthetic regressions cover future schema/policy, missing parents, self-loops, multi-node cycles, sequence/order errors, truncation, bad cache, cross-layout ID conflicts, downgraded order ties, symlink/hardlink, and directory replacement.
- Two-pass startup preflight: if a later item's lineage is corrupt, earlier header-only or Started/partial logs are not prematurely rewritten.
- Actual header create failure from a read-only context directory: no provider call or child log; the same controller remains blocked, and explicit retry is possible only after restoring permissions and reopening.
- Actual delta storage failure retains confirmed content only. Second-turn upstream fake keys/error bodies do not enter IPC or A/B/C JSONL.

<a id="审查修复与过程证据"></a>

### Review Fixes and Process Evidence

The first real behavioral red test failed with `Command continue_lab_run not found`, then passed after implementation. Additional tests exposed cache masking of cross-layout duplicate IDs; red tests preceded the fix. Review found missing parent-directory synchronization for the new context-v2 entry; root-directory sync is now confirmed before constructing store/provider. Bounded first-line scanning was also restored to avoid rereading all historical bodies on every execution creation; full validation remains at startup and parent-chain reads. Strict clippy requested Boolean-expression simplification; checks reran after an equivalent fix. No lint suppression or hook skipping.

Logs: `/private/tmp/tinker-context-checks-20261110`; Cargo cache: `/private/tmp/tinker-rust-target-20261110`. Previous temporary worktrees/caches no longer existed; new isolated directories were created without cleaning user files. The original main workspace already contained uncommitted changes; implementation did not occur there.

<a id="未验证与后续"></a>

## Unverified Areas and Follow-Up

The local HTTP service and real handler use Tauri MockRuntime and cannot replace native WebView/UI acceptance. Real model compatibility, TLS handshakes, account authentication, charges, tools, image generation, projects, and full product replacement are outside this round. A future real call requires authorization specifying service, model, one-time credential purpose, synthetic request, and spending cap.

Exact Started append/sync, directory sync, and file fsync failures were not injected; no physical power-loss experiment occurred. Actual header permission failure, delta failure, corruption/truncation recovery, and control-flow review do not establish all I/O failure windows. No separate multi-turn panic scenario was run; it uses the tested shared catch_unwind path. Old binaries were not run; compatibility evidence consists of original v1 file/DTO shapes and simulated downgraded mixed-write tests. Other OSs, model token capacity, and whole-machine memory gains remain untested; full-library startup scanning still has no global run-count budget.

Byte limits are not model-token/spending limits. No automatic summarization or trimming, model configuration UI, default-enabled HTTP provider, or full product UI reproduction. Old providerKind/scenario remain compatibility metadata and must not be displayed as actual network provenance.

Preferred rollback: stop using the added continuation command. Reverting the entire batch does not delete existing experimental history or affect the original production app. Retain the new subdirectory's data for newer readers; do not resolve conflicts by deleting data.

<a id="交付约束"></a>

## Delivery Constraints

Final diff review and credential-pattern scanning found no actual credentials. Production `apps/electron`, `packages`, `bun.lock`, both prototype frontends, and old prototype source have zero differences. Normal pre-commit automatically increments root and Rust Lab package patch versions; these are metadata-only changes without new production dependencies. README, CLAUDE, existing research features, and licenses remain unchanged.

Source, specifications, audits, and inventories are delivered on the same safe branch using normal commit/push hooks and a Draft PR only, without merge or deployment. The final delivery reply and PR review comments govern remote SHA, PR, and CI results; absent checks/status/Actions records must not be described as CI passing.
