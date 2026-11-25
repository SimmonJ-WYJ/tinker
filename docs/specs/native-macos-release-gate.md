# macOS preview migration gate

The gate qualifies an Apple Silicon Channels Preview build for side-by-side engineering review. It does not install an app, replace Electron, use a real profile, or publish a release.

## Run locally

From a clean checkout on an Apple Silicon Mac with Xcode tools, Python 3, Cargo, and the lockfile's Bun dependencies installed:

```sh
python3 apps/tinker-rust/scripts/native-macos-release-gate.py
```

Keep Python assertions enabled. The Electron dependency must include its downloaded macOS runtime. The Rust builders compile offline and expect the locked dependencies to be cached. Both applications are built and signed ad hoc into temporary staging. The script prints a new evidence directory with a JSON summary and per-step logs. It exits nonzero on a failed stage.

You can repeat just the checks with `--preview-app` and `--qa-app` pointing at the original temporary bundle locations. In that mode the report does not attest the supplied bundles' source commit. Do not use installed applications.

| Check | What it establishes |
| --- | --- |
| Both bundles | Correct app and executable identifiers, arm64 architecture, strict local signature verification. |
| Ordinary Channels Preview | No QA-only symbols detected. The regular bundle is inspected but is not launched by this gate. |
| Upgrade and rollback | The dedicated native QA app opens the React workbench, imports an Electron fixture, continues a thread, edits and exports an image, and survives application restart. The real Electron runtime reads the independent rollback copy. Source and copy are fingerprinted. |
| Portable project restore | A separate native QA app run creates a project archive, moves the source away, restores into a profile containing existing content, then reopens documents, citations and images after restart. It checks deduplication and request counts against two owned loopback providers. |

## Release boundary

- The Electron production application remains the default. The preview uses temporary staging and separate synthetic data. Its ad hoc signature is for local verification only.
- The gate does not use the real Open and Save dialogs, launch the installed Electron GUI, access the user's profiles or use live provider credentials. The native QA app supplies known file selections.
- Real panel acceptance, Developer ID signing, notarization, and Gatekeeper acceptance on a clean Mac remain separate release gates.
- If the rehearsal fails, keep the evidence and fix the failing stage. No manual work on the user's production profile is required. Keep native-only work separate before returning to Electron. See [upgrade and rollback rehearsal](2026-11-23-native-upgrade-rehearsal.md).
