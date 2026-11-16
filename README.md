# Tinker

Tinker is an AI Agent desktop application evolved from the existing ASCI project. It uses chat, writing, coding, and image capabilities according to the task.

The delivered installer baseline is **the 0.1.603-rc.1 candidate**. The current development source version is defined in `apps/electron/package.json`. A source commit does not automatically update the installer or indicate a stable release or Apple notarization.

<a id="本机开发"></a>

## Local Development

Requires Bun 1.2.5+, Node.js, and the Electron/native dependencies for the target platform.

```sh
bun install
TINKER_CANDIDATE=1 ASCI_SKIP_LOGIN=1 bun run electron:build
TINKER_CANDIDATE=1 ASCI_SKIP_LOGIN=1 bun run electron:start
```

This candidate uses local bring-your-own keys without sign-in. Configure API keys only inside the application. Never commit them to Git.
Mac candidate data is isolated in `~/Library/Application Support/Tinker Candidate`. Existing ASCI sessions and channels are not migrated automatically.

<a id="当前清理与兼容边界"></a>

## Current Retirement and Compatibility Boundaries

The source is retiring research-specific workflows according to their dependencies while preserving general chat, models/channels, image generation, projects, history reading/export, and media capabilities. See the [research retirement report](docs/reports/2026-11-10-research-retirement.md) for implementation batches and test boundaries. The existing Electron/SDK backend still provides production functionality. Rust/Tauri is a separate migration path and has not replaced the formal interface or user data.

<a id="旧候选验证记录与限制"></a>

## Earlier Candidate Verification and Limitations

The following records concern the earlier candidate listed above. They do not constitute complete acceptance of the current source or a new installer.

- Previous candidate build regression: 3127 passed, 4 skipped, 0 failed. Type checking and the build passed.
- Tested the home screen, default-model settings entry, Chinese language switching, project creation, search, sample drafts, and draft retention after returning.
- Real-key authentication, end-to-end chat/image generation, continuous editing, and first installation on another computer still require acceptance testing.
- The macOS installer currently uses ad-hoc signing and is not notarized. This repository contains no installers, personal channels, keys, or session data.
- Internal `@asci/*` namespaces are retained for now to preserve existing module contracts. The existing graphic mark is retained.

The original project's CI, automatic release, and notification configurations are stored in `docs/upstream-workflows/*.disabled` and do not run automatically in this repository. Update sources and external distribution settings still require confirmation. Do not run the old configurations to publish to the upstream repository.

Issues and PRs currently target [`SimmonJ-WYJ/tinker`](https://github.com/SimmonJ-WYJ/tinker) by default. Historical upstream links retain their original repository context.

<a id="项目来源与许可"></a>

## Project Origins and Licensing

Retain attribution to ASCI/OPENSCI Labs and the contributors. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Original project documentation is preserved in the [historical README](docs/history/ASCI-README.md) and [historical domain language](docs/history/ASCI-CONTEXT.md). Current development conventions are in [CLAUDE.md](CLAUDE.md), and general domain language is in [CONTEXT.md](CONTEXT.md). The old research roadmap is no longer a current product goal.
