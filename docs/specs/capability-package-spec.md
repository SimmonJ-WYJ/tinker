# 能力包概念 Spec（Capability Package Concept Specification）

> **状态**：草稿 · 待 review
> **审计标准**：0.2 §三-4 X2
> **关联 issue**：#231（E-4）
> **依赖输入**：E-1 (#218) 访谈清单 · lit-search / lit-review 场景 Agent 编排说明（原始来源文档已吸收进 `docs/milestones/0.2/2026-05-23-agent-and-capability-pack-spec.md` §5.3/§5.4 并清理）
> **阻塞后续**：D-4 (#239) schema 实现 · E-5 (#236) UI 概念稿 · E-6 (#240) 迁移方案

---

## 1. 概述与定位

### 1.1 什么是能力包

**能力包（Capability Package）** 是 ASCI 向用户交付"可下达任务"能力的最小可发布单元。

当前 ASCI 的配置和场景更像 Coding Agent——用户需要分别配置 MCP、Skill、Provider 模型。能力包范式将这些基础设施打包为用户可直观理解的任务域（检索/综述/写作/实验...），**一键安装即可向 Agent 下达任务**。

核心公式：

```
能力包 = 场景 Agent 设定 + Skill 引用 + MCP 引用 + UI 框架选择与渲染配置
       + capabilities.proposals[]（副产品契约，v0.3 兑现）
```

### 1.2 与 Skill 的关系

| 维度 | Skill | 能力包 |
|------|-------|--------|
| 粒度 | 单一能力片段（一个 SKILL.md + 实现） | 面向任务域的完整解决方案 |
| 心智模型 | "工具箱里的一把螺丝刀" | "一套完整的工作台" |
| 组合方式 | 被能力包引用，也可独立启用 | 引用多个 Skill + MCP 组成 pipeline |
| Agent 交互 | 被 Agent 按匹配度选择调用 | 自带场景 Agent，定义完整会话拓扑 |
| 用户视角 | 高级用户在设置中管理 | 所有用户在"配置"页浏览/安装/管理 |

> **设计判据**：用户需在 30 秒内区分"调系统参数 vs 管 Agent 能力"（X1.2 验证项，正确率 ≥ 60% 方可维持二分）。

### 1.3 不做的事（Non-scope）

- 能力包 marketplace / 第三方扩展（0.4+）
- 能力包自动升级（0.4+）
- 包间依赖解析（0.2 只做概念预留，0.3 首发包互不依赖）
- 非 TypeScript 语言的能力包（0.4+ 评估 Python 等）

---

## 2. 命名与粒度

### 2.1 包 ID 命名规范

```
<scope>.<category>.<name>

示例：
  asci.builtin.lit-search    ← 内置文献检索包
  asci.builtin.lit-review    ← 内置文献综述包
  asci.community.writing     ← 社区贡献的写作包（0.4+）
```

| 字段 | 规则 |
|------|------|
| `scope` | `asci`（官方）· 0.4+ 开放组织 scope |
| `category` | `builtin`（内置）/ `community`（社区）/ `enterprise`（企业） |
| `name` | kebab-case，≤ 32 字符，全局唯一 |

完整包 ID 用于 `Proposal.sourceCapability` 字段，是采纳率统计的分组键，**必须全局唯一且不可变**。

### 2.2 最小可发布单元粒度判据

一个能力包对应**一个用户可感知的任务域**。判据：

1. **独立可用**：安装后不依赖其他能力包即可完成至少一个端到端任务
2. **场景 Agent 唯一**：每个包有且仅有一个场景 Agent 入口
3. **Skill 可复用**：包内引用的 Skill 可被其他包共享（引用而非拷贝）
4. **拆分信号**：当一个包的场景 Agent 需要处理两种无关联的意图分支时，应拆成两个包

反例——不应合并：
- "检索 + 综述"是两个包，因为输入（自然语言 query vs 已选定 EvidenceSet）和输出（论文列表 vs review.md）完全不同
- "检索 + 引文追溯"是一个包，因为引文追溯是检索意图分支之一，共享同一场景 Agent

---

## 3. 四要素内容物

### 3.1 场景 Agent 设定（Scene Agent Setting）

场景 Agent 是能力包的入口 Agent。它负责对话流开口、意图分类、SubAgent 派活、收口汇总。

```typescript
interface SceneAgentSetting {
  /** 场景 Agent 的系统提示词（英文，末尾由主程序注入 Output Language directive） */
  systemPrompt: string

  /** 场景 Agent 使用的模型偏好 */
  modelPreference: 'sonnet' | 'haiku' | 'opus'

  /** SubAgent 定义列表 */
  subAgents: SubAgentDefinition[]

  /** 意图分类规则（场景 Agent 在职责 02 中使用） */
  intentClassification: {
    /** 支持的意图列表 */
    intents: IntentDefinition[]
    /** 默认意图（无法分类时回退） */
    defaultIntent: string
  }

  /** 场景 Agent 每 turn 内 LLM 调用上限（默认 2：开口 + 收口） */
  maxSceneAgentCallsPerTurn: number
}

interface SubAgentDefinition {
  /** SubAgent 唯一标识（包内唯一） */
  slug: string
  /** 英文名称 */
  name: string
  /** 英文描述（Agent 选择依据） */
  description: string
  /** 模型偏好 */
  modelPreference: 'sonnet' | 'haiku' | 'opus'
  /** 执行形态 */
  executionMode: 'deterministic-pipeline' | 'agent-loop'
  /** 触发条件：哪些意图下派活 */
  triggeredByIntents: string[]
  /** 串接顺序（同意图下多个 SubAgent 的执行序号） */
  sequenceOrder: number
  /** 暴露给该 SubAgent 的 tool 白名单（引用 MCP tool 名） */
  allowedTools: string[]
  /** 失败兜底策略 */
  failurePolicy: 'fail-turn' | 'degrade-and-continue' | 'skip-and-continue'
}

interface IntentDefinition {
  /** 意图标识 */
  slug: string
  /** 意图描述 */
  description: string
  /** 触发关键词（可选，辅助分类） */
  triggerKeywords?: string[]
  /** 该意图下的 SubAgent 派活链 */
  subAgentChain: string[]
}
```

**关键约束**（来自两份编排说明）：

- 场景 Agent 每 turn 内**仅 2 次 LLM 调用**（开口 + 意图分类合并 1 次，收口 1 次）
- SubAgent 执行期间场景 Agent 不被打断、不做判断、不重新规划
- 一次性下计划，runtime 按计划执行

### 3.2 Skill 引用（Skill References）

```typescript
interface SkillReference {
  /** Skill slug（对应 SkillMeta.slug） */
  slug: string
  /** Skill 来源 */
  source: 'workspace' | 'builtin' | 'imported'
  /** 是否为包的必要依赖（安装时校验） */
  required: boolean
  /** 该 Skill 被哪些 SubAgent 使用 */
  usedBy: string[]
}
```

能力包引用 Skill 的语义是**声明式引用**，不是拷贝：
- 安装包时校验 `required: true` 的 Skill 是否存在于工作区
- 缺失的 required Skill 阻塞安装，提示用户先启用
- 同一 Skill 可被多个包引用（Skill 粒度独立于包）

### 3.3 MCP 引用（MCP References）

```typescript
interface McpReference {
  /** MCP 服务器名称（对应 McpServerEntry 的 key） */
  name: string
  /** 是否为内建 MCP（zotero / ocr / asr / paper-search） */
  isBuiltin: boolean
  /** 是否为包的必要依赖 */
  required: boolean
  /** 该 MCP 被哪些 SubAgent 使用 */
  usedBy: string[]
  /** 暴露给包内 SubAgent 的 tool 白名单（不列则暴露该 MCP 全部 tool） */
  allowedTools?: string[]
  /** 配置模板（非内建 MCP 的安装引导） */
  configTemplate?: Partial<McpServerEntry>
}
```

**Tool 白名单机制**：

能力包可限制 SubAgent 对 MCP tool 的访问范围。例如 lit-review 包引用 paper-search MCP 但仅暴露 `get_paper_meta` 和 `get_paper_full_text`，不暴露 `search_papers` 和 `snowball_search`——这是跨包 scope 守门的关键手段。

### 3.4 UI 框架选择与渲染配置（UI Framework Selection）

```typescript
interface UiFrameworkSelection {
  /** UI 框架标识（0.3 仅内置 'dialog-main-product'） */
  frameworkId: string
  /** 渲染配置（框架特定） */
  renderConfig: DialogMainProductConfig | Record<string, unknown>
}

/** 0.3 内置框架：对话主 + 右侧产物面板 */
interface DialogMainProductConfig {
  /** 右侧面板渲染的产物类型 */
  productType: 'search-results' | 'review-html' | 'custom'
  /** 是否启用右侧面板流式渲染 */
  streamToPanel: boolean
  /** 面板标题 i18n key */
  panelTitleKey: string
}
```

**扩展路线**：
- **0.3**：仅内置 `dialog-main-product`（对话主 + 右侧产物），两个首发包均使用
- **0.4+**：开放 UI 框架注册机制，支持写作/实验日志/数据分析等不同布局

---

## 4. `capabilities.proposals[]` 副产品契约

> **v0.2 收敛决策**（2026-05-22）：Proposal 机制整体延后 v0.3。v0.2 两个首发包不产出 Proposal 副产物。本节定义契约 schema 作为 v0.3 实现层的字段权威源。

### 4.1 字段定义

```typescript
interface ProposalDeclaration {
  /** 该包能产出的 Proposal 类型 */
  kind: ProposalKind
  /** 触发点描述（何时产出） */
  triggerEvent: string
  /** reasoning 模板（Agent 填充的结构化理由框架） */
  reasoningTemplate: string
  /** 目标对象类型 */
  targetObjectKind: 'paper' | 'evidence-set' | 'note'
}
```

### 4.2 两个首发包的 Proposal 产出清单（v0.3 规划）

v0.2 阶段两个首发包均不产出 Proposal。以下为 v0.3 规划占位，来自 0.2 §一-A 触发式产出点表：

#### lit-search 包

| Proposal kind | 触发事件 | 目标对象 | reasoning 模板 |
|---------------|---------|----------|----------------|
| `evidence-set` | 检索结果入库 | EvidenceSet | "基于检索结果，建议将以下 N 篇论文追加到 EvidenceSet '{name}'，因为..." |
| `citation-relation` | 检索结果入库 | Paper | "新入库论文 {paperA} 与 {paperB} 之间存在 {relationType} 关系，依据..." |

#### lit-review 包

| Proposal kind | 触发事件 | 目标对象 | reasoning 模板 |
|---------------|---------|----------|----------------|
| `citation-relation` | 综述生成完成 | Paper | "综述过程中发现 {paperA} 与 {paperB} 之间存在 {relationType} 关系..." |
| `hypothesis-promote` | 综述生成完成 / 用户写 Note 触发断言识别 | Note | "检测到以下断言可提升为正式假设：'{claim}'，支撑论文 {N} 篇..." |
| `hypothesis-review` | EvidenceSet 新增 Paper | Note (hypothesis) | "新增论文 {paper} 对假设 '{hypothesis}' 的立场为 {stance}，理由..." |

> **v0.2 fact-checker 替代**：v0.2 的 fact-checker 只做 claim 四档标记（`verified` / `unsupported` / `contradicted` / `unchecked`），不产出 Proposal 候选。Proposal 候选的产出（`citation-relation` / `hypothesis-promote` 等）连同 Proposal 机制整体延后 v0.3。

---

## 5. 依赖 / 安装 / 卸载语义

### 5.1 依赖解析

```typescript
interface PackageDependency {
  /** 依赖类型 */
  type: 'skill' | 'mcp' | 'capability-package'
  /** 依赖标识 */
  identifier: string
  /** 是否必要（required=true 阻塞安装） */
  required: boolean
  /** 最低版本要求（可选） */
  minVersion?: string
}
```

**解析规则**：

1. 安装前扫描所有 `required: true` 依赖
2. Skill 依赖：检查工作区 `skills/` + `skills-inactive/` 是否存在，不存在则提示启用或安装
3. MCP 依赖：检查 `~/.asci/mcp.json` + builtin MCP 是否已注册，未注册的非内建 MCP 提供配置模板引导安装
4. 能力包间依赖：0.2 不实现（首发包互不依赖），v0.3 预留字段

### 5.2 安装顺序

```
1. 校验依赖完整性
   ├─ 缺失 required 依赖 → 阻塞，列出缺失项
   └─ 全部满足 → 继续
2. 注册能力包 manifest 到工作区
3. 启用包内引用的 Skill（从 skills-inactive/ 移到 skills/）
4. 确认 MCP 服务器就绪
5. 注册场景 Agent 到 Orchestrator 路由表
6. 广播 CAPABILITY_PACKAGE_INSTALLED 事件
```

### 5.3 卸载语义

| 关切项 | 卸载行为 |
|--------|---------|
| 包内引用的 Skill | **不自动禁用**（可能被其他包或用户手动使用） |
| MCP 服务器 | **不自动删除**（全局资源，可能被其他包使用） |
| 已产出的 Proposal | **保留**（`status: accepted` 的已转化为正式对象；`pending` 的标记为 `sourceCapability` 已卸载，UI 灰显但不删除） |
| 场景 Agent 注册 | **移除**（从 Orchestrator 路由表注销） |
| 会话历史 | **保留**（只读，不可新建 turn） |
| 配置偏好 | **保留**（用户重装同包时恢复；使用 `~/.asci/capability-packages/{packageId}/preferences.json`） |

**卸载后清理 Proposal 的决策理由**：Proposal 的 `payload` 是不可变的信号数据（0.3 §三-A 采纳率分析的输入），删除会破坏历史统计完整性。`sourceCapability` 字段的存在本身就是溯源键，即使包已卸载仍有审计价值。

---

## 6. 二分布局：Skill 板块 + 能力包板块

### 6.1 分层判据

| 层级 | 位置 | 内容 | 用户心智 |
|------|------|------|----------|
| **系统底座** | Settings 弹窗 | Provider API Key、MCP 服务器、Zotero 凭据、代理、主题、语言 | "调系统参数" |
| **Agent 生态** | 左侧栏"配置"页 | Skill 注册表 + 能力包浏览器 | "管 Agent 能力" |

### 6.2 Skill 板块

复用现有 `SkillMeta` 结构，增加能力包反向引用：

```typescript
interface SkillMetaExtended extends SkillMeta {
  /** 引用该 Skill 的能力包列表（反向索引，只读） */
  usedByPackages: string[]
}
```

展示逻辑：
- 按 `category` 分组
- 每个 Skill 卡片显示：名称（`nameI18n[lang] ?? name`）、描述、启用开关、引用方包列表
- 被能力包 `required` 引用的 Skill 禁用时弹确认（"此 Skill 被 {packageName} 依赖"）

### 6.3 能力包板块

展示逻辑：
- 按已安装 / 可安装分区
- 每个能力包卡片显示：
  - 包名（`displayNameI18n[lang] ?? displayName`）
  - 简介
  - 四要素摘要（N 个 Skill · M 个 MCP · 场景 Agent · UI 框架）
  - 安装/卸载按钮
  - Proposal 产出声明（v0.3 亮灯，v0.2 灰显"暂未启用"）
- 点击进入详情页：完整四要素 + SubAgent 拓扑图 + 包内偏好设置

---

## 7. 两个首发包详解

### 7.1 lit-search（文献检索包）

> 字段权威源：as-built `apps/electron/default-capability-packs/lit-search/manifest.json` + `docs/milestones/0.2/2026-05-23-agent-and-capability-pack-spec.md` §5.3（原 `lit-search场景 Agent 编排说明.md` 已吸收并清理）

#### 基本信息

| 字段 | 值 |
|------|-----|
| 包 ID | `asci.builtin.lit-search` |
| 显示名 | 文献检索 / Literature Search |
| UI 框架 | `dialog-main-product`（productType: `search-results`） |
| 场景 Agent 模型 | sonnet（首字 ~600ms） |

#### SubAgent 拓扑

```
场景 Agent（dispatcher，2 次 LLM/turn）
  ├─ 意图：精确查找 → 无 SubAgent（场景 Agent 直接调 paper-search）
  ├─ 意图：普通检索 → searcher → relevance-scorer
  └─ 意图：引文追溯 → [seed 解析] → citation-explorer → relevance-scorer
```

| SubAgent | 模型 | 执行形态 | 触发意图 | 暴露 tool |
|----------|------|---------|---------|-----------|
| searcher | sonnet | deterministic-pipeline | 普通检索 | paper-search: `search_papers` |
| citation-explorer | sonnet | deterministic-pipeline | 引文追溯 | paper-search: `snowball_search`, `get_paper_meta` |
| relevance-scorer | sonnet + haiku | deterministic-pipeline | 普通检索, 引文追溯 | （无外部 tool，纯 LLM 评分） |

#### Skill 引用

| Skill slug | required | 用途 |
|------------|----------|------|
| `literature-search-enhanced` | true | searcher 检索能力骨架 |

#### MCP 引用

| MCP name | isBuiltin | required | 暴露 tool |
|----------|-----------|----------|-----------|
| `paper-search` | true | true | `search_papers`, `get_paper_meta`, `get_paper_full_text`, `snowball_search` |
| `zotero` | true | false | `add_to_library` |

#### TTLT 预算

| 意图 | 典型 TTLT | 最差 TTLT | LLM 调用 |
|------|:---------:|:---------:|:--------:|
| 精确查找 | ~3s | 5s | 2 |
| 普通检索 | ~8s | 15s | 5 |
| 引文追溯 | ~12-15s | 22s | 4 |

#### Proposal 产出（v0.3 规划）

- `evidence-set`：检索结果入库时
- `citation-relation`：新入库论文之间关系候选

> v0.2：无 Proposal 产出。

---

### 7.2 lit-review（文献综述包）

> 字段权威源：as-built `apps/electron/default-capability-packs/lit-review/manifest.json` + `docs/milestones/0.2/2026-05-23-agent-and-capability-pack-spec.md` §5.4（原 `lit-review场景 Agent 编排说明.md` 已吸收并清理）

#### 基本信息

| 字段 | 值 |
|------|-----|
| 包 ID | `asci.builtin.lit-review` |
| 显示名 | 文献综述 / Literature Review |
| UI 框架 | `dialog-main-product`（productType: `review-html`，streamToPanel: true） |
| 场景 Agent 模型 | sonnet |

#### 会话拓扑：两 turn 必走断点

```
Turn 1 · 方向选择（~10-12s）
  场景 Agent → review-proposer Skill → litreview.present_directions tool → ChoiceCard
  用户选定方向 → tool 返回 → 同一 agent run 进 Turn 2

Turn 2 · 综述生成（~70-200s）
  场景 Agent → synthesizer（并发轨 A: outline 拆分 + 并发轨 B: reader fan-out）
  → 两轨汇合 → 章节级流式写 review.md → fact-checker 异步核验 → 收口
```

#### SubAgent 拓扑

| SubAgent | 模型 | 执行形态 | 所在 Turn | 暴露 tool | 失败兜底 |
|----------|------|---------|----------|-----------|---------|
| synthesizer | sonnet | **agent-loop** | Turn 2 | paper-search: `get_paper_meta`, `get_paper_full_text` | 单段 LLM 错 → Turn 2 失败 |
| reader | haiku | deterministic-pipeline | Turn 2（并发 fan-out） | （无外部 tool，读 PDF 内容） | 单篇失败 → 降级用 abstract |
| fact-checker | haiku | deterministic-pipeline | Turn 2（异步，不阻塞） | （无外部 tool，纯 LLM 核验） | 单段失败 → claim 标 `unchecked` |

#### Skill 引用

`skillRefs: []`（空）。架构演进后，`review-proposer` 与综述正文主笔人均改为包内 **SubAgent**（见上「SubAgent 拓扑」），不再走 skillRef：
- `review-proposer`：Turn 1 方向生成，现为 SubAgent（`subAgents[]`）。
- 综述正文由 `synthesizer`（Agent loop）**自带完整 prompt 直接产出**，不引用任何骨架 Skill。
- `literature-review-result` 是**独立回落 Skill**：仅当工作区未注册任何 review 能力包时，由 master 经 Skills-First 链（`review-proposer` → `literature-review-result`）兜底；本包不引用它。

> 历史注记：早期草稿曾规划 `skillRefs: [review-proposer, literature-review-result]`（后者作 "synthesizer 骨架"）。实现时改为 SubAgent 拓扑、synthesizer 自包含，skillRefs 空。此表已对齐 as-built（见 `apps/electron/default-capability-packs/lit-review/manifest.json`）。

#### MCP 引用

| MCP name | isBuiltin | required | 暴露 tool | 备注 |
|----------|-----------|----------|-----------|------|
| `paper-search` | true | false | `get_paper_meta`, `get_paper_full_text` | 跨包精确查找补漏（cap=3） |
| `zotero` | true | false | — | 间接通过 EvidenceSet 关联 |

**跨包精确查找 hard cap**：

| 维度 | 值 |
|------|-----|
| 单 Turn 2 累计调用上限 | 3 次 |
| 单次 timeout | 8s |
| 累计失败触发停止 | ≥ 2 次 |
| 主流程阻塞 | 0s（fire-and-forget） |

#### 工具调用契约

| Tool | 用途 | 参数摘要 |
|------|------|----------|
| `litreview.present_directions` | Turn 1 方向选择 ChoiceCard | `directions[]` + `rerollLabel` + `customLabel` → return `{ choice, customDirection? }` |
| `litreview.present_resume_choice` | 中断恢复 ChoiceCard | "重新生成 / 放弃" → return `{ choice }` |

#### TTLT 预算

| 场景 | Turn 1 | Turn 2 | 总耗时 | LLM 调用 |
|------|:------:|:------:|:------:|:--------:|
| 小集（10 篇） | ~10s | ~70s | ~80s | ~40 |
| 中集（20 篇） | ~12s | ~110s | ~120s | ~58 |
| 大集（40 篇） | ~15s | ~200s | ~215s | ~95 |

#### 输出格式

review.md（实际存储为 `~/.asci/reviews/{id}.html`）：
- YAML frontmatter：`reviewId` / `title` / `direction` / `sourceEvidenceSetId` / `sourceCapability` / `generatedAt` / `factCheckSummary` / `chapters` / `totalSentences`
- 正文：sentence-anchor（`data-sentence-id`）+ 内嵌 fact-check（`data-fact-check`）+ claim 关联（`data-claims`）
- 参考文献：`<handle>` 反查 paper-search 进程 cache

#### Proposal 产出（v0.3 规划）

- `citation-relation`：综述完成时
- `hypothesis-promote`：综述完成时 / 用户写 Note 触发断言识别
- `hypothesis-review`：EvidenceSet 新增 Paper 时

> v0.2：无 Proposal 产出。fact-checker 只做 claim 四档标记。

---

## 8. D-4 契约 Schema 映射

本节确保 D-4 (#239) 实现层可直接消费本 Spec 的字段定义。

### 8.1 能力包 Manifest 完整 interface

```typescript
/**
 * 能力包清单（Capability Package Manifest）
 *
 * D-4 实现层从此 interface 生成 JSON Schema，
 * 放置于 schema/capabilities/ 目录下。
 */
interface CapabilityPackageManifest {
  /** 包 ID（全局唯一，不可变） */
  id: string

  /** 版本号（semver） */
  version: string

  /** 英文显示名 */
  displayName: string

  /** 双语显示名（可选） */
  displayNameI18n?: { zh?: string; en?: string }

  /** 英文描述 */
  description: string

  /** 双语描述（可选） */
  descriptionI18n?: { zh?: string; en?: string }

  /** 图标（emoji 或 asset 路径） */
  icon?: string

  /** 四要素 */
  sceneAgentSetting: SceneAgentSetting
  skillReferences: SkillReference[]
  mcpReferences: McpReference[]
  uiFramework: UiFrameworkSelection

  /** 副产品契约（v0.3 兑现） */
  proposals: ProposalDeclaration[]

  /** 依赖声明 */
  dependencies: PackageDependency[]

  /** 包内偏好默认值 */
  defaultPreferences?: Record<string, unknown>
}
```

### 8.2 字段到现有类型的映射

| Manifest 字段 | 现有类型 | 位置 |
|--------------|---------|------|
| `proposals[].kind` | `ProposalKind` | `packages/shared/src/types/objects/proposal.ts` |
| `skillReferences[].slug` | `SkillMeta.slug` | `packages/shared/src/types/agent.ts` |
| `mcpReferences[].name` | `McpServerEntry` key | `packages/shared/src/types/agent.ts` |
| `mcpReferences[].isBuiltin` | `BUILTIN_MCP_RESERVED_NAMES` | `packages/shared/src/types/agent.ts` |
| `proposals[].targetObjectKind` | `ProposalTargetRef.kind` | `packages/shared/src/types/objects/proposal.ts` |
| `id` → `Proposal.sourceCapability` | `string` | `packages/shared/src/types/objects/proposal.ts` |

---

## 9. E-1 (#218) 访谈清单交叉验证

本 Spec 需与 E-1 访谈清单交叉验证。以下矩阵列出 X1.1 / X1.2 验证项对本 Spec 的影响：

| 验证项 | Spec 段落 | 交叉验证点 | 若验证失败的影响 |
|--------|----------|-----------|----------------|
| X1.1 Agent 主动提议接受度 | §4 Proposal 副产品契约 | 用户对三类 Proposal（citation-relation / hypothesis-promote / hypothesis-review）评分 ≥ 50% 给 ≤ 2 分 → 触发 §零 降档 | Proposal 机制可能进一步延后或改为 opt-in |
| X1.2 Skill/能力包二分心智识别度 | §6 二分布局 | 用户 30 秒内区分"调系统参数 vs 管 Agent 能力"正确率 < 60% | 二分布局降级为统一 Settings 页内分 tab |
| X1 能力包候选清单 | §2.2 粒度判据 | 访谈识别的 ≥3 类能力包是否与当前粒度判据一致 | 调整粒度边界或合并/拆分首发包 |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| 能力包（Capability Package） | 面向用户交付"可下达任务"能力的最小可发布单元，包含四要素 + Proposal 副产品契约 |
| 场景 Agent（Scene Agent） | 能力包的入口 Agent，负责对话流开口、意图分类、SubAgent 派活、收口汇总 |
| SubAgent | 场景 Agent 派活的子 Agent，执行具体任务（如检索、评分、综述生成） |
| Proposal | Agent 产出、用户决策的提议对象；交互载体而非研究产物 |
| `sourceCapability` | Proposal 的来源字段，指向产出该 Proposal 的能力包 ID |
| TTFT | Time To First Token，场景 Agent 第一个 chat token |
| TTLT | Time To Last Token，场景 Agent 最后一个 chat token（turn 结束） |
| ChoiceCard | 用户决策卡片，通过 tool call 渲染（沿用 0.1 ExitPlanMode 模式） |

## 附录 B：与 north-star 审计标准的对齐

| 审计标准 | 本 Spec 覆盖段落 | 状态 |
|---------|-----------------|------|
| X2 · 命名/粒度 | §2 | ✅ |
| X2 · 四要素内容物 | §3 | ✅ |
| X2 · `capabilities.proposals[]` 契约 | §4（v0.3 占位） | ✅ |
| X2 · 依赖/安装-卸载语义 | §5 | ✅ |
| X2 · Skill 板块 + 能力包板块二分 | §6 | ✅ |
| X2 · 副产品段落两个首发包各自清单 | §4.2 + §7.1/7.2 Proposal 产出 | ✅（调整为 SubAgent 拓扑 + tool 暴露契约 + v0.3 Proposal 占位） |
| A3 · 契约文档化可被实现层消费 | §8 D-4 映射 | ✅ |

---

**Spec ID**: `2026-05-25-capability-package-concept`
**作者**: ASCI 0.2 design session
**版本**: v1
