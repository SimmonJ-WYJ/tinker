# Claude Agent SDK 升级历史

本文档记录 `@anthropic-ai/claude-agent-sdk` 历次升级的 Breaking Changes 与相关背景。

**当前仍有效的加固方案**保留在 `CLAUDE.md` 的"SDK 版本升级注意事项"段中，此处只记录历史条目或已不活跃的变更，供未来升级评估时参考。

## Breaking Changes 日志

### `0.2.119`

- 当前升级目标版本，npm `latest`；`0.2.120` 当前为 `next`，不进入生产升级目标
- **项目影响**：中；本次 PR 只做兼容准备，不接入 `PermissionMode='auto'`、`forwardSubagentText`、`sessionStore` 等新能力
- **验证要求**：升级后必须跑本地 typecheck/build，并手动触发 Windows `--dir` smoke，确认 `claude-agent-sdk-win32-x64/claude.exe` 已进入 `win-unpacked`

### `0.2.113`

- `options.env` 语义恢复为"替换 `process.env`"
- SDK 改为通过 per-platform optional dependency 分发 native Claude Code binary，不再依赖主包内 `cli.js`
- **项目影响**：高；`buildSdkEnv()` 必须显式构造完整 env，`electron-builder.yml` 必须包含 `node_modules/@anthropic-ai/claude-agent-sdk-*/**/*`
- **打包风险**：跨平台构建时必须确保目标平台 optional dependency 进入包内，Windows 用 `.github/workflows/smoke-windows.yml` 验证

### `0.2.91`

- `sandbox.failIfUnavailable` 默认从 `false` 变为 `true`
- **项目影响**：目前项目未使用 sandbox 选项，未触发
- **未来风险**：若后续引入 sandbox，需显式设置 `failIfUnavailable: false` 以保留原语义

### `0.2.111`

- `options.env` 语义从"替换"变为"叠加"（之前是替换 `process.env`，现在是叠加到 `process.env`）
- **项目影响**：高；完整加固方案见 `CLAUDE.md` → "SDK 版本升级注意事项"
- **此条目只作索引**，细节不在这里复述
