# 大集合综述（>10 篇）读取链路优化：批量轻证据抽取器 + reader 数封顶 设计规格

> 注：触发阈值与 deepReadCap 自 20/15 **下调为 10/8**（便于快速验证向量库价值;升级上限仍 5）。下文数字已同步。

- 状态：草案（待评审，三项核心参数已与用户确认）
- 关联 issue：（待建）
- 关联 PR：（待建）
- 领域语言事实源：`CONTEXT.md`（reader / evidence-triager / 语义检索 / EvidenceSet）
- 关联 spec：`lit-review-reader-evidence-cache-spec.md`（.context 缓存，正交，被本方案复用）、
  `lit-review-evidence-enrichment-spec.md`（覆盖补全，正交）

## Context（为什么做）

综述 Turn 2 对大集合**每篇论文都开一个 reader**：30 篇 → 30 个 reader，40 篇 → 40 个。每个 reader 是独立子 agent，
有固定开销（system prompt + reader.md ~2–3k tokens + 工具 schema），与它实际读多少无关。**到 40 篇量级，
"reader 个数 × 固定开销" 成为主成本中心**（~80–120k tokens 仅固定 prompt），且 agent 数随论文数线性爆炸。

现有 `evidence-triager` 已把大集合按章节语义相关度分成 `deepRead`（核心）/ `light`（尾部），但**尾部仍每篇开
reader**，只是读得轻——省了"读取深度"，没省"reader 个数"。

**目标**：把尾部 ~N–K 篇的证据抽取，从"N–K 个并行 reader"合并为**一个批量抽取器**：复用 triager 已有的向量命中
锚点、逐篇读小窗上下文产出 verbatim 证据行；只有**核心层 + 向量覆盖不足的少数论文**才开 reader。
reader 数从 **O(N)** 降到 **O(deepReadCap + 升级上限)**，与论文总数解耦。

## 已确认的核心参数（用户拍板）

1. **统一策略**：所有 `papersInScope > 10` 的综述**一律用批量抽取器**处理尾部（不按规模再分档）。
2. **`deepReadCap = 8`**：核心层最多 8 篇开 full reader。
3. **升级上限 = 5**：批量器判定"覆盖不足"的论文最多再补开 5 个 reader；超出部分按优先级取前 5，其余保留
   批量器产出的轻证据（见决策 4）。

## 触发门控

- **`papersInScope > 10` 且检索模式 = `vector` / `both`** 才启用。
- `papers-rg` 纯关键词模式 → triager 整步 skip → 退回**全员 full reader**（无本优化）。
- `papersInScope ≤ 10` → 维持现状（全员 reader）。

## 关键事实（已核实）

| 事实 | 出处 |
|------|------|
| triager 不读论文，只做 per-chapter 语义检索排序，输出 `deepRead[]`/`light[]`/`zeroHit[]`/`perChapterTopHits` | `evidence-triager.md` |
| `perChapterTopHits` 每条仅 `{paperId, score, snippet≤120字}`，**丢了 `anchorStart`** | `evidence-triager.md:32-39` |
| `papers_semantic_search` 命中**本来就返回 `anchorStart`/`anchorEnd`**（段落 `p<sec>_<para>` 或字节 `b<offset>`）；索引在向量化时已存锚点 | trace 实测 + `reader.md` 语义跳读段 |
| 锚点可直接喂读取工具：`p<sec>_<para>`→`papers_read_article_section`，`b<offset>`→`papers_read_context` | `reader.md` |
| snippet 可能截断，**禁止直接当 `<q>`**；必须读锚点上下文取连续 span | `reader.md`、SKILL `<q>` 契约 |
| `source_id` 必须是 parent item key（非 attachmentKey），否则引文映射断 | 缓存 spec 的修复 |
| reader Step 0 命中 `.context` 缓存即跳过一切 | 缓存 spec |
| 守门测试断言 lit-review 子 agent 名单（新增子 agent 须同步更新） | `default-capability-packs-load.test.ts:52` |

## 锁定的设计决策

### 1. Turn-2 大集合编排：三层

```
① evidence-triager（1个，已存在，加 anchorStart 透传）
     per-chapter papers_semantic_search（paperIds 锁集合内）→ 排序
     输出：deepRead[]（top-8）、light[]（其余）、perChapterTopHits（每条带 anchorStart）

② 核心层 deepRead（≤8 个并行 reader）
     full outline-first 精读（不变）。保住综述质量主体。

③ 尾部层 light（1 个 evidence-skimmer，新增子 agent，串行）
     输入：light 论文清单 + 它们在各章的命中锚点（来自 triager perChapterTopHits）
     逐篇：在 anchor 处 papers_read_context / papers_read_article_section 读小窗
           → 取 verbatim 连续 span → 产出证据行（source_id=parentItemKey）
     覆盖判定（见决策 2）：
       · 够 → 直接产出该篇证据行 + 写 .context 缓存
       · 不足 / 缺 §5 gap 信号 → 不凑合，列入 needsDeepRead[]
     输出：尾部已覆盖论文的 evidenceRows[] + needsDeepRead[]

④ 升级层 needsDeepRead（≤5 个 reader，targeted）
     仅这几篇做 outline + 未覆盖目标章节的 section 读（targeted deep read）。
     若 needsDeepRead > 5 → 按 triager 命中强度取 top-5；其余保留批量器轻证据
     （仍可引用，但 §8 标注 "skim-only, 覆盖有限"）。
```

terminal_skill（`literature-review-result`）照常消费**全部** evidenceRows（核心 reader + skimmer + 升级 reader）。

**Agent 数（40 篇, K=8）**：1 triager + 8 reader + 1 skimmer + ≤5 升级 ≈ **≤15**（vs 现 41），且省 ~30 份 reader 固定开销。

### 2. 覆盖充分性判定（skimmer 逐篇自检，给弱模型一个清单）

skimmer 对每篇 light 论文：

- 该篇 `targetChapters`（它在 triager 里命中的章节）**每章至少 1 条** high-confidence、verbatim、读自上下文的证据行；
- 单篇证据行 2–4 条；
- **§5 gap 兜底**：若 `targetChapters` 含"研究空白/局限"相关章节（或方向强调 gaps），命中里没有 limitation /
  future-work 行 → **直接列入 needsDeepRead**（limitation 句常不在向量 top 命中里，这是语义优先最大的质量风险，
  不在 skimmer 里凑合）。

任一不满足 → `needsDeepRead`。

### 3. 启用前提：triager 透传 `anchorStart`（不重新向量化）

- `perChapterTopHits` 每条加 `anchorStart` 字段——纯透传 triager 已从 `papers_semantic_search` 拿到、却丢弃的值。
- **不碰索引、不碰 embedding、不重新向量化**：锚点早在索引里、搜索本来就返回。
- 没有它，skimmer 就得每篇自己再跑一次 `papers_semantic_search`（白费一轮查询）。skimmer 仍保留
  `papers_semantic_search` 作为"锚点缺失"的兜底。

### 4. 质量护栏（四条，缺一不可）

1. **引文保真**：skimmer 绝不用 snippet 当 `<q>`；必须在 anchor 处读上下文取**单段连续 verbatim**。
2. **§5 gap 兜底**：见决策 2——缺 gap 信号的论文升级，不凑合。
3. **`source_id = parentItemKey`**（非 attachmentKey）。
4. **缓存优先**：skimmer 处理某篇前先查 `.context/{parentItemKey}.evidence.json`，命中即用缓存、不读不查
   （Step 0 短路，优先级最高）；skimmer 产出的轻证据也写回 `.context`。

### 5. 成本天花板与取舍（诚实记录）

| 层 | 上限 | 并行性 |
|----|------|--------|
| 核心 reader | 各 1 outline + ~3 section | 并行 |
| skimmer / 篇 | anchor 处 ≤3 次小窗读（每次 1–2KB） | **串行**（单 agent 顺序处理 ~K 篇） |
| 升级 reader | outline + 未覆盖 section，≤5 个 | 并行 |

- **取舍**：skimmer 串行 → 这一步 wall-clock 比并行 reader 长；换来的是 **token 大降 + agent 数封顶**。
  小窗读量小，~25 篇 × 几次 ≈ 100–150KB，单上下文可承载。
- 弱模型若误判频繁升级，也被"≤5"硬上限挡住，不会退回大量 reader。

## 落点（文件）

- `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-triager.md`：`perChapterTopHits` 输出
  schema 每条加 `anchorStart`（透传）。
- **新增** `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-skimmer.md`：批量轻证据抽取器
  prompt（输入契约、anchor 上下文读、覆盖判定、§5 gap 升级、`source_id=parentItemKey`、缓存读写、串行处理、
  needsDeepRead 输出）。
- `apps/electron/default-capability-packs/lit-review/manifest.json`：注册 `evidence-skimmer` 子 agent，工具
  `mcp__papers-rg__papers_read_context` / `papers_read_article_section` / `papers_search_keywords` /
  `papers_semantic_search`（锚点缺失兜底）+ `Read` + `Write`（缓存），`model: haiku`。
- `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`：Turn-2 PLAN 大集合分支改造——
  triager → deepRead reader fan-out（≤8, full, parallel）+ 1 个 evidence-skimmer（尾部）；skimmer 返回
  `needsDeepRead` 后补派 ≤5 个 targeted reader；terminal_skill 汇总全部 evidenceRows。`deepReadCap` 固定传 8、
  升级上限传 5。
- `apps/electron/default-capability-packs/lit-review/sub-agents/reader.md`：增"targeted 升级读"说明（dispatch 指明
  只读某几章 → outline + 这些 section）；原"每篇语义优先 light"路径作废（尾部已由 skimmer 接管）。
- `apps/electron/src/main/lib/__tests__/default-capability-packs-load.test.ts`：lit-review 子 agent 名单断言
  加入 `evidence-skimmer`（现为 6 个 → 7 个）。

## 分阶段

- **Phase 1（MVP）**：triager 透传 anchorStart + 新增 evidence-skimmer + manifest 注册 + scenario 大集合编排 +
  reader targeted 升级 + 守门测试更新。纯 capability-pack 层，零主进程 / IPC / 打包改动。
- **Phase 2（可选）**：skimmer 命中相关性更细的排序；中文源直接降级到 reader（语义召回弱时跳过 skimmer）。

## 验证

1. `bun run typecheck` / `bun test`（含守门测试新名单、模板展开无残留 `{{}}`）。
2. **agent 数 / token 对照（核心）**：同一 40 篇综述题，开/不开本优化各跑一次，比 **reader/agent 总数、总
   token、wall-clock**；预期 agent 数从 ~41 → ~20，token 显著下降，质量(judge)不降。
3. **§5 Gaps 不退化**：核查尾部论文的 limitation/future-work 是否仍进入综述（gap 升级规则生效）。
4. **升级路径 + 上限**：构造 >5 篇"向量覆盖不足"的 light 论文 → 确认只补开 5 个 reader、其余保留 skim 证据且
   §8 标注；被升级的篇确实做了 targeted section 读。
5. **缓存短路**：命中 `.context` 的 light 论文 → skimmer 不读不查、直接用缓存。
6. **引文保真**：skimmer 产出的 `<q>` 均为单段连续 verbatim、可在原文定位（非截断 snippet）。

## 未决

1. **skimmer 串行延迟**：若 ~25 篇串行读对 wall-clock 影响过大，可评估"把 light 再切 2–3 个 skimmer 分片并行"
   （部分牺牲 agent 数收益换延迟）。先按单 skimmer 跑，看实测。
2. **zeroHit 论文**：triager 标记的零命中论文（词汇不匹配≠不相关）目前仍进 light → skimmer。是否对其直接走
   targeted reader 而非 skimmer？倾向先让 skimmer 试、不足再升级（已有兜底）。
3. **score floor**：skimmer 判定"命中可用"的分数线，需用真实库标定，先给经验默认。
