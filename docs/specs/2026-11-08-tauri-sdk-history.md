<a id="tauri-sdk历史只读接线实施计划"></a>

# Tauri SDK History Read-Only Wiring Implementation Plan

Status: the user authorized the next phase after merging PR #7. Baseline main fdf92f3bb758d04c6f469fe8915d62e41a15f36b. Domain sources of truth: Electron appendSDKMessages/getAgentSessionSDKMessages, shared SDKMessage types, and the previous phase's read-only paginator.

<a id="范围和契约"></a>

## Scope and Contract

Retain the old read_history interface and all draft commands, reusing line/page budgets to add read_sdk_history. Raw SDK and legacy records may be interleaved; preserve every original JSON field without losing tool blocks, image references, parent runs, uuids, or unknown future messages. Extract only text blocks for safe text display; do not execute tools or render raw HTML.

Return SDKHistoryPage: camelCase JSON `{protocolVersion:1,entries:[{lineNumber,kind,text,uuid,raw}],nextBeforeLine,incompleteTail}`. uuid is string or null; raw is the full JSON object. Retain source-line cursors, the 1MiB per-line limit, at most 256 entries per page, and the 8MiB source-line budget. Default to 64 entries. SDK user/assistant records validate basic message/content shapes; future types remain opaque. Old AgentMessage validation stays strict.

Add a real Tauri command read_session_history(sessionId,beforeLine?,limit?), reading only Rust Lab app_local_data_dir()/history-v1/<id>.jsonl; the frontend cannot supply paths. IDs use restricted ASCII 1..64; reject symbolic links/directories/out-of-bounds paths, without creating or writing history directories/files. Read-only work runs in spawn_blocking with a separate nonwaiting gate to avoid blocking UI or multiple decoding. Errors return fixed codes without raw logs/absolute paths.

The experimental React UI provides a separate collapsible history reader, session ID, read/older/latest-page controls, and tail-line notices, with English/Chinese using the existing useT dictionary. Retain only one page at a time; failures preserve the current page, and selection changes or races must not mix sessions. All display is safe text, with no image-file reading or model execution.

Production does not automatically scan or import Electron data. Acceptance uses only synthetic SDK fixtures built from source-code structures and a separate QA directory; real history requires later user authorization to export a copy. Working API wiring does not mean the original app's history has migrated.

<a id="用户补充的生产不变约束"></a>

## Additional User Constraint: Production Must Remain Unchanged

The user's request, translated into English: “After these changes, make sure the interface, features, and UI have no changes, right?” Production Electron, shared/core/ui, and existing dependency lockfiles must remain byte-identical to baseline in this phase. The new reader belongs only to isolated Rust Lab/QA and must not enter production entry points, layouts, styles, or interactions. Do not update the installed app; distinguish source-scope checks, existing-feature regressions, and real-device evidence, without guaranteeing untested full flows.

<a id="任务"></a>

## Tasks

1. SDK parsing: add failing-first tests and TS shared fixtures, reuse the bounded scanner, and preserve compatibility with the old simplified reader and benchmark tools.
2. Tauri wiring: read-only history service, fixed error codes, separate command module and registration, isolated temporary-file tests, and mock-runtime tests of the real Tauri Invoke handler chain.
3. Frontend reader: strict response decoding, pagination and error/race tests, bilingual read-only UI, with draft behavior unchanged.
4. Acceptance and rollback: fmt/test/clippy, frontend typecheck/build, repository-wide test/Electron build. Where possible, validate the native bridge in a local QA app with a separate identifier, using synthetic files only, without launching or writing to current Tinker. Stop starting new implementation/long operations at Beijing time 02:00 (UTC18:00).
5. Review and Draft PR: protect current fingerprints of the original 89 uncommitted files; include no real logs, keys, or build artifacts. After verifying no conflicts, commit and push a separate branch through normal hooks; Draft only, no merge or installation, and verify remote SHA and CI.

<a id="回滚"></a>

## Rollback

The current installation and Electron remain unchanged. Removing the new history command registration, separate state, and frontend panel restores the original draft Rust Lab; restoring the old read_history interface requires no data changes. History is read-only, with no file writeback/repair/migration. Reverting this PR does not delete independent history copies. The source-level read-only boundary is not a complete sandbox against active concurrent file replacement by the same OS user.
