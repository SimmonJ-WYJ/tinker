# 综述大纲质量提升 + 独立「研究空白」识别 设计规格

- 状态：草案（待评审）
- 关联 issue：[#441](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/441)
- 关联 PR：（待建）
- 领域语言事实源：`CONTEXT.md`（EvidenceSet / 综述方向 / 证据行 evidence row / 阅读 bucket）
- 锁定决策（已与用户确认）：①「研究空白」走**最小改动**（不加新子智能体，强化现有三处）；②大纲层次化走**纯 prompt 改造**（不动 `LitReviewDirection` 类型 / `present_directions` IPC / 渲染层）

---

## Context（为什么做）

来自「0601 测试反馈汇总」序号 19（旭武 · OPTIMIZATION）：

> 自动生成的大纲质量不佳，而且文献综述产出缺乏独立的研究空白，文献综述认可度不佳。

两个独立的质量短板：

1. **大纲质量**：自动生成的综述大纲**平铺罗列**、结构松散、层次不清——没有主题分组、没有逻辑递进。
2. **研究空白**：综述缺少**独立、有据可依**的「研究空白 / 未解问题」部分；现状要么被折叠进结论、要么泛泛而谈，学术认可度不足。

### 现状管线（改前）

综述写作是 `lit-review` 能力包的两阶段流程：

```
Turn 1  review-proposer ──► 3 个候选方向（title / thesis / outlinePreview=6 章扁平标题 / papersInScope）
            │                    └─► present_directions ChoiceCard（用户选方向）
Turn 2  reader 扇出（单篇精读，逐字提取证据行 evidence row，含 gap 信号）
            └─► literature-review-result skill（写 §1–§8 HTML 综述正文，body-writer，不读论文）
                    └─► fact-checker 审计
```

### 两个短板的根因

**大纲（review-proposer.md）**：现有 prompt 强制一个**通用固定骨架**——

```
1. Background / context   2. Key studies / evidence   3. Methods / approaches
4. Results / outcomes     5. Limitations / open questions   6. Conclusions / future directions
```

这是一套「**按章节类型**」的模板（背景/方法/结果），与具体论文的**主题聚类无关**，天然导致平铺：每章塞一堆论文、一篇接一篇罗列，缺乏「主题分组 + 递进论证」。`outlinePreview` 只是 6 个扁平标题字符串，本身不承载层次。

**研究空白（literature-review-result/SKILL.md §5）**：§5 Gaps 当前是**有条件**的（"Only omit §5 entirely when the evidence genuinely contains no gap signal" / "do not fold it away"），实践中经常被并进 §6 结论或写成空泛断言。根因：

- **上游未规划**：review-proposer 的方向里没有把「研究空白」作为一等公民维度，§5 全靠 skill 临场发挥，与 §1–§4 抢同一次生成的注意力，被压缩。
- **证据未结构化**：reader 虽被要求 "Always capture gap signals"，但 gap 行没有被显式标记/强制，skill 临场 mine，召回不稳。
- **§5 缺约束**：没有要求分类、跨论文综合、逐条 `<cite>` 溯源。

---

## 目标 / 非目标

**目标**

- G1 自动生成的大纲有**清晰逻辑结构与层次**：主题分组 + 递进，而非按「背景/方法/结果」平铺。
- G2 综述产出**独立**的「研究空白 / 未解问题」部分，且每条结论**可回溯到已读证据行**（非空泛断言）。
- G3 改动局限在内置 prompt（英文）+ 版本号，零数据模型/IPC/渲染改动。

**非目标**

- 不动 `LitReviewDirection` 类型、`present_directions` IPC 四联、`LitReviewDirectionsCard` 渲染（决策②）。
- 不新增子智能体（决策①）；不改 evidence row schema（`{{evidenceSchema:read,litreview}}` 字段不变）。
- 不改 Turn 2「不检索」铁律、不改 reader「单篇不做跨篇综合」边界。
- 不做综述模板可配置化 / 多模板（超出本 issue）。

---

## 设计方案（纯 prompt，三处改 + 版本号）

层次与递进**在两个层面**落地，互相对齐：

- **大纲层（review-proposer）**：方向的 `outlinePreview` 从「按类型」改为「**按主题 + 递进 + 一章专门留给研究空白**」，并在 `thesis` 之外用一段**结构化 blueprint 文字**（非新字段，写进 review-proposer 的 dispatch 回包 / scenario Turn-2 透传文本）描述每章的意图 + 关联论文 + gap 维度。
- **正文层（literature-review-result skill）**：§2–§4 主题章用 `<h2>` 主题 + `<h3>` 子主题表达层次、跨论文综合而非逐篇罗列；§5 升级为**强制、结构化、逐条溯源**的独立研究空白章。

### 改动点 1 — `review-proposer.md`（大纲：主题分组 + 递进 + 规划 gap）

> 文件：`apps/electron/default-capability-packs/lit-review/sub-agents/review-proposer.md`

1. **替换「Outline quality requirement」整段的通用骨架**。新约束（英文）要求 `outlinePreview` 6 章遵循「**漏斗式主题递进**」而非章节类型模板：
   - 第 1 章：领域/问题**框定**（landscape / 核心问题），不是泛泛 "Background"。
   - 中间 3 章：**从已读论文实际聚类出来的主题章**（按机制 / 方法族 / 应用场景 / 争议轴分组），标题须体现「该主题在论证中的角色」，并按逻辑递进排列（由表及里 / 由共识到分歧 / 由方法到效果），**禁止**沿用 "Methods / Results" 这类纯类型标题。
   - 第 5 章：**专门的「研究空白 / 未解问题」章**（dedicated gaps chapter）——把 gap 提升为 Turn 1 就规划的一等维度，而非事后补。标题须明确信号 gaps / open problems。
   - 第 6 章：**展望 / 结论**。
2. **新增「Blueprint requirement」段**：要求 review-proposer 在每个 direction 的 JSON 里，除现有字段外，输出一段**结构化大纲意图**——复用现有 `outlinePreview` 字段无法承载层次（决策②不扩类型），故约定 review-proposer 在 JSON **之外**额外输出一个 fenced `text` 的 `## OUTLINE BLUEPRINT (dir <key>)` 块（仅供 scenario agent 在 Turn 2 透传给 skill，不进 ChoiceCard、不进类型）：每章一行 `章号. 标题 — intent: <一句话本章论证意图>; papers: <N,N,N>; subthemes: <子主题A / 子主题B>`，并对 gaps 章额外标 `gap-dimensions: <方法/实证/理论/矛盾/未来工作 中适用的几项>`。
   - **取舍说明**：决策②要求不动数据模型，所以 blueprint 走「prompt 文字契约」而非 IPC 字段。scenario Turn-2 PLAN 的 `terminal_skill.input` 已经写了「chosen direction (title + thesis + 6-chapter outline / **blueprint**)」——本来就预留了 blueprint 透传位，这里把它实体化为上面的 text 块即可，无需改 system-prompt 的 PLAN 形状。
3. **更新 Prohibited behaviors**：把「Mixing the 6-chapter skeleton verbatim into all 3 directions」升级为「沿用按类型骨架（Background/Methods/Results 式）即失败」；新增「缺少专门的 gaps 章即失败」。
4. 保留：恰好 3 方向、恰好 6 章、diversity requirement、papersInScope 选择规则、无检索/无捏造。

### 改动点 2 — `reader.md`（证据：gap 信号强制 + 可识别）

> 文件：`apps/electron/default-capability-packs/lit-review/sub-agents/reader.md`

现有第 122 行已要求 "Always capture gap signals when present"。强化为**强制可识别**（不改 schema，靠 `claim` 文字约定）：

1. 把 gap 信号从「when present」升级为：**只要源文本含 limitation / future work / open problem / untested assumption / 与他文的矛盾，就必须各自单独成行**（每行一个 verbatim `quote` + locator），不得并进「方法有效」类正向行。
2. **可识别约定**：gap 行的 `claim` 字段以固定英文前缀开头 `[gap:<kind>] …`，`<kind>` ∈ `limitation | future-work | open-problem | assumption | contradiction`。这样 body-writer 用纯文本匹配即可稳定召回 gap 行做 §5，无需新字段。
3. `readMode: light`（escalation）已要求「a Discussion/Limitations/Conclusion section when the unmet need is a §5 gap signal」——保留，并补一句：light 模式下若该论文是被 skimmer 标 gap 用途升级的，至少产出 1 条 `[gap:*]` 行。

> 注：`evidence-skimmer.md` 的 tail 读取同样会经手 gap，但本次最小改动**只动 reader 的强约定**；skimmer 的 gap 行靠 reader 同款 `[gap:*]` 约定自然兼容（skimmer 复用 reader 的 evidence 规则），无需单独改 skimmer prompt。若评审认为 tail 论文的 gap 召回也要硬保证，再追加 skimmer 一句（列为可选）。

### 改动点 3 — `literature-review-result/SKILL.md`（正文：层次化 §2–§4 + 强制结构化 §5）

> 文件：`apps/electron/default-skills/literature-review-result/SKILL.md`

**(a) 大纲层次化（§2–§4）** — 在「Section content」里强化 §2–§4 的写法约束：

- §2–§4 主题章必须**按 blueprint 的 subthemes 用 `<h3>` 分子主题**，每个子主题下做**跨论文综合**（对比/呼应/分歧），**禁止**「一段一篇论文」的流水账（呼应现有 Tone & Quality 的 "do not summarize one paper at a time"，但提升为 §2–§4 的硬检查项）。
- 章与章之间须有**递进衔接句**（上承下启），体现 blueprint 给出的论证弧线；若收到 blueprint 文字块，§2–§4 的 `<h2>` 标题与顺序**以 blueprint 为准**，不得擅自改回类型骨架。

**(b) 独立研究空白（§5）** — 把 §5 从「有条件」改为「**默认强制 + 结构化 + 逐条溯源**」：

1. **强制**：§5 默认必出，且是**独立** `<section id="s5">`，`<h2>` 明确信号研究空白（如「§5 研究空白与未解问题」/「§5 Gaps & Open Problems」），**禁止**并入 §6、**禁止**重命名为普通主题。仅当证据行里**确实零** `[gap:*]` 信号且无任何 limitation/分歧/future-work 时方可省略，并在 §6 显式声明「未发现显著未解问题」。
2. **结构化**：§5 内部按 blueprint 的 `gap-dimensions` 用 `<h3>` 分类组织，覆盖适用的：**方法学空白 / 实证空白（缺数据·基线·数据集）/ 理论-概念空白 / 跨论文矛盾 / 作者自陈的未来工作**。同一维度跨多篇时做**综合**（"多篇均指出…而 X 反例" 式），而非逐篇。
3. **逐条溯源**：§5 每一条空白都必须挂至少一个 `<cite data-ref="N"><q>…</q></cite>`，`<q>` 取自 reader 的 `[gap:*]` 证据行的 verbatim 引文（作者自陈的局限/未来工作原句），杜绝「泛泛而谈、无出处」的断言。
4. **证据通道**：在「Evidence rows live in `.context/`」步骤补一句——读 `.context/*.evidence.json` 后，**优先把 `claim` 以 `[gap:*]` 开头的行归集为 §5 的素材池**；§5 的 `<q>` 必须来自这些行（或对其 locator 的 `papers_read_context` 收紧），不得另造。

**(c) 一致性检查（Consistency Check）** — 把现有第 11 项「§5 Gaps present」升级为更硬的检查：

- §5 是独立 `<section id="s5">`、`<h2>` 信号 gaps、**未并入 §6**；
- §5 内每条空白都有 `<cite><q>` 且 `<q>` 来自 `[gap:*]` 证据行；
- §2–§4 无「一段一篇」流水账（抽查：每个 `<h3>` 子主题下至少综合 ≥2 篇或显式说明单篇独有）。
- 任一不过 → 原地修 → 重查。

**(d) Positioning / Workflow Step 3** — 同步把「§5 Gaps」「§2–§4 主题层次」的新约束在 Step 3 摘要里点一句，保证模型在写之前就读到。

### 改动点 4 — `scenario/system-prompt.md`（透传 blueprint，最小改）

> 文件：`apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`

`terminal_skill.input` 描述里已含「title + thesis + 6-chapter outline / **blueprint**」。只需补一句：Turn-2 Planning turn 把 review-proposer 产出的 `## OUTLINE BLUEPRINT` 文字块**原样**塞进 `terminal_skill.input`（连同 reader 的 gap 约定说明），不重写、不翻译。`comprehensive` 模式下由 scenario agent 自构 blueprint 时，同样按「主题递进 + 专门 gaps 章 + gap-dimensions」组织。其余 PLAN 形状不变。

---

## 数据流（改后）

```
Turn 1  review-proposer ─► 3 方向 JSON（outlinePreview 改为主题递进+gaps 章）
                          + 每方向一个 ## OUTLINE BLUEPRINT 文字块（intent/papers/subthemes/gap-dimensions）
            └─► present_directions（ChoiceCard 仍只展示扁平 title/thesis/outlinePreview，零 UI 改动）
Turn 2  reader 扇出 ─► 证据行（gap 行强制成行、claim 以 [gap:*] 前缀标记）→ .context/*.evidence.json
            └─► literature-review-result skill
                   · §2–§4：按 blueprint subthemes 用 h3 分组 + 跨论文综合（层次/递进）
                   · §5：独立、按 gap-dimensions 分类、逐条 <cite><q> 溯源到 [gap:*] 行
                   └─► fact-checker 审计（§5 的 cite 一并被溯源校验）
```

全程无类型 / IPC / 渲染改动；blueprint 与 gap 约定都走「prompt 文字契约 + `.context` 既有缓存」。

---

## 影响面 & 版本号

| 包 / 文件 | 改动 | 版本号 |
|---|---|---|
| `default-capability-packs/lit-review/manifest.json` | review-proposer / reader / system-prompt 三个 prompt 改动属本能力包 | `0.2.9 → 0.2.10` |
| `default-skills/literature-review-result/SKILL.md` | §2–§4 层次化 + §5 强制结构化溯源 + 一致性检查 | `version: 0.21.5 → 0.21.6` |
| `apps/electron/package.json` | 上述文件均在 apps/electron 下（开 PR 时一次性 patch+1） | 按 CLAUDE.md 规则 patch+1 |

> 注：能力包内 prompt 是英文（内置 prompt 约定）；本 spec、PR 描述用中文。

---

## 验收（对齐 issue Acceptance criteria）

- [ ] AC1 大纲：自动生成的大纲有主题分组 + 递进层次（review-proposer 主题骨架 + skill §2–§4 的 h3 子主题 + 递进衔接），非平铺。
- [ ] AC2 研究空白：综述含独立 `<section id="s5">` 研究空白章，按维度分类，每条挂 `<cite><q>` 且 `<q>` 来自 reader `[gap:*]` 证据行（可回溯，非空泛）。
- [ ] AC3 涉改的 synthesizer 链路 prompt（review-proposer / reader / skill / system-prompt）仍为英文。
- [ ] AC4 用一个真实综述任务对比改前后：大纲层次更清晰 + 出现可溯源的独立研究空白部分（`bun run dev` 实跑，截图对比）。
- [ ] AC5 `manifest.json` / `SKILL.md` / `package.json` 版本号已递增；`bun run typecheck` + `bun test`（含能力包加载 / key-parity）通过。

## 风险 & 缓解

- **R-1 纯 prompt 的层次约束较脆弱**（模型可能仍偶发平铺）：用 skill 的 Consistency Check 作硬门（§2–§4「一段一篇」抽查、§5 独立 + 溯源检查），并在 review-proposer 把「按类型骨架=失败」写进 Prohibited，双侧约束。
- **R-2 `[gap:*]` 前缀污染 `claim` 文字**：前缀是机器可读标记，body-writer 写正文时只取 `quote` 不取 `claim`，不会进 HTML；fact-checker 校验的是 `<q>`↔源对应，不受前缀影响。
- **R-3 能力包加载校验**：reader.md / review-proposer.md 含 `{{evidenceSchema:read,litreview}}` / `{{redLines:*}}` 占位符——本次不动占位符，只改正文文字，`default-capability-packs-load.test.ts` 应继续通过；改完跑该测试确认。
- **R-4 blueprint 文字块被 scenario agent 丢弃**：system-prompt 明确「原样塞进 terminal_skill.input」；skill 侧对「无 blueprint」保持向后兼容（仍能从证据行自组织 §2–§5），blueprint 在则以其为准。

## 待评审决策点

1. **§5 是否真的"几乎不可省略"**：当前定为「默认强制，仅零 gap 信号可省」。是否接受极少数确无空白的综述也强制写「未发现显著未解问题」于 §6（而非空 §5）？（本 spec 倾向：是。）
2. **是否同步给 `evidence-skimmer.md` 也加 `[gap:*]` 硬约束**（tail 论文 gap 召回）：本 spec 列为可选，默认靠 skimmer 复用 reader evidence 规则自然兼容。评审若要硬保证则追加一句。
