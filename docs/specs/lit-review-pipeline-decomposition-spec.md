> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 综述链路能力拆解改造 Spec（Lit-Review Pipeline Decomposition）

> **状态**：草稿 · 待 review
> **关联 issue**：TBD（建议建 issue 跟踪）
> **关联 PR**：TBD
> **领域语言事实源**：本 spec §11 术语；落 `CONTEXT.md` 后以 `CONTEXT.md` 为准
> **影响包**：`apps/electron/default-capability-packs/lit-review`、`apps/electron/default-skills/literature-review-result`、`apps/electron/src/main/lib/agent-prompt-builder.ts`

---

## 1. 背景与问题

### 1.1 现状链路（Turn 2）

用户在 ChoiceCard 选定方向后，`lit-review` scenario Agent 发出 Turn 2 PLAN：

```
steps:        [ reader × N  (parallel, optional) ]
terminal_skill: literature-review-result
optional_followups: [ fact-checker ]
```

主 Agent 协议（`agent-prompt-builder.ts` PLAN dispatch §step4）：**先跑完所有 `steps`，再调 `terminal_skill`**。

### 1.2 观察到的问题（real trace：综述 3m58s 仍未出正文）

| 现象 | 根因 |
|------|------|
| reader 在精读时 `Read webfetch-…pdf`，从网络下载 PDF | reader 工具集为 `Read/Glob/Grep/Bash/WebFetch`，**没有 wiki 工具、不能 `zotero_wiki_lookup`**，取正文只剩 WebFetch 一条路 |
| 同一批论文被读两遍 | reader fan-out 读一遍（PDF），`literature-review-result` skill Step3 又用 wiki 工具读一遍（`papers_read_*`） |
| 链路慢、主上下文重 | skill 经 `Skill` 工具在**主 Agent 上下文内**逐篇读，token 重、易触发 auto-compaction（skill 自己在 Step3 注释里都点了这个风险） |
| 源质量劣化 | WebFetch 原始 PDF 比 wiki 已解析的结构化 `.article.md` / `.txt`（带 `# OUTLINE` + `<p id>` 锚点）更差、更易失败 |

**本质**：阅读能力被同时实现在 reader 与 skill 两处，且 reader 用了错误的源。

### 1.3 设计决策（已与 owner 确认）

1. **阅读能力完全拆解给 reader**：reader 接 wiki 工具、去掉 WebFetch，成为唯一阅读者；skill 不再自己读。
2. **合并 skill 与 synthesizer 为单一 body-writer**：保留 `literature-review-result` skill 作为唯一 body 生产者（terminal_skill），**退役 `synthesizer` SubAgent**；skill 的输入从「论文集」改为「reader 产出的 evidence rows」。

---

## 2. 目标与非目标

### 2.1 目标

- **单一阅读源**：综述全链路只读一次，且只从 wiki 结构化源读，杜绝 WebFetch 下载 PDF。
- **读写分离**：reader（隔离沙箱、haiku、并行）负责读并产出 evidence rows；body-writer 只合成、不读。
- **主上下文变轻**：主 Agent 只见紧凑 evidence rows，不再承载整篇论文正文。
- **角色收敛**：body 生产者唯一化（skill），删除 synthesizer 重复定义。
- 行为不退化：`<cite data-ref="N"><q>…</q></cite>` 引用契约、§1–§8 结构、fact-checker 终审、持久化 hook 全部保持。

### 2.2 非目标

- 不改 Turn 1（方向提议 / `present_directions` ChoiceCard）链路。
- 不改综述持久化（`persistReviewsFromSessionCwd` / cwd 扫描）。
- 不改 lit-search / EvidenceSet 策展链路。
- 不引入 PDF 解析（仍由 wiki 异步队列负责）。
- 不改 HTML fragment 渲染管线（DOMPurify + KaTeX + 引用后处理）。

---

## 3. 现状能力盘点

### 3.1 `literature-review-result` skill 的四步能力

| 步 | 能力 | 用到的工具 |
|----|------|-----------|
| Step 1 | Intake & 编号（papers[] → 固定 1-based N） | —（纯逻辑） |
| Step 1.5 | wiki 解析：identity → `mdPath/txtPath/articlePath/abstract` | `zotero_wiki_lookup` |
| Step 2 | 阅读计划：按字段分桶（md-read / abstract-only / metadata-only） | —（纯逻辑） |
| Step 3 | 逐篇深读（outline-first） | `papers_read_outline` / `papers_read_article_section` / `Read(mdPath)` |
| Step 4 | 合成 §1–§8 HTML + 引用/quote/一致性校验 + 落盘；targeted 引用核查 | `papers_search_keywords` / `papers_read_context` / `Write` / `workspace_papers_list` |

### 3.2 现状 SubAgent

| SubAgent | 工具 | 模型 | 现职责 |
|----------|------|------|--------|
| review-proposer | Read/Glob/Grep | sonnet | Turn 1 产 3 方向 |
| reader | Read/Glob/Grep/Bash/**WebFetch** | haiku | 单篇精读（**当前走 WebFetch PDF**） |
| synthesizer | Read/Glob/Grep/Bash/Write/Edit/get_paper_meta | sonnet | body 兜底（**将退役**） |
| fact-checker | Read/Glob/Grep/Bash/WebFetch | haiku | 引用终审 |

---

## 4. 目标架构

### 4.1 能力拆解映射（skill 四步 → 新链路落点）

| 原 skill 能力 | 拆解后落点 | 说明 |
|---------------|-----------|------|
| Step 1 Intake & 编号 | **保留在 body-writer（skill）** | N 编号是引用事实源，必须由最终写 `<cite data-ref>` 的角色掌握 |
| Step 1.5 wiki 解析 | **下放给 reader（每个 reader 自解析自己那篇）** | 给 reader 接 `zotero_wiki_lookup`，并行、自包含；abstract-only/无源论文不派 reader |
| Step 2 阅读计划/分桶 | **拆为两半**：派活分桶在 scenario PLAN / reader 降级；§8 决策汇总在 body-writer | reader 三级降级（full / abstract-only / insufficient）回报 bucket，body-writer 汇总成 §8 |
| Step 3 逐篇深读 | **整体移入 reader** | reader 用 `papers_read_outline/section`（+ `Read(mdPath)` 兜底）outline-first 读，产 evidence rows |
| Step 4 合成 + 引用 + 落盘 | **保留在 body-writer（skill）** | 输入从 papers[] 改为 evidence rows；保留 `papers_search_keywords`/`papers_read_context` 做 targeted 引用核查；保留 `Write` |

### 4.2 角色重定义

**reader（新）** — 唯一阅读者
- 工具：`zotero_wiki_lookup` + `papers_read_outline` + `papers_read_article_section` + `papers_search_keywords` + `papers_read_context` + `Read`（仅限 wiki `.md/.article.md/.txt`）。
- **移除 `WebFetch` / `Bash`**（杜绝下载 PDF 与自造 I/O）。
- 输入：单篇论文 identity（`{ N, title, zoteroKey|doi }`）+ 方向 blueprint 片段。
- 行为：自解析路径（`zotero_wiki_lookup`）→ outline-first 读 → 产出该篇的 evidence rows（多条，覆盖 method/result/limitation/key-number）。
- 降级（沿用 reader.md 三级，但源换成 wiki）：full → abstract-only → insufficient；回报 bucket。
- 模型：haiku，并行 fan-out。

**body-writer（= `literature-review-result` skill，吸收 synthesizer 职责）** — 唯一 body 生产者
- 工具：`workspace_papers_list` + `papers_search_keywords` + `papers_read_context` + `Write`。
- **移除 `zotero_wiki_lookup` / `papers_read_outline` / `papers_read_article_section` / `Read(mdPath)` 的"整篇阅读"用途**（阅读归 reader）。保留 `papers_search_keywords` + `papers_read_context` 仅用于「按 reader locator 做 byte 级 quote 精确定位/补齐」。
- 输入：`{ chosenDirection/blueprint, papers[](identity+N), evidenceRows[] }`。
- 行为：Intake 编号 → 消费 evidence rows → 写 §1–§8 HTML（`<cite data-ref="N"><q>…</q></cite>`）→ 一致性校验 → `Write` 落 `reviews/{ts}-{slug}.html`。
- 模型：sonnet。

**fact-checker** — 不变（终审 §1–§6 引用可追溯）。

**synthesizer** — **退役**：从 manifest `subAgents` 移除，prompt 文件删除；其"整合多篇阅读输出"职责被 body-writer 吸收。

### 4.3 新 Turn 2 数据流

```
用户选定方向 (present_directions → choice)
   │
 ① scenario Agent (Turn 2 planning) 产 PLAN：
      steps: [ reader × N  (parallel, 仅对"可深读"论文) ]
      terminal_skill: literature-review-result   ← input 改为 { blueprint, papers[], evidenceRows[] }
      optional_followups: [ fact-checker ]
   │
 ② 主 Agent 并行派 reader（每篇一个）
      reader: zotero_wiki_lookup(自解析) → outline-first 读 wiki 源 → 产 evidence rows[]（含 verbatim quote+locator+bucket）
      └ 无 wiki 源 → 降级 abstract-only / insufficient，回报 bucket（不下载 PDF）
   │
 ③ 主 Agent 收齐所有 reader evidence rows → 调 literature-review-result skill
      skill: 编号 → 按 evidence rows 写 §1–§8 HTML（quote 取自 evidence row，必要时 papers_search_keywords/read_context 补齐）
             → 一致性校验 → Write reviews/{ts}-{slug}.html
   │
 ④ fact-checker 终审引用
   │
 ⑤ 主 Agent 一句话收口 → run 完成 → 持久化 hook（不变）
```

---

## 5. 交接契约：evidence row → `<cite data-ref="N"><q>`

这是拆解后最关键的契约。reader 产 evidence rows，body-writer 据此填 `<cite><q>`。

### 5.1 source_id → N 映射

- reader 被派活时，dispatch prompt 必须携带该论文的 **1-based N** 与 identity；reader 的 evidence row `source_id` 回填为该论文的 `zoteroKey`（或 `doi`）。
- body-writer 持有 papers[]（含 N 与 identity），用 `source_id == zoteroKey/doi` 反查 N，写 `<cite data-ref="N">`。
- **N 永不重排**（沿用 skill 既有铁律）。

### 5.2 quote 长度/语言/连续性契约对齐（关键缺口）

现状两套规则冲突，必须统一：

| 维度 | evidence row `QUOTE_RULE`（现状） | skill `<q>`（现状） | **统一后（本 spec）** |
|------|----------------------------------|--------------------|----------------------|
| 长度 | ≤25 词 / ≤80 CJK | ≤240 CJK | reader quote 放宽到 **≤240 CJK / ≤120 词**，与 `<q>` 对齐 |
| 连续性 | 未约束 | **单连续 span，禁 `…` 桥接** | reader quote 也必须是**单连续 span**，禁 `…`/尾省略 |
| 语言 | 未约束 | **保留源语言，禁翻译** | reader quote **保留源语言**（英文文献→英文 quote） |
| locator | 必填（page/section/figure/line） | — | 保留必填；body-writer 用它驱动 `papers_search_keywords` 精确定位 |

> **改造点（已决议）**：`agent-prompt-builder.ts` 新增一个 **lit-review 专用 quote 规则**（如 `{{evidenceSchema:read,litreview}}` 占位符 / 参数），只对综述链路生效，规则为 **≤240 CJK、单连续 span、保留源语言**，与 skill 的 `<q>` 完全对齐。**不放宽全局 `QUOTE_RULE`**（隔离 blast radius，避免影响 searcher/fact-checker 等其他 evidence 消费者）。reader 产出的 evidence row `quote` 即可直接填入 body-writer 的 `<q>`，无需二次裁剪。

### 5.3 bucket / §8 决策字段

reader 每篇回报 bucket ∈ `{ deep-read | abstract-only | insufficient }` + 简短 reason（如 `outline-first via article` / `wiki parse not finished` / `not in wiki index`）。body-writer 汇总为 §8 Per-Paper Decisions（沿用现有三桶措辞）。

### 5.4 多候选 quote 缓解 quote-claim 对齐

reader 不知道最终叙事，故**每篇产多条 evidence rows**（覆盖 method/result/limitation/key-number），给 body-writer 一个 quote 池择用。若 body-writer 需要池外 quote，用 `papers_search_keywords` + `papers_read_context` 按 reader 的 locator 做 byte 级补齐（不重读整篇）。

---

## 6. 改造点清单（按文件）

| 文件 | 改动 |
|------|------|
| `default-capability-packs/lit-review/sub-agents/reader.md` | 重写阅读源：wiki 工具 outline-first；三级降级源从 PDF 换 wiki；quote 规则对齐 §5.2；新增 bucket 回报字段 |
| `default-capability-packs/lit-review/manifest.json` | reader `tools` 改为 `[zotero_wiki_lookup, papers_read_outline, papers_read_article_section, papers_search_keywords, papers_read_context, Read]`（去 WebFetch/Bash/Glob/Grep 视需要）；**移除 synthesizer 条目**；version bump |
| `default-capability-packs/lit-review/sub-agents/synthesizer.md` | **删除** |
| `default-capability-packs/lit-review/scenario/system-prompt.md` | Turn 2 PLAN：reader 改为「仅对可深读论文 fan-out + 必须携带 N」；terminal_skill `input` 改为携带 `evidenceRows[]`；删除「synthesizer fallback」表述（R4/fallback 文案同步） |
| `default-skills/literature-review-result/SKILL.md` | 输入契约改为「evidence rows + papers identity」；Step1.5/Step2/Step3「整篇阅读」段落删除或改为「消费 evidence rows」；工具集去掉整篇阅读工具，保留 search_keywords/read_context/Write；`<q>` 取值来源改为 evidence row；version bump |
| `apps/electron/src/main/lib/agent-prompt-builder.ts` | `QUOTE_RULE` 按 §5.2 提供综述档规则（推荐方案 b：lit-review 专用）；同步 `agent-prompt-builder.test.ts` |

> ⚠ 内置 prompt 全英文（CLAUDE.md §2）；本次改动均为内置 Agent/Skill prompt，**不涉及面向用户 UI 文案**，无 i18n key 改动。改 `agent-prompt-builder.ts` 注释用中文。

---

## 7. 兼容性与回退

| 场景 | 行为 |
|------|------|
| 论文 wiki 未解析完 | reader 降级 abstract-only（用 dispatch 携带的 abstract）；不下载 PDF；body-writer 走 abstract-only 路径并在 §1 标注「证据深度受限」 |
| 论文不在 wiki index | reader 回 insufficient；body-writer 列 §7/§8 metadata-only，不在 §1–§6 引用 |
| skill 不可用（terminal_skill 缺失） | synthesizer 已退役、**不保留 fallback**：主 Agent **明确报错 + 提示用户重试**，不静默降级（决议 #2） |
| 用户 @ 本地 PDF | 同现状：仅进 §7，不解析 |
| ad-hoc 链路（用户 @ 几篇 Zotero 直接综述） | 仍走「先 reader fan-out 读 → skill 合成」；不再让 skill 自己读 |

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| **quote-claim 对齐变松**（reader 先读、不知叙事） | §5.4 多候选 evidence rows + body-writer byte 级补齐；fact-checker 终审兜底 |
| **quote 长度契约不一致**导致 `<q>` 截断或定位失败 | §5.2 统一为 ≤240 CJK + 单连续 span + 源语言；推荐 lit-review 专用 quote 规则隔离影响 |
| **N 映射错位**（source_id↔N） | dispatch 强制携带 N；body-writer 以 papers[] 为 N 事实源、不依赖 reader 编号 |
| **reader 并发**击穿 MCP/wiki | 复用既有 fan-out 并发上限；reader 内 `zotero_wiki_lookup` 一篇一调 |
| **synthesizer 退役**失去 fallback | §7 明确回退；保留「报错重试」而非静默劣化 |
| 行为回归（引用/§结构/落盘） | 用同一 EvidenceSet 跑改造前后对照；fact-checker verified/flagged 计数对比 |

---

## 9. 实施步骤（建议分 PR）

1. **PR-1 契约层** ✅：`agent-prompt-builder.ts` 加 lit-review 专用 quote 规则（`{{evidenceSchema:read,litreview}}`，≤240 CJK + 单连续 span + 源语言 + bucket 字段）；补 test。electron `0.1.382→0.1.383-rc.1`。
2. **PR-2 reader 改造** ✅：`reader.md` 改 wiki 源 + 引用 litreview quote 档 + 产 bucket；`manifest.json` reader tools 去 WebFetch、换 `zotero_wiki_lookup`+`papers-rg` wiki 工具。pack `0.2.2→0.2.3`，electron `→0.1.384-rc.1`。⚠ 需 `bun run dev` 实跑确认不再出 `webfetch-*.pdf`。
3. **PR-3 body-writer 收敛** ✅：`SKILL.md` 输入改 `papers[]+evidenceRows[]`、Workflow 由 4 步收为 3 步（删 Step1.5/2/3 阅读）、工具瘦身（去 outline/section 读 + Read + zotero_wiki_lookup，留 search_keywords/read_context/workspace_papers_list/Write）、skill `0.20.2→0.21.0`；`scenario/system-prompt.md` Turn 2 PLAN 带 `evidenceRows[]` + reader 携带 N + 删 synthesizer fallback（改报错重试）；移除 `synthesizer`（manifest + 删 `synthesizer.md`），pack `0.2.3→0.2.4`。
   - **连带改动（§6 原清单外，但必要）**：`synthesizer` 仅存在于 lit-review pack（`buildBuiltinAgents` 返回 `{}`，无独立内置），退役后 master prompt 的「My Team」仍宣告它会导致主 Agent 派一个不存在的 SubAgent → 同步更新 `agent-prompt-builder.ts` Section 5（4 人小队→3 人 + body-writer 归 skill）、`STATUS_FLOW`（回流边指向 body-writer skill），及 `agent-prompt-builder.test.ts` / `default-capability-packs-load.test.ts`（4 worker→3 worker）。electron `→0.1.385-rc.1`。
   - **未动**：`REVIEW_SOURCE_CAPABILITY='asci-core-synthesizer'`（持久化稳定标识，改它破坏历史 review 数据）；`paper-meta-cap-hook.ts`（get_paper_meta 护栏，退役后惰性但无害，lit-search 仍可能用）；若干历史注释（review-artifact-parser / persistence / litreview-ipc）。
4. **PR-3.5 综述阶段禁补充检索** ✅（trace 暴露的越权行为）：触发综述后主 Agent 在 Turn 2 擅自派 `lit-search`（searcher + relevance-scorer）补检索，违反 R2。根因——R2 只约束 lit-review 场景 Agent，管不住主 Agent 的跨包路由裁量。修复双管齐下：
   - `agent-prompt-builder.ts` review-writing intent 段新增 **「No retrieval during a review (hard rule)」**：综述流程内禁止 reroute lit-search/searcher/retrieve/search_*，集合不够就按现有论文写并标注 limited scope，或问用户——绝不静默把检索折进综述 turn。
   - `scenario/system-prompt.md` Turn 2 PLAN 新增 `do_not` 字段 + 「Hard rule for the executing (main) Agent」直接指令（PLAN 由主 Agent 读，约束力强于场景内 R2）。
   - 补回归测试（断言硬规则 token 存在）。pack `0.2.4→0.2.5`，electron `→0.1.386-rc.1`。
5. **PR-4 回归验证**：对照综述质量 + 延迟（目标：消除双读，Turn 2 wall-clock 显著下降，且 Turn 2 不再出现 lit-search/searcher）。

每个 PR 递增对应包 patch（manifest pack version、skill version、electron 包 version）。

---

## 10. 验收（Done When）

- [ ] Turn 2 trace 中**不再出现** `Read webfetch-*.pdf`（reader 只走 wiki 源）。
- [ ] 同一篇论文**只被读一次**（reader 读，skill 不读）。
- [ ] body-writer 工具集不含整篇阅读工具；reader 工具集不含 WebFetch。
- [ ] `synthesizer` 已从 manifest + 文件系统移除，链路无引用残留。
- [ ] `<cite data-ref="N"><q>…</q></cite>` 引用、§1–§8 结构、§7/§8、一致性校验全部保持；fact-checker 仍终审。
- [ ] `bun run typecheck` + `bun test`（含 `agent-prompt-builder.test.ts`）通过。
- [ ] 同一 EvidenceSet 改造前后对照：引用可追溯不退化、Turn 2 延迟下降。
- [ ] 受影响包 version 已递增；`simplify` 复盘已跑。

---

## 11. 领域语言（拟落 `CONTEXT.md`）

| 术语 | 定义 |
|------|------|
| **body-writer** | 综述链路中唯一的正文（§1–§8 HTML fragment）生产者，由 `literature-review-result` skill 担当；吸收原 synthesizer 职责；只合成不阅读 |
| **evidence row（read 态）** | reader 产出的单条结构化证据：`{ claim, source_id, locator, quote, confidence, status:read, bucket }`；是 reader→body-writer 的交接单元 |
| **deep-read / abstract-only / insufficient** | reader 对单篇论文的三级阅读 bucket，决定该篇在 §1–§6 是否可引用及 §8 决策措辞 |
| **wiki 结构化源** | wiki 异步队列产出的 `.article.md`（LLM 增强）/ `.txt`（结构化解析），含 `# OUTLINE` + `<p id="pS_P">` 锚点；综述阅读的唯一合法源 |

---

## 12. 决议记录（已与 owner 确认）

| # | 决议 | 落点 |
|---|------|------|
| 1 | **quote 规则**：reader evidence row `quote` 按 skill `<q>` 规则处理 —— **≤240 CJK + 单连续 span + 保留源语言**；实现为 **lit-review 专用占位符**，不放宽全局 `QUOTE_RULE` | §5.2 |
| 2 | **synthesizer 退役后**：不保留 fallback，采用 **「报错重试」**（不静默劣化） | §7 |
| 3 | **reader 工具**：**保留 `Read`** 仅作无锚点 raw `mdPath` 兜底，主路径走 `papers_read_*` | §4.2 / §6 |
| 4 | **可深读论文分桶**：**PLAN 粗筛（review-proposer blueprint 已知）+ reader 降级兜底** | §4.3 / §5.3 |
