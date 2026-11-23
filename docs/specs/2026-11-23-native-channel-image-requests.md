# Native channel-bound text and image requests

Status: implemented in the isolated Channels Preview. Related work: PR #36 and the native channels preview. Domain terms: [CONTEXT.md](../../CONTEXT.md).

## Scope

The existing React workbench runs inside the isolated Tauri Channels Preview. A user saves a channel, discovers and selects a compatible model, then explicitly sends text, requests an image or edits a selected source. Rust owns credential binding, dispatch, local cancellation, the task receipt and restart recovery. The default Electron entry and existing mock-only preview remain available.

Use the existing OpenAI-compatible channel for image generation and multipart PNG edits. Keep the existing OpenAI-compatible and Anthropic text paths. A retry refers to the original channel, model and connection revision. Changing the selected channel must not redirect a retry. Deleting, disabling or replacing the original route blocks a fresh retry. An already committed request may be inspected without accessing the vault or the network. Only non-secret routing metadata may be persisted with new image attempts. Discovery, text and image failures expose bounded diagnostic codes.

## Acceptance

Use synthetic credentials and separate locally owned endpoints. Exercise both channels independently, including discovery, selection, streaming, successful generation and editing, authentication and rate limits, deadline expiry, stopping, duplicate dispatch, restart and recovery. Verify accepted requests and retained image references. Inspect the captured test artifacts for secret disclosure. Keep real credentials, services, user profiles, upstream billing and production deployment outside this run.

## Request and recovery boundary

- The shared renderer resolves the selected **channel and model together** from the saved catalog. Entries from older catalogs without a capability retain their text behavior. Explicit discovery metadata or a manual choice can distinguish text, generation, and editing. Text streaming uses the existing OpenAI-compatible and Anthropic transports. Image requests require an enabled OpenAI-compatible image model and a supported action.
- The credentialed Tauri host checks the immutable connection revision and acquires the bound credential off the actor thread. It checks the route again before admission. Generation sends JSON to the generations endpoint. Editing uploads the selected source PNG to the edits endpoint. The transport accepts a bounded inline PNG, strips auxiliary metadata, and never follows an output URL or redirect. The per-image limit is 512 KiB. The image operation allows 180 seconds for the response with a separate five-second connection limit. DALL·E 2 and 3 request inline base64 explicitly. DALL·E 3 supports generation only. Services returning only URLs or larger images cannot complete this path.
- Image task receipts store the channel ID, model ID, connection revision, protocol, action, and source image relationship. A cancelled task cannot publish a late image. Local cancellation cannot establish whether the upstream already accepted or billed a request.
- A fresh retry requires an available original revision. Selecting a different default does not change its destination. Viewing a committed request or reopening its session does not authorize another dispatch.

## Rollback

The standard Electron launch path remains available. For an older Channels Preview, use its previous isolated data root or its pre-upgrade backup. Use a separate disposable root when trying a mixed image/text catalog: older strict catalog readers do not recognize explicit capability fields. Old image receipt files retain their format. The routed image ledger is separate, and older builds cannot show its newer outputs. Keep the current root so the new preview can reopen those results. No user data or Keychain migration is required.

## Native window acceptance

Run the dedicated QA bundle built by `bun apps/tinker-rust/scripts/build-channels-native-qa.ts`. Invoke `python3 apps/tinker-rust/scripts/native-channel-model-qa.py /absolute/path/to/Tinker\ Channels\ Native\ QA.app/Contents/MacOS/tinker-channels-native-qa`. The runner starts two owned loopback servers, uses a synthetic vault and creates its own temporary roots. Each listener records a credential slot and request counts. The ordinary preview build excludes these fixtures.

The first native process configured two channels through the settings UI and selected their models using the normal workbench. Channel A streamed a text response and generated a blue PNG. Channel B generated a different image, then deliberately failed a multipart edit referencing the image made by A. After choosing A again, the application quit fully and reopened under a new PID. Recovery and browsing added zero requests. Double-clicking the failed edit's Retry sent one new edit to B and produced one new result. The server checked the actual source PNG bytes, and the window displayed the original blue source and the orange edit side by side.

| Owned endpoint | Model discovery GETs | Total model POSTs | Credential observed |
| --- | ---: | ---: | --- |
| A | 2 | 2 | A only |
| B | 2 | 3 | B only |

The two discovery GETs per endpoint come from explicit refresh and connection test. Both POST counts include the entire first and second launch. The native processes in this run had PIDs 64040 and 64174. The fixture scanned 133 isolated files and logs for the two synthetic credentials. No match was found. Error status classification, timeouts, late cancellation and unavailable source revisions have separate transport and host tests. The window test covers a failed edit and its successful retry. It does not exercise live billing, a real provider, or the user's Keychain.

[Window capture after reopening and retrying](assets/native-channel-image-requests/comparison.png)
