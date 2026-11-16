<a id="rust执行器provider边界解耦"></a>

# Decoupling the Rust Executor Provider Boundary

Status: implemented with automated validation and independent review complete; additional native UI acceptance remains blocked. Baseline 80a0043aef0e37930a395c6666e5129f3942ffdf, separate branch refactor/rust-provider-boundary.

<a id="范围"></a>

## Scope

RunProvider no longer accepts OfflineScenario, and the controller must not directly create/execute OfflineFixture. The host adapter binds existing success/failure/slow options to a provider before injecting it into the same executor, preserving start_lab_run/cancel_lab_run/read_lab_run and existing UI/DTO/old-log reading, deduplication, cancellation, failure saving, and restart recovery. If OfflineScenario remains as compatibility metadata for old persistence, it must no longer serve as a provider execution parameter or determine controller behavior. Do not add idle forwarding layers merely to hide types.

New behavior: if any injected trusted provider returns a controlled error or panics, the executor must reach an explicit terminal state and preserve committed chunks rather than remain running forever; late provider results after cancellation must not rewrite an old run, and drop/reopen must not automatically call the provider. The default and only provider selectable via IPC remains the offline fixture; the frontend cannot pass provider implementations, URLs, or credentials.

<a id="验收"></a>

## Acceptance

Write failing behavioral tests first, then implement the minimal interface; at least two different injected providers must pass through the real controller, verifying chunked output, errors and panics, duplicate requests, cancellation/late chunks, reopening without execution, and disk-write failures. Existing Tauri handler tests prove old commands continue through the injected provider chain; IPC/React protocols remain unchanged, production Electron/packages/bun.lock have zero diff, and there are no new dependencies. Run Rust fmt/test/clippy, frontend and repository-wide type/tests/lint/build checks and independent review; after validation, push a safe branch through normal hooks and open only a Draft PR.

Independent blocker for native UI acceptance: both desktop tool getState attempts returned failed to start Node runtime: No such file or directory, before entering the new app permission flow. Success/cancellation/failure/restart/bilingual themes/close-and-return remain unaccepted and are not replaced by automated tests; do not retry CUA or bypass it with another tool.

Rollback: revert this batch of commits to restore the previous fixture executor without deleting experimental data. No real network, models, keys, or paid calls, and no installation/deployment. Reuse existing Cargo caches; stop new builds below 4GiB disk space and do not clean user files. Do not operate on old worktrees with 47/14 existing changes or read timeouts.

Validation and rollback: [report](../reports/2026-11-09-provider-boundary-validation.md).
