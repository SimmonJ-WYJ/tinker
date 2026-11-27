# Native conversation forks

This document records the original text-only milestone in PR #47. For the current behavior with managed images and PDF citations, see [Project conversations with media in native forks](native-project-media-forks.md).

The existing assistant-message menu opens a new conversation at a selected completed text reply. The native host must derive the copied prefix from the named source session and reply, retain its project, and keep both histories independently readable after restart. Creating, opening and restoring a fork issue no provider requests. The first explicit follow-up must include the prefix and exclude later source turns.

The native host may copy completed text turns with project document citations. It must reject unsupported prefixes (including tool or image results and imported attachments) before publishing any session. It must not copy working directories, external files, provider secrets, active requests, retry permissions or pending tool approvals. Existing Electron fork and rewind stay on their own paths. Use the current native history seed and atomic catalog publication so branches are self-contained after deleting or archiving the source.

## Runtime and limits

The React message menu uses the existing `forkAgentSession` preload API. The Tauri host accepts only a source session ID and an assistant message UUID. It compares the visible history through that UUID with completed Rust turns. A branch inherits the effective workspace and channel profile, gets its own message IDs, and stores a passive history seed using the existing portable-session journal entry. Copied turns use the historical model label `portable-history`. Document locator metadata remains attached to its original workspace; copied text does not include the selected document excerpt.

PR #47 initially supported ordinary completed native text turns. The subsequent [project media fork milestone](native-project-media-forks.md) adds managed images and validates project citations. The following limits describe the original text-only implementation. Earlier tool, image, queued, imported-message, stopped or failed entries block the fork rather than silently losing part of its history. Later entries are outside the cutoff. A copied prefix must leave room for a nonempty follow-up under the existing context limits. Forking does not rewind files, replay tools or clone active tasks.

A per-anchor slot and a private metadata intent allow a retry to reuse a partly staged branch. Publication makes one catalog journal entry. A later deliberate fork from the same reply creates another independent branch.

## Reproduction and evidence

1. Build the dedicated Channels Native QA app with `bun apps/tinker-rust/scripts/build-channels-native-qa.ts`. Run `python3 apps/tinker-rust/scripts/native-conversation-fork-qa.py "/private/tmp/.../Tinker Channels Native QA.app"` against the resulting bundle.
2. The harness sends two text turns through the ordinary composer, exits, reopens the source and chooses **Fork from here** from the first reply's menu. It verifies the source still has both turns. From the fork it sends a single follow-up. The loopback service returns success only if the complete message array matches the first user turn, its assistant reply and the new follow-up in order.
3. The application exits again. A third process reopens the active fork. Both histories, their separate IDs and the request counts must match their pre-exit values. Source, fork and mock credentials all live in an isolated QA profile.

The macOS arm64 run used three distinct processes and the packaged React renderer inside WKWebView. Provider A saw two discovery GETs and three explicit chat POSTs in total. Provider B saw zero. Creating and reopening the fork caused no additional requests. Rust tests covered a missing anchor, mixed prefixes, pending metadata reuse and a global conversation with no workspace. The final Rust suite passed 343 tests with two ignored helper entry points. No paid service or real user profile was exercised.

## Rollback

Leave the preview and open the existing Electron app, or revert this change before building another preview. The source conversation and its files are preserved. New forks use the pre-existing native portable-history format; keep the preview data directory if those branches are needed later. This change does not import new native branches back into Electron.
