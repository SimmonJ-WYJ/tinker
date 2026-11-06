# PR flow: open, sync, review

PR 规范的真相源是 [ADR-000 §3.3](../adr/ADR-000-common-convention.md)。本文给 Agent 列出可直接执行的 `gh` / `git` 步骤。所有操作用 `gh` CLI，目标恒为 `origin`（`OPENSCI-Labs/ASCI-Alpha`）。

## 开 PR 前：合并最新主干

1. 拉最新并合并目标分支（base = `main` 或 `UI-main`）：
   ```bash
   git fetch origin
   git merge origin/main      # 或 origin/UI-main
   ```
   消化所有冲突后再继续。
2. ⚠️ **committer email**：merge 会把源分支**所有** commit 的 author / committer email 一并带进来，CI `verify-email` 会逐条校验。任一 commit 邮箱不是 `*@opensci.io`（或允许的 `@users.noreply.github.com`）须先改写——squash merge 也救不了 sync 分支。校验逻辑见 `scripts/verify-commit-email.sh`，规则见 [ADR-000 §3.2](../adr/ADR-000-common-convention.md)。
3. 跑一次 `simplify` / `@code-simplifier` 复盘 reuse / 简化 / 可读性，再 push。

## 开 PR

```bash
gh pr create --repo OPENSCI-Labs/ASCI-Alpha \
  --base main \
  --title "<type>(<scope>): <subject>" \
  --body "$(cat <<'EOF'
## Summary

| 改动 | 说明 |
|------|------|
| ... | ... |

## Why

- ...
- ...

Closes #

## Test Plan

- [ ] bun run typecheck
- [ ] bun test
EOF
)"
```

- 标题与 commit 同格式（squash 后成为 main 的 commit message）。
- body 字段沿用 `.github/PULL_REQUEST_TEMPLATE.md`（`Summary / Why / Test Plan / Closes #`）。
- **body 格式硬约束**：只用**表格 + 项目符号**，**禁分号、禁散文长句**，用**中文**填充；UI 改动必须贴截图 / GIF。

## PR 开好后：审查并回帖

1. 对刚推上去的 PR 跑一次 `/review` skill 做代码审查。
2. 把审查结果用评论回帖（多行用 heredoc）：
   ```bash
   gh pr comment <num> --repo OPENSCI-Labs/ASCI-Alpha --body "$(cat <<'EOF'
   ## /review 结果

   | 发现 | 位置 | 建议 |
   |------|------|------|
   | ... | `file:line` | ... |

   ### 已核实无虞

   - ...
   EOF
   )"
   ```
   - **回帖格式硬约束**：同 PR body —— 只用**表格 + 项目符号**，**禁分号、禁散文长句**，用**中文**。
3. ⚠️ **回帖即收尾**：到此 Agent 流程**结束**。**绝不**执行 `gh pr merge`、**绝不**开启 auto-merge——合并是人工动作，留给开发者手动完成。

## 远端说明

本仓库有两个 remote：`origin`（`OPENSCI-Labs/ASCI-Alpha`，canonical）与 `personal`（`pantsbang-yannik/ASCI-P`）。`gh` 在 clone 内通常自动推断；若选错，显式传 `--repo OPENSCI-Labs/ASCI-Alpha`。
