<a id="claude-agent-sdk-升级历史"></a>

# Claude Agent SDK Upgrade History

This document records Breaking Changes and background for successive `@anthropic-ai/claude-agent-sdk` upgrades.

**Hardening measures still in effect** remain in the "SDK Version Upgrade Notes" section of `CLAUDE.md`. This file records only historical entries or inactive changes for reference during future upgrade evaluations.

<a id="breaking-changes-日志"></a>

## Breaking Changes Log

### `0.2.119`

- Current upgrade target, npm `latest`; `0.2.120` is currently `next` and is excluded from the production upgrade target
- **Project impact**: Medium; this PR only prepares compatibility and does not integrate new capabilities such as `PermissionMode='auto'`, `forwardSubagentText`, or `sessionStore`
- **Validation requirements**: After upgrading, run local typecheck/build and manually trigger the Windows `--dir` smoke to confirm `claude-agent-sdk-win32-x64/claude.exe` is included in `win-unpacked`

### `0.2.113`

- `options.env` semantics return to "replace `process.env`"
- The SDK now distributes the native Claude Code binary through per-platform optional dependencies, instead of relying on `cli.js` in the main package
- **Project impact**: High; `buildSdkEnv()` must explicitly construct a complete env, and `electron-builder.yml` must include `node_modules/@anthropic-ai/claude-agent-sdk-*/**/*`
- **Packaging risk**: Cross-platform builds must ensure the target platform's optional dependency is included; verify Windows with `.github/workflows/smoke-windows.yml`

### `0.2.91`

- The default for `sandbox.failIfUnavailable` changes from `false` to `true`
- **Project impact**: Not triggered; the project currently does not use sandbox options
- **Future risk**: If sandbox is introduced later, explicitly set `failIfUnavailable: false` to preserve the original semantics

### `0.2.111`

- `options.env` semantics change from "replace" to "overlay" (previously replacing `process.env`, now overlaying `process.env`)
- **Project impact**: High; see `CLAUDE.md` → "SDK Version Upgrade Notes" for complete hardening measures
- **This entry is an index only**; details are not repeated here
