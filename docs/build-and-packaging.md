# 构建与打包

esbuild / Vite / electron-builder 协作细节。重点是 **Agent SDK 外部化规则**——这是项目里最容易出错、
代价最大的一段配置。

---

## 构建工具概览

| 目标 | 工具 | 命令 |
|------|------|------|
| 主进程 | esbuild | `--bundle --platform=node --format=cjs --external:electron --external:@anthropic-ai/claude-agent-sdk` → `dist/main.cjs` |
| Preload | esbuild | 同上但 `--external:electron` → `dist/preload.cjs` |
| 渲染进程 | Vite + React 插件 + Tailwind CSS | `dist/renderer/` |
| 打包分发 | electron-builder | 配置见 `apps/electron/electron-builder.yml` |

### 开发热重载

- **渲染进程** —— Vite HMR 即时生效
- **主进程 / Preload** —— `electronmon` 监听 `dist/` 文件变化自动重启；由 `build:main` / `build:preload` 的 `--watch=forever` 触发

---

## 运行时：Bun

使用 Bun 替代 Node / npm / pnpm：

- `bun install` 安装依赖，`bun run <script>` 运行脚本
- `bun test` 运行测试（内置运行器，`import { test, expect } from "bun:test"`）
- Bun 自动加载 `.env` 文件（无需 dotenv）
- 优先使用 Bun 原生 API：`Bun.file` > `node:fs`，``Bun.$`command` `` > `execa`

---

## Agent SDK 打包要求（必须遵守）

### 规则

1. **esbuild 必须 `--external`** —— `@anthropic-ai/claude-agent-sdk` 不能被打进 `main.cjs`
2. **electron-builder 通过 `files` 包含** —— 不要用 `extraResources`

在 `apps/electron/electron-builder.yml` 中：

```yaml
files:
  - dist/**/*
  - package.json
  - node_modules/@anthropic-ai/claude-agent-sdk/**/*
  - node_modules/@anthropic-ai/claude-agent-sdk-*/**/*
  - "!node_modules/@asci/**"
```

### 为什么这样做

- 这样配置后，SDK 主包会被复制到 `app/node_modules/@anthropic-ai/claude-agent-sdk/`，native binary 包会被复制到同级 `claude-agent-sdk-<platform>-<arch>/`
- Node.js 的模块解析会从 `app/dist/main.cjs` 向上查找 `node_modules`，能正确找到 SDK
- SDK 0.2.113+ 的 `pathToClaudeCodeExecutable` 指向 optional dependency 内的 `claude` / `claude.exe`，因此 native 包必须通过 `files` 进入 `resources/app/node_modules`

### 为什么不用 `extraResources`

- `extraResources` 会把文件复制到 `Contents/Resources/` 目录
- 使用 `to: app/node_modules/...` 路径时，Node.js 模块解析可能无法找到
- 直接用 `files` 更简单可靠

### 修改打包配置检查清单

1. ✅ SDK 在 esbuild 中使用 `--external` 参数
2. ✅ SDK 主包与 `claude-agent-sdk-*` native 包在 `files` 配置中被正确包含
3. ✅ 本地测试打包后的应用 Agent 功能：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false bunx electron-builder --mac --dir
```

---

## 其他依赖的打包策略

**原则：只有 `electron` 和 `@anthropic-ai/claude-agent-sdk` 需要 `--external`。**

| 依赖 | 策略 | 原因 |
|------|------|------|
| `electron` | external | 由 Electron 运行时提供 |
| `@anthropic-ai/claude-agent-sdk` | external + `files` 包含 | SDK 主包需要运行时解析，0.2.113+ native binary 由 optional dependency 分发 |
| 其他所有依赖（`electron-updater` / `undici` / `pdf-parse` 等） | 让 esbuild 打包进 `main.cjs` | 避免遗漏子依赖，简化 electron-builder 配置 |

### 常见错误

> **标记为 external 但忘记在 `files` 中包含**
>
> 打包后运行时找不到模块，如 `Cannot find module 'universalify'`。
>
> 修复：要么把依赖打进 `main.cjs`（去掉 `--external`），要么在 `files` 中列出该依赖及其所有子依赖。

---

## TypeScript 配置

- `"module": "Preserve"` + `"moduleResolution": "bundler"`
- `"jsx": "react-jsx"`、严格模式、Target ESNext
- 所有包 `"type": "module"`，**导入时带 `.ts` 扩展名**（如 `import { foo } from './bar.ts'`）

---

## 相关资料

- [`architecture.md`](./architecture.md) —— 服务层 / 状态层 / 组件层
- [`agent-sdk-integration.md`](./agent-sdk-integration.md) —— SDK 环境变量加固（`buildSdkEnv` 覆盖逻辑）
- [`history/sdk-upgrade-notes.md`](./history/sdk-upgrade-notes.md) —— SDK 版本升级历史
