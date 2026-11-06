# 证据集/笔记基础体验 Spec（Evidence Set as Topic Container）

> **状态**：草稿 · 设计定稿（2026-06-25 grill 收敛 Q1–Q8，见 §3 决策总表 / §5）· 待 review
> **关联 milestone**：[`docs/milestones/0.4/north-star.md`](../../milestones/0.4/north-star.md) §二（P2 证据集/笔记基础体验，审计标准 EN1–EN5）
> **关联 PRD**：[`docs/specs/0.4.0/0.4.0-prd.md`](./0.4.0-prd.md) Epic 2
> **关联 issue**：[#709](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/709)（是 Epic1 [#708](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/708) 沉淀的前置）
> **领域语言事实源**：`CONTEXT.md`「证据集与笔记」域 + 本 spec §2
> **关联 ADR**：[`ADR-007`](../../adr/ADR-007-evidence-set-topic-container.md)（证据集 1:1 → M:N 多归属主题容器，**核心前置**）
> **关联 spec**：[`at-mention-evidence-set-spec.md`](../at-mention-evidence-set-spec.md)（@ 引用栈，补证据选择器复用）· [`research-gap-spec.md`](./research-gap-spec.md) §5.6（Epic1 沉淀衔接，EN5）
> **交互原型**：[`assets/evidence-set-notes-prototype.html`](./assets/evidence-set-notes-prototype.html)（用 ASCI 真实 token 还原；视图 A 证据集页可走通 golden path，视图 B Sheet 抽屉形态）
>
> 📌 本 spec = Epic2 的设计 + 实现计划权威源；目标 / 验收口径以北极星 EN1–EN5 为准；数据模型方向以 ADR-007 为准。

---

## 1. 概述与定位

**证据集/笔记基础体验**：把"证据集"从 v0.2 的「1 集 = 1 条笔记」反转为**研究主题容器**——一个容器里**多条笔记 + 多条证据并列**，详情页可随时补笔记/补证据、各自管理，承接 Epic1 研究空白的产出落地。

三条定位：

1. **已有优化、增量低风险** —— 复用既有 `notes:*` / `evidenceSets:*` 通道与证据集服务；不另造视图框架，详情仍走 Sheet（内部重排）。
2. **心智对齐** —— "证据集 = 围绕一个主题沉淀材料的容器；笔记 = 容器里的备注，与证据并列为成员"。笔记不再是文献附属、不再只能划词建、不再只能一条。
3. **数据一步到位、UI 分步** —— 数据模型按 ADR-007 直接做 **M:N 关联表**（避免日后迁移）；但"一条笔记/证据同属多个容器"的**多归属交互本期不放开**，底线 = "随时补、可多条"。

---

## 2. 领域语言

不新增术语（术语极简）；沿用 CONTEXT.md「证据集与笔记」域，本 spec 只把既有词对齐到容器心智：

| 术语 | 定义 | 来源 |
|------|------|------|
| 证据集（主题容器）| 用户围绕一个主题沉淀材料的容器；含 N 条笔记 + N 条证据 + 标签 | CONTEXT.md / ADR-007 |
| 笔记 | 容器里的**用户备注**，与证据**并列**为成员；可自由建（不必依附划词）、可多条 | CONTEXT.md |
| 证据条目（EvidenceRef）| 指向某来源对象（论文段落 / 综述句子 / 对话消息）的**可溯源引用**（含锚点 + 引文 `snapshotText`）| CONTEXT.md |
| 成员（co-member）| 笔记与证据在容器内的并列身份；各自可增删、互不影响 | ADR-007 |
| 标签（tag）| 容器级标签，用于库列表筛选；一容器可多 tag | ADR-007 §六 |

> 沿用 Epic1：研究空白的产出沉淀进容器时，**对照表 → 1 条结构化笔记**、**每个选中空白/冲突 → 1 条带溯源证据条目**。

---

## 3. 决策总表（讨论结论一览）

| 层 | 决策点 | 结论 |
|----|--------|------|
| 载体 | 详情页承载 | **保留单例 Sheet、内部重排**（低风险）；`NotesView` 右详情与 Sheet **共用**同一成员版面组件 |
| 版面 | 笔记/证据并列 | **上下两区分组**：「笔记」区 + 「证据」区，各带计数 + 独立"+ 补充"入口（Epic1 产物按类落区）|
| 数据 | 模型反转 | **笔记↔集** 由 1:1 `note_id` → 新 join 表 `evidence_set_notes`（M:N）；**证据↔集** 已是 `evidence_set_refs`（M:N，不动）|
| 交互 | 补笔记 | 详情页内联建**自由笔记**（直接打字，不依赖划词；填上 `createNote` 缺口）|
| 交互 | 补证据 | 弹**库对象选择器**（论文/综述/对话）引用进来，**保留溯源**；为**对象级引用**（snapshotText 用来源代表文本兜底，见 §5.4），段落级精确锚点仍走"划词"老路 |
| 交互 | 删除语义 | **证据 = 从本集移除**（解除引用，来源对象留库；孤儿 ref 软删）；**笔记 = 删除**（软删 `visibility='deleted'`，可恢复）|
| 范围 | tag | **全做**：容器级 tag chips（展示/增删）+ 库列表按 tag 筛选（**多选 + OR**）；created_at 时间戳前台化 |
| 范围 | 多归属 UI | **本期不放开**（数据层 M:N 已就绪，UI 后续放开）|
| 边界 | 这一期范围 | `#709`（主题容器，脊柱）+ **收编 `#539`**（保存证据集存对东西）；`#461` 拆出另案，`#718`/`#446`/`#493` 另案 |
| 数据 | `#539` 修法 | **不新建抽取**（`attachPaperRefsForMessage` 已抽 `{paper,snippet,anchor}`）；**砍掉"从会话保存"的占位 note**（容器初始 0 笔记），已抽证据在证据区平铺 |
| 交互 | 对话证据 | 会话 Q&A 保留为 `conversation` 证据 co-member；证据区给**"是否展示对话证据"开关**（集级偏好，数据照存）|
| 交互 | 划词建笔记 | **机械移植、行为等价**：每次划词 = 建 note + 自动建单成员容器（`note_id`→`evidence_set_notes` join，`persisted=0`）；容器爆炸暂不解（留 0.5）|
| 数据 | 容器持久化 | NotesView 只列 `persisted=1`；划词/Agent 临时集为 `persisted=0` 不进列表；**显式新建主题容器出生即 `persisted=1`**（建即存，无额外保存仪式）|

---

## 4. 用户流程（对应原型）

```
视图 A · 证据集页（NotesView，主载体）
  左：容器列表（名/tag/笔记数·证据数/时间）+ 顶部 tag 筛选
  右：详情 = 笔记区 / 证据区 上下并列
     ＋补笔记 → 内联 textarea 直接建自由笔记（EN1/EN2）
     ＋补证据 → 弹库选择器（论文/综述/对话）引用 → 保留溯源（EN1/EN3）
     笔记🗑=删除（可恢复） / 证据⊘=从本集移除（来源留库）（EN4）
     证据卡「跳到原文/综述/会话↗」→ 溯源
     Epic1 沉淀：结构化对照表笔记（笔记区）+ 选中空白条目（证据区），挂"来自研究空白"徽章（EN5）
     底部「找研究空白」入口（Epic1 衔接）

视图 B · Sheet 抽屉（从论文「所属证据集」徽章点开）
  以抽屉浮出，承载与视图 A 右详情相同的「笔记区 / 证据区」版面（共享组件）
```

---

## 5. 详细设计

### 5.1 数据模型反转（核心 · ADR-007 落地）

**关键事实**：`evidence_set_refs` 已是 M:N join 表（`set_id, ref_id, position`），证据↔集本就支持多条；**真正要反转的只有笔记侧**（`evidence_sets.note_id` 1:1 UNIQUE + ON DELETE CASCADE）。

| 改动 | 现状（001-initial.sql）| 目标 |
|---|---|---|
| 笔记↔集 | `evidence_sets.note_id TEXT UNIQUE REFERENCES notes(id) ON DELETE CASCADE` | 新建 `evidence_set_notes(set_id, note_id, position)`，PK`(set_id,position)` + `idx(note_id)`——镜像 `evidence_set_refs`，M:N |
| 级联 | 删 note → CASCADE 删 set | 取消；删笔记只删 join 行 + 软删 note |
| CHECK | `source ↔ note_id` 联动约束（user-highlight↔note 必非空 等）| 移除该约束（note_id 出主表）；`persisted ↔ name/saved_at` 约束保留 |
| 证据↔集 | `evidence_set_refs`（M:N）| 不动 |
| tag | 无 | 新建 `evidence_set_tags(set_id, tag)`，PK`(set_id,tag)` + `idx(tag)`（一集多 tag）|
| 时间戳 | `created_at` 有但未前台 | 前台化（容器头 + 成员卡展示）|

**迁移 `003-evidence-set-topic-container.sql`**（SQLite 表重建模式）：建新 `evidence_sets`（去 `note_id`、去 source↔note_id CHECK）→ 拷数据 → 建 `evidence_set_notes` 并把每个老 set 的 `note_id` 回填为 `position=0` 的 join 行（`agent-assembled` 无 note 者不回填）→ 建 `evidence_set_tags` → drop 旧表 rename。**每个老证据集 = 含 1 条笔记的容器**（ADR-007 §六迁移要求）。

`EvidenceSetSource` 的 `source` 列保留（创建来源溯源仍有意义），仅解除其与 `note_id` 的 CHECK 耦合。

### 5.2 详情版面（Sheet 内部重排 + NotesView 容器化 · 共享组件）

- 新建 **`EvidenceSetMembers`** 组件（替代退役的 `PairedCardsList`）：上「笔记」区 + 下「证据」区，各区 = 计数 + "+ 补充"入口 + 成员卡列表。**由 `EvidenceSetDetailSheet`（抽屉）与 `NotesView` 右详情共用**，避免两套渲染。
- **容器头 `SetHeader` 扩展**：容器名（inline rename ✎）+ tag chips（含"+ 标签"）+ created/updated 时间戳。
- **`NotesView` 左列表：note-centric → container-centric**——从"1 note = 1 行"改为"**1 容器 = 1 行**"，行内显示：容器名 · tag · 笔记数/证据数 · 时间。这是容器心智的必然结果（一集多笔记后 1:1 列表不成立）。
- 卡片用阴影不描边（暗色细边框），中性灰；唯一语义色 = "来自研究空白"沉淀物用 warning 琥珀左边条 + 徽章（关联研究空白来源）。

### 5.3 补笔记（自由笔记）

- 「笔记」区 "+ 补笔记" → 就地展开 textarea，直接打字保存为一条**自由笔记**（不依赖划词、不必依附某条证据）。
- 填上既有 `createNote` 直建缺口（ADR-007 §六提及）；走新通道 `evidenceSets:addNote`（建 note + 写 `evidence_set_notes` join，事务）。
- 现有"划词建笔记"路径（`createNoteFromPaperHighlight` / `createNoteFromReviewHighlight`）**行为等价、机械移植**：`note_id` 列出表后，原路径里"建 set 时传 `noteId`"一步改为"建 set + 写 `evidence_set_notes` join（position=0）"，划词仍 = 建 note + 自动建一个**单成员容器**（`persisted=0`）+ paper/review 证据 ref。注意是"等价"而非"零改动"——`note_id` 既已删列，该路径**必然改写**（spec 早前"保留不动"措辞为误，已据 2026-06-25 grill 更正）。容器爆炸（一划一容器）本期不解，留 0.5（"划词加入已有容器"）。

### 5.4 补证据（引用库对象 + 溯源）

- 「证据」区 "+ 补证据" → 弹**库对象选择器**（复用 `AddToEvidenceSetDialog` / @ 提及风格，论文/综述/对话三段切换）→ 选中一项 → 建 `evidence_ref`（`source_kind` 已支持 paper/review/conversation）+ 写 `evidence_set_refs` join → 走新通道 `evidenceSets:addEvidence`。
- **溯源（EN3 / Story5）**：证据卡保留锚点，点"跳到原文/综述/会话 ↗"复用现有锚点跳转（`Anchor` 双层定位 + `snapshotText`）。
- **段落级精确锚点**仍走"划词"老路（详情页引用为对象级；要精确段落由用户在原文划词补充）。
- **对象级引用的 snapshotText（Anchor 契约硬约束）**：`Anchor.snapshotText` 永远必填（"anchor 的灵魂"，见 `packages/shared/src/types/anchor.ts`），`locationData` 才是可选加速器。对象级引用无具体片段，故 snapshotText **用来源代表文本兜底**——论文 = 标题（或 abstract 首段）、综述 = 章节标题、对话 = Q&A 快照（本就有片段）；`locationData` 留空，"跳到原文"跳到来源对象顶部。原型 `addEvidence()` 里那句占位 `"…relevant passage…"` 落地时换成该兜底文本。dedup 键 `source.id|snapshotText` 仍成立（同对象级重复加 → 同键去重）。

### 5.5 删除语义（区分措辞 · EN4）

| 成员 | 按钮 | 行为 |
|---|---|---|
| 证据 | "从本集移除" | 删 `evidence_set_refs` join 行；**来源论文/综述留在库里**（证据本质是引用）；该 ref 若无其他归属则软删（`visibility='deleted'`）。**本期多归属 UI 未放开 → 每条 ref 仅一个归属 → 移除必然成孤儿 → 必软删**；"检查其他归属"为面向 0.5 的前向逻辑 |
| 笔记 | "删除笔记" | 软删 note（`visibility='deleted'`，可恢复）+ 删 join 行 |

两者均为 join 行级操作 → "删单个成员不影响其余"（EN4）天然满足。

### 5.6 tag（容器级 + 库筛选）

- 容器头：tag chips + "+ 标签"，增删走新通道 `evidenceSets:setTags`（写 `evidence_set_tags`）。
- `NotesView` 左列表顶部：tag 筛选条（**多选 chips，OR 语义**——命中任一选中 tag 即显示），按 tag 过滤容器。（原型 `filterTag()` 为单选占位，落地按多选 + OR。）
- `listSummary` / `notes.listAll`（容器化后）返回 `tags: string[]`，并支持可选 `tagFilter` 入参。

### 5.7 Epic1 沉淀契约（EN5 / GM6 · 与 research-gap-spec §5.6 对齐）

- 对照表整体 → **1 条结构化笔记**（body 存表，落**笔记区**）→ 走 `evidenceSets:addNote`。
- 每个选中空白/冲突 → **1 条带溯源证据条目**（落**证据区**）→ 走 `evidenceSets:addEvidence`；空白条目的锚点形态由 Epic1 定义。
- 本 spec 只负责"成员可存可读回、完整保序"（EN5/GM6）；不定义对照表/空白的内部结构。

---

## 6. 复用点与扩展点（摸排结论，带文件路径）

**复用（现成，直接用）**
| 对象 | 文件 |
|------|------|
| 证据↔集 M:N join 表 | `evidence_set_refs`（`001-initial.sql`，已 M:N）|
| 证据集聚合查询 | `apps/electron/src/main/lib/objects/query-service.ts`（`queryEvidenceSetDetail`）|
| 补证据选择器范式 | `apps/electron/src/renderer/components/library/dialogs/AddToEvidenceSetDialog.tsx` · @ 提及栈 `at-mention-*` |
| 溯源锚点 | `packages/shared/src/types/anchor.ts` · `types/objects/evidence-ref.ts` |
| 划词建笔记 | `apps/electron/src/main/lib/notes-service.ts`（`createNoteFrom*Highlight`，保留）|

**改造**
| 对象 | 文件 | 改动 |
|------|------|------|
| schema | `apps/electron/src/main/lib/objects/migrations/`（新增 `003-*.sql`）| 见 §5.1 |
| 证据集仓储 | `objects/repositories/evidence-set-repository.ts` · `note-repository.ts` | join 表读写、tag、去 1:1 假设 |
| 详情聚合 | `objects/query-service.ts` | `EvidenceSetDetail.note` → `notes: Note[]` + `tags: string[]`（多笔记聚合）|
| 服务层 | `evidence-set-service.ts` · `notes-service.ts` | `addNote / removeNote / addEvidence / removeEvidence / setTags` |
| 类型 | `packages/shared/src/types/objects/evidence-set.ts` · `types/evidence-sets.ts` · `types/notes.ts` | `EvidenceSetDetail` 多笔记 + tags；新通道常量 |
| 详情容器 | `renderer/components/library/EvidenceSetDetailSheet.tsx` · `evidence-set-detail/SetHeader.tsx` | 接 `EvidenceSetMembers` + tag + rename |
| 证据集页 | `renderer/components/library/NotesView.tsx` | 列表 container 化 + tag 筛选 |

**新增**
- `renderer/components/library/evidence-set-detail/EvidenceSetMembers.tsx`（笔记区/证据区并列，Sheet 与 NotesView 共用）。

**退役**
- `evidence-set-detail/PairedCardsList.tsx`（笔记段落配对论文、合卡 → 不再符合"并列 co-member"心智）。

---

## 7. IPC 四联同步 + 迁移

新增/改造通道（均走四联：shared 常量+类型 → main `ipc.ts` → preload → renderer）：

| 通道 | 作用 |
|---|---|
| `evidenceSets:addNote` | 容器内建自由笔记（建 note + join，事务）|
| `evidenceSets:removeNote` | 软删 note + 删 join |
| `evidenceSets:addEvidence` | 引用库对象建 ref + join |
| `evidenceSets:removeEvidence` | 删 join（来源留库）|
| `evidenceSets:setTags` | 容器 tag 增删 |
| `evidenceSets:getDetail`（改）| 返回 `notes: Note[]` + `tags: string[]` |
| `evidenceSets:listSummary` / `notes:listAll`（改）| 返回 `tags`，支持 `tagFilter` |

**迁移**：`003-evidence-set-topic-container.sql` 表重建 + 老 1:1 数据回填（§5.1）；dev 走 `~/.asci-dev`，需在 dev/prod 各验一次读回。

---

## 8. 验收（映射北极星 EN1–EN5）

| 审计 | 验收 |
|------|------|
| EN1 | 详情页直接补证据、补笔记各成功一次（不经 Agent 对话）|
| EN2 | 一个证据集连加 2+ 条笔记，均读回 |
| EN3 | 笔记与证据并列、各自可管理；任一证据点击溯源到论文段落/综述句/对话消息成功 |
| EN4 | 删单个笔记 / 单个证据后，其余成员完整无损 |
| EN5 | Epic1 产物（对照表结构化笔记 + 选中空白证据条目）写入证据集，读回完整、保序（与 GM6 同口径）|

---

## 9. Out of Scope

- 多归属交互（一条笔记/证据同属多个容器的 UI）→ 后续放开（数据层 M:N 已预留）。
- 双向链接 / 知识图谱、证据集协作 / 分享、证据集导出独立格式 → 不做（PRD Epic2 Out of Scope）。
- 补证据的段落级精确锚点直建 → 仍走划词老路（详情页引用为对象级）。
- 笔记富文本 / 附件 → 不做（自由笔记为纯文本，沿用现有 note body）。
- `#461`（会话"加入文献"面板与 Zotero 删除不同步）→ **拆出另案**：evidence-set 侧已被"Zotero 删 paper 不联动删 `papers` 行"策略保护（`zotero-paper-sync.ts`，无悬空 ref），其实体工作在 Zotero 同步 + 会话 paper 面板刷新，与本容器改造正交（2026-06-25 grill）。
- 容器爆炸（划词一划一单成员容器）→ 本期不解；"划词加入已有容器" / 真正无容器的游离笔记 → 留 0.5。
- 列表"搜索证据集"框（原型 `es-search`）→ 本期不做（占位），容器规模变大后再议。
- "找研究空白"入口属 Epic1 [#708](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/708)：本期只留入口，不实现分析流程。

---

## 10. 依赖与实施顺序

```
前置：ADR-007 签 Accepted（数据模型方向）

tracer bullet：
  1. schema 003 迁移（join 表 + tag + 老数据回填）+ 仓储读写
  2. query-service：getDetail 多笔记 + tags 聚合
  3. 服务层 + IPC 四联：addNote/removeNote/addEvidence/removeEvidence/setTags
  4. renderer：EvidenceSetMembers（共享）→ SetHeader(tag/rename) → Sheet 接入 → NotesView 容器化 + tag 筛选 → 退役 PairedCardsList
  5. i18n en+zh（补/删/移除/标签 文案）；typecheck + bun test + dev golden path（视图 A/B）；simplify 复盘
```

依赖关系：**Epic1 沉淀（GM6）⬅ 本 Epic 的 addNote/addEvidence 能力**；多归属 UI 不阻塞本期。

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 迁移动核心数据模型，老数据损坏 | 表重建走标准 SQLite 模式 + 迁移后读回校验（dev/prod 各一次）；`bun test` 加迁移用例 |
| `NotesView` 从 note-centric 改 container-centric 影响面广 | 先抽 `EvidenceSetMembers` 共享组件，列表与详情解耦；保留 `notes:*` 通道语义 |
| 删除语义混淆（删证据误删库论文）| 措辞硬区分（"从本集移除" vs "删除笔记"）+ 二次确认仅笔记删除 |
| 单归属下 tag 价值有限 | 本期只做容器级 tag + 库筛选；跨容器 tag 组织随多归属 UI（0.5）放开 |
