# 证据集 Note 展示修复 Spec（issue #446）

> **状态**：已实现 · 待 PR review
> **关联 issue**：#446（[ops-feedback] library 论文下添加 note：证据集列表标题/副标题与详情页引用展示不符预期）
> **关联 PR**：待开
> **领域语言事实源**：`CONTEXT.md`（证据集 / Note / EvidenceRef / Anchor）

---

## 1. 问题复核（issue 三个症状 ↔ 当前 main 现状）

issue 截图来自旧版打包构建（详情页还是 `NOTE` 区 + 引用块布局；现 main 已演进为
`PairedCardsList` 配对卡片）。在当前 main（`2647134f`）逐条复核：

| # | issue 症状 | 当前 main 现状 | 结论 |
|---|-----------|---------------|------|
| 1 | 证据集列表主标题未显示用户输入（显示成论文标题） | `NotesView.tsx` `NoteListItem` 已改为 `setName → note.content → 占位`（#556 携带落地） | **已修复**，本次仅回归验证 |
| 2 | 列表副标题未显示关联论文 | 副行 = note.body 首段；与主标题重复时整行隐藏 → 列表行完全没有论文信息（`sourceTitle` 字段已有但未用） | **待修** |
| 3 | note 详情展示冗余"引用内容" | 写入路径在无划词时用**正文前 200 字伪造** `sourceAnchor.snapshotText`；B3 起 `quote` 即 anchor.snapshotText → quote ≡ 正文前缀，`NoteDetailDialog` / `PaperNotesPanel.NoteCard` 把正文重复展示成引用块；该伪 quote 还会作为 PDF 跳转锚点（必然定位失败）。**存量数据已污染** | **待修（根因）** |

伪造点（写入路径）：

- [usePaperNotes.ts:106-109](apps/electron/src/renderer/hooks/usePaperNotes.ts:106) —
  `snapshotText: (draft.quote ?? draft.content).slice(0, 200)`
- [NotesView.tsx:449-452](apps/electron/src/renderer/components/library/NotesView.tsx:449) —
  `snapshotText: (pending.quote || content).slice(0, 200)`

> 注：当前 UI 的"无划词直接添加"入口已被"添加证据集"dialog 取代（`createWithPaper`
> 路径 anchor 为空串，干净），ItemDetailPanel 的 inline 空白笔记分支（rect=null）现已无触发点。
> 但兜底代码仍在、且老版本产生的存量数据仍在用户库里，三处症状里 #3 对存量数据依旧可见。

## 2. 行为期望（BDD）

1. **划词建注**（摘要 / PDF 选区）：
   - 证据集列表：主标题 = note 正文（截断），副标题 = 来源论文标题；
   - note 详情（NoteDetailDialog）：展示引用块 = 划词原文（保留现有行为）；
   - PDF 跳转锚点 = 划词原文。
2. **添加证据集 → 新建**（name + 补充说明）：
   - 列表：主标题 = 集合名，副标题 = 来源论文标题；
   - 详情：无引用块（anchor 本来为空，保持）。
3. **存量"直接添加"老数据**（quote 被正文前缀污染）：
   - 详情 / 论文页笔记卡不再出现与正文重复的引用块；
   - 不再把伪 quote 当 PDF 定位锚点。
4. 对话来源证据集：列表副标题 = 「会话名 · 问题前 20 字」（复用现有 `conversationSourceTitle`）。

## 3. 修复方案

### 3.1 Fix-副标题：列表副行改为"来源标题"（renderer）

`NotesView.tsx` `NoteListItem`：

- 删除"note.body 首段"推导，副行 `preview` 改传 `note.sourceTitle`
  （paper → 论文标题；review → 综述标题；conversation/none → 现有 `sourceTitle` 兜底文案）。
- 主标题逻辑不动（`setName → content → 占位`）。
- 去重守卫：`sourceTitle === primaryTitle` 时不渲染副行（防 set 名恰好等于论文标题的两行重复）。

不改 `PaperContainingEvidenceSetsPanel`（Referenced In 区在论文详情页内，论文上下文自明，
副行继续显示 note 摘要更有信息量）；不改 `EvidenceSetCard` 组件 API（`preview` 语义即副行）。

### 3.2 Fix-引用伪造（写入路径，renderer）

无划词时 anchor 留空，不再用正文兜底：

- `usePaperNotes.ts` createNote：`snapshotText: (draft.quote ?? '').slice(0, 200)`
- `NotesView.tsx` NotesViewPdfOverlay handleSave：`snapshotText: pending.quote.slice(0, 200)`
  （该流必有选区；显式去掉 `|| content` 兜底）
- 全仓 grep `snapshotText:` 构造点复查，确认无其他"正文兜底"残留
  （`addPaperToEvidenceSet` / `createEvidenceSetWithPaper` 已是空串，符合预期）。

语义依据：anchor 表"在原文哪里划的"，note 正文是用户原创，不构成定位锚点；
`addPaperToEvidenceSet` 已确立"无选区 → snapshotText 空串"的先例。

### 3.3 Fix-存量数据治理（查询层归一化，main 进程）

不做 DB migration，在查询出口统一"伪 quote 判定"：

`query-service.ts` 新增私有 helper：

```ts
/** 伪引文判定：旧版本无划词时用正文前 200 字兜底生成 anchor.snapshotText；
 *  正文以 quote 开头 → 视为伪造，按"无引文"返回。真实划词引文来自论文原文，
 *  与用户正文前缀重合的概率可忽略；即便重合，隐藏重复引用块也符合预期。 */
function sanitizeQuote(snapshot: string, noteBody: string): string {
  const q = snapshot.trim()
  if (q.length === 0) return ''
  return noteBody.trim().startsWith(q) ? '' : snapshot
}
```

两处出口接入（均能拿到同行的 note body）：

- `queryNotesByPaper`（[query-service.ts:133](apps/electron/src/main/lib/objects/query-service.ts:133)）
- `queryAllNotesWithPaper`（[query-service.ts:356](apps/electron/src/main/lib/objects/query-service.ts:356)）

收益：`NoteDetailDialog`、`PaperNotesPanel.NoteCard`、NotesView 搜索、PDF 跳转锚点等
所有 consumer 一次治愈；纯读侧归一，可随时回退，无数据风险。

**实现补充（复盘后扩展，超出上述两出口）**：
- `sanitizeQuote` 仅对 **paper 锚点**生效（按 source kind 门控）——兜底伪造只发生在
  paper md anchor 写入路径；conversation 的 Q/A 快照与 note 正文同源是合法形态，不判伪。
- 第三个泄漏出口 `queryEvidenceSetDetail`：给 `EvidenceRefWithSource`（`@asci/shared`）
  加派生只读字段 `quote`（查询层归一后的值），**raw `ref.source.anchor` 不动**
  （promote / 导出 / `anchorContentHash` 幂等键依赖原始值）。消费侧改读 `quote`：
  - `NotesView.onSelectPaperRef`（PairedCard → PDF 定位）
  - `evidence-set-context-block.ts`（`<excerpts>` agent 注入 —— 否则会把用户正文
    冒充论文原文喂给 Agent）

**备选（不推荐）**：一次性 migration 清洗 `evidence_refs.source_anchor`。
能根治存量，但要写迁移 + 判定逻辑相同、风险更高；查询层归一已覆盖全部可见症状。

### 3.4 不做的事

- 不引入 note "标题"字段（issue 的"标题"即正文首行心智，主标题=正文已满足）；
- 不改 `EvidenceSetDetailSheet` / `PairedCardsList`（当前已无引用块，无症状）；
- 不动 IPC 契约（无通道/类型变更，四联同步不触发）。

## 4. 测试与验收

- **单测**（main 进程，`bun test`）：
  - `sanitizeQuote`：空串 / 真实引文 / 正文前缀伪引文 / 带空白差异的前缀；
  - `queryNotesByPaper` / `queryAllNotesWithPaper`：插入"伪 quote"行 → 返回 quote 为空；真实划词行 → 原样返回。
- **手动 golden path**（`bun run dev`）：§2 的 4 条行为期望逐条走查；
  zh ↔ en 切换确认列表副行无 raw key（本次预计**零新增 i18n key**：副行直接展示来源标题）。
- `bun run typecheck` 通过。

## 5. 影响面与版本

- 改动包：`apps/electron`（renderer 2 文件 + main 1 文件）→ 开 PR 时 patch +1；
- `packages/*` 无改动；无新依赖；无 IPC / schema 变更。

## 6. 待确认（open questions）

1. 列表副行统一改为"来源标题"（含命名集合）—— 命名集合现在副行显示的"补充说明首段"会被替换，可接受？（推荐：接受，列表口径统一为「集合是什么 + 来自哪」）
2. 存量治理选查询层归一化（推荐）还是 DB migration？
