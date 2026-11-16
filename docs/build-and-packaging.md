<a id="构建与打包"></a>

# Build and Packaging

Details of how esbuild / Vite / electron-builder work together. The focus is **Agent SDK externalization rules**, the configuration most prone to errors
and the costliest when it fails in this project.

---

<a id="构建工具概览"></a>

## Build Tools Overview

| Target | Tool | Command |
|------|------|------|
| Main process | esbuild | `--bundle --platform=node --format=cjs --external:electron --external:@anthropic-ai/claude-agent-sdk` → `dist/main.cjs` |
| Preload | esbuild | Same as above but `--external:electron` → `dist/preload.cjs` |
| Renderer | Vite + React plugin + Tailwind CSS | `dist/renderer/` |
| Distribution packaging | electron-builder | Configuration: `apps/electron/electron-builder.yml` |

<a id="开发热重载"></a>

### Development Hot Reload

- **Renderer** — Vite HMR takes effect immediately
- **Main process / Preload** — `electronmon` watches `dist/` and automatically restarts on changes, triggered by `build:main` / `build:preload` with `--watch=forever`

---

<a id="运行时bun"></a>

## Runtime: Bun

Use Bun instead of Node / npm / pnpm:

- `bun install` installs dependencies; `bun run <script>` runs scripts
- `bun test` runs tests (built-in runner, `import { test, expect } from "bun:test"`)
- Bun loads `.env` files automatically (no dotenv needed)
- Prefer native Bun APIs: `Bun.file` > `node:fs`, ``Bun.$`command` `` > `execa`

---

<a id="agent-sdk-打包要求必须遵守"></a>

## Agent SDK Packaging Requirements (Mandatory)

<a id="规则"></a>

### Rules

1. **esbuild must use `--external`** — `@anthropic-ai/claude-agent-sdk` must not be bundled into `main.cjs`
2. **Include through electron-builder `files`** — do not use `extraResources`

In `apps/electron/electron-builder.yml`:

```yaml
files:
  - dist/**/*
  - package.json
  - node_modules/@anthropic-ai/claude-agent-sdk/**/*
  - node_modules/@anthropic-ai/claude-agent-sdk-*/**/*
  - "!node_modules/@asci/**"
```

<a id="为什么这样做"></a>

### Rationale

- This configuration copies the SDK main package into `app/node_modules/@anthropic-ai/claude-agent-sdk/` and native binary packages into sibling `claude-agent-sdk-<platform>-<arch>/` directories
- Node.js module resolution searches upward from `app/dist/main.cjs` for `node_modules`, correctly locating the SDK
- In SDK 0.2.113+, `pathToClaudeCodeExecutable` points to `claude` / `claude.exe` inside an optional dependency, so native packages must enter `resources/app/node_modules` through `files`

<a id="为什么不用-extraresources"></a>

### Why Not `extraResources`

- `extraResources` copies files into `Contents/Resources/`
- With a `to: app/node_modules/...` path, Node.js module resolution may fail to find them
- Using `files` directly is simpler and more reliable

<a id="修改打包配置检查清单"></a>

### Packaging Configuration Change Checklist

1. ✅ SDK uses the `--external` argument in esbuild
2. ✅ SDK main package and `claude-agent-sdk-*` native packages are correctly included in `files`
3. ✅ Test Agent functionality locally in the packaged application:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --dir
```

---

<a id="其他依赖的打包策略"></a>

## Packaging Strategies for Other Dependencies

**Principle: only `electron` and `@anthropic-ai/claude-agent-sdk` need `--external`.**

| Dependency | Strategy | Reason |
|------|------|------|
| `electron` | external | Provided by the Electron runtime |
| `@anthropic-ai/claude-agent-sdk` | external + inclusion in `files` | SDK main package requires runtime resolution; 0.2.113+ native binaries are distributed through optional dependencies |
| All other dependencies (`electron-updater` / `undici` / `pdf-parse`, etc.) | Let esbuild bundle into `main.cjs` | Avoid missing transitive dependencies and simplify electron-builder configuration |

<a id="常见错误"></a>

### Common Mistakes

> **Marking external but forgetting inclusion in `files`**
>
> Runtime cannot find a module after packaging, such as `Cannot find module 'universalify'`.
>
> Fix: either bundle the dependency into `main.cjs` (remove `--external`) or list it and all its transitive dependencies in `files`.

---

<a id="typescript-配置"></a>

## TypeScript Configuration

- `"module": "Preserve"` + `"moduleResolution": "bundler"`
- `"jsx": "react-jsx"`, strict mode, Target ESNext
- All packages use `"type": "module"`; **include `.ts` extensions in imports** (e.g. `import { foo } from './bar.ts'`)

---

<a id="相关资料"></a>

## Related Resources

- [`architecture.md`](./architecture.md) — service / state / component layers
- [`agent-sdk-integration.md`](./agent-sdk-integration.md) — SDK environment-variable hardening (`buildSdkEnv` override logic)
- [`history/sdk-upgrade-notes.md`](./history/sdk-upgrade-notes.md) — SDK version upgrade history
