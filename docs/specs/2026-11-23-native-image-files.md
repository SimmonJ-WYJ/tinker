# Import and export images in the native workspace

- Status: Implemented and verified with synthetic file selections in native windows. Manual system panel interaction is pending.
- Base: `3a3a385275d127861a41ce06fa4cd19968a07db8` (PR #31)
- Domain: conversation attachments and image versions, as defined in the existing React workspace

## User flow

1. Choose a local image through the composer's existing attachment control. The host opens a system file picker. The selected file becomes a session-owned reference. Its original location is not a durable capability.
2. Send an explicit edit instruction. The existing image runner submits the chosen source pixels to the local test provider and persists the result with a link to its source. The sent message retains its reference thumbnail.
3. Use the existing Save control. Only the native save dialog grants a destination. The exported image has the indicated format and can be decoded independently.
4. Quit and start a new process using the same disposable profile. Reopen the message, view both images, and reuse a saved image even after moving the external source. Viewing and recovery issue zero provider requests.

## Safety and acceptance

Limit input to regular supported images within bounded encoded and decoded dimensions. Declining either picker grants no file access and sends no request. Unsupported or oversized input should give actionable feedback and leave existing images intact. Filesystem paths chosen by the native dialogs stay on the host. Test with generated files in a fresh temporary directory and only the preview's owned loopback mock. Record separately the cases exercised in an actual window, native panel interaction, and lower-level tests.

## Rollback

Revert this milestone on a separate branch and rebuild the preview to return to PR #31. Keep preview data when rolling back. The installed Electron application and its storage are outside this migration.

## Formats and compatibility

- The import picker accepts one PNG or JPEG at a time. PNG is validated and copied byte-for-byte. JPEG is decoded, rotated according to its EXIF orientation, and encoded as PNG. The JPEG conversion discards EXIF metadata. The original basename remains a display label.
- The preview retains its existing persisted PNG and IPC budget. Source files may be at most 8 MiB, each side at most 4,096 pixels, the total area at most 4,194,304 pixels, and the resulting stored PNG at most 512 KiB. An otherwise valid photograph may exceed the normalized PNG limit. The preview reports the size error instead of silently scaling or cropping.
- The owned loopback editor now works with imported image dimensions and preserves transparency. Its deterministic tint is for exercising the local file and version pipeline.
- The native save dialog writes a PNG to a new filename in the directory the user chose. An existing file is preserved, and the user can choose another name. The renderer never supplies an arbitrary filesystem source or destination.
- Generated versions from PR #31 keep their existing catalog. Imported references and their version chains are stored separately, so an earlier build can still open its original image history. Keep the new indexes and assets if reverting the code.

## macOS acceptance evidence

The dedicated QA binary had SHA-256 `e43b1c945db0d830bccad3470a82af0682b0a7332970fe96aea838bab2adf77f`. It loaded the existing React workspace in WKWebView. Only the file-selection result was supplied by a QA-only picker restricted to named fixtures in a disposable directory. The normal host commands handled validation, import, edits, attachment reads and export.

| Step | Observed result |
| --- | --- |
| Select a synthetic 72 × 48 PNG | The composer showed the source image. Cancelling a subsequent pick retained it. Cancelling the first pick left Recent unchanged. |
| Choose damaged and oversized inputs | Distinct error messages were visible. The previous selection remained available. The provider received zero requests. |
| Explicitly edit, then cancel Save and save to a new file | One local edit request. Cancel left the destination absent. A confirmed save produced a 918-byte PNG, identical to the displayed result and different from the source. Export SHA-256 was `e750116024f6dbe35e81e801e7bd08c710f6e727160e9023e9723859de247bdf`. |
| Quit, remove the external synthetic source, and reopen | The first process (98353) quit normally. A new process (98481) opened the same isolated profile. The result and sent reference thumbnail decoded. Reselecting the original reference issued zero provider requests. A new explicit edit issued one request. |

[Restored workspace with the sent reference, edited result and reselected source](assets/native-image-files/restored-import.png)

The separate interactive test dispatched the attachment click in the real window. The controller could not address the standalone QA executable to observe or operate the system panel. Manual confirmation in AppKit Open/Save and interaction with a real image provider remain unverified. Tests used no personal photos, real account or paid requests.

### Reproduce

Build the locked QA target with `bun apps/tinker-rust/scripts/build-native-qa.ts`. Run the following from the repository root, substituting the built QA binary if a custom Cargo target directory is in use.

```sh
python3 apps/tinker-rust/scripts/native-image-qa.py --files apps/tinker-rust/src-tauri/target/debug/tinker-formal-native-qa
python3 apps/tinker-rust/scripts/native-image-qa.py --system-file-panels apps/tinker-rust/src-tauri/target/debug/tinker-formal-native-qa
```

The first command supplies synthetic picker decisions. The second asks a tester to select the printed temporary input and destination in macOS. Both validate the image content against the result displayed by the native preview.

## Automated checks

- Workspace TypeScript checks, scoped ESLint, Rust formatting and `cargo clippy --locked --offline --all-features --all-targets -- -D warnings` passed.
- The Electron application, Tauri formal preview and native QA window built successfully on macOS arm64.
- The complete Bun suite passed 3,595 tests, with 5 skipped and zero failures. An earlier run hit the existing five-second limit in the optional Python-wrapper packaging test. Its two focused tests and the subsequent full run passed without changing the wrapper, test or timeout.
- The focused renderer selection, image card, sidebar, save and restore suite passed 97 tests. The Rust suite exercised JPEG orientation, decoding, bounded PNG output, version ownership, cancellation, grant expiry, export collisions and rollback compatibility.
- The final Rust suite passed 491 tests across 46 targets with 2 ignored and no failures. The count excludes nested child-process test summaries.
