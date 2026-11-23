# Image tasks in the native project workbench

Status: implemented in the isolated Native Formal Preview; see the acceptance record below.

Related issue: migration follow-up to PR #35. Domain language: [CONTEXT.md](../../CONTEXT.md).

Base: merged PR #35 at 0810f00d04d1d1c232541b173c0e82d3bfb4124a.

## Behavior

In the macOS Formal Preview, an explicit image generation or edit belongs to the conversation and project where it started. The existing project overview identifies the type and state of the latest task. Returning to that conversation restores either a running indicator or a final result. A successful edit leaves its source and prior versions intact. A failed write cannot publish an asset as successful.

A local Stop and an application exit have distinct meanings. The first terminates the selected local attempt. The second preserves the attempt as interrupted. Neither proves that an upstream service received or cancelled a request. Restoring, browsing and opening an image must not resubmit work. Only an explicit eligible retry may send again. A retry of an edit must use its original reference, even if the composer now holds a different image. Duplicate clicks and late responses cannot create extra versions.

## Acceptance

Use disposable profiles, synthetic text and images, and the native host's loopback provider. Run a text task in one project and an image task in another. Navigate away and back, stop one and verify the other, then check successful output, failed artifact storage, late responses, explicit retry, full process restart and unchanged source hashes. Count accepted mock requests separately for explicit actions and recovery. The existing text journal and image receipts remain authoritative for their own operations. No upgrade of real data or credentials is required.

## Storage and compatibility

Task status comes from the text binding and its run journal, or from the image turn receipt. The project query joins the latest task for each member conversation. Reading the overview does not load image bytes. New image admissions record the last text request identity, the positions of both v1 image lists and the original request identity for an explicit retry in a separate task-order file. The receipt commits admission. This allows the host to distinguish attempts even if the renderer clock moves backwards. Images are published only after the result file and the successful receipt are committed.

The old reader understands the existing image receipt format. Local cancellation uses its existing failed representation and a specific cancellation code. An earlier preview may display this as a failure. A pending receipt without a live worker is interrupted. The new host grants Retry only for a confirmed latest failed or interrupted attempt. An old receipt without admission metadata, or a mixed text/image history whose ordering cannot be proven, remains browsable. The user can start an explicit new task or select an old source for editing. Reading such a history never backfills causal metadata. Dates shown for legacy entries are best-effort across the old journals.

## Acceptance record

The native acceptance driver uses the original React workbench, a real macOS WKWebView and the host's isolated loopback HTTP server. It creates two synthetic projects and records accepted requests in each process. It tests a streaming text task alongside a running image task, followed by two overlapping image tasks. Only the selected edit is cancelled. The server attempts to send its response later. The other project completes and the cancelled edit adds no image. A failed edit retried twice in immediate succession produces one new request and keeps the original reference, even when another image is selected in the composer.

The candidate was exercised across three separate processes (43187, 43530, 43693) and then opened with the previous preview (43924). The first process accepted eight explicit requests. Browsing after a clean quit or an abrupt termination accepted zero in each new process. After the latter restart, double-clicking Retry sent exactly one request. The test compares assistant and user history, reference thumbnails, source and result pixels, image lineage, project membership and file hashes. Screenshots below were captured from the candidate WKWebView. The PR records the validation of the exact published head.

[Source and result after restarting](assets/native-project-image-tasks/comparison.png) · [Interrupted edit and explicit retry](assets/native-project-image-tasks/interrupted.png)

For an upgrade check, the previous preview created an image, a successful edit and a failed edit in its own project using three explicit requests. The candidate opened the same project, found the failed task, decoded both images and their thumbnail, compared the versions and quit. The two PNGs and the old receipt retained their hashes. This read opened no provider request.

## Reproduction and rollback

Build the QA binary with `bun apps/tinker-rust/scripts/build-native-qa.ts`. From the repository root run `python3 apps/tinker-rust/scripts/native-project-image-task-qa.py /absolute/path/to/tinker-formal-native-qa --previous-binary /absolute/path/to/previous/tinker-formal-native-qa`. Each run creates a private synthetic profile and evidence directory under the macOS temporary directory, and prints their location. It checks visible rendered pixels and text as well as accepted requests. Explicit cancellation promises only local termination.

Quit the candidate and reopen the previous preview against the same isolated QA profile. In the rollback run the previous binary reopened four images in one project, inspected the stored references and compared versions. Browsing generated zero requests and left all nine image/metadata files unchanged. To roll back the code, revert this feature commit on the integration branch. The default Electron launch, production model routes, user settings and installed applications are outside this milestone. No paid upstream service or real conversation was exercised.
