> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](../2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 研究空白·小版 Spec（Research Gap · In-Selection）

> **状态**：草稿 · 待 review · 2026-06-23
> **关联 milestone**：[`docs/milestones/0.4/north-star.md`](../../milestones/0.4/north-star.md) §一（P1 研究空白，审计标准 GM1–GM7）
> **关联 PRD**：[`docs/specs/0.4.0/0.4.0-prd.md`](./0.4.0-prd.md) Epic 1
> **关联 issue**：[#708](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/708)（沉淀依赖 Epic2 [#709](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/709)）
> **领域语言事实源**：`CONTEXT.md`「研究空白」「证据集与笔记」「文献语料与检索」三域 + 本 spec §2
> **关联 spec**：[`capability-package-spec.md`](../capability-package-spec.md)（能力包架构）· [`at-mention-evidence-set-spec.md`](../at-mention-evidence-set-spec.md)（证据集沉淀，Epic2 衔接）· `evidence-set-topic-container`（ADR-007，一集多笔记前置）
> **交互原型**：[`assets/research-gap-prototype.html`](./assets/research-gap-prototype.html)（用 ASCI 真实 token 还原，4 阶段可切换）
>
> 📌 本 spec = Epic1 的设计 + 实现计划权威源；目标 / 验收口径以北极星 GM1–GM7 为准。

---

## 1. 概述与定位

**研究空白·小版**：在用户圈定的一组文献上，AI 抽出"谁做过什么"的**对照表**，标出**没人填的组合（空白）**和**互相打架的结论（冲突）**，每条可溯源，用户拍板哪个值得做，结果沉淀进证据集。

三条不可动摇的定位：

1. **增强而非替代** —— AI 只铺对照表、指空白、标冲突；"是不是真创新 / 哪个值得做"永远由用户判断，AI 不下该结论（HITL）。
2. **范围严格限定"所选文献内"** —— 一切空白/冲突只在用户选的这组论文内成立，**零**"全领域/全世界没人做过"措辞。全前沿版（开放世界）→ 0.5。
3. **最小化复用** —— 作为新能力包接入现有注册中心，复用现有对话流 + 右侧 Tab + 文献解析 + 证据集；**只新增一个表格视图**，不建通用 renderer 框架。

---

## 2. 领域语言

| 术语 | 定义 | 来源 |
|------|------|------|
| **研究空白**（唯一新增） | 把一组文献按可比维度排成对照表后，**没人填的属性组合（空格子）= 研究空白**，外加 AI 标出的结论冲突。严格限定"在所选的这组文献内"。 | CONTEXT.md（本 spec 回填） |
| 对照表 | 白话：把一组文献按可比维度铺开的表（论文=行、维度=列）。非术语。 | — |
| 证据集 / 证据条目（EvidenceRef）/ 笔记 | 沿用已有术语。对照表里**每个填上的格子 = 一条证据条目**（可溯源）。 | CONTEXT.md「证据集与笔记」 |

> 命名约定：只新增「研究空白」；**不**使用「假设 / hypothesis / 创新点」作为系统输出术语。

---

## 3. 决策总表（讨论结论一览）

| 层 | 决策点 | 结论 |
|----|--------|------|
| 形态 | 运行与呈现 | **多入口唤起（显式 UI 入口 / 对话框 @ 选材料 + 自然语言或显式指令）→ 单路由到 research-gap 单包；右侧"研究空白"表格视图**（复用 Chrome Tab + 能力包 Manifest + at-mention 栈，不改核心代码；**不做**多包自主编排）|
| 形态 | 空白语义 | **论文×维度主表 + AI 标注"组合空白"与"结论冲突"**；不做完整交叉透视表（避组合爆炸 + 超抽取能力） |
| 交互 P1 | 表格轴 | 论文=行、AI 提议维度=列；列可增 / 删 / 改 |
| 交互 P2 | 空白呈现 | 琥珀卡片列表 **+ 点击卡片→对照表上联动高亮**支撑论文行/维度列 |
| 交互 P3 | 溯源 | 点格子→弹层预览原文片段（带出处）→可跳精读锚点 |
| 交互 P4 | 可信底线 | 范围徽章 + 底部可信底线条；**底层 AI 输出措辞硬过滤 + 回归测试**（必做） |
| 交互 P5 | 沉淀 | 对照表=1 条结构化笔记；每个选中空白/冲突=1 条带溯源条目（依赖 Epic2 一集多笔记） |
| 机制 M1 | 抽取过程 | 全部抽完一次性出整表；进度走现有 Agent 执行步骤流 |
| 机制 M2 | 改列重填 | 改列后点"重新填表"才触发，不自动重抽 |

---

## 4. 用户流程（对应原型 4 阶段）

```
① 圈定文献          ② AI 提议列         ③ 抽取填表（M1）      ④ 完成：对照表+空白+冲突   ⑤ 拍板+沉淀（P5）
   从证据集 /          AI 看完提议           执行步骤流显示          论文×维度对照表             勾"值得做" →
   文献库勾选    →     4–6 个维度（列）  →   "12/18 篇…"      →    + 琥珀空白卡 + 红冲突卡  →   存入证据集
   （GM1）            用户增删改（P1）       一次性出整表            每格可溯源（P3/GM2）        （GM6）
                                                                  范围徽章+可信底线（P4/GM4-5）
```

---

## 5. 详细设计

### 5.1 运行形态：能力包 + 多入口唤起 + 右侧表格视图

- **新增能力包 `research-gap`**（声明式 Manifest，复用现有注册中心，**无需改核心代码**）。完整命名规范 `asci.builtin.research-gap`，packId 与现有 `lit-search`/`lit-review` 实际惯例一致取 `research-gap`。
- **发起入口与唤起（GM1，复用现有选择交互与 @ 提及栈，不另造）**——选材料（输入文献集）与触发（唤起）解耦，三路统一汇入同一场景 Agent：
  - **A. 显式 UI 入口**：从**一个证据集**发起（证据集详情页 → "找研究空白"）；在**文献库 / 检索结果**里勾选一组论文 → 发起。
  - **B. 对话框 `@` 选材料**：用户在对话框用 `@` 提及一个证据集或一批论文（复用 at-mention 栈，见 [`at-mention-evidence-set-spec.md`](../at-mention-evidence-set-spec.md)），把文献集带入上下文。
  - **触发**：选材料后，用户既可**自然语言**说"找这组文献的研究空白"→ **总控 Agent 识别意图、单路由到 research-gap 包**；也可用**显式调用指令**直接点名调起。
  - **边界**：以上仅为"**单路由到 research-gap 这一个包**"。**不含** Supervisor 自主编排*多个*能力包——后者北极星列为 0.4「不做」（需 ADR）。
- **运行**：场景 Agent 在对话流里跑，执行步骤分组（`ExecutionStepGroup`）实时显示"读全文 / 提议列 / 逐篇填表 / 标注空白冲突"。跑在用户 BYOK channel。
- **呈现**：产出在右侧面板**新增的 `research-gap-table` Tab**（Chrome 风累积，用户不关不消失），承载对照表的查看 / 编辑列 / 联动高亮 / 拍板。

### 5.2 对照表数据模型与溯源

数据形态（草案，最终类型实现时定，验收只验"可存可读回"，落 `packages/shared/src/types/research-gap.ts`）：

```ts
interface ResearchGapTable {
  id: string
  sourceSelection: PaperSelectionRef   // 圈定的文献集（证据集 id 或 paperId[]）
  columns: GapColumn[]                  // AI 提议 + 用户编辑后的维度
  rows: GapRow[]                        // 每篇论文一行
  gaps: ResearchGap[]                   // AI 标注的组合空白
  conflicts: ConflictNote[]             // AI 标注的结论冲突
  scopeLabel: string                    // "基于你选的 18 篇文献" —— 范围披露
}
interface GapColumn { id; name; origin: 'ai' | 'user' }
interface GapRow { paperId; cells: Record<columnId, GapCell> }
interface GapCell {
  value: string | null                 // null = 该篇未涉及该维度（斜纹空格）
  evidenceRef?: EvidenceRef            // 填了的格子 = 一条证据条目（溯源锚点）
}
interface ResearchGap { id; title; rationale; supportingPaperIds[]; involvedColumnIds[] }
interface ConflictNote { id; title; paperRefs: EvidenceRef[]; rationale }
```

**溯源（P3 / GM2，复用现成机制）**：每个非空格子的 `evidenceRef` 用现成 `Anchor`（`packages/shared/src/types/anchor.ts`，双层定位 = 结构化 `locationData` + 兜底 `snapshotText`）。点格子 → 弹 popover 预览原文快照 + 出处 → "跳精读锚点"打开/切到该论文 `paper-detail` tab 并定位。

### 5.3 空白判定（论文×维度主表 + AI 标注）

- **主结构**：论文×维度对照表。每个填了的格子 = 一条可溯源证据；空格 = 该篇未涉及该维度（斜纹，**不等于**研究空白）。
- **组合空白（ResearchGap）**：AI 在填好的表上挑 1–2 对关键维度，标出**这组论文里没出现的取值组合**（如"ViT + from-scratch + miniImageNet 无人覆盖"）。**不强行铺完整交叉表**——只产出有依据的洞察条目，规避组合爆炸与超出抽取能力。
- **结论冲突（ConflictNote）**：AI 标出跨论文在相近设置下结论相反处（如"预训练是否有用"）。
- 每条空白/冲突都带 `rationale` + `supportingPaperIds`/`paperRefs`，**可溯源、限定所选文献内**（GM3）。

### 5.4 交互细则

| 项 | 设计 |
|----|------|
| **列管理（P1）** | AI 提议 4–6 列（`origin:'ai'`，虚线 chip）；用户增/删/改（改后 `origin:'user'`）。提示"维度越聚焦，组合空白越有意义"。 |
| **联动高亮（P2）** | 点空白卡 → 对照表高亮该空白的 `supportingPaperIds` 行 + `involvedColumnIds` 列；点冲突卡 → 高亮冲突两篇行 + 该维度列。`ring`/底色用状态色，非聚焦环（符合 design.md §9 例外）。 |
| **抽取（M1）** | 用户确认列 → 一次性逐篇抽取 → 全表完成才呈现。进度走 `ExecutionStepGroup`，"N/M 篇"。 |
| **改列重填（M2）** | 增删改列后出现"重新填表"按钮，用户点击才重抽（不自动、不增量；增量 → 后续优化）。 |
| **大表审阅（GM8 体验）** | 表头 sticky、首列 sticky；支持排序 / 筛选 / 管理列（最小实现，不做透视）。 |

### 5.5 可信底线（P4 / GM4 / GM5 —— 产品命门）

三道守门，缺一不可：

1. **范围限定（视觉）**：右侧顶部范围徽章 `基于你选的 N 篇` 常驻 + 底部可信底线条"仅在这 N 篇内成立，不代表全世界没人做过；是否值得做由你判断"。
2. **措辞硬过滤（输出）**：场景 Agent / Skill 的产出过一道脱敏式措辞过滤，扫并拦截/改写 `全领域 / 全世界 / 没人做过 / 这是创新点 / novel / 首创` 类越界措辞。
3. **拍板止损（语义）**：AI 输出**止于**"铺表 + 指空白 + 标冲突"，**不**输出"哪个值得做 / 是否创新"的结论（GM5）。
4. **回归测试**：专门用例扫产品文案 + AI 输出，命中越界措辞即 fail（GM4/GM5 验收）。

### 5.6 沉淀（P5 / GM6，衔接 Epic2）

- **拆法**：对照表整体 → **1 条结构化笔记**；用户勾选的每个空白/冲突 → **1 条带溯源的证据条目**，写入目标证据集（成为容器成员，与 Epic2 模型对齐）。
- **依赖**：现状"1 证据集 = 1 条笔记"，本拆法需 **Epic2 的「一集多笔记」先就位**（ADR-007）。
- **降级**：若 Epic2 未就位时需先验证 Epic1 主链路，可临时退化为 "整个分析=1 条笔记"（决策 P5 的 B 档）作为过渡，**不作为最终交付形态**。
- 验收只验"可存入 + 完整读回 + 保序"（GM6）。

### 5.7 能力包编排（研发落点，按 PRD D + 摸排结论）

```
场景 Agent: research-gap（planner）—— 澄清圈定文献集、编排三步、处理改列重填、守可信底线
  ├─ column-proposer   读 N 篇结构/摘要 → 提议 4–6 个可比维度（列）
  ├─ cell-extractor    对每篇按确定的列抽取取值 + 溯源锚点（★抽取命门，量大）
  └─ gap-analyzer      在填好的表上标组合空白 + 结论冲突，每条带依据
工具复用: papers-rg MCP（papers_read_* 读全文结构化 / papers_semantic_search）
模型: 跑用户 BYOK；cell-extractor 量大可走较快模型，gap-analyzer/planner 走推理模型
```

---

## 6. 复用点与扩展点（摸排结论，带文件路径）

**复用（现成，直接用）**
| 对象 | 文件 |
|------|------|
| 右侧 Chrome Tab 框架 | `apps/electron/src/renderer/atoms/right-panel-tabs.ts` · `components/app-shell/RightPanelTabContent.tsx` |
| 能力包注册中心（Manifest 驱动，免改码） | `apps/electron/src/main/lib/capability-pack-loader.ts` · `subagent-registry.ts` |
| 抽取语料层 | papers-rg MCP（`papers_read_*` / `papers_semantic_search`，lit-review reader 在用） |
| 溯源 | `packages/shared/src/types/anchor.ts`（Anchor 双层定位）· `objects/evidence-ref.ts`（EvidenceRef） |
| 证据集聚合查询 | `apps/electron/src/main/lib/objects/query-service.ts` |

**扩展（需新增/改）**
| 目标 | 落点 |
|------|------|
| Tab 类型 | `right-panel-tabs.ts` `TabKind` 加 `'research-gap-table'` |
| Tab 路由 + 视图组件 | `RightPanelTabContent.tsx` 加 case + 新组件 `ResearchGapTableView.tsx` |
| 能力包 | 新建 `apps/electron/default-capability-packs/research-gap/`（manifest + scenario/sub-agents prompts） |
| 数据类型 | `packages/shared/src/types/research-gap.ts` |
| IPC（如需持久化） | `researchGap:*` 通道，走四联同步（shared→main→preload→renderer） |
| i18n | `research-gap` ns，en+zh 同步落键 |

---

## 7. 前置 spike（GM7 · 动工核心前必做）

**抽取质量是本功能命门，也是业界最不成熟环节（最强工具准确率仅 39%）。核心实现前先跑：**

| 项 | 口径 | 产出 |
|----|------|------|
| ① 抽取准确率 | 真实 15–20 篇（用户实际领域）跑 column-proposer + cell-extractor，人工抽样核格子填对比例 | 准确率数值 |
| ② 篇数上限 | 一次能稳定处理的论文篇数（不崩、不显著掉准） | 上限 + 是否分批策略 |
| ③ BYOK 成本/时延 | 用户 key 跑一次的真实 token 成本与耗时 | 单次成本/时延 |
| ④ 单路由可挂载性 | 确认现有"单路由到一个包"能挂 research-gap 新包、且自然语言意图可触发（若现状为手动选包，则评估补一条"意图→包"路由的工作量）| 可行性结论 + 工作量 |

**降级策略（不达标时）**：缩小单次篇数 → 减少对照表维度 → 降低自动化深度。**原则：守"证据优先于承诺"，不拿未验证的抽取能力当交付承诺。**

---

## 8. 验收（映射北极星 GM1–GM7）

| 审计 | 验收 |
|------|------|
| GM1 | 显式入口（证据集 / 勾选论文）各发起一次；对话框 @ 选材料后，自然语言 + 显式指令各唤起一次 |
| GM2 | 对照表列为 AI 提议且可增删改；点任一非空格子跳回原文锚点 |
| GM3 | 走查见组合空白与结论冲突标注，每条可溯源 |
| GM4 | 回归测试扫产品文案/AI 输出，**零**"全领域/全世界没人做过"措辞 |
| GM5 | 回归测试扫 AI 输出，**不出现**"这是创新点/novel"类替用户拍板结论 |
| GM6 | 对照表 + 选中空白写入证据集，读回完整、保序 |
| GM7 | spike 三项（准确率/篇数/成本）有量化结论，**结论先于核心实现** |

---

## 9. Out of Scope

- 研究空白·**全前沿版**（范围扩到整个领域）→ 0.5（依赖文献深钻语料）。
- 完整维度取值**交叉透视表** → 不做（组合爆炸 + 超抽取能力）。
- 自动生成具体研究主张 → 不做（仅在表上提示，仍用户拍板）。
- 改列**增量重抽** → 后续优化（本期全量重填）。
- 渐进/骨架填表（M1 的 B/C） → 后续优化。
- 可插拔 renderer 通用框架 → 不做（仅一个新表格视图）。

---

## 10. 依赖与实施顺序

```
前置：GM7 抽取 spike（真实论文，量化准确率/篇数/成本）   ← 阻塞核心实现
并行可起步：能力包骨架（manifest + 三子 Agent prompt）、Tab 类型 + 空视图组件
spike 出结论后：
  column-proposer → cell-extractor → gap-analyzer 串成对照表
  → 右侧表格视图（列管理 + 联动高亮 + 溯源） → 可信底线 → 沉淀（衔接 Epic2）
```

依赖：**沉淀 ⬅ Epic2 一集多笔记（ADR-007）**；**核心 ⬅ GM7 spike 结论**。

---

## 11. 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 抽取质量不达标（SOTA 仅 39%） | 功能价值落空 | GM7 spike 先验，据结论定深度，不达标降级范围 |
| "空白"被读成"全世界没人做过" | 可信度崩 | §5.5 三道守门 + 措辞回归测试 |
| 沉淀依赖 Epic2 未就位 | Epic1 收尾受阻 | 过渡退化为"整个分析=1 笔记"，Epic2 就位再升级 |
| 大表审阅体验差 | 头牌功能体感差 | sticky 表头/首列 + 排序/筛选；篇数上限由 spike 控 |

---

**Spec 版本**：v1 · 2026-06-23 · 待 review
