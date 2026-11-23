# Native full-resolution image assets

**Status:** Implemented in an isolated native preview. Verification results below.

**Baseline:** PR #37, main `9089fd92d54ec110cdabe53413c91b98111452d3`. Domain terminology follows `CONTEXT.md`.

## Scope and baseline

PR #37 saved PNG files alongside each native session's receipt index. The 512 KiB file limit and small response envelope excluded common high-resolution output. The workbench also read the entire PNG to render a conversation card. This milestone separates preview traffic from original image access and keeps original pixels available for explicit inspection, editing and export.

## Behavior

- Accept a bounded inline PNG from an explicit, channel-bound image request. Validate file size, dimensions, decoded size and structure before committing. Keep HTTP, task, source and retry authority in Rust.
- Persist each original independently of message and session snapshots. Only publish a result after the file and task receipt are durable. Preserve the uploaded source when a request fails or is stopped. Enforce storage and image limits before publishing.
- Display a bounded thumbnail in normal conversation and file previews. Read a full original on demand through a session-scoped asset reference. Save the original PNG through the existing native Save As mechanism. Never use a thumbnail for an edit or an export.
- Read existing small assets without rewriting their receipts. Retain the narrow legacy backup-import contract. A previous executable is only supported with a compatible root or backup, and may reject larger new assets.
- Preserve the default Electron launch and renderer interactions. The native preview accepts no remote image URLs or renderer-selected filesystem paths.

## Acceptance

Use deterministic synthetic PNGs and a temporary native profile. Observe a successful large generation, explicit edit using the full original, source and result comparison, byte-identical export, failed or cancelled operations, full process restart with zero extra requests, and separation of two project sessions. Record sizes and digests, native window evidence, exact build and regression checks, the scope of file selection simulation and any coverage gaps.

## Limits, ownership and compatibility

The native provider accepts one inline PNG of up to 8 MiB. Each axis is limited to 4,096 pixels and the image to 8,388,608 pixels. The compressed HTTP envelope, chunk count and decoded pixel memory have separate limits. Source edits use the original referenced by the committed receipt. The channel and request identities still come from the task ledger. Animated PNGs and remote result URLs are unsupported.

For a supported PNG without discarded metadata the stored file matches the provider's bytes. The authenticated provider drops nonessential ancillary chunks such as text, EXIF and embedded ICC profiles. It preserves IDAT bytes, dimensions, bit depth, palette, transparency and supported colour chunks. Export always returns the bytes of the committed original. A supplied file containing stripped metadata can have a different container digest or profile-dependent colour appearance. The existing JPEG picker converts selected JPEG pixels to PNG. The Electron backup importer keeps its earlier 512 KiB / 4,194,304-pixel preview limit.

Each native session has a 128 MiB budget for regular image files, cached thumbnails and interrupted file writes. A new generation reserves room for an 8 MiB result before dispatch. Existing committed originals remain readable when the budget is full. Browsing a full session can generate a thumbnail without caching it. The limit is per session. A user with many sessions can use more space across the profile.

Card, sent-reference and file previews resolve an indexed session asset. A cache miss is decoded outside the actor. Thumbnails fit within 256 × 256 pixels. The renderer coalesces identical thumbnail reads and sends at most four at once. Zoom and comparison read originals in 256 KiB ranges with a pinned digest and verify the assembled SHA-256. At most two originals are in flight. Closing a view releases its Blob URL. The existing native export grant writes the original to the chosen destination.

## Reproducing the window checks

Build the independent native fixtures on a Mac with `bun apps/tinker-rust/scripts/build-channels-native-qa.ts` and `bun apps/tinker-rust/scripts/build-native-qa.ts`. Pass the freshly built Channels executable and Formal executable to the runner. To include the upgrade check, also pass a built #37 Channels QA executable. The runner creates its own two isolated data roots, local providers and synthetic images.

```sh
python3 apps/tinker-rust/scripts/native-large-image-qa.py \
  --channels-binary "$CHANNELS_QA" \
  --formal-binary "$FORMAL_QA" \
  --previous-binary "$PR37_CHANNELS_QA"
```

## Rollback

Keep the newer preview root to access its large images. For an older native preview, reopen a compatible pre-upgrade profile or backup. An older reader can reject a large PNG or a mixed session containing dimensions beyond its metadata limits. Previous small receipts need no conversion. The normal Electron launcher remains available and uses its existing storage. This patch requires no production data or Keychain migration.

## Measured sample

| Representation | Dimensions | PNG bytes | SHA-256 |
| --- | --- | ---: | --- |
| Synthetic source, lightbox and exported original | 1536 × 1024 | 3,877,810 | `da5abb87eb804a3fa494199461e86cc97d53df6fd03050d020fad1efd095aa71` |
| Rendered card thumbnail | 256 × 171 | 63,672 | `386ec242dc3999f581134f15b2048a22945c4bfa1e3978f689148896f4fbac28` |
| Edited image in the comparison viewer | 1536 × 1024 | 3,877,810 | `ad67d4621df5cdb8b5ea4c1450ebdce24f1bdf84d381739600131f14bc107097` |

The thumbnail is 1.64% of the original PNG's byte size for this synthetic image. This comparison covers the PNG payloads. Process memory and average savings across other images were not measured.

The Channels QA app uses two observable local endpoints and a synthetic vault. A separate Formal QA app supports two test projects and a synthetic file-panel selection. The save action goes through the real native export code. Physical clicks in the macOS file panel, external providers, real credentials, billing and an end-to-end run of the installed Electron product were outside this acceptance.

## Automated checks

| Check | Local result |
| --- | --- |
| Rust tests with formal-native-qa, locked offline dependencies and one test thread | 592 passed across 47 top-level test targets, 2 helper entry points ignored |
| Rust formatting and Clippy, all targets and features with warnings denied | Passed |
| Repository Bun suite with the built Rust runtime | 3,660 passed across 438 files |
| Workspace TypeScript checks and Electron build | Passed |
| Rust Lab frontend, Formal native QA, Channels native QA, ordinary Channels Preview builds | Passed locally on Apple Silicon |

The review covered session-bound reads, independent file and pixel limits, quota reservation, disposal of cached previews, late responses and held buffers. The host can retain up to two partially read original files until eviction, environment reinitialization or process exit. Closing a viewer aborts its renderer-side request and releases the Blob URL.

## Window results

The two-project Formal window generated and zoomed the large original. Cancelling Save As produced no file. Confirming the synthetic destination exported exactly the original bytes. A delayed edit was cancelled, the mock attempted its late response, and the session retained one committed result. The other project had a different image in a different session directory. After quitting process 78448, process 78551 reopened both projects with zero additional model requests. Its eight JSON/JSONL files occupied 15,657 bytes and contained no PNG data URL or long base64 match. The independently copied Formal QA executable had SHA-256 `82a1a4048c4804fcc70d4b4b47a0c6e1f8e2822eababb7d527f9e6737b713ca8`.

[Reopened original in the native window](assets/native-large-image-assets/restored-original.jpg)

The Channels window opened a small PNG written by the #37 binary, then generated a large reference. The first multipart edit failed. After a full application restart a double-click on Retry produced one edit request and one new version. The provider fixture checked the complete source PNG bytes. The comparison viewer loaded the two distinct full-size Blobs. Restore and browse added zero HTTP requests. Nine JSON/JSONL files occupied 13,570 bytes with zero embedded-image or long-base64 matches. A separate scan of 142 fixture files found neither synthetic credential.

The native processes were 78770 and 78852. The tested Channels executable SHA-256 was `e8a118f8ba8bf042d88ac34f27e7c9588af73bb2731ee85438a9840dabf257a7`. The previous executable was `f43e772ae87bfb8cd89148ea5ef1458ce8751761d3a221601895424b983904dc`. When sharing a Cargo target across configurations, copy the freshly built QA executable before starting other Cargo commands. A mismatched configuration was refused by the native host during an intermediate run.

[Full-resolution version comparison](assets/native-large-image-assets/comparison.jpg). The linked captures are reduced JPEGs for the report. All pixel dimensions and checksums above were taken in the running window or from the original PNG.
