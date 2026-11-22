# Find and reopen a conversation by message content

Users of the original workspace can open Search, find a phrase from a conversation, and return to its source. The Rust preview currently persists turns and runs but does not answer the existing `agent:search-messages` preload request. The renderer also discards the message identity when opening a result. This milestone connects that workflow to the isolated Rust session store.

## Scope

- Reuse the original Search dialog, conversation tabs, history restoration, and existing IPC result fields. A result refers to the durable session and message. A title-only hit retains its existing behavior.
- Search user and assistant text from visible conversations, including archived sessions. Exclude deleted sessions, credentials, hidden tool arguments and raw protocol logs. Operate only on the profile already opened by the preview.
- Bound the amount of work and the results. Search must not wait on a provider, acquire an execution credential, start a turn or monopolize the actor that handles Stop and stream delivery.
- Return snippet positions suitable for JavaScript slicing. Preserve text and message identity through restart and when switching between sessions. A later search or navigation must supersede an earlier one.
- Keep Electron as the production default. This branch builds from `5c9a24d` and is independent of the diagnostic changes in PR #29.

## Acceptance

Use a disposable workspace and the local mock provider. Send a distinctive phrase in the body of a turn, finish or stop the turn, and reopen the profile. Open Search and use a body-only query. Follow the result to the expected session and message. Verify that archived hits are identifiable, deleted content stays absent, and that search alone produces no provider traffic. Exercise Unicode offsets, short queries, result limits, and an empty workspace. Run the Rust host and renderer contract checks independently of the native window check.

## Rollback

Revert the feature commit and rebuild the isolated preview. The migration adds no new requirement to read existing session data. No action on production channels, credentials, or installed applications is part of rollback.

## Reproduce with the built-in provider

1. Build the native-QA frontend with `apps/electron/vite.native-qa.config.ts`. Build `tinker-formal-native-qa` with the matching `tauri.qa.conf.json` as `TAURI_CONFIG` and the `formal-native-qa` feature. The repository's `apps/tinker-rust/scripts/build-native-qa.ts` performs both steps.
2. Launch that binary with a new `TINKER_FORMAL_PREVIEW_ROOT` directly below the system temporary directory, named `tinker-tauri-formal-preview-<unique suffix>`. Set `TINKER_NATIVE_QA_DIR` to a private directory matching the constraints in `formal_native_qa.rs`. Use only synthetic text and the built-in Local Mock channel. Give the session a title that does not contain the search phrase.
3. Send a first turn containing a distinctive phrase, wait for its reply, quit and wait for the process to exit. Relaunch the same binary and profile with a fresh QA evidence directory.
4. In Search, enter the phrase and open the content hit. Confirm the matching message or rendered message group receives focus and stays in view. Compare the QA driver's `records` before and after navigation. Send a follow-up in that session and check the new mock request includes the earlier user/assistant pair.
5. Repeat with an archived session. Delete only a disposable test session and confirm its messages disappear from a subsequent search. Run `cargo test --offline --features formal-native-qa -- --test-threads=1` for the host contract cases.

A damaged journal or exceeded scan deadline yields a search error. The search does not silently label a partial scan as a complete set of matches. It searches rendered text, not tool inputs or hidden attachment metadata. A hit in a grouped turn locates that group. Substring-level scrolling inside a long message is outside this increment.

## Native window evidence

On macOS arm64, a formal native QA process (PID 14074) created a synthetic conversation and completed a text turn through the local HTTP provider. The normal Quit action ended the process. PID 14085 opened the same marked root. The Search dialog found the phrase “orchard thread” in the body of a message in the session “Synthetic review.” Opening the result focused the user row `search-native-regression-user`. Focus and the location highlight were still on that row after the composer's deferred autofocus interval. The mock provider received zero requests on search and navigation. One explicit follow-up then contained two user messages and the previous assistant reply. Both processes exited normally.

[Content-only search result](assets/native-conversation-search/content-hit.png) · [Focused message in the restored conversation](assets/native-conversation-search/restored-message.png)

The native run used the repository's instrumented WKWebView and local mock. It exercised the full-width window. Compact drawer behavior, archived hits and queued identity collisions have separate regression tests. This milestone did not run a real model, migrate legacy SDK logs or measure whole-application memory.
