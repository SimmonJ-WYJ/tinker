> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# lit-review 源可用性预检 + 全-abstract 快路径 Spec

> **状态**：草稿 · 待 review
> **关联里程碑**：0.3.x
> **领域语言事实源**：
> - 阅读预算分配器：`apps/electron/default-capability-packs/lit-review/sub-agents/evidence-triager.md`
> - 编排（Turn-2 PLAN）：`apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`
> - 终产物（abstract-only fallback）：`apps/electron/default-skills/literature-review-result/SKILL.md`（§Input Contract / §Error Handling）
> - wiki 解析状态源：`apps/electron/resources/zotero-mcp/tools/wiki-lookup.ts`（`inIndex` / `parseStatus` / `mdPath` / `articlePath` / `txtPath` / `abstract`）+ `~/.asci/zotero/wiki/index.json`
> **前序**：`lit-review-pipeline-decomposition-spec.md`（reader 唯一阅读者）、`lit-review-turn2-orchestration-robustness-spec.md`（L1/L2/L3 压缩防御）、`lit-review-finalize-fast-path-spec.md`（收尾段确定性闸）

---

## 1. 背景：问题不在"写"，在"没先看有没有源"

综述 Turn-2 在用户选完方向后**直接规划 reader fan-out**，全程**没有任何前置的"这些论文有没有可读全文（Zotero PDF 已解析的 wiki 源）"判断**。"有没有源"是**每个 reader 在内部、晚到读取时**用 `zotero_wiki_lookup` 各自发现的——发生 N 次、且在已经决定派 N 个 reader 之后。

### 1.1 真实失败（2026-06-30 trace）
一次对 **lit-search 检索结果集**（`openalex` 来源，有 `doi`、无 `zoteroKey`、不在 Zotero、无 wiki 源）写综述的 run：

| 现象 | 根因 |
|------|------|
| 22+ 篇全部 `abstract-only`，reader fan-out 退化成"把 abstract 重排成 evidence JSON" | 输入整集无源，但管线仍强制 reader fan-out |
| 主 Agent 手搓 10 个内联塞满 abstract 的 reader prompt → 主循环膨胀 → **触发压缩** | **没有"全无源 → 直接用 abstract 写"的分支**，模型只能绕/手搓 |
| 压缩后丢失编排状态 → **停住不产综述** | 同上：管线没给这个场景留路径 |

### 1.2 两条根因，本 spec 只解其一
- **(A) 路由 / DIY**：master 根本没走 lit-review scenario（把检索结果当 EvidenceSet 自己手搓）。**属路由兜底问题，本 spec 非目标**（另开 routing-guard）。
- **(B) 管线内缺"源预检 + 全-abstract 快路径"**：即使正确走管线，整集无源也没有干净路径。**本 spec 解决 (B)。**

### 1.3 已确认的产品决策
**纯检索、未进 Zotero 的论文（只有检索 abstract）依然要能产出综述**——即 "基于摘要的概览级综述" 是**一等模式**，不是单纯降级兜底。

---

## 2. 目标 / 非目标

**目标**
1. 用户选完方向后、规划 reader 之前，**一次性确定性预检** papersInScope 的源可用性（readable / abstract / none）。
2. **整集无可读源（allUnreadable）→ 跳过整个 reader fan-out**，直接派 body-writer 用 `papers[].abstract` 走 skill 已有的 abstract-only 路径产综述。**零 reader、零主循环膨胀。**
3. **部分可读** → reader 只对 readable 子集派；unreadable 论文走 abstract 路径，不为它们起 reader。
4. 纯检索论文的 abstract 能正确灌进 `papers[].abstract`。

**非目标**
- 不修路由 / DIY（根因 A，另开）。
- 不改 reader / skimmer / fact-checker 的内部逻辑。
- 不改 skill 的 abstract-only fallback 实现（它已具备，只是当前到不了）。
- 不在 Turn-2 引入任何外部检索（"不扩库"铁律不变）。

---

## 3. 设计

### 3.1 把预检并进 `evidence-triager`，并提升为"永远先跑"的 Turn-2 入口步

理由：triager 本就是"reader 之前、决定每篇怎么读"的步骤——"有没有源"和"deepRead 还是 light"是同一类决策；scenario 规划轮不能调工具（`system-prompt.md` L14），故预检必须由被派的子 Agent 承担；不新增 agent，与精简方向一致。

改动：
- **解除门控**：现 `when: "papersInScope.length > 10"` → **永远运行**。源预检对任意规模都要做；语义阅读预算分配那部分仍只在 readable 子集较大时才做（小集合 readable 全 deepRead）。
- **职责重定义**：triager = **源可用性预检 + 阅读预算分配**（先预检，后对 readable 子集分配）。

### 3.2 确定性 parse-status：`zotero_wiki_lookup_batch`（✅ 已实现，PR-1）

triager 现有工具只有 `papers_semantic_search`——**语义检索判不了"有没有 PDF 源"**（未进索引的论文一律 zeroHit，与"有源但没命中"混淆，正是当前盲点）。

新增一个 **batch 版 wiki 查询工具**（确定性、读同一份 `~/.asci/zotero/wiki/index.json`，**索引只加载一次**）。

**关键：复用 `zotero_wiki_lookup` 的核心，不是 `zotero_get_collection_items`。** 后者走 Zotero Web API、返回元数据摘要、不碰 wiki 索引、且是 collection 维度（无法表达任意论文子集、看不到"不在 Zotero 的纯检索结果"）——三点都不匹配。`wiki-lookup.ts` 已抽出共享核心 `resolveOne(idx, input)`，单篇 `handleWikiLookup` 与批量 `handleWikiLookupBatch` 共用 → **`results[i]` 与单篇返回逐字段一致**。

```
mcp__zotero__zotero_wiki_lookup_batch({
  items: [{ zoteroKey?, doi?, title?, authors?, year? }],   // 1..N；单篇=长度 1
  page?: number,      // 1-based，默认 1
  pageSize?: number   // 默认 50，上限 500
})
  → { results: WikiLookupResult[],   // 与该页 items 切片逐一对齐
      page, pageSize, total, hasMore, indexAvailable }
```

- **通用性（按用户要求）**：单篇查询 = `items` 长度 1；批量 = 多条；`page`/`pageSize` 分页 + `total`/`hasMore` 供循环。`WikiLookupResult` 即单篇返回结构（`found` / `inIndex` / `parseStatus` / `mdPath` / `articlePath` / `txtPath` / `abstract` / `reason` …）。
- **readable 判定**：直接用 `result.found`（`found:true ⇔ parseStatus==='completed' 且有可读路径`）。triager 据此分 readable / abstract（`!found && abstract` 可用）/ none。
- **注册**：纯 MCP server 工具，注册在 `resources/zotero-mcp/server.ts`（tools 列表 + dispatch switch），**不走 IPC 四联**（它是 SDK 拉起的 stdio MCP server，不是 renderer IPC 通道）。triager 用时把工具名加进 `evidence-triager` 的 `tools`。
- **后续迁移（用户提出，非本 PR）**：稳定一段时间后，可把其他 `zotero_wiki_lookup` 单篇调用点逐步换成 `..._batch`（`items:[one]`）以省重复索引加载；因结果逐字段一致，迁移是机械替换。

### 3.3 triager 输出 schema 增量

在现有 `{ scopeNote, deepRead, light, zeroHit, perChapterTopHits }` 基础上新增：

```jsonc
{
  "sourceAvailability": {
    "readable":   ["<attachmentKey|N>", ...],   // found=true，有可读全文源 → 进 reader
    "unreadable": ["<...>", ...]                 // 其余（parse pending/failed / 不在索引 / 无源）→ 不进 reader
  },
  "allUnreadable": true,                          // readable 为空 → 触发快路径
  "deepRead": [...],   // 仅在 readable 子集内分配（不可读的不进来）
  "light":    [...]    // 同上
}
```

- `deepRead` / `light` **只在 `readable` 子集内**分配；`unreadable` 不进 reader。
- `allUnreadable === (readable.length === 0)`；为 true 时 triager **不做任何语义搜**。
- `readable` = batch lookup 的 `found:true`（确定性，与语义无关）。
- `unreadable` 的 **abstract-only vs metadata-only 细分留给 skill**（其 §8 Per-Paper Decisions 已按 `papers[].abstract` 有无分档），triager 不需要拿到 abstract，保持输入精简。
- 语义工具不可用（keyword-only）或全 degraded → 预检仍照常（parse-status 与语义无关），仅 `deepRead/light` 退回"readable 全 deepRead"。

### 3.4 scenario Turn-2 分叉（核心）

scenario 在 Turn-2 把 triager 提到**第一步、永远跑**，然后据其输出二选一规划：

**分支 1 — `allUnreadable: true`（你强调的纯检索场景）**
PLAN **不含任何 reader / skimmer step**；`terminal_subagent = body-writer`，input 的 `papers[]` **必须带 `abstract`**。body-writer 调 skill，skill 走**已有** abstract-only fallback（`SKILL.md`：no rows + 有 abstract → 用 `papers[].abstract` 写，§8 全标 abstract-only / metadata-only）。收尾的 evidence-depth notice（包 2 已接）顶到最显眼。

**分支 2 — 有 readable**
- reader fan-out **只对 `readable`**（triager.deepRead）；skimmer 处理 readable 的 light 尾部（沿用现状）。
- `abstract` / `none` 论文**不派 reader**，作为 abstract-only 直接带进 body-writer 的 `papers[]`（带 abstract）。
- 其余编排（escalation reader、body-writer、fact-checker）不变。

> 两分支都**保留 triager 这一步**，故 `lit-review-terminal-skill-guard` 的 arm 信号（reader/triager/skimmer 派发）在两分支都成立——快路径不会让"综述待生成"失去武装。

### 3.5 纯检索 abstract 的灌入点（确定性：**线程透传，禁止 re-fetch**）

`none`/`abstract` 论文的 abstract 必须进 `papers[].abstract`，来源**只用手上已有的**、绝不重新抓：
- **owned / Zotero-found 论文**：直接用 triager 的 `zotero_wiki_lookup_batch` 返回里的 `abstract` 字段(batch 结果已带)。
- **纯检索论文（不在 workspace）**：`workspace_papers_list` 查不到 → **scenario 在 Turn-1→Turn-2 把检索结果（EvidenceSet / `search_papers` 命中 / `report-data.json` 每篇的 `abstract`）的摘要 verbatim 挂到 `papersInScope.{abstract?}` 一路带到 body-writer 的 `papers[].abstract`**。这是分支 1 的唯一证据来源。
- **硬禁令：不得用 `get_paper_meta` 批量补 abstract**。`paper-meta-cap-hook` 把 `get_paper_meta` 钉在 **3 次/turn**（只留给单篇跨包 gap-fill），N>3 篇批量补会**静默只补 3 篇、其余全空**。
  > **实测坐实（2026-07-01 allUnreadable run）**：8 篇纯检索集,主 Agent 即兴连打 8 次 `get_paper_meta` → 被 cap 夹到只成 3 篇 → 最终仅 1 篇有可用摘要,综述建立在 1 真摘要 + 7 metadata-only 上。主 Agent 归因 "openalex 503" 是误判,**确定性根因是 3/turn cap**。修法即本节：线程透传、不 re-fetch。
- 缺 abstract 的论文 → 直接 metadata-only（§8 列出），**不循环去抓**。

### 3.6 与现有组件的衔接（不改它们）
- **skill**：abstract-only fallback 已存在（`SKILL.md` §Input Contract "empty or absent AND .context 无缓存 → 用 papers[].abstract" + §Error Handling 行）。本 spec 只是**让它真的被走到**。
- **三个 guard**：structure-lint / factcheck / terminal-skill 均不变；快路径仍产 `reviews/*.html`、仍派 fact-checker、triager 仍 arm terminal-skill-guard。
- **reader**：分支 1 完全不派；分支 2 只派 readable，reader 自身降级逻辑作为冗余兜底仍在。

---

## 4. 影响面与改动清单

| 文件 | 改动 | 归属 |
|------|------|------|
| ✅ `apps/electron/resources/zotero-mcp/tools/wiki-lookup.ts`（抽出 `resolveOne` + 加 `handleWikiLookupBatch` / `wikiLookupBatchToolDefinition`）+ `server.ts` 注册 + `wiki-lookup-batch.test.ts` | §3.2 batch 工具（**PR-1 已完成**） | P0 |
| ✅ `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-triager.md` | §3.1 永远跑 + §3.2 parse-status(batch) + §3.3 新 schema(readable/unreadable + allUnreadable)（**PR-2 已完成**） | P0 |
| ✅ `apps/electron/default-capability-packs/lit-review/manifest.json` | evidence-triager 的 `tools` 加 `zotero_wiki_lookup_batch` + 描述重写；pack `version` → 0.2.16（**PR-2**） | P0 |
| ✅ `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md` | §3.4 Turn-2 分叉（allUnreadable 快路径）+ triager 去门控 + §3.5 abstract 灌入 + comprehensive 段同步 + 新 hard-rule（**PR-2**） | P0 |

i18n：均为内置英文 prompt / 工具描述，无 i18n key；triager / scenario prompt 改动须**保持英文**（CLAUDE.md §2，CJK 会被 loader 红线闸打回——见 prompt-slim 教训）。

---

## 5. 验证

- **单测**：`zotero_wiki_lookup_batch` 对 completed / pending / not-in-index / doi-only 各档返回正确 `hasReadableSource`；triager schema 含 `sourceAvailability` + `allUnreadable`。
- **加载**：`default-capability-packs-load` 通过（triager tools / schema 变更）。
- **真实 run（人工，无法 headless 自验）**：
  1. **整集无源**（纯检索结果集）→ 确认 **0 个 reader 被派**、body-writer 直接产 abstract-only 综述、§8 全标、evidence-depth notice 出现、**无压缩、不卡死**。
  2. **混合**（部分 owned 已解析 + 部分检索）→ reader 只对 readable 篇；abstract 篇进 §1–§6（abstract `<q>`）或 §8；引用结构合规。
  3. **全 readable** → 行为与现状一致（回归不退化）。
- `bun run typecheck` / `bun test` 通过。

---

## 6. 排期 / 拆 PR

1. ✅ **PR-1（工具）**：`zotero_wiki_lookup_batch` + 单测。**已完成**（复用 `resolveOne` 核心、单篇+批量+分页、29 测试通过、typecheck 通过）。独立、可先合。
2. ✅ **PR-2（编排）**：triager 去门控 + parse-status（用 `..._batch`，readable = `found`）+ 新 schema；scenario Turn-2 分叉 + abstract 灌入。**已完成**（46 包加载/契约测试 + typecheck 通过）。依赖 PR-1。**真实 run 回归仍需人工**（见 §5）。

---

## 7. 风险与回退

- **abstract 缺失**：分支 1 下若 `papers[].abstract` 没灌进来 → 整集 `none` → skill 报 "lack readable material" 停。**缓解**：§3.5 把"灌 abstract"列为硬要求 + 真实 run case 1 专门验。
- **误判 readable**：`hasReadableSource` 判定过松 → 派了 reader 却读不到 → reader 自身降级兜底（不致命，仅浪费一次 reader）。判定以 `parseStatus==='completed' && 有路径` 为准，从严。
- **回退**：batch 工具缺失 / 报错 → triager 跳过预检、`allUnreadable=false`，回退当前"全量 reader fan-out"行为（即今天的现状），不破坏既有路径。
- **不在本 spec 范围的 routing/DIY**：若 master 仍绕过管线手搓，本 spec 不拦——需另开 routing-guard（检测"无 lit-review PLAN 却连续手派 reader"→ 强制路由）。
