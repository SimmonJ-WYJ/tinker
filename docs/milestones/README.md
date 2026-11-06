# Milestones 目录公约

> 这份公约约束 `docs/milestones/` 和 `ya-docs/milestones/` 的目录结构与文件命名，目的是让"讨论 → 定稿 → 团队共享"的迁移路径无需任何路径改写。

---

## 1. 目录结构

```
docs/milestones/                 # 团队共享，进 git
  README.md                      # ← 本文件，目录公约
  0.1/
    north-star.md
  0.2/
    north-star.md                # ← 该版本唯一主入口
    moat-analysis.md             # 附件：护城河分析（虎尼克）
    milestone-review.md          # 附件：版本评审（虎尼克）
  0.3/
    north-star.md

ya-docs/milestones/              # 本地讨论场，被 .gitignore 忽略
  0.1/                           # 结构与 docs/milestones/ 完全镜像
  0.2/
  0.3/
```

**两条硬规则**：

1. **每个版本目录有且只有一个 `north-star.md`**——它是该版本的总结/主入口。北极星目标的所有变更都收敛到这一个文件。
2. **其他 `.md` 一律视为附件**，与 `north-star.md` 同目录平铺，不再分子目录。需要时直接在 `north-star.md` 中用相对链接 `./xxx.md` 引用。

附件的常见命名（按需挑选，不强制全部存在）：

| 文件名 | 用途 |
|--------|------|
| `north-star.md` | **唯一主入口**，本版本的最终目标与审计标准 |
| `moat-analysis.md` | 护城河 / 战略定位分析（鹰尼克 / 虎尼克） |
| `milestone-review.md` | 版本评审 / SWOT / CLEAR（虎尼克） |
| `{topic}-research.md` | 主题调研（鹰尼克） |
| `{topic}-spec.md` | 设计规格（狐尼克） |
| `feedback-{date}.md` | 反馈整理（猫尼克） |

附件名**不带版本号前缀**——已经在版本目录里了。

---

## 2. 引用约定

| 场景 | 写法 |
|------|------|
| 同版本附件互引 | `[moat-analysis.md](./moat-analysis.md)` |
| north-star 跨版本引用附件 | `[moat-analysis.md](../0.2/moat-analysis.md)` |
| 跨版本带 anchor | `[0.2 开放标准 O1](../0.2/north-star.md#对象标准开放护城河-p0)` |

跨版本引用注意 anchor 的 GitHub slug 规则：中文保留，括号删除，空格转 `-`，全部小写。

---

## 3. 命名空间冲突防御

**同版本内不同章节的审计标准编号不能撞名**。例如：
- ❌ §四"版本更新"用 `O1/O2/O3`，§六"对象标准开放"也用 `O1/O2/O3`
- ✅ 前者改用 `UP1/UP2/UP3`（Update），后者保留 `O1/O2/O3`（Open）
- ✅ §二"设计约束"用 `D1/D2/D3`，§六"数据所有权"改用 `DO1-DO4`（Data Ownership）

**跨版本可以复用编号**（因为带 anchor 引用时是 `../0.2/north-star.md#xxx` 显式定位）。

---

## 4. 工作流：讨论 → 定稿

### 第一稿
- 直接在 `ya-docs/milestones/{version}/{file}.md` 写。
- Agent 战略产出（如虎尼克的 `moat-analysis.md`）也直接写到 `ya-docs/milestones/{version}/`，不要再绕 `ya-docs/{version}/{agent-name}/`。
  - 例外：那些**不会进 milestone** 的 Agent 工作底稿（调研笔记、过程稿）仍按 `.claude/CLAUDE.md` 放 `ya-docs/{version}/{agent-name}/`。
  - 判定标准：这份文档会被 `north-star.md` 引用吗？是 → 直接写 milestones/；否 → 写 agent 目录。

### 修订
- 已发布的某版本要修订时：
  ```bash
  cp -r docs/milestones/{version}/ ya-docs/milestones/{version}/
  ```
  在 ya-docs 修改、讨论。

### 定稿
- 修改完成后：
  ```bash
  cp -r ya-docs/milestones/{version}/* docs/milestones/{version}/
  ```
  路径相同 → 引用零改动。git diff 在 docs 中可见。

### 不变量
- 任何时候 `find docs/milestones -type f` 和 `find ya-docs/milestones -type f` 的相对路径集合应该是 `ya-docs ⊇ docs`（ya-docs 可以多出正在讨论的草稿，但已存在 docs 的文件 ya-docs 应有同名同结构副本作为"工作底稿"或"已同步副本"）。

---

## 5. 不做的事

- ❌ 不分附件类型子目录（`strategy/`、`research/`），避免空目录与过度分层。
- ❌ 不在 docs/milestones/ 写"草稿/讨论中"标注——草稿留在 ya-docs，定稿才进 docs。
- ❌ 不引用 `ya-docs/...`——docs 的链接对外可见，引用 .gitignore 的路径会断。

---

## 6. 跨批次 summary 与团队同步交付物

当一次讨论跨越多个版本（如 0.2 + 0.3 一起规划），会产出多种衍生文档。区分两类，分别走不同流程。

### 6.1 文件分类与位置

| 文件 | 性质 | 位置 |
|------|------|------|
| `summary-v<起>-v<止>.md` | 讨论档（含可行性评估、行动清单、PM 内部叙事）| **仅** `ya-docs/milestones/` 根 |
| `asci-v<起>-v<止>-overview.html` | 团队同步整合交付物（版本规划 + 产品原型 单页整合）| **同时** `ya-docs/` + `docs/milestones/` 根 |

命名规则：
- 跨版本批次：`asci-v<起始版>-v<结束版>-overview.html`（如 `asci-v0.2-v0.3-overview.html`）
- 单版本批次：`asci-v<版本>-overview.html`（如 `asci-v0.4-overview.html`）
- 前缀统一 `asci-v`，排序时自动归类
- 旧批次的 HTML / markdown summary **不覆盖、不改名**，保留作为历史决策档案
- 历史命名：早期 v0.2 / v0.3 批次曾分 `summary-v<起>-v<止>.html`（规划可视化）+ `prototypes-v<起>-v<止>.html`（产品原型）两份文件，2026-05-14 合并为单页 `asci-v<起>-v<止>-overview.html`

### 6.2 生命周期

- **markdown summary** 是讨论期对齐工具，**只入 ya-docs/**——含可行性评估 / 重排理由 / PM 内部叙事，不向外部暴露
- **HTML 交付物** 是面向团队的成品，**同步到 docs/** 让所有人可访问
- 讨论定稿后，summary 中的所有"决策类内容"必须吸收进各版本 `north-star.md`（north-star 是单一权威源）

### 6.3 与 north-star 的边界

- north-star = 单个版本的"做什么 + 怎么验证"权威源
- summary = 跨版本批次的"为什么这么切 + 整体可行性 + 重排理由"讨论档
- HTML 交付物 = 基于 summary §一 版本规划的可视化呈现，**不引入 north-star 没有的决策**
- 重叠内容以 north-star 为准
