# Generate, edit and reopen images in the native workspace

Base: main at `a7a901a`. Both the Keychain recovery and conversation search changes are present.

## Behavior

The isolated Tauri formal preview uses the existing React composer, version cards, reference thumbnail and session file viewer. An explicit image creation sends one generation request to the preview's own loopback provider. Editing an explicitly selected version sends its source bytes to the edit endpoint and links the result to that version. Selecting an older result takes precedence over the most recent result. Ordinary discussion, opening a preview and restoring the workspace do not authorize an image request.

A submitted edit retains its source in the user message. A failed edit keeps the source and does not expose a new successful version. Reading a session after quitting and starting a new process should show the same images and allow another explicit edit. The provider records operation kinds without storing prompts or image bodies in its diagnostics. This increment targets images already saved in the same preview conversation.

## Acceptance

Exercise the actual Rust host, HTTP provider and existing React workspace with a fresh marked profile. Count successful generation, successful edits and an intentionally failed edit. Check parent IDs, exact source selection, thumbnail display and sidebar enlargement. Record which checks run in a real desktop process and which are automated contracts. Use only generated fixtures.

## Rollback

Revert this feature and rebuild the isolated preview. Keep its profile if images are needed again. Production Electron remains the default. This change neither imports existing conversations nor requires credentials, a model charge or a modification to the installed application.

## Implementation and limits

The formal host advertises a native image capability to the shared workspace. The composer reuses the existing image intent classifier and the identity of the selected or immediately preceding successful image. A discussion of pricing can still use the text route. When the user asks to inspect pixels, this preview explains the limitation and preserves the draft. The production Electron image tool and the credentialed and tools preview backends keep their existing execution paths.

The image worker records acceptance before starting HTTP and writes a new, immutable PNG on success. The catalog binds the request, source version and result to one session. An uncertain or interrupted request is available on reopen without resubmission. Duplicate request identities cannot change their prompts or source versions. Session activity and search include the user's visible image instructions. Binary images stay outside the conversation history payload. The file viewer lists only committed images and reads a file's size without loading its pixels.

The local provider runs on the host's private loopback listener and returns synthetic PNGs. Its JSON edit request carries the selected PNG bytes. This fixture protocol has no upstream account, relay or credential. External file imports, cross-conversation references, image understanding and native save-as export are outside this milestone. The attachment adapter validates PNG content and limits each result to 512 KiB, each side to 4,096 pixels and total area to 4,194,304 pixels. The isolated catalog supports up to 128 image turns per session. Existing Electron saves, data and installed applications are unaffected by building this preview.

## Reproduce the window check on macOS

From the repository root, install the locked Bun dependencies and run these commands with Cargo dependencies available locally. Build the QA binary after any other Cargo builds sharing its target directory, so its embedded Tauri configuration matches the QA identifier.

```sh
bun apps/tinker-rust/scripts/build-native-qa.ts
python3 apps/tinker-rust/scripts/native-image-qa.py "${CARGO_TARGET_DIR:-apps/tinker-rust/src-tauri/target}/debug/tinker-formal-native-qa"
```

The driver creates a new marked profile in the system temporary directory. It operates the existing composer, reference and image controls in a native WKWebView, waits for normal process exit, opens the same profile in a new process and checks provider records and displayed image content. It writes a local summary and screenshots in its QA evidence directory. The scope of the zero-request assertion is the owned image/text mock in this preview.

[Compare the generated image with its edit](assets/native-image-workflow/generated-and-edited.png) · [Open a restored image from Session Files](assets/native-image-workflow/restored-sidebar-lightbox.png)

## Observed results on macOS arm64

The native-QA build embedded the original workspace UI. Its binary SHA-256 was `1d501828f3d86b3521729faffc602e41f372188657868100b7c88abfb64447c2`. Process 92447 sent the first generation and one reference edit. The user message displayed its source thumbnail. After the normal Quit action, process 92487 opened the same disposable profile. Both processes exited with status zero.

| Operation | Requests received by the local provider | Observation |
| --- | ---: | --- |
| Initial generation, then edit from its card | 1 generation, 1 edit | Two PNG versions and a visible reference thumbnail |
| Relaunch, reopen conversation, view files and zoom | 0 | Both images and the thumbnail decoded; sidebar lightbox reached 195% |
| Explicit edit with fixture error | 1 failed edit | Both previous images remained available |
| Edit from the older source, then a short follow-up | 2 edits | The first used the selected older version. The second used the immediately preceding result. The comparison viewer displayed the expected parent pixels for each. |

The first pre-change window check sent the prompt down the ordinary text path and produced no image. During integration the real window exposed an independent-session sidebar that required a project. The final run exercised the corrected path without creating a project. The real macOS run used the local provider and the QA probe. No production provider, paid request, personal keys, old Electron data migration or installer was exercised.

## Automated verification

- `cargo test --locked --offline --features formal-native-qa -- --test-threads=1` passed 479 top-level tests across 46 targets with 2 helper entry points ignored. This count excludes nested child executions. The store and host regressions cover exact source bytes, receipt replay, ownership, malformed images, cancellation, failure preservation, restore capacity, search and stable activity order on read.
- `cargo fmt --all -- --check` and `cargo clippy --locked --offline --all-features --all-targets -- -D warnings` passed.
- `bun test` passed 3,587 tests with 5 skipped. The focused image and shared behavior suites passed 196 tests. Workspace typechecks, scoped ESLint, the Electron build, and the formal and native QA renderer builds passed.
