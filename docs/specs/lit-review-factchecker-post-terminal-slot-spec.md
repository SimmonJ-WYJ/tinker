> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# lit-review fact-checker 入协议 + terminal_skill 之后核查槽 设计规格

- 状态：草案（待评审）
- 关联 issue：[#517](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/517)（guichuanqing 留言：fact-checker 从不派发，结构性不可达）
- 关联 PR：（待建）
- 领域语言事实源：`CONTEXT.md`（PLAN / terminal_skill / SubAgent 派活协议）；执行协议事实源：`apps/electron/src/main/lib/agent-prompt-builder.ts`

## Context（为什么做）

lit-review 综述生成后，spec §5.4 + scenario `stop_conditions` 都声称 `fact-checker` 必对每段核查（标 verified/unsupported/contradicted/unchecked），是"对抗幻觉的最后一道防线"。但实测 **fact-checker 从不派发**（issue #517：本机 55 个真实 session dispatch=0，含全链路跑到终点的 session `b1602034`）。

### 根因（已对照代码核验）

1. **fact-checker 只挂在 `optional_followups`，不在 `steps`**：lit-review Turn-2 PLAN 模板 [`system-prompt.md:102-104`](https://github.com/SimmonJ-WYJ/tinker/blob/4ca339592668581c1dc36abc9097fc9bf0aa1650/apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md) 把它放进 `optional_followups`；真正会派的 `steps` 里只有 `evidence-triager / reader / evidence-skimmer`。
2. **执行协议根本不消费 `optional_followups`（也不消费 `stop_conditions`）**：主 Agent 的 PLAN 执行协议 [`agent-prompt-builder.ts:565-583`](../../apps/electron/src/main/lib/agent-prompt-builder.ts) 只有 7 步——`parse → confirm 门 → steps（含 when）→ 等待/并行 → terminal_skill → closing_action → summary`。没有任何一步读 `optional_followups` / `stop_conditions`。→ 对**任何模型**都是 0 派发（结构性不可达，区别于 lit-search 的"步骤在 steps 里、个别模型不照做"的模型走偏）。
3. **更深一层结构缺陷——协议没有"terminal_skill 之后"的动作槽**：即便把 fact-checker 挪进 `steps`，`steps`（第 3 步）整体在 `terminal_skill`（第 5 步）**之前**执行，而 fact-checker 必须在综述正文**写出之后**核查每段——它会在无内容可核时空跑。协议形状 `steps → terminal_skill → summary` 里，terminal_skill 之后只剩 summary，没有可靠落点。（这也是关联 FINDING-20260610-001「reader 全 insufficient → terminal_skill 不触发」的同一类结构空白。）
4. **自相矛盾 / 误导表现**：`stop_conditions` 写「fact-checker has run on each chapter at least once」却无代码强制；收尾 summary 模板 [`system-prompt.md:120`](https://github.com/SimmonJ-WYJ/tinker/blob/4ca339592668581c1dc36abc9097fc9bf0aa1650/apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md) 串 `Fact-check status: <verified count> / <flagged count>`——fact-checker 没跑，占位符**原样泄漏**给用户，给出"已核验"的错觉且无跳过信号。
5. **现有护栏罩不到**：#590 的 [`plan-terminal-skill-guard.ts:37-38`](../../apps/electron/src/main/lib/plan-terminal-skill-guard.ts) 注释「只对 lit-search 的 general-query PLAN 生效，不波及 lit-review」，强制补调的也只是 `lit-search-report` skill。

## 目标 / 非目标

**目标**
- G1 给 PLAN 执行协议增加一个**「terminal_skill 之后」的核查槽**，让"产出 deliverable 后再校验 deliverable"成为协议一等步骤。
- G2 把 `fact-checker` 从 `optional_followups` 挪进该槽，并携带 fact-checker 需要的**claim-level 派发信号** + deliverable 定位（review HTML 路径 + `.context` 证据缓存），使它真正可派发、可核查、可回填 summary。
- G3 修掉 summary 占位符泄漏：fact-check 状态从 fact-checker 真实结果派生；未跑/未核查时给**显式信号**，不留 `<...>`。

**非目标**
- 不做"发现 rejected 后自动改写综述"的闭环（fact-checker 的 block-on-red 仅在 summary 里**呈现** must-fix / disputed 清单，自动修订留作后续）。
- 不在本 spec 解决 FINDING-20260610-001（terminal_skill 因全 insufficient 不触发）——同类但独立，单列「关联」。
- 不改 fact-checker 的审计算法 / 证据 schema；只动它的**派发接入**与**输出回填**。

## 设计方案

分两层，对齐 issue 的路线排序（先结构可达，再运行时保证）：

### Layer 1（结构性 —— 本 spec 核心）：核查槽 + fact-checker 入协议

#### 1.1 新增 PLAN 顶层字段 `post_terminal_steps`（通用，非 lit-review 专属）

语义：**在 `terminal_skill` 产出 deliverable 之后、summary 之前**，按序派发的"后置校验"子 Agent 列表。结构与 `steps` 同构（`{ subagent_type, input, model?, when? }`），但执行时机在 terminal_skill 之后。

```jsonc
"post_terminal_steps": [
  { "subagent_type": "fact-checker",
    "input": "<见 1.3 的派发契约>",
    "model": "haiku" }
]
```

#### 1.2 执行协议消费（`agent-prompt-builder.ts` PLAN dispatch protocol）

在现有第 5 步（terminal_skill）与第 7 步（summary）之间，**插入一步**（prose，英文，与现有协议同风格）：

> **Post-terminal verification steps (`post_terminal_steps`).** If the PLAN carries a top-level `post_terminal_steps` array, then **after the `terminal_skill` has produced its deliverable** (and only if it actually ran — skip when terminal_skill was conditionally skipped or never produced an artifact), dispatch each entry **in order** via `Task(subagent_type=…, prompt=…)`, same `when`-predicate and recommended-sub-agents cross-check as `steps`. These run on the *produced* artifact (e.g. verifying the review HTML the terminal_skill just wrote), which is why they cannot live in `steps` (those run before the deliverable exists). Collect their tool_results — the summary step consumes them. A PLAN without `post_terminal_steps` behaves exactly as before.

并把 summary 步骤（现第 7 步）补一句：**若 `post_terminal_steps` 含校验器，summary 必须从其 tool_result 派生校验状态**（见 1.4）。

> 说明：执行协议是 prompt 驱动（orchestrator LLM 读 PLAN JSON + 协议 prose 行事），故 Layer 1 = `agent-prompt-builder.ts` 的 prose 改动 + lit-review PLAN 模板发出该字段。无 PLAN 的硬 schema/类型需要改（PLAN 是 agent 文本里的自由 JSON；`plan-terminal-skill-guard` 只解析自己关心的子集）。

#### 1.3 lit-review PLAN 模板改动（`lit-review/scenario/system-prompt.md`）

- **把 fact-checker 从 `optional_followups` 移到 `post_terminal_steps`**（删 `optional_followups` 或仅留真正可选项）。
- fact-checker 的 `input` 必须携带（缺一不可）：
  1. **claim-level / per-section 派发信号**——fact-checker.md:52 明确「Without the explicit dispatcher signal, do NOT emit the claim-level JSON」，而 summary 的 `verified/flagged` 计数正依赖这段 JSON。故 input 必须显式写明"per-section claim-level check, emit the claims[] JSON"。
  2. **deliverable 定位**：terminal_skill 写出的 review HTML 路径（`reviews/*.html`，从 terminal_skill 的 tool_result 取）。
  3. **证据通道**：`.context/*.evidence.json`（fact-checker 自己 Glob+Read，对齐 fact-checker.md:13）。
- `when`（可选）：`terminal_skill` 已产出（无产出则跳过，避免空核）。
- **更新 `stop_conditions`**：把「fact-checker has run …」从"无强制的空声明"改为与 `post_terminal_steps` 一致的真实表述（或直接删掉该条，避免再制造"声称必跑"假象）。

#### 1.4 修掉 summary 占位符泄漏（`system-prompt.md` Turn-2 Closing turn）

- `Fact-check status: <verified count> / <flagged count>` 改为**从 fact-checker 的 claims[] JSON 真实派生**：verified 计数 = status==='verified'，flagged = unsupported+contradicted（unchecked 单列）。
- **fact-checker 未跑 / 未返回 claims[] JSON**（被跳过、超时、降级）：summary 必须输出**显式信号**（如「⚠ 本篇综述未经事实核查」/「Fact-check skipped」），**禁止**留 `<...>` 原样占位符。
- 若 fact-checker 报 `rejected`/`contradicted`：summary 附 must-fix / disputed 简表，让用户看到被标红的论断（不自动改写）。

#### 1.5 fact-checker.md（按需微调）

派发信号与 deliverable 定位都由 PLAN 的 `input` 传入，fact-checker.md 的 claim-level 模式（§4.5）已就绪，原则上**无需改**；仅在评审认为 input 契约需在 sub-agent 侧呼应时，补一句"dispatch 会带 review HTML 路径 + claim-level 信号"。

### Layer 2（运行时保证 —— 推荐随同落地，否则仍是模型走偏风险）

Layer 1 让 fact-checker **可达**，但派发仍是 prompt 驱动——在上下文压力下模型仍可能跳过（即 lit-search 那类走偏）。要**保证**它跑，需要代码护栏：

- **扩展 / 复刻 `plan-terminal-skill-guard` 到 lit-review**：监听 lit-review PLAN 的 terminal_skill（`literature-review-result`）被调用 + Task 派发流；到 `Stop` hook 时若 terminal_skill 已产出 review 但**未见 fact-checker 的 Task 派发**，则 `decision: 'block'` + 注入 additionalContext 强制主 Agent 立即补派 fact-checker（并落可定位日志），与 #590 对 lit-search-report 的保险网同构。
- 该 guard 须 pack-scoped（`lit-review`），不波及他包；防 Stop 循环（forced 标志）。
- 列为**同 PR 的第二步**：先 Layer 1 让它进协议，紧接 Layer 2 给硬保证。评审若要拆分，可 Layer 1 单独先行，但需明确"Layer 1 only 仍可能 0 派发"的残留风险。

## 数据流（改后）

```
Turn 2 PLAN: steps[evidence-triager? / reader* / evidence-skimmer?]
           → terminal_skill: literature-review-result  →  写出 reviews/*.html
           → post_terminal_steps[fact-checker]  ← 新槽：读 reviews/*.html + .context/*.evidence.json
                                                  ← claim-level 信号 → emit claims[] JSON
           → summary：从 claims[] 派生 Fact-check status（未跑则显式"未核查"）
   [Layer 2] guard 在 Stop 兜底：terminal_skill 产出但 fact-checker 未派 → 强制补派
```

## 影响面 & 版本号

| 包 / 文件 | 改动 | 层 |
|---|---|---|
| `apps/electron/src/main/lib/agent-prompt-builder.ts` | PLAN 执行协议 prose：新增 `post_terminal_steps` 消费步 + summary 派生校验状态 | L1 |
| `default-capability-packs/lit-review/scenario/system-prompt.md` | fact-checker 移入 `post_terminal_steps`（含 claim-level 信号 + review 路径 + 证据通道）；修 summary 占位符；更新 stop_conditions | L1 |
| `default-capability-packs/lit-review/sub-agents/fact-checker.md` | 按需微调（默认不改） | L1 |
| `default-capability-packs/lit-review/manifest.json` | 上述 prompt 改动 → version `0.2.x → 0.2.(x+1)` | L1 |
| `apps/electron/src/main/lib/plan-terminal-skill-guard.ts`（或新 `lit-review-factcheck-guard.ts`）+ `run-orchestrator-query.ts` 装配 | lit-review fact-checker 运行时保险网 | L2 |
| `apps/electron/package.json` | patch+1（开 PR 时一次） | — |

> 内置 prompt 一律英文（约定）；本 spec / PR 描述中文。

## 测试

- `agent-prompt-builder.test.ts`：断言协议 prose 含 `post_terminal_steps` 消费语义（与现有 terminal_skill/closing_action 断言同风格）。
- `default-capability-packs-load.test.ts`：lit-review 包仍正常加载（manifest 版本 + prompt 占位符不破）。
- （L2）新增 guard 单测：terminal_skill 已调用 + 无 fact-checker Task → Stop 时 block + 注入；有 fact-checker → 不触发；非 lit-review 包 → 不波及（对齐 plan-terminal-skill-guard 既有测试结构）。
- 真机验收：跑一个真实综述（含 b1602034 同类 21-paper 规模），确认 ① fact-checker 被派发 ② summary 出真实 `Fact-check status` ③ 未核查路径出显式信号而非 `<...>`。

## 验收（对齐 issue #517）

- [ ] AC1 fact-checker 不再结构性不可达：协议消费 `post_terminal_steps`，lit-review PLAN 把它放进该槽。
- [ ] AC2 真实综述 run 中 fact-checker dispatch > 0 且 emit claims[] JSON（claim-level）。
- [ ] AC3 summary 的 `Fact-check status` 由真实结果派生；未跑时显式提示，不泄漏占位符。
- [ ]（L2）AC4 运行时护栏：terminal_skill 产出但 fact-checker 未派 → 强制补派并落日志（lit-review pack-scoped）。
- [ ] AC5 受影响 manifest / package.json 版本号递增；`typecheck` + `bun test` 通过。

## 风险 & 缓解

- **R-1 Layer 1 only 仍可能被模型跳过**（结构可达≠保证跑）：故强烈建议 Layer 2 同 PR 落地；若分期，须在 PR 描述标注残留风险。
- **R-2 `post_terminal_steps` 与 `closing_action` 时序混淆**：closing_action 用于 Turn-1 多阶段 ChoiceCard 交接（无 terminal_skill）；post_terminal_steps 用于 Turn-2 terminal_skill 之后。协议 prose 明确二者互不重叠的触发条件。
- **R-3 fact-checker 在 deliverable 缺失时空跑**：`when` + 协议"仅 terminal_skill 实际产出才派"双重门控。
- **R-4 guard 误伤其他包**：pack-scoped resolver（仅 `lit-review` scenario）+ 既有 forced 防循环，复用 #590 验证过的结构。

## 待评审决策点

1. **Layer 2 是否同 PR**：本 spec 倾向同 PR（否则 0 派发风险仍在）。是否接受？
2. **`post_terminal_steps` 命名 / 通用性**：定为通用字段（任何包可用）还是 lit-review 专属？倾向通用（FINDING-001 等同类问题也可复用"产出后动作"槽）。
3. **fact-checker block-on-red 的处置**：本 spec 仅在 summary 呈现 must-fix/disputed，不自动改写。是否够？（自动修订=更大特性，建议另立 issue。）

---

## 附录：#668 跟进 —— Layer 2 guard 武装信号对齐 #679 重构

- 关联 issue：[#668](https://github.com/OPENSCI-Labs/ASCI-Alpha/issues/668)（fact-checker 0/45 复测，与 #517 同类根因）
- 关联 PR：（待建）

**背景**：本 spec 的 Layer 2 guard（`lit-review-factcheck-guard.ts`，#517 随 `3f128dfa` 落地）原以**主层 terminal_skill `literature-review-result` 被调用**作为「综述已产出」武装信号——当时综述正文由主 Agent 直接调该 skill 写出，信号在主 query hook 必然可见。

**漂移**：#679（`c3d362e3`）把综述正文改由 **`body-writer` 子 Agent 隔离生成**（在其上下文里调 `literature-review-result` skill），system-prompt 的 `terminal_skill` 改成了 `terminal_subagent: body-writer`，但 guard **未同步**。此后 guard 仅靠观察"子 Agent 内部"的 skill 调用来武装——虽然 SDK 对子 Agent 内部工具调用同样触发主 query PostToolUse（带 `agent_id`，guard 不按它过滤，故该信号仍生效），但这已是脆弱的间接信号，不再对齐架构。

**本次加固（#668）**：guard 改为以 **body-writer 子 Agent 派发**（主层 `Task`，必然可见、天然 pack-scoped）为**首要**武装信号，保留对内层 `literature-review-result` skill 调用的观察作为**冗余**信号；两者任一命中即武装（`bodyWriterDispatched || reviewSkillInvoked`）。force reason / 日志措辞对齐 `terminal_subagent` 现实。回归测试新增 #679 场景（仅 body-writer 派发即 block、body-writer + fact-checker 放行、内层带 `agent_id` 的 skill 仍武装、非 body-writer worker 不武装）。

**残留 / 同类**：`lit-review-structure-lint-guard`（监听 `Write(reviews/*.html)`）同样依赖子 Agent 内部工具调用冒泡——其触发器是 `Write` 路径而非 skill 名，且 SDK 已确认子 Agent 内部 `Write` 的 PostToolUse 可见，故功能未断；本次不改，仅在此记录其同源依赖以备后续审视。
