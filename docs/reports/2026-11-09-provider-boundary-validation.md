<a id="provider边界解耦验证与原生补验状态"></a>

# Provider Boundary Decoupling Validation and Native Follow-up Status

Baseline main: 80a0043aef0e37930a395c6666e5129f3942ffdf. Branch refactor/rust-provider-boundary, worktree /private/tmp/tinker-provider-boundary-20261109. Assess the new phase separately from the previous phase's outstanding native validation.

<a id="一原生补验仍受阻"></a>

## I. Native Follow-up Remains Blocked

The desktop tool getState failed before entering the app permission flow: `failed to start Node runtime: No such file or directory (os error 2)`. It failed identically after one reset through the public js_reset, then work stopped. No new getApp permission request was made; the authorized single app-access retry was not consumed, and no request awaits approval. No alternative tool bypass, desktop automation runtime installation or modification, or QA/user app launch.

Actual native-window acceptance for success/streaming events/cancellation and duplicates/failure preservation/restart recovery/Chinese-English themes/close and return remains unperformed. This round cannot determine whether the display is off or the desktop locked and makes no inference about password status. No temporary keepalive process exists. The automated checks below cannot substitute for actual WebView acceptance.

<a id="二本阶段实现"></a>

## II. Implementation in This Phase

- RunProvider::execute accepts only input, a cancellation token, and an output sink, not OfflineScenario.
- OfflineFixture is configured by the host with the original options and injected as Arc<dyn RunProvider>; the controller no longer constructs fixtures or selects execution behavior by scenario.
- RunHostState still binds only the offline fixture by default. Trusted Rust test hosts can inject other implementations; IPC cannot pass implementations, URLs, or credentials. The actual start_lab_run call connects to injection, rather than merely adding an isolated trait.
- scenario/providerKind remain compatibility metadata for the old DTO, logs, and deduplication; they are not yet a generic provider identity protocol. This round changes no old schema, UI, or public commands and does not claim real models can be attached directly.
- Provider panics map to the fixed providerPanicked failed terminal state, preserving committed fragments; payloads never enter JSONL/snapshot/IPC. Rust's default stderr panic hook remains, with no global hook modification.
- Injected providers must honor cooperative cancellation and output sink errors; the existing synchronous worker's Drop/join does not forcibly terminate third-party code that never returns. This round does not claim to solve that boundary.

<a id="三本次新跑的证据"></a>

## III. Fresh Evidence from This Run

| Check | Result |
| --- | --- |
| Full Rust tests | 96 passed, 0 failed; 5 controller injection/failure tests and 1 actual-handler test added over baseline |
| Actual Tauri handler | Different HostEcho/HostPanic implementations enter the same executor through the old DTO; scenario labels do not determine behavior, and error/panic fragments remain readable |
| Controller regressions | Fragmented output, controlled errors, panic, duplicate requests, late delta/panic after cancel, next-run isolation, no execution on drop/reopen, disk-write failure |
| Rust quality | fmt --check and clippy --all-targets -D warnings passed |
| Repository-wide types | 6 workspaces passed |
| Repository-wide Bun | 3376 passed, 4 skipped, 0 failed, 380 files; the 4 skips are existing package-local rg binary integration tests, not new cases |
| Frontend and lint | Lab Vite build and Lab checks reusing existing ESLint rules passed; frontend source unchanged |
| Native compilation | Offline release cargo tauri build --no-bundle passed; compiled without launching, and the old QA .app was not replaced |
| Independent review | Both spec and quality passed, with no blocking regressions; cooperative cancellation and metadata limitations reviewed |
| Electron build | This round's electron:build passed; production source unchanged |

First observed failing compilation for the missing new trait/injection interface, then implemented and observed passing tests; other new tests verify preserved semantics, without claiming an individual red/green cycle for each. Original implementation logs and Root's fresh logs are in /private/tmp/tinker-provider-checks-20261109; implementer-report.md and reviewer-report.md are in the same directory.

<a id="四保护发布与回滚"></a>

## IV. Protection, Publication, and Rollback

Electron, packages, bun.lock, Cargo.lock, Rust Lab frontend, and storage implementation have zero differences from baseline; changes cover only Rust executor/provider/host wiring, tests, and this round's documentation. Normal hooks update package versions. Older worktrees with 47 and 14 existing differences were untouched; source status remains unknown after a read timeout. No real sessions, keys, models, network requests, fees, installation, or deployment.

Reused the existing Cargo cache, created no duplicate large caches, observed approximately 12GiB free, and removed no user files. Unaccepted native UI remains a publication limitation; after automated checks and independent review pass, this is suitable as a Draft for review, without merging or replacing the production runtime. Remote SHA/CI status must reflect final actual verification; zero records does not mean green CI.

Reverting this batch's commits restores the old fixture executor without deleting data or migrating schema. The old draft submit_draft modelNotMigrated, save/recover, and read-only history API remain. The current provider boundary completes only wiring that requires no real calls; subsequent network protocols, real model authentication, and fees remain unimplemented.
