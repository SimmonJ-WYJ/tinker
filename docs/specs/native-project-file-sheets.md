# Native macOS file sheets

| Status | Baseline | Scope |
| --- | --- | --- |
| Implementation and native acceptance | PR #44, c074b80 | [Project documents and portable backups](native-portable-projects.md) |

## Behavior

A file or folder chooser belongs to the window that opened it. While the chooser is open, the application must continue dispatching main-thread events. The native command resolves once the user selects a URL or cancels. The existing one-dialog limit and host-side validation remain in effect.

## Regression check

Use the existing portable-project window harness in system-panel mode with the isolated Channels QA build. It queries the owner window through Tauri while the sheet is open, checks that the sheet is attached, and checks dismissal before testing the application result. Fixed fixture selections do not exercise this check.

## Rollback

Revert the sheet presentation change on the preview branch. No session, asset, backup, credential or preference format changes are involved.

## Apple Silicon acceptance

On Apple Silicon macOS the baseline QA executable from #44 entered an AppKit nested modal loop on the Tauri thread when opening a project PDF. A foreground-state request to that thread timed out. The revision uses a window-owned sheet and a completion callback. The QA-only probe can observe attachment and dismissal on the same window.

| Real system UI on synthetic data | Observed result |
| --- | --- |
| Cancel PDF selection | Returned to the document library; the project still contained zero documents and neither mock channel received a request. |
| Cancel backup export | Returned to Settings without creating the target archive. |
| Cancel backup selection | Returned to Settings without starting a restore. |
| Open a valid portable backup | On the final build, selected the exact 280-byte file produced by the physical Save operation. The empty destination did not contain the project at preflight. Clicked Restore project and observed the success message. The same project ID and snapshot survived full process exit and relaunch (different PIDs), with zero calls to either mock channel. |
| Import a selected PDF | In an early attempt the Open button remained disabled. On the final build, selected a PDF with a space in its filename, clicked the enabled Open button, and observed the imported document, page 1, and the expected first-page marker in the project. Both mock channels stayed at zero requests. |
| Save an archive through AppKit | An early build proposed a duplicate extension. The final panel displayed Project.tinkerproject once. Clicked Save into an empty, isolated QA destination. The 280-byte archive matched a deterministic export of the same project byte for byte (SHA-256 a861adf6795a2540dbd916829400de931e5ec8b8723355957dd57dfad7be0e76). The harness polled a different temporary directory, so the comparison was made independently at the actual chosen destination. |

The automated migration gate uses fixture choices for the archive and PDF. It exercises serialization, a two-profile restore, a full process restart and source navigation independently of AppKit. A fixture choice cannot qualify the corresponding physical panel. No personal data, distribution signing, notarization, or installed production application is needed for this rehearsal.


## Checks on the final revision

- Rust tests with the native QA feature: 635 passed, 3 ignored. Rustfmt and Clippy with warnings denied passed.
- Bun: 3,677 passed, 4 skipped. Workspace typecheck and the Electron build passed.
- Both Apple Silicon Tauri bundles passed strict local signature validation. Both used ad-hoc signatures.
- The migration release gate passed its ordinary-binary symbol check, synthetic Electron upgrade and rollback, and portable-project restart checks. Its file choices were injected. The preceding table lists the separate system-dialog evidence.
- Project directory rebinding, reference-image import, image export and overwrite confirmation share code with the tested panels. Their physical UI flows were not separately exercised on this revision.
