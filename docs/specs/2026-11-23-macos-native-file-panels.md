# macOS system file panel acceptance

PR #39 merged at `e9a57f8e9bb0e950ee6cd224d4759da7b59d03a2`. Its native rehearsal verified the file workflow with scripted picker selections. This follow-up tracks actual AppKit panel interactions separately.

## Observations on the Mac

| Entry point | Actual system UI evidence | Outstanding acceptance |
| --- | --- | --- |
| Settings → General → Import conversations | The QA window exposed the macOS Open dialog, including Cancel and Open. Settings was visible again and reopening the dialog succeeded. The app later showed the prompt for a folder containing the session or workspace index. No old sessions or projects appeared and both loopback counters stayed at zero. | Desktop control timed out while confirming Cancel. The exact selected directory and dismissal action could not be established. Import through the correct Chinese/space path remains unverified. |
| Project → Choose / change folder | No verified system selection this run. | Cancel without granting a binding, select a directory, rebind it, move the selected directory and inspect the status after restart. |
| Image → Save | No verified system selection this run. The file test set includes a same-name collision, an interrupted write and exact exported bytes. | Cancel, decline a collision in the actual Save panel, choose a fresh name and compare the bytes. |
| Composer → Attach file | No verified system selection this run. | Cancel, select the synthetic PNG and check its displayed pixels without sending. |

The tested Apple Silicon QA binary came from PR #39 head. Its source tree was identical to the merge tree, and its SHA-256 was `d5a81627ffe72d81c0b2449048e0a199761070795ad0e2df7a6b5cee1b8fc1a7`. It used a new profile, synthetic material and two loopback listeners. The desktop controller intermittently returned `-10005 timeoutReached` for the target window and screenshot. An app-local read confirmed that the workbench was responsive and the import action was enabled. The process exited normally. No application defect was established from the timeout. No screenshots of real folders or private paths are included.

## Repeat the remaining checks

On a Mac with an interactive desktop, a development checkout and its dependencies, build the isolated app and start the guided pass:

```sh
bun apps/tinker-rust/scripts/build-channels-native-qa.ts
python3 apps/tinker-rust/scripts/native-file-panels-manual.py \
  --binary "/private/tmp/tinker-tauri-channels-package-EXAMPLE/Tinker Channels Native QA.app/Contents/MacOS/tinker-channels-native-qa"
```

Use the path printed by the build. The script prepares two identically named projects in a synthetic backup, an empty directory, two workspace folders, a PNG reference and an existing output sentinel. It configures a finite test channel and opens each app entry point. The operator completes the **actual system panel** and confirms each step in Terminal. Use **Command–Shift–G** to reach the printed directory. In the Save dialog navigate to the output directory and enter the printed filename in **Save As**. Decline the same-name overwrite. Keep all selections inside the printed fixture directory.

The script compares the original backup digests, tracks request counters, checks the rebind against the actual directory identity, compares the export with the native PNG and checks the reference pixels. It exits and restarts the same QA app with the same native profile. A missing bound directory must report unavailable until the original directory returns. Only a completed pass writes a summary with two distinct process IDs, byte counts, hashes and the request delta. A console confirmation alone does not verify any selected data. To generate disposable test materials without opening any app, use `--fixtures-only` instead of `--binary`.

## Regression scope

- 14 Rust file IO, session import, project binding and recovery tests passed using the existing test executable built from the identical source tree. Three tests initially could not start the loopback fixture in the file sandbox. All 14 passed when rerun with loopback access.
- 20 targeted Bun adapter and React tests passed across five files, with 74 assertions. These exercise UI state and API contracts and do not operate AppKit.
- The workspace typecheck passed. The guided runner's fixture-only mode was exercised separately, including the eight-file backup, three sessions, 72 × 48 PNG and collision sentinel. Its complete operator-driven run is pending.
- Preparation of a separate internal preview package can proceed. Broadening a trial to user-owned folders or treating all native file operations as accepted should wait for the operator pass. The default Electron application, its installation and real user data are outside this test.
- The default Electron build and a fresh Apple Silicon Channels QA build succeeded. The QA bundle passed strict local ad-hoc signature verification. No distribution signing, notarization, installation or production source change was involved.
