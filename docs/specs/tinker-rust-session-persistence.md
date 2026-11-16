<a id="rust-会话草稿持久化基础"></a>

# Rust Session Draft Persistence Foundation

Status: isolated experimental implementation, not connected to production sessions. Related issue / PR: none. Domain source of truth: this file and src-tauri/src/session_store.rs.

<a id="本阶段范围"></a>

## Scope of This Phase

Continue on existing apps/tinker-rust, retaining the com.tinker.rustlab identifier and old snapshot, save_draft, and submit_draft commands. Persist only the draft for the default session draft; this is not a complete session-history migration. Retain the five behavioral tests of the original in-memory domain. No models, channels, keys, projects, message streams, reconnection, rewind, or Electron data are connected.

<a id="数据与接口"></a>

## Data and Interfaces

Store draft.json, draft.bak, and store.lock under Tauri app_local_data_dir()/session-store-v1. The backend determines paths; the frontend cannot supply them. JSON schemaVersion=1; fields are sessionId, revision, draft. IPC protocolVersion remains 1, retaining old architecture/draft and adding sessionId, revision, recoveryRequired, storageKind. The React decoder accepts old v1 and explicitly labels it memory; reject writes for unknown protocols.

A single draft is limited to 65536 UTF-8 bytes; the file-read limit is 524288 bytes to accommodate JSON control-character escaping. Allow only restricted ASCII session IDs, and never execute user input. New Unix directories use 0700 and files 0600; reject direct symbolic links. This is not a security isolation mechanism against malicious concurrent file replacement by the same user.

Writes: process-level file lock + in-process mutex + expected revision; first write the previous-version backup, then write a temporary file in the same directory, sync_all, rename, and sync the Unix directory. Sync failures report an uncertain result, requiring retained input and a reread. Temporary files are not automatically treated as committed records. Only explicit save or attempted send writes data; autosave is not yet available.

When the primary file is corrupt, display only an available backup and disable saving. recover_draft(expectedRevision) explicitly preserves the corrupt original before restoring the backup. The backup may be one revision behind, which the UI clearly states. Future schemas, oversized files, unavailable backups, and abnormal paths all stop overwriting rather than becoming empty drafts. Originals and backups are never automatically deleted.

<a id="实施与兼容边界"></a>

## Implementation and Compatibility Boundaries

1. Back up the existing skeleton and uncommitted Electron work; test in isolated temporary directories.
2. Rust versioned storage, failure tests, and concurrency tests.
3. Old-command compatibility adapters, recoverable error codes, and Tauri independent-path wiring.
4. React contract validation, English/Chinese copy, and explicit recovery flow.
5. After checks pass, update only the experimental directory; no installation, production launch, or real-data migration.

Preserve old submit semantics: save first, then return emptyInput or modelNotMigrated, never claiming the request was sent. Return save errors first without pretending success. Old interfaces may ignore added response fields; the new UI can recognize the old in-memory backend. This is compatibility only at the draft layer, not grounds for claiming full Electron session compatibility.

<a id="验收与回滚"></a>

## Acceptance and Rollback

Rust tests cover reopening reads, Unicode, size/ID limits, atomic backup failures, corrupt primary/backup files, future schemas, orphan temporary files, revision conflicts, thread concurrency, process exits, path symbolic links, and Unix permission failures. Adapters retain old errors/fields and verify that input is still saved when models are not migrated. TS validates old/new/invalid contracts; browser synthetic IPC verifies English/Chinese and recovery branches.

Original experimental code and source backups from before this integration remain in the local diagnostics directory of the Tinker-A project session, outside this repository. Rollback restores only the Rust files listed in this batch and moves newly added files away; never reset the entire repository. The old installed version was never replaced and remains usable. Experimental data stays in place; the rolled-back in-memory version neither reads nor deletes it. Old and new experimental processes must not run together; lock acquisition failure in a new process displays an error.

Not accepted: complete real native-window end-to-end flow, physical power loss/disk corruption, Windows/Linux file replacement and directory persistence, production-data import, all original features, or whole-machine memory benefits. Local tests cannot support those conclusions. Next, implement the message/event model and interruptible execution state, beginning with synthetic session replay acceptance.
