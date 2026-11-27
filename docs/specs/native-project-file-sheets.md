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

## Workspace and image acceptance after #45

The native acceptance scenario uses a fresh project, two test folders, two visually different JPEGs with the same name, and the local Channels QA provider. The first folder is bound and the second replaces it. Moving the selected folder must make the binding unavailable. Reopening the original location must restore it. Canceling a picker must retain the previous selection.

The selected JPEG must match the composer thumbnail, the submitted edit reference and the restarted message by decoded dimensions and color. The receiver must verify the normalized PNG of the selected fixture. Export to a new name must preserve the generated PNG bytes. Canceling replacement must preserve the existing file. Restart and navigation must add no provider requests.

### Reproduce the physical-panel run

Build the isolated Channels Native QA app with `bun apps/tinker-rust/scripts/build-channels-native-qa.ts`. From the repository root run `python3 -u apps/tinker-rust/scripts/native-workspace-image-panels-qa.py "/path/to/staged/Tinker Channels Native QA.app"` with its original temporary bundle path. Follow the printed steps in that window. Enter DONE after each real sheet closes. Confirm DECLINED only after seeing and canceling the macOS replacement alert. The script reports a pass only after the restart assertions succeed.

| Apple Silicon Mac, synthetic data | Observed result |
| --- | --- |
| Project directory | Bound First folder, canceled a rebind and connected the second folder with Chinese characters and a space. Temporarily moving each selected directory produced unavailable, and moving it back produced bound. Reopening retained the second binding and project ID. |
| Reference identity | Both folders contained a 96 × 64 JPEG with the same name. The first was black and the second white. Canceling Attach left the composer empty. The white image matched the normalized PNG thumbnail in the composer and sent message. The mock accepted one edit only with the expected normalized reference. |
| Image export | Clicked Save and saw the system replacement alert for an existing file. Canceled both the alert and the sheet. Its 37 bytes remained intact. Saved to a new name and compared all 10,663 bytes to the managed result. Export SHA-256: `adba99271c0d5cf9542f692882c2485187befdeb7ad6f5c0f3f2d640babbbf28`. |
| Full application restart | Moved the original JPEG, quit and launched a new process. The sent message retained the selected pixels and image ID. The generated result and project binding were unchanged. Neither loopback listener recorded another request. |

The first attempt to poll the QA main thread continuously during sheet presentation timed out. The completed run used explicit synchronization after dismissal. This exercise covers local native-preview behavior with a mock provider. Reverting its QA-only changes removes the new scenario without migrating user data.
