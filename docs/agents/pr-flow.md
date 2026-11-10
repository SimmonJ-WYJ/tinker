# PR flow: open, sync, review

通用 PR 规范见 [ADR-000 §3.3](../adr/ADR-000-common-convention.md)，当前 Tinker 仓库目标以本文为准。本文给 Agent 列出可直接执行的 `gh` / `git` 步骤。所有操作用 `gh` CLI，目标恒为 `origin`（`SimmonJ-WYJ/tinker`）。

## 开 PR 前：合并最新主干

1. 拉最新并合并目标分支（base = `main` 或 `UI-main`）：
   ```bash
   git fetch origin
   git merge origin/main      # 或 origin/UI-main
   ```
   消化所有冲突后再继续。
2. **提交身份与历史**：正常运行本仓库 hooks。当前 `scripts/verify-commit-email.sh` 允许 `@opensci.io` 或 GitHub 个人 noreply 邮箱及列出的 bot，具体以脚本为准；遇到守门失败先核对新增提交范围与配置，保留已有作者归属，不为套用上游组织规则重写继承历史。
3. 跑一次 `simplify` / `@code-simplifier` 复盘 reuse / 简化 / 可读性，再 push。

## 开 PR

- 多行 PR 正文先写入临时文件，执行时用 `--body-file`；下例展示字段结构，避免把正文插入 shell 命令。

```bash
# 将以下字段填入 /tmp/tinker-pr-body.md：Summary / Why / Closes # / Test Plan
# Test Plan 按实际结果记录 typecheck、Bun tests 与涉及的构建或 UI 验证。
gh pr create --repo SimmonJ-WYJ/tinker \
  --base main \
  --title "<type>(<scope>): <subject>" \
  --body-file /tmp/tinker-pr-body.md
```

- 标题与 commit 同格式（squash 后成为 main 的 commit message）。
- body 字段沿用 `.github/PULL_REQUEST_TEMPLATE.md`（`Summary / Why / Test Plan / Closes #`）。
- **body 格式硬约束**：只用**表格 + 项目符号**，**禁分号、禁散文长句**，用**中文**填充；UI 改动必须贴截图 / GIF。

## PR 开好后：审查并回帖

1. 对刚推上去的 PR 跑一次 `/review` skill 做代码审查。
2. 把审查结果写入临时文件后回帖，包含发现、位置、建议及已核实项目：
   ```bash
   gh pr comment <num> --repo SimmonJ-WYJ/tinker --body-file /tmp/tinker-pr-review.md
   ```
   - **回帖格式硬约束**：同 PR body —— 只用**表格 + 项目符号**，**禁分号、禁散文长句**，用**中文**。
3. ⚠️ **回帖即收尾**：到此 Agent 流程**结束**。**绝不**执行 `gh pr merge`、**绝不**开启 auto-merge——合并是人工动作，留给开发者手动完成。

## 远端说明

当前 `origin` 为 `SimmonJ-WYJ/tinker`。`gh` 在 clone 内通常自动推断；若选错，显式传 `--repo SimmonJ-WYJ/tinker`。上游 [`OPENSCI-Labs/ASCI-Alpha`](https://github.com/OPENSCI-Labs/ASCI-Alpha) 的 issue / PR 链接保留原归属，不把旧编号当成本仓 issue。
