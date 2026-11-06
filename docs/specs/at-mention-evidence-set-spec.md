# Agent 对话框 @ 引用证据集（At-Mention Evidence Set）

| 项 | 值 |
|---|---|
| 状态 | 草稿 · 待 review |
| 关联 issue | #449（[ops-feedback] Agent 对话框 @ 支持引用证据集；P1 / ready-for-agent；来源：0601 测试反馈序号 27 / yannik） |
| 关联 PR | 待开（feat/capability-pack-v4） |
| 衔接 | 复用现有 @ 提及栈式导航（`at-mention-helpers.ts`）与 Zotero 引用注入范式（`zotero-context-block.ts`）；证据集体系 workspace 隔离见 #457 |
| 领域语言事实源 | `CONTEXT.md`；本 spec 术语：证据集 evidence set、@ 提及面板 at-mention panel、提及项 mention item、待发提及 pending mention、引用 chip mention chip、证据集上下文块 evidence-set context block、引文 quote（`snapshotText`） |

---

## 1. 背景与动机

Agent 对话框的 `@` 提及面板（at-mention panel）当前支持四类可提及对象：**文件 / Zotero 类目 / Zotero 条目 / 文献库**。用户输入 `@` 后栈式下钻浏览、选中后以 chip 形态插入对话框，发送时作为结构化引用回传 Agent。

yannik 反馈（#449，序号 27）：希望 `@` 能引用**证据集（Evidence Set）**——把一个已保存的命名证据集带入对话上下文，供 Agent 读取其内容用于后续任务。

证据集是 ASCI 已有的一等对象：围绕一个主题、由多条 `EvidenceRef`（论文/综述/对话引文）+ 1:1 绑定 Note 组成的集合，存于本地 SQLite。当前用户只能在证据集详情面板里查看，无法把它喂给 Agent。本 spec 填补这条链路。

---

## 2. 范围与非目标

**范围**：
- `@` 面板新增「证据集」可提及类目，与 file / zotero-col / zotero-item / library 同级，可浏览/搜索/选中。
- 选中后以一致 chip 形态插入对话框，发送时作为结构化引用回传 Agent。
- 主进程展开证据集内容，注入 user 消息前，使 Agent 能读取其内容。

**非目标**：
- 不在对话内**新建/编辑/删除**证据集（仅引用已存在的命名集合）。
- 不引用临时集（`persisted=false`）——临时集无名字，不进选择器。
- 不做证据集的 Agent 工具（MCP/SDK tool）化（见 §6 决策：本期走 inline 注入，工具化留作后续）。
- 不改证据集本身的数据模型 / 存储 / 既有 IPC 通道语义。

---

## 3. 现状事实源（已读源码确认）

### 3.1 @ 提及链路（渲染侧）

| 环节 | 位置 |
|---|---|
| 栈式导航模型（`AtMentionLevelKind` / `enterLevel` / `goBack` / `isLeaf` / `toDrillTarget` / `isLegalTransition`） | `apps/electron/src/renderer/components/agent/at-mention-helpers.ts` |
| 面板 item 类型 `AtMentionItem` + 渲染 + 键盘导航 | `apps/electron/src/renderer/components/agent/AtMentionPanel.tsx` |
| 各层 item 列表 `buildItems(level, query)` + `insertChip` + Enter/→/← 语义 | `apps/electron/src/renderer/components/agent/at-mention-suggestion.tsx` |
| 待发提及类型 `AgentPendingMention`（`kind: 'file' \| 'zotero-item' \| 'zotero-col'`）+ 去重写入 atom | `apps/electron/src/renderer/atoms/agent-atoms.ts` |
| token 格式化 + 发送组装 `AgentSendInput` | `apps/electron/src/renderer/components/agent/AgentView.tsx`（`handleSend`） |
| token 正则抽取 | `apps/electron/src/renderer/components/agent/at-mention-parse.ts` |

现有 token 形态：`@file:<path>`、`@zotero-item:<key>|<encodedLabel>`、`@zotero-col:<key>|<encodedLabel>`。

root 层 item 即 category 入口列表（`at-mention-suggestion.tsx` 的 `buildItems` root 分支），现含两项 `category`（project-files / library-root）。

### 3.2 Agent 侧消费（主进程）

- `agent-orchestrator.ts` 在组装 `enrichedMessage` 时，用 `buildZoteroContextBlock(mentionedZoteroItems, mentionedZoteroCollections)`（`apps/electron/src/main/lib/zotero-context-block.ts`，纯函数、有单测）生成 `<zotero-context>` 块注入 user 消息前。
- Zotero 块**只注入引用元信息**，全文靠 Zotero MCP 工具按需拉取。

### 3.3 证据集体系

| 环节 | 位置 |
|---|---|
| 类型 `EvidenceSet` / `EvidenceSetDetail` / `EvidenceSetSummary` | `packages/shared/src/types/objects/evidence-set.ts`、`packages/shared/src/types/evidence-sets.ts` |
| 存储 | 本地 SQLite `~/.asci/asci.db`（dev：`~/.asci-dev/asci.db`） |
| 服务 / 聚合查询 `queryEvidenceSetDetail` | `apps/electron/src/main/lib/evidence-set-service.ts`、`apps/electron/src/main/lib/objects/query-service.ts` |
| IPC 通道 `EVIDENCE_SETS_IPC_CHANNELS`（含 `LIST_SUMMARY` 按 workspaceId + persistedOnly、`GET_DETAIL`） | `packages/shared/src/types/evidence-sets.ts`、`apps/electron/src/main/ipc.ts` |
| preload 桥 `window.electronAPI.evidenceSets.*` | `apps/electron/src/preload/index.ts` |

`EvidenceSetDetail` = `{ set, note, refs, memberPapers, memberReviews, memberConversations, sourceReview }`；每条 `EvidenceRef` 的 anchor 内嵌 `snapshotText`（逐字引文）；`memberPapers` 带 `zoteroKey`。

**关键事实**：证据集**当前没有任何 Agent 可调的 MCP/工具**（main/lib 下 mcp/tools 无 evidence 相关定义）。

---

## 4. 关键设计决策

> **D1 — 内容必须主进程 inline 注入，不能照搬 Zotero「只注入引用、全文靠 MCP」模式。**
> 因为证据集无 Agent 工具可拉取。主进程已有 DB 同步访问（`getObjectsDb()`）+ `queryEvidenceSetDetail`，由主进程展开内容、避免大 payload 过 IPC，是最贴合现有架构的做法。

> **D2 — 回传只带 `{ id, name }`，内容由主进程展开。**
> 渲染侧不预取详情、不把大内容塞进 `AgentSendInput`；保持渲染侧薄、主进程为单一事实源。

> **D3 — 只列命名持久集（`persistedOnly: true`）。**
> 临时集无名字、是对话/划词副产品，不应出现在选择器。

> **D4 — 完全复用现有 @ 面板交互/样式，不另起一套**（验收第 4 条硬要求）。
> 新 kind 接入既有栈式导航 + 键盘 + insertChip + chip 行。

> **D5 — 证据集内容 = note 动机 + 每条引文 `snapshotText` + 成员论文/综述/对话快照。**
> 这是 Agent 真正需要的「证据」。成员论文带 `zoteroKey`，可顺势复用 `zoteroAttachments` 管线喂 PDF（增强项，见 §5.4，非核心）。

---

## 5. 方案

### 5.1 面板侧：新增 `evidence-set` 可提及 kind

**导航模型** `at-mention-helpers.ts`：
- `AtMentionLevelKind` 增 `'evidence-set-list'`（叶子层）。
- `AtMentionEnterTarget` 增 `{ kind: 'evidence-set-list' }`。
- `isLegalTransition`：`root → evidence-set-list` 合法。
- `AtMentionItemLike` 增 `{ kind: 'evidence-set' }`；`isLeaf` 对其返回 `true`；`toDrillTarget` 对 `category(target: 'evidence-set-list')` 返回该 target。

**面板 item 类型** `AtMentionPanel.tsx`：
- `AtMentionItem` 增 `{ kind: 'evidence-set'; set: EvidenceSetSummary }`。
- root 的 `category` target 联合增 `'evidence-set-list'`。
- 渲染分支给图标（建议 `Layers` / `FolderTree`，颜色走语义 token），展示 `set.name`，副行可显示 `paperCount` / `notePreview`。

**`buildItems`** `at-mention-suggestion.tsx`：
- root 列表追加 `{ kind: 'category', target: 'evidence-set-list', labelKey: 'atMention.category.evidenceSet', icon: ... }`。
- 新增 `level.kind === 'evidence-set-list'` 分支：调
  `window.electronAPI.evidenceSets.listSummary({ workspaceId, persistedOnly: true })`，
  对 `name` 做大小写不敏感 `includes` 过滤（复用现有 filter 风格），`slice` 上限（如 50）。
  - **workspaceId 来源**：通过 `cfg` 透传（AgentView 已有派生 `currentWorkspaceId`）。无 workspace 时返回空数组 + 空态占位文案。
- breadcrumb / 空态：参照 library 分支补 i18n key。

**`insertChip` + 键盘**：`evidence-set` 走叶子路径（与 file / zotero-item 同分支），
`cfg.onMentionAdd?.({ kind: 'evidence-set', id: set.id, label: set.name })`。
↑↓ / → / ← / Enter / Esc 全部复用现有 `onKeyDown`，**零新增键位逻辑**。

**待发提及类型** `agent-atoms.ts`：
- `AgentPendingMention.kind` 增 `'evidence-set'`（id=证据集 ObjectId，label=name）。去重写入 atom 无需改动（已按 kind+id 去重）。

### 5.2 数据回传（token → 结构化引用）

**`AgentView.tsx` `handleSend`** mentionTokens：
```
if (m.kind === 'evidence-set') return `@evidence-set:${m.id}|${encodeURIComponent(m.label)}`
```

**`at-mention-parse.ts`**：新增 `extractEvidenceSetIds(text)`（复用 `extractUnique`，正则 `/@evidence-set:(\S+)/g`，按 `|` 前取 id）。

**`AgentView.tsx`** 组装：从 `effectiveText` 抽 id，配 `pendingMentions` 里的 label，填
`mentionedEvidenceSets: Array<{ id: string; name: string }>`，仅在非空时挂入 `AgentSendInput`。

### 5.3 Agent 侧消费（主进程 inline 序列化）

**shared 类型** `packages/shared/src/types/agent.ts`：
`AgentSendInput` 增 `mentionedEvidenceSets?: Array<{ id: string; name: string }>`。

**新建纯函数** `apps/electron/src/main/lib/evidence-set-context-block.ts`（仿 `zotero-context-block.ts`，零 Electron 依赖、可单测）：
- 输入：`EvidenceSetDetail[]`。
- 输出：`<evidence-set-context>` 字符串或 `null`（空时）。
- 每个集合块含：集合名 / note 动机（`note.body`）、成员论文（标题 + zoteroKey）、综述、对话快照，以及每条 ref 的 `snapshotText` 引文。
- **截断与标注**：对引文条数 / 成员数设上限（如每集 ≤N 条引文），超出显式写「已省略 M 条」（遵守 no silent caps）；跳过 `removed` 态的 ref 或标注「来源已删除」。

**orchestrator** `apps/electron/src/main/lib/agent-orchestrator.ts`（在 `<zotero-context>` 注入附近，§11.7 一带）：
- 从 `input` 解构 `mentionedEvidenceSets`。
- 逐个 `queryEvidenceSetDetail(getObjectsDb(), id)`（过滤 `null`）。
- `buildEvidenceSetContextBlock(details)` → 注入 `enrichedMessage` 前置（与 zotero 块并列）。
- `console.log` 注入条数（中文日志，与既有风格一致）。

### 5.4 增强（可选，非核心，可拆后续）

把成员论文的 `zoteroKey` 合流进现有 `zoteroAttachments` / `mentionedZoteroItems` 解析路径，让 Agent 直接拿到 PDF 全文绝对路径（复用 §11.6 的 `<zotero_attachments>` 注入）。
本期可只做 §5.3 的元信息 + 引文注入；PDF 全文增强若超出工时，单独开 issue。

### 5.5 i18n

新增 key（en + zh 同步，`key-parity` 守门）：
- `atMention.category.evidenceSet`（root 入口标签）
- `atMention.breadcrumb.evidenceSet`（面包屑）
- 证据集列表空态 / 无 workspace 占位文案
- 内置注入文案（`<evidence-set-context>` 块内说明）走**英文**（内置 prompt 规则，§CLAUDE.md 核心规则；非 UI 文案不进 i18n）

---

## 6. IPC 四联同步说明

本特性**不新增 IPC 通道**：

- **发送**：复用现有 `sendAgentMessage`，只给 `AgentSendInput` **加字段** `mentionedEvidenceSets`——四处改的是同一 input 类型链路：
  1. shared 定义（`agent.ts`）
  2. orchestrator 消费（`agent-orchestrator.ts`）
  3. preload 透传（`sendAgentMessage` 已透传整个 input，通常无需改）
  4. renderer 构造（`AgentView.tsx`）
- **列证据集**：`evidenceSets.listSummary` 已是现成通道（shared 常量 + main handler + preload 桥 + 现有调用方齐全），面板直接调用，无需四联改动。

---

## 7. 验收对照（issue #449）

| 验收项 | 覆盖位置 |
|---|---|
| @ 面板新增「证据集」类目，可浏览/搜索/选中 | §5.1 root category + `evidence-set-list` 层 + `listSummary` 过滤 |
| 一致引用形态插入 + 结构化回传 Agent | §5.1 pendingMention/chip + §5.2 `@evidence-set:` token + `mentionedEvidenceSets` |
| Agent 能读取证据集内容 | §5.3 `queryEvidenceSetDetail` → `<evidence-set-context>` 注入 |
| 复用现有 @ 面板交互/样式（键盘/插入），不另起一套 | §5.1 全程接入既有 nav / keyboard / insertChip / chip 行 |
| 文案走 useT、en+zh、key-parity；涉 IPC 取数四联 | §5.5 新 key 同步；§6 仅扩字段复用 send 通道 + 现成 listSummary |
| 受影响包 patch 递增；typecheck + bun test 通过；dev 实跑 | §8 + §9 |

---

## 8. 受影响包与版本号

开 PR 时各递增一次 patch：
- `apps/electron`（面板 / AgentView / parse / orchestrator / context-block / i18n）
- `packages/shared`（`AgentSendInput.mentionedEvidenceSets` 字段）

---

## 9. 测试计划

**单元（`bun test`）**：
- `evidence-set-context-block.test.ts`：空输入 → `null`；单/多集合块结构；引文截断标注；`removed` 态处理。
- `at-mention-parse.ts`：`extractEvidenceSetIds` 抽取 + 去重 + `|label` 剥离。
- `at-mention-helpers.ts`：`root → evidence-set-list` 合法转移 + `evidence-set` 叶子判定。
- `key-parity.test.ts`：新增 key en/zh 对齐（自动覆盖）。

**类型**：`bun run typecheck` 全 monorepo 通过（`AgentPendingMention` / `AtMentionItem` / `AgentSendInput` 联合扩展无遗漏分支）。

**手动 golden path（`bun run dev`）**：
1. 对话框输入 `@` → 见「证据集」入口 → 进入 → 列出当前 workspace 命名证据集。
2. 搜索过滤 name；键盘 ↑↓ 选、→/Enter 插入、← 返回、Esc 关闭。
3. 选中 → chip 行出现一致样式 chip；可移除。
4. 发送 → Agent 回复体现读到证据集内容（引文/成员论文）。
5. 边界：无 workspace / 空证据集列表 → 占位文案，不报错。
6. 设置页切 zh ↔ en 各走一遍，无 raw key、无漏翻。

---

## 10. 风险与边界

- **workspace 隔离**：`listSummary` 必传 `workspaceId`（#457）；新会话 / 无 workspace 给空态，勿报错。
- **prompt 体积**：大证据集 inline 会撑大 prompt → §5.3 强制截断 + 显式标注省略数。
- **soft-deleted 成员**：`queryEvidenceSetDetail` 的 ref 有 `removed` 态 → 序列化跳过或标注「来源已删除」。
- **persistedOnly**：务必只列命名集，临时集不进选择器（D3）。
- **label 漂移**：chip label 取选中时的 name；若集合事后改名，本轮以 token 内 label 为准，主进程以 id 重查为权威内容（id 不变即可）。

---

## 11. 实现顺序建议（tracer bullet）

1. shared：`AgentSendInput.mentionedEvidenceSets` + 类型导出。
2. 主进程：`evidence-set-context-block.ts`（+ 单测）→ orchestrator 注入。
3. 渲染：`at-mention-helpers` 导航 → `AtMentionPanel` item 类型/渲染 → `at-mention-suggestion` buildItems/insertChip → `agent-atoms` pendingMention kind。
4. 渲染：`AgentView` token + 抽取 + 组装；`at-mention-parse` 抽取函数（+ 单测）。
5. i18n：en/zh key。
6. 跑 typecheck + bun test + dev golden path；`simplify` 复盘。
