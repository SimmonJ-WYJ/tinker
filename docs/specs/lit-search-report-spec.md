> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 检索报告（lit-search report）

| 项 | 值 |
|---|---|
| 状态 | 草稿 · 待 review（2026-06-04 v2：分级报告，见 §4bis） |
| 关联 issue | 决策父 issue #454；实现子 issue #496（按需生成最小集 · 端到端骨架）、#497（大检索自动触发，blocked by #496） |
| 关联 PR | 待开（feat/capability-pack-v3） |
| 衔接 | #437 / `lit-search-failure-source-expansion-spec`（覆盖与局限的数据源）；范式照搬 `lit-review-pipeline-decomposition-spec`（terminal_skill → HTML 产物） |
| 领域语言事实源 | `CONTEXT.md`；本 spec 术语：检索报告 search report、报告 skill `lit-search-report`、检索面板 search panel、收尾摘要 closing summary、入口 report entry |

---

## 1. 背景与动机

lit-search 检索结束后，主 Agent 仅写一段 **≤60 词的收尾摘要**（closing summary，见 lit-search `scenario/system-prompt.md` §Closing turn）。该摘要刻意求快（默认无 closing turn，省 3–5s），信息量不足以充当「检索报告」。

旭武反馈（#454 序号 9）：希望产出**完整检索报告**，并为报告编排单独做 skill、固定结构，避免每次 Agent 自由发挥深浅不一。

#454 已 triage 拍板四项决策（见该 issue 决策记录评论）：

1. **建专门 terminal skill** `lit-search-report`（照搬 `literature-review-result` 范式），**不**增强 ≤60 词 closing summary。
2. **呈现**：右侧产物区独立 HTML 文档 + 对话流保留收尾摘要 + 入口。
3. **触发**：默认按需（对话流给入口）；大型主题检索（general-query 且结果 ≥N）自动；标识符查找 / 引用追踪不产报告。
4. **内容（最小集）**：① 检索策略 ② 关键发现 + 高分论文概览 ③ 覆盖与局限。

---

## 2. 范围与非目标

**范围**：lit-search 检索结束后产出结构化检索报告的 skill 编排 + 呈现 + 触发。

**非目标（明确排除）**：

- ❌ **全文深读**：报告 skill 只消费检索元数据 + 候选论文的标题/摘要/分数，**不读全文**（深读是 lit-review `reader` 的职责）。
- ❌ ~~研究空白 / 后续建议、主题聚类/研究脉络：列为后续可选增强，不进最小集~~ —— **2026-06-04 决策推翻**：进完整版报告（FULL 档），见 §4bis；精简版（MINIMAL 档）维持最小集。
- ❌ **作者机构信息**：候选数据无机构字段，靠模型知识填属于捏造——「关键研究团队」节只列高频作者 + 命中数 + 代表作，**不设机构列**（2026-06-04 拍板）。
- ❌ 导出 / 分享报告：另议。

---

## 3. 数据来源（报告能放什么，由可得数据决定）

lit-search 闭幕时可得、且**无需深读**的数据：

| 数据 | 来源 |
|------|------|
| 检索策略（keywords / 检索词改写 / sources / method_terms / object_terms / time range） | scenario PLAN |
| 各源命中量、去重量、面板展示量 | `mcp__paper-search__process_search_results` 返回（`source_counts` / `source_new_counts` / `total_from_sources` / `new_records` / `display_count`） |
| top-N 论文（title / authors / year / finalRelevance / abstract） | 候选 JSONL（searcher 写入 session cwd，relevance-scorer 回写分数；report skill 按 cwd 约定读取） |
| 哪些源失败 / 返 0 / 限速 | `source_counts`（=0 或缺失即失败），衔接 #437 |

**相关理由**由 report skill 据论文 abstract 现场生成（不深读）。

---

## 4. 报告内容 — MINIMAL 档（最小集 §1–§3）

报告输出为右侧产物区可渲染的 **HTML 片段**，顶层单一 `<article class="asci-search-report" data-version="1">`（对齐 review 的 sanitizer 友好约定）。

- **§1 检索策略 Search strategy** — 研究问题 / 关键词与改写 / 检索源 / 方法-对象词 / 时间范围 / 各源命中量。
- **§2 关键发现 + 高分论文概览 Key findings & top papers** — top-N（建议 ≤10）逐条：题录（title/authors/year）+ finalRelevance + 一句相关理由（据 abstract 生成）。引用走 `<cite data-ref="N">` 以复用注引装饰。
- **§3 覆盖与局限 Coverage & limitations** — 命中分布、哪些源失败/返 0/被低产早停丢弃、可见盲区；与 #437 的失败扩源机制衔接。

数字一律取自 `process_search_results` 返回（与收尾摘要同源，避免口径不一）；缺失则如实声明，不臆造。

---

## 4bis. 报告分级（2026-06-04 决策，v2）

旭武对照外部检索报告样例（6 节式：概况表 / 主题分布 / 按主题推荐 / 研究团队 / 趋势与空白 / 管理建议）拍板：报告按**候选量分级**，覆盖范围从「当前轮」扩为「**本次会话全部检索轮**」（skill Step 1 跨 `turn_id` 全局去重统计）。

| 档位 | 条件（去重后全程候选量） | 结构 |
|------|------|------|
| 不触发 | < 20 | 面板按钮隐藏（`REPORT_BUTTON_MIN_RESULTS = 20`，与 `AUTO_REPORT_MIN_RESULTS` 对齐）；用户对话直接要求时仍优雅产出 MINIMAL |
| **MINIMAL** | 20 – 49 | §1 检索概况 · §2 关键发现与高分论文（≤10）· §3 覆盖与局限 · References（即 §4 最小集） |
| **FULL** | ≥ 50（`FULL_REPORT_MIN_RESULTS = 50`，写死在 SKILL.md） | §1 检索概况（概况表 + 各轮统计）· §2 核心主题分布（3–6 主题）· §3 论文推荐按主题分表（≤40 篇）· §4 关键研究团队（高频作者，**无机构列**）· §5 研究趋势与空白（趋势须引候选论文佐证；空白限定「本次候选集未见」措辞）· §6 下一步建议 · References |

防幻觉边界（FULL 档新增）：

- **各轮关键词**：JSONL 不存 query 文本，仅当主 Agent 经 `input.rounds` 传入才展示；缺失如实声明。
- **机构**：不进报告（见 §2 非目标）。
- **趋势**：每条须 `<cite data-ref>` 至少 1 篇候选论文，给不出佐证就砍。
- **空白**：定性为「基于本次候选集的推断」，报告内显式声明该框定语句。

分级判定在 skill Step 1 脚本内完成（打印 `tier=`），不依赖入口传参。

新建 `apps/electron/default-skills/lit-search-report/SKILL.md`，结构照搬 `literature-review-result`，但定位为**检索元数据消费者**而非综述正文生成器。

### 5.1 输入契约（`Skill` 的 `input`，由主 Agent 携 PLAN 的 `terminal_skill.input` 传入）

```jsonc
{
  "plan_summary": {
    "research_question": "...",
    "keywords": [...], "rewrites": [...],
    "sources": [...], "method_terms": [...], "object_terms": [...],
    "time_range": { "from": 2020, "to": 2024 }   // 可选
  },
  "rounds": [                                      // 可选（v2）：各轮检索策略，按时间正序；
    { "round": 1, "kind": "keyword", "keywords": [] } // JSONL 不存 query 文本，仅主 Agent 上下文可得时传
  ],
  "panel": {                                       // 取自 process_search_results 返回
    "display_count": 0, "new_records": 0, "total_from_sources": 0,
    "source_counts": {}, "source_new_counts": {}
  },
  "candidates_path": "<session cwd 下候选 JSONL 路径>"  // skill 读取 top-N 题录+摘要+分数
}
```

### 5.2 输出契约

- 路径：`searches/{YYYY-MM-DD_HH-mm}-{slug}.html`（session cwd 下，**相对路径**，含时间戳前缀）。
- 内容：单一 `<article class="asci-search-report" data-version="1">` 片段，无 `<html>/<body>` 包裹、无 markdown 语法。

### 5.3 allowed-tools 与硬约束

- `allowed-tools`: `Write`、`Read`/`Glob`/`Bash`（仅用于定位与读取候选 JSONL）。
- **禁止** `papers_read_outline` / `papers_read_article_section` / 对 mdPath 的全文 `Read`——不做 full-text 深读。
- 不重复检索、不重排、不改写面板。

---

## 6. 触发与入口

### 6.1 按需（#496，默认）

主 Agent 在收尾摘要后给出「生成完整检索报告」**入口**；用户触发后，主 Agent 用 `Skill(lit-search-report)` 携 §5.1 input 生成报告。lit-search manifest 声明 `skillRefs: ["lit-search-report"]`，使主 Agent 的 `<available_skills>` 含该 skill。

**入口形态 —— 已拍板：面板按钮（A）。** 检索面板 `SessionPapersToolbar` 加「生成检索报告」按钮 → 触发主 Agent 用 §5.1 input 调 `Skill(lit-search-report)`。理由：与 present_search_plan 的 Banner/Card 交互范式一致，入口最明确、就在结果旁，最贴合 #454「对话流给摘要 + 入口」。

落库实现（#496 已落地）：

- 按钮挂 `SessionPapersToolbar`（结果旁，~~`totalCount > 0`~~ **v2：`totalCount >= REPORT_BUTTON_MIN_RESULTS (= 20)` 才显示**，见 §4bis 分级表），点击 → `setPendingPrompt({ sessionId, message })`（复用 `agentPendingPromptAtom`，与 `SendToAgentButton` 同款，会自动把该消息发给当前会话）。
- 消息是一条 i18n 的**自然语言 canned 提示**（`sessionPapers.report.prompt`，如「请根据当前检索结果生成一份完整的检索报告」）；主 Agent 据 Skills-First Protocol（manifest 已注册 `lit-search-report` skillRef）路由到该 skill。
- **已知取舍（tracer-bullet）**：自然语言 + LLM 路由比 lit-review 的 PLAN `terminal_skill` 结构化路由更脆弱（UI 文案/模型变化可能误路由）。当前可接受——skillRef 已注册、Skills-First 明确、文案走 i18n、路由失败用户即时可见。**深层做法**：后续转为显式结构化路由（按钮 → lit-search 场景 Agent PLAN 直接挂 `terminal_skill: { name: 'lit-search-report', input }`），与 lit-review 范式一致。**dev 验证项**：实跑确认按钮消息稳定路由到 skill 而非裸工具。
- 渲染路由共用：仅 `registrations.ts` 的富渲染器 matcher 扩到 `searches/`（经 `isAsciRichHtmlPath`）。综述专属的「解析引用」按钮（`InlinePreview` `isReviewHtml`）与服务端「带入被引论文」富集（`SDKMessageRenderer` `isReviewOutput`）**故意保持 `reviews/` 限定**——检索报告不需要这两项。

> 备选（未采纳）：B prompt_suggestion（renderer 存而未渲成可点击按钮，需补通用 UI）；C 纯散文入口（最薄但入口最弱）。

### 6.2 自动（#497，已落地）

**难点**：规划轮在检索**之前**，此刻还不知道结果数，无法用「结果 ≥N」在 plan 时决定是否挂。

**机制：条件化 terminal_skill。** 给 PLAN 的 `terminal_skill` 增加可选 `condition` 字段——一个对累计 tool_results 的简短谓词，由主 Agent 在所有 `steps` 完成后（此时 `process_search_results` 计数已知）评估，**成立才调 skill**。这是对编排协议的**通用扩展**（`condition` 缺省 = 无条件，lit-review 等不受影响），而非 lit-search 特例。

- `intent = general-query`：scenario PLAN 挂
  `terminal_skill: { name: "lit-search-report", input: {...}, condition: "process_search_results.display_count >= 20" }`。
  阈值 **20** 作为可读常量写在 scenario prompt（`AUTO_REPORT_MIN_RESULTS`）。
- `exact-lookup` / `citation-tracing`：**不挂** `terminal_skill`（永不自动）。
- 仍保留 §6.1 面板按钮：sub-threshold 的 general-query、或任意 intent 下用户主动点，都走按需。
- 自动触发不改变默认 ≤60 词收尾摘要（step 5 仍写摘要；报告作为右侧产物叠加）。

主 Agent 侧实现见 `agent-prompt-builder.ts` 的 PLAN dispatch protocol step 4（条件评估）。

---

## 7. 前端呈现

右侧产物区按文件扩展名 + 路径分发渲染器（`renderer/components/preview/registrations.ts`）。当前 `reviews/*.html` 命中 `ReviewHtmlPreviewRenderer`（DOMPurify + KaTeX + 注引装饰），其余 `.html` fall-through 到通用 `HtmlRenderer`。

**最小改动**：把 `ReviewHtmlPreviewRenderer` 的 `matches` 正则从 `/(?:^|\/)reviews\//` 扩为同时匹配 `searches/`，使检索报告复用同一富渲染（注引装饰对 §2 的 `<cite>` 有用）。`preview-registry.test.ts` 同步加用例。

---

## 8. 实现计划（映射子 issue）

### #496 — 按需生成最小集（端到端骨架）

1. 新建 `default-skills/lit-search-report/SKILL.md`（§4 内容、§5 契约、硬约束）。
2. lit-search manifest：`skillRefs: ["lit-search-report"]`；版本 0.2.15 → 0.2.16。
3. scenario `system-prompt.md`：收尾段说明按需挂 `terminal_skill` 与入口文案。
4. 前端：§7 matcher 扩展；入口形态按 §6.1 review 结论落地（A/C）。
5. i18n：入口文案走 `useT`/`t`，en + zh 同步，key-parity 通过。
6. 测试：`default-capability-packs-load.test.ts`（skillRef 注册）、`preview-registry.test.ts`、key-parity。

### #497 — 大检索自动触发

1. scenario PLAN：general-query 且结果 ≥阈值自动挂 terminal_skill（§6.2）；阈值常量化。
2. 标识符查找 / 引用追踪不自动触发。
3. 不破坏默认收尾摘要行为。

---

## 9. 风险与开放问题

1. ~~入口形态~~ —— 已拍板「面板按钮」（§6.1）；剩余实现期细节为按钮→skill 的触发链路选型（canned 消息 vs 复用 `respondSearchPlan` 范式）。
2. **候选 JSONL 路径约定**：report skill 读 cwd 候选集，须复用 relevance-scorer 既有的 cwd 路径推导，避免与编排约定漂移。实现时核对该约定的事实源。
3. **自动触发阈值**：默认 ~20，需小流量观察后调参。
4. **延迟**：报告 skill 为额外 Skill 调用；按需触发已规避高频 identifier 查找的开销，自动触发仅限大主题检索。
