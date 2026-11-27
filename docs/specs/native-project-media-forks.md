# Project conversations with media in native forks

Given a native project conversation containing a cited PDF, a managed reference image and a successful image edit, choosing **Fork from here** must create an independent readable prefix in the same project. The cutoff is the selected reply. A selected image reply includes its own result. Later messages, unrelated imports and other projects' assets must stay outside the fork.

Before publishing the new session, copy only verified managed originals needed by included versions, remap all local asset references, and verify project document locators. No execution, tool approvals or secrets are transferred. Starting a new text turn must include only the saved text conversation, without sending an image or a historical document excerpt. Only an explicit attachment on that turn grants access to the selected excerpt or image.

After the app exits and reopens, historical source buttons must open the correct PDF page and lines, and referenced images and results must still resolve under the branch's own identity. Reject failed, pending, unsupported or unverifiable prefixes before catalog publication. Recovery may only reuse an identical staged image set.

## macOS acceptance

Build the Channels Native QA bundle with `bun apps/tinker-rust/scripts/build-channels-native-qa.ts`. Run `python3 apps/tinker-rust/scripts/native-project-media-fork-qa.py "/path/to/Tinker Channels Native QA.app"`. The test creates its own profile, project, fixtures and loopback channels.

| Action in the packaged React window | Observed result |
| --- | --- |
| Cite a PDF line, edit a synthetic reference image, then add two text turns | The source contained the citation, the sent reference thumbnail and the managed result. The harness removed both original input files before opening the branch. |
| Fork from the earlier text reply using the message menu | The branch retained the citation and the image edit, with a distinct local image ID. The later text stayed in the source. |
| Fully quit and reopen the branch | The thumbnail matched the reference pixels. The 192 × 128 result opened at 100% and zoomed to 125%. Its 10,663 PNG bytes matched the source result (SHA-256 `adba99271c0d5cf9542f692882c2485187befdeb7ad6f5c0f3f2d640babbbf28`). The citation opened the stored text at page 2, line 2. |
| Send a plain follow-up, explicitly reattach the PDF line, then edit the branch image | The mock verified the exact five-message plain text context, the selected document excerpt on explicit attachment, and the expected image bytes on explicit edit. The original conversation still matched its pre-fork snapshot. |
| Fork from the source image reply itself | A second branch included that reply’s image, with another independent ID and identical bytes. Both subsequent text turns stayed outside its history. |

The final acceptance used three distinct macOS processes. Across setup and explicit sends, channel A received two discovery GETs and seven POSTs. Channel B received none. Branch creation, reopening, source navigation and preview added zero requests. The harness drove the real WKWebView message menu, composer, source dialog and lightbox. File selection used the isolated QA picker. The system file panel, real model providers and distributed builds were outside this run.

## Limits and rollback

The host verifies managed images against successful local receipts and validates citations against the source project. The aggregate copy limit is 64 million decoded pixels and 64 MiB of encoded image data. Historical image records carry no live retry permission. Pending tasks, unknown tools and raw imported message prefixes remain unsupported. A failed staging step leaves the branch unpublished. Retrying can reuse a verified identical asset set.

Electron remains the default desktop entry. To return to it, quit the preview and open the existing Electron installation. Keep the native profile and assets for later use. Native branches are not imported back into Electron. The implementation can be reverted as a single commit.
