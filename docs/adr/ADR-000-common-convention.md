# ADR-000：协作规范（分支 / commit / PR）

| 字段 | 内容 |
|------|------|
| **状态** | Accepted |
| **决策时点硬约束** | 无（与 milestone 无关） |
| **拍板日期** | 2026-05-19 |
| **拍板人** | Riting |
| **作者** | Riting |
| **关联** | [CLAUDE.md §3 反馈回路](../../CLAUDE.md)、[`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md)、[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |

---

## 一、背景

现有 [ADR-001](./ADR-001-local-storage.md) / [ADR-002](./ADR-002-server-stack.md) / [ADR-003](./ADR-003-ui-design-system-layering.md) 都是**架构决策**，约束「技术选型应如何取舍」。但仓库目前缺一份**协作元约定**，约束「人 / Agent 与仓库交互时应遵守什么流程」。表现：

- repo 实际遵循 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)（`feat / fix / chore / refactor / docs / ci / revert` 等 prefix），但无明文规范，新人 / Agent 无据可查
- `UI-main` 分支与 `main` 的关系（基线 / mock 数据 / 同步策略）未文档化
- PR 实际是 squash-merge（commit log 中 `(#NN)` 后缀可证），单一主题 / rebase 前置 / 截图等口径散落在 review 评论中
- CI 已强校验 committer email、version 后缀，但规则只在 workflow 里，开发侧不知情

本 ADR 把上述事实约定**明文化**为前置元 ADR（编号 000），定位为「贯穿全部后续 ADR 与日常开发的协作底座」。

---

## 二、决策维度

| 维度 | 关键问题 |
|------|---------|
| **可发现性** | 新人 / Agent 第一天能否在一个文件内读完全部协作约束 |
| **机器可校验** | 关键规则（email / version / Conventional Commits prefix）是否能被 CI 拦截 |
| **历史一致** | 规则是否与 repo 既有 commit history / PR 实践对齐 |
| **多分支模型** | `main` / `UI-main` 双基线如何共存、何时同步 |
| **可扩展** | 规则是否过紧，导致 release / 大型 refactor 等场景失灵 |

---

## 三、决策

### 3.1 分支（branch）

采用 [trunk-based development](https://trunkbaseddevelopment.com/) 的「短 lived feature branch off trunk」模型，并叠加 `UI-main` 作为 UI mock 工作流的并行 trunk。

| 规则 | 说明 |
|------|------|
| 基线 | 始终基于 `main` 或 `UI-main` 开新分支；后端 / 全栈改动基于 `main`，纯 UI/UX mock 改动基于 `UI-main` |
| `UI-main` 起源 | 基于 `main` 创建；后端 API 未就绪前，UI 改动用 **mock 数据** 落 commit 到 `UI-main`，待后端接口可用后由对应 backend PR 合入 `main`，再走 `chore/sync-main-ui-into-main` 拉回 `UI-main` |
| `UI-main` 用途 | 所有基于 mock 数据的 UI/UX 改动合并到此分支；定期 `chore/sync-main-ui-into-main` 双向同步（参考 commit `c2f2bf47` 前后实践） |
| 命名 | `<type>/<short-slug>`，type 与 commit prefix 同集合（`feat / fix / chore / refactor / docs / ci`）；issue 关联用 `fix/issue-142-<slug>` 或 `feat/f51-<slug>` |
| 禁止 | 直接 commit 到 `main` / `UI-main` / 任何带 release / freeze 含义的共享分支；必须走 PR |
| 生命周期 | 短 lived（< 1 周）；超过 1 周需 rebase 一次以避免分歧累积 |

### 3.2 Commit message

采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)。

| 规则 | 说明 |
|------|------|
| 格式 | `<type>(<scope>): <subject>`，可选 `<body>` / `<footer>` |
| type | `feat / fix / chore / refactor / docs / ci / revert / test / perf / style`（前 7 项是 repo 实际使用集合，按 git log 频次） |
| scope | 可选；常见值：`ui / i18n / agent / channels / ux / release / auto-resolve / paper-search-mcp` 等（取自 git log） |
| subject | ≤ 72 字符；现在时祈使语；首字母小写；末尾不加句号；可掺中文 |
| body | 解释「为什么」而非「做了什么」；空行隔开 subject |
| footer | 关联 issue：`Closes #142` / `closes #93`；BREAKING CHANGE 必须在 footer 标注 |
| 禁止 | 直接 commit 到 shared 分支（含 `main` / `UI-main`）；使用 `--no-verify` 跳过 hook；amend 已 push 的 commit |
| committer email | 必须使用当前用户的 `*@opensci.io` 邮箱；CI `verify-commit-email` 强校验（见 `.github/workflows/ci.yml`）；禁止 `noreply@github.com` 等非 opensci 域 |
| 版本号 | 无需手动 bump：pre-commit 钩子（`scripts/bump-version-on-commit.mjs`）自动把改过的 workspace `package.json` 钉到 `origin/main` patch+1（纯数字、不带 `-rc.N`）并 auto-stage；pre-push 不再碰版本号；CI `Version Lint` 仍强校验非 release PR 不得带 `-rc.N` |

### 3.3 Pull Request

采用 [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) + squash-and-merge。

| 规则 | 说明 |
|------|------|
| 创建前 | 必须先把目标分支最新合并进来（`git fetch origin && git merge origin/main` 或 `origin/UI-main`），消化冲突后再开 PR。⚠️ merge 会把源分支**所有** commit 的 author / committer email 暴露给 CI `verify-email`；含贡献者非 `*@opensci.io` 邮箱时须先改写（见 §3.2 / `scripts/verify-commit-email.sh`） |
| PR 前自查 | 开 PR 或更新/推送已有 PR **之前**必须跑一次 `simplify` / `@code-simplifier`，复盘 reuse / 简化 / 可读性后再 push |
| 开 PR 后 | PR 推到远端后跑一次 `/review` skill 审这条 PR，把结果用 `gh pr comment <num> --body ...` 回帖（流程见 [`docs/agents/pr-flow.md`](../agents/pr-flow.md)）。**回帖正文同 body 格式约束：只用表格 + 项目符号，禁分号、禁散文长句，用中文** |
| committer email | PR 中所有 commit（含 merge / rebase 后的）必须使用当前用户的 `*@opensci.io` 邮箱 |
| 单一性 | 每个 PR 只围绕**一个主题**；多主题改动拆多个 PR |
| 标题 | 与 commit 同格式：`<type>(<scope>): <subject>`（squash 后会成为 main 的 commit message） |
| body | 字段沿用 `.github/PULL_REQUEST_TEMPLATE.md`（`Summary / Why / Test Plan / Closes #`）。Agent 写 body 时只用**表格 + 项目符号**，**禁分号、禁散文长句**，用**中文**填充；UI 改动**必须贴截图 / GIF** |
| 合并归属 | `/review` + 回帖后 Agent **流程到此为止**：**绝不**执行 `gh pr merge`、**绝不**开启 auto-merge。合并由开发者手动完成 |
| 合并策略 | 开发者手动 **squash merge**（除非历史确需保留每个 commit）；理由：main 上每条 commit 对应一个完整 PR，便于 `git log` / blame / revert |
| 何时保留 commits（不 squash） | release / 大型 refactor 含明确可独立 revert 的子步骤；需在 PR 描述里明确说明 |
| Review | 至少 1 approval；CI 必通过（typecheck / test / key-parity） |
| 自检 | 走完 [CLAUDE.md §8 Done When](../../CLAUDE.md) 清单 |

### 3.4 文件体积与模块化

巨型单体文件（ipc.ts / agent-orchestrator.ts / preload/index.ts 一度均 ~2000–3000 行）难 code review、单测粒度粗、合并冲突概率高。约定文件体积门槛与三类既定拆分范式，防止再次膨胀。

| 规则 | 说明 |
|------|------|
| 阈值 | 单个 `.ts` / `.tsx` 源文件**软上限 ~500 行、硬上限 ~800 行**（以文件总行数为可量化门槛）；接近软上限即评估拆分，越过硬上限须拆。**已知例外**：紧耦合实例状态的巨型核心 class（如 `agent-orchestrator.ts`）在抽净自包含 helper 后其核心循环仍可能超硬上限，属允许的阶段性状态——须持续按阶段瘦身，不得以此为由停止拆分或回填新代码 |
| IPC 拆分范式 | 主进程 IPC 注册按域拆到 `apps/electron/src/main/ipc/<domain>.ts`，每域导出一个 `register<Domain>Ipc(...)`（复刻 `lib/updater/updater-ipc.ts`）；`ipc.ts` 仅作编排器，`registerIpcHandlers()` 顺序调用各域函数，导出签名与 `main/index.ts` 调用点不变 |
| preload 拆分范式 | preload API 按域拆到 `apps/electron/src/preload/domains/<domain>.ts`，每域导出「API 片段对象 + 对应接口」；`index.ts` 聚合各片段组装同形状 `electronAPI` 并 `satisfies ElectronAPI` 兜底运行期形状；共享监听逻辑走 `preload/helpers.ts` 的 `subscribe()`。⚠️ 拆分**不得改变** `window.electronAPI` 的运行期键集/嵌套/签名 |
| class 拆分范式 | 巨型 class（如 `AgentOrchestrator`）优先抽**自包含纯 helper**（不引用 `this`）到同级 `*-helpers.ts` / `*-<concern>.ts`（如 `-sdk-env.ts` / `-mcp.ts`），依赖改显式参数注入；紧耦合实例状态的核心循环保守留在原类。⚠️ `buildSdkEnv()` 等硬约束函数（[CLAUDE.md §7.2](../../CLAUDE.md)）搬移须逐字保留内部逻辑 |
| 反向规则 | **新增 IPC handler 放对应 `ipc/<domain>.ts`、新增 preload API 放对应 `domains/<domain>.ts`；禁止为图省事把新代码回填已拆薄的编排/聚合文件**，否则巨型文件复发 |
| 拆分守恒 | 拆分是**纯机械搬移**：通道名 / 方法签名 / 运行期形状 / handler 计数守恒，行为不变；每次拆分单独一个 `refactor(...)` commit，配 `typecheck` + `bun test` 全绿 |

---

## 四、已排除方案

- **GitFlow** —— 多分支模型（`develop` / `release` / `hotfix`）过重，与单 milestone 节奏 + Electron 桌面端发版节奏不匹配
- **fast-forward only** —— 与 squash-merge 的「PR 即原子单位」语义冲突；且会让 main 的 commit log 充斥 WIP commit
- **不规范 commit 自由 message** —— `feat / fix / chore` 已是 repo 事实标准，明文化反而降低 review 摩擦

---

## 五、后果

### 正向后果
- 新人 / Agent onboard 时有唯一真相源
- PR 模板、CI 校验、ADR 三者口径对齐
- 后续 ADR（004 起）可直接引用本 ADR，省略协作约定重述

### 负向后果 / 风险
- 旧 PR / 旧 commit 不溯及既往，新规则从签字日起生效
- 规则需随实践演进；若 CI / 模板调整与本 ADR 不一致，应走 ADR 修订流程，不要让文档与机器校验漂移

### 后续动作
- [x] 同步更新 `docs/adr/README.md` 索引（把 000 排在 001 之前）
- [x] 同步更新 `CLAUDE.md §2` 表格加一行指向 ADR-000
- [ ] （可选）在 `.github/PULL_REQUEST_TEMPLATE.md` 顶部加一行 `> 提交前请确认遵循 [ADR-000](../docs/adr/ADR-000-common-convention.md)`
- [x] 引入 commit-msg hook（`.husky/commit-msg` → `scripts/verify-commit-msg.sh`）把 Conventional Commits 从「人盯」升级到「机器拦截」；零依赖 shell（镜像 `scripts/verify-commit-email.sh`），单测 `scripts/verify-commit-msg.test.ts`
