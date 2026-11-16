<a id="m2a原正式-react-ui-的-taurirust-独立宿主"></a>

# M2A: Independent Tauri/Rust Host for the Original Production React UI

Status: In progress. Baseline: 63fdde632dcb625df1f5736d9f7ea5270f5de547. Related: Merged PR #21. Domain sources of truth: CONTEXT.md and actual source.

<a id="目标与全局约束"></a>

## Goals and Global Constraints

The user requested faster technical migration while reusing the current production UI and interactions. This batch uses the same apps/electron/src/renderer/main.tsx, App, CSS, and Jotai state to deliver an independent Tauri test host calling Rust DesktopRuntime directly, without embedding the Electron/Node backend.

- Preserve the production Electron/SDK default chain, old Lab, installed user app, and real data.
- Use only newly marked isolated roots, synthetic configuration, and numeric-loopback mock services; no real credential/session reads, paid calls, or Applications installation.
- Preserve existing API parameters, return values, synchronous behavior, and unsubscribe semantics. Explicitly reject unimplemented capabilities; no empty-success Proxy.
- A synchronous settings return of true must represent confirmed persistence. Closing must save tab state from the final 500ms before debounce; storage failure must not silently close the window.
- Separate Rust platform state from the session journal: safe roots, schemas, size limits, atomic persistence, error redaction. Renderer must not control roots/endpoints/keys.
- New identifier, separate app bundle, minimal window/IPC permissions; no wildcard files/command execution or arbitrary external navigation.
- New user-facing copy uses en/zh i18n; no layout, style, or production-default changes. Do not modify README.md/CLAUDE.md; explanations belong in this spec and report.
- One implementation agent writes serially, with independent review of the same task. No user-file cleanup or overwriting other worktrees. Normal commits, push, and Draft PR on a safe branch, without merge, deployment, or installation.

<a id="决策与能力边界"></a>

## Decisions and Capability Boundaries

Choose pure preload domain factories with transport injection, reusing the full API shape. The Electron adapter retains ipcRenderer/contextBridge. Tauri initializes actual host snapshots and the event bridge before dynamically importing the original renderer. Adapt original static Electron Sentry dependencies and CSP in the separate Tauri build, without affecting Electron builds.

The Tauri native Rust platform service supplies startup/session APIs for settings, theme/language, synthetic profiles, workspaces, onboarding, and tabs. Session sending/context/streaming/cancellation/failure/restart continue using existing DesktopRuntime. Unavailable attachments, images, OAuth, general tools, etc. cannot falsely succeed.

Current provider sink/context/journal support text only, with no typed tool events, call/result, permission coordinator, or runner. Actual M2B tool loops depend on those extensions and belong in a later batch, prioritizing read-only synthetic-file tools; deny/cancel/expired/wrong-run must yield zero execution. Standalone permission cards or toy buttons do not count as tool migration.

<a id="实现计划"></a>

## Implementation Plan

<a id="task-1纯-api-工厂与-electron-适配"></a>

### Task 1: Pure API Factory and Electron Adapter

Scope: apps/electron/src/preload/{transport.ts,api.ts,helpers.ts,index.ts,domains/*} and corresponding tests.
Replace Electron dependencies in six domains with explicit transport injection; export createDesktopApi(transport), returning the same ElectronAPI. Transport supports invoke, readSync, subscribe, getPathForFile. Put the Electron adapter in the sole Electron entry, preserving existing method channels/parameters/return values/synchronous execution/unsubscribe. Pure api/domain/helpers must not runtime-import Electron/Node.

Write behavioral tests first, using a recording transport to verify all API method shapes, representative four-layer parameters, event unsubscribe, synchronous settings/theme/chrome/telemetry, and webUtils path semantics, including zero arguments and namespaces. Preserve original Electron build/typecheck. Do not implement Tauri transport or Rust platform; do not change production UI.

<a id="task-2rust-平台状态与可信启动边界"></a>

### Task 2: Rust Platform State and Trusted Startup Boundary

Add formal_platform and a trusted startup boundary; keep shared DTOs thin. Fixed-allowlist platform services share the strictly marked isolated root with DesktopRuntime. Native host wiring comes next; old Lab remains None. Provide fixed-allowlist platform invoke/bootstrap, typed bounded mutations, versioned snapshots, revision, and persistence ack. Settings, user/workspace, and initial-theme sources of truth must recover after restart. Write failures must not update caches early. Window-close tokens validate matching renderer flush; timeout/failure keeps the window open.

Behavioral tests first: root/marker/schema/unknown fields/size, concurrent revisions, duplicate mutations, atomic failures, and restart. Test handlers, not just helpers. Never access real user paths. Main binary production defaults and Lab remain unchanged.

<a id="task-3原生会话适配与独立宿主"></a>

### Task 3: Native Session Adapter and Independent Host

Add FormalAgentHost owning session active/polling/generation, reusing DesktopRuntime and existing projection contracts; page refresh must not lose execution facts. Fix IPC/session/profile mappings and parameter boundaries. GET_SDK_MESSAGES recovery must proactively provide complete text_snapshot, requestId, and subsequent deltas; late responses cannot enter other requests. The host owns cancellation, exit, and disconnection lifecycle. Add a separate binary/config: FormalHost owns the sole Arc<DesktopRuntime>; old Lab DesktopHostState(None) and default commands remain. New binary registers only formal commands constrained by actor/generation/close boundaries, without exposing old Lab generic commands that could bypass them.

Embed a controlled Rust numeric-loopback HTTP/SSE mock in the preview host, with stable test-channel/model labels and logical configRevision; random ports serve only host transport location. This fixture is not a core provider and accesses no real service. The separate app requires no Node/Electron/devserver. First test the host's actual service facade, pagination/refresh/duplicates/cancellation/failure/error projection; reject unsupported capabilities explicitly.

<a id="task-4同-renderer-的-tauri-transport-与生命周期"></a>

### Task 4: Same-renderer Tauri Transport and Lifecycle

Separate Vite/entry/transport, restricted event bridge, native session event subscriptions and Rust projection/polling contract, platform cache, and close participant. Reuse M1 pure logic to keep Node routers out of WebView. Register events before mounting. Synchronous APIs read confirmed cache; updateSettingsSync must not fake acknowledgment. Production main.tsx adds only a nonvisual, explicitly Tauri-gated close-flush participant; original Electron path remains.

Wire channels/models, creation/lists/history, sending/multiturn/streaming/stop/errors/restart through the same DTO; late responses belong only to their requestId. Separate-build CSP supports required Tauri IPC; Sentry uses a controlled adapter without real networking. Test protocol mapping, parameter failures, cancellation, reordering, latest-atom closing, and failure keeping the window open.

<a id="task-5可运行包原生验收与最终守门"></a>

### Task 5: Runnable Bundle, Native Acceptance, and Final Gates

Build an .app with an independent identifier, without writing Applications. No Node/Electron/devserver dependencies; if a mock provider is needed, deliver an explicit launcher and synthetic service, with explicit failure when absent. Native acceptance may drive WKWebView inside an owned QA binary and record screenshots/synthetic HTTP/journal, without arbitrary eval exposed to the product renderer or bypassing system permissions.

Cover startup/exit, two models/effort, multiturn Unicode, streaming, cancellation/duplicates, failed drafts/partial content, refresh/close/reopen, Chinese/English themes, and final debounce-window persistence. Distinguish DOM automation from system-mouse testing; compare screenshots to original production UI without promising cross-engine pixel equivalence.

Final Rust fmt/test/clippy, frontend and repository-wide typecheck/Bun/lint, Electron build, Tauri build, independent review/simplify, sensitive-information and production-default diff review. Fetch/merge latest main before safe commit/push/Draft PR; verify full head/checks/status/Actions. No records does not mean CI passed.

<a id="回滚与交付"></a>

## Rollback and Delivery

Exiting the independent test app returns to original Electron; original data was never migrated. Revert batch source commit by commit; clean new isolated data only when explicitly identified and separately authorized for deletion. Report actual tests, unrun scope, source SHA, app path/hash, signing/notarization status, GitHub PR/CI, and unmigrated features. Do not claim complete-product/real-service/all-UI-behavior acceptance.

<a id="task4-审查修复关闭与初始化失败契约"></a>

## Task4 Review Fixes: Close and Initialization-failure Contracts

- Any tabs/settings hydration failure blocks further automatic persistence by that document; late StrictMode success cannot clear the failure barrier. Closing/refreshing still requires successful recovery and latest Jotai flush.
- attach/detach/recovery attach share a short control queue that advances after acknowledgment. Sample observed watermark when attach is actually sent; history waits for attach acknowledgment, dispose queues final detach. Long SEND does not enter this queue.
- During bootstrap, the native environment retains latest revision/sequence and replays after baseline arrives; entry's first screen reads the same updated cache.
- `closeReady(generation, closeToken, committedRevision)` performs only irreversible cancel/drain/join and saves a native receipt; it does not close the window. Same-token retries return pending/final results without duplicate cleanup. Preparation rejection can recover after confirmed `abortClose`; abort acknowledgment for the same expired/cancelled token is idempotent. Irreversible cancellation failure uses `closeFailed`, with host/mock still reclaimed in the background and failed receipt retained.
- Only confirmed success for the same generation/token/revision permits the narrow `closeWindow`; this final authorization has no renderer deadline. After closeReady wait timeout, the renderer stays frozen and late results cannot automatically close it. Another native close or Quit request may query the same token; pending/failure keeps the window open, while success requires renewed explicit closeWindow authorization. Reload does not execute during unknown commit state; a reclaimed host is not falsely restored as usable.
- Protocol fault injection and Tauri mock-runtime/actual-actor tests do not equal native WKWebView UI acceptance; Task5 must separately validate window closing, menus, and interactions.

<a id="task5原生-qa-隔离与构建配置校验"></a>

## Task5: Native QA Isolation and Build Configuration Validation

Production and QA binaries share `formal_launch`, explicitly passing different identifiers; reject crossed configuration before creating Builder, windows, or data. Tauri 2.10 context macros load default files by configuration directory, so both direct-Cargo build scripts explicitly set TAURI_CONFIG rather than trusting the macro filename argument.

`formal-native-qa` is a macOS-only optional feature, with separate `tinker-formal-native-qa` binary and `com.tinker.formal-native-qa` identifier. Only the QA entry supplies the ready callback; the ordinary entry never starts a controller even under all-features compilation. Normal delivery builds disable this feature. Public WKWebView evaluateJavaScript/takeSnapshot serve synthetic acceptance of this process's original React renderer only, with no new renderer IPC or network control endpoint.

QA evidence must use canonical `/private/tmp/tinker-tauri-checks-*/native-qa/<batch>`. Original synthetic profiles remain subject to TrustedRoot's separate marker checks. command.json/result-N.json in the test directory form a bounded local acceptance protocol (max 256 actions, 30 minutes); eval, snapshot, records, focus, fullscreen, window, reload, close affect only the owned main window. Screenshots are fixed snapshot-N.png, with no arbitrary output paths. Use `scripts/native-qa-command.py` to submit actions; build-native-qa.ts builds QA only, and QA binaries must not be delivered as ordinary bundles.

This round uses macOS 26.5.1 arm64, actual editor input, Send/Stop, and model/effort/settings DOM controls, alongside native fullscreen/CloseRequested, owned HTTP metadata, and journal/process restart acceptance. DOM events are not system-mouse automation; cross-engine pixel equivalence is not promised. Acceptance reports must distinguish passed and unrun additional fault injection, >128 backlog, and unmigrated real-product capabilities.

<a id="task5-review-补证"></a>

### Task5 Review Supplementary Evidence

QA now uses separate `native-qa-dist` and `vite.native-qa.config.ts`; its entry awaits the formal entry before loading a limited atom probe against the same default Jotai store. Original App, CSS, and ordinary formal-dist remain unchanged. The current production UI does not mount SidebarProjectFilesSection, so projectFiles 400ms exit-persistence acceptance explicitly uses white-box atom injection, without claiming a real clickable panel toggle.

LaunchProbe is passed explicitly only by the QA binary: before document initialization, install bounded console/error/rejection/CSP observers; the native event pump can temporarily hold at most 1024 actual EventEnvelope instances and count unread text_delta before releasing them to the same WebView. This count sits at native delivery, without inferring unread backlog from total chunks or internal actor queue saturation. Fixed old-generation/old-run envelopes use different markers to verify filtering. Menu Quit invokes the real menu item through public performActionForItemAtIndex on its own NSApplication/NSMenu, rather than treating a direct public close action as menu validation.

QA result-N.json now uses same-directory create_new temporary files, complete write/sync, and atomic rename publication; failure produces explicit stderr diagnostics and stops the driver. Tests confirm failures preserve existing complete receipts. Early observations record Zod allowsEval capability probing rejected by existing CSP and caught as false, plus explicit unsupported unmigrated paper/feedback reads; CSP is not relaxed and errors are not hidden with fake empty data. Append all supplementary evidence to the Task5 report, preserving prior unrun history.
