> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# lit-review Turn-2 编排健壮性 spec

> **状态**：L1+L2+L3 已实现（typecheck + 守门测试通过；待 >10 篇综述、其中 >8 已解析的行为验证）。阈值/deepReadCap 已下调为 10/8（见 semantic-first spec）。
> **关联 issue**：（待补）
> **关联 PR**：（待补，本 PR）
> **领域语言事实源**：`CONTEXT.md`、`docs/specs/lit-review-semantic-first-reader-spec.md`、`docs/specs/lit-review-reader-evidence-cache-spec.md`

## 1. 背景与问题

lit-review Turn-2 的执行是**纯 prompt 驱动**：scenario Agent 吐一个 `## REVIEW PLAN`，master（orchestrator）靠阅读 PLAN 协议的英文叙述来决定派哪些 SubAgent、派几个、最后调不调 terminal skill。PLAN 协议见 `agent-prompt-builder.ts` 的 “Scenario Agent PLAN dispatch protocol”（§5.3/§5.4）。

在一次 39 篇论文的真实 run 里（debug dump #4），观察到的实际派发是 `1 triager + 15 reader + 0 skimmer + 0 escalation`，且最后 master **自己用 Write 拼了综述 HTML**，绕过了 `literature-review-result` terminal skill。

### 1.1 四个叠加失效（over-determined）

- **A — 条件步骤写成 `input` 散文。** `scenario/system-prompt.md` 的 triager / skimmer step 以 “INCLUDE THIS STEP ONLY when…” 开头，“要不要跑这一步”埋在 dispatch 字符串里，不是结构化字段。master 要读散文临场判断，是上下文压力下最先丢的逻辑。
- **B — ≤5 升级 reader 不是 step，只是 `step_ordering` 叙述。** master 要自己从散文里：读 skimmer 的 `needsDeepRead[]` → 按 hit 强度排序 → 截 5 → 合成新 reader 派发。动态 fan-out 要从散文“发明”，极易整段蒸发。
- **C — terminal_skill 调用与 master 自身 Write 能力竞争。** master 有 `Write`。证据已落 `.context/`、文件也读了，最省力路径就是自己拼 HTML。协议只说 “invoke that Skill”，**没有硬闸**禁止 master 直接写交付物。
- **D — 上下文压缩冲掉 PLAN 本身。** PLAN 躺在早期一个 scenario tool_result 里；15 个 reader 把大量证据行灌回 master context，读完时压缩很可能已把 PLAN JSON 丢掉。压缩后 master 只剩 `.context` 文件 + 模糊记忆 → 只能即兴 Write。**这是最深的因：PLAN 易失，执行窗口又长又重。**

## 2. 重构框架：脊柱 vs 尽力而为

把 Turn-2 的步骤分两类，分别用不同强度的手段保障：

- **硬保证（必须永远发生）**：`evidence-triager`（>10 时）→ core `reader` fan-out → **terminal skill 产出综述**。
- **尽力而为（丢了降质但不破 run）**：`evidence-skimmer`、≤5 升级 `reader`。升级 reader 明确划入此类——未派到的论文在 terminal skill 里降级进 §7/§8 低置信，不为它单独上结构化 fan-out DSL（会引入新的 PLAN 语法歧义）。

## 3. 方案（本轮范围 L1+L2+L3）

### L1 — terminal_skill 硬闸（修 C + D 最坏症状）

**目标**：PLAN 声明了 `terminal_skill` 时，综述**只能**经该 Skill 产出；master 禁止自己 Write 交付物；证据被压缩也照调，Skill 自己 glob `.context/` 恢复。

落地：
- `agent-prompt-builder.ts` PLAN 协议 step 5 增加硬规则：*当 PLAN 含 `terminal_skill` 时，你（master）MUST NOT 自己写交付物产物（如 `reviews/*.html`）。该 Skill 是唯一生产者。即使 inline evidenceRows 已被压缩丢失，也仍然调用该 Skill —— 它会 glob `.context/*.evidence.json` 重建证据。绝不用 ad-hoc prompt / 直接 Write 代替它。*
- `scenario/system-prompt.md` Turn-2 “Hard rule” 段回写同一条（双保险）。
- `literature-review-result/SKILL.md` 的 `.context` glob 恢复**已在前序 PR 落地**（inline 缺失时 Glob `.context/*.evidence.json`）；本轮把它从“fallback”表述升级为“常规输入通道”（见 L2）。

### L2 — terse reader 回传 + cache 当传输通道（修 D 根因）

**目标**：reader / skimmer 不再把整套证据行灌回 master，只回**指针**；真正的行留在 `.context/`，terminal skill glob 取。master context 跨 15 个 reader 几乎不涨 → 压缩可能根本不触发。

reader / skimmer 回传契约改为 terse pointer（每篇一行）：

```json
{ "N": 5, "source_id": "<parentItemKey>", "bucket": "deep-read",
  "rowCount": 4, "cacheFile": ".context/<key>.evidence.json" }
```

- 完整 `rows` 只写进 `.context/<key>.evidence.json`（reader 已有此行为），**不再**整体回灌 master。
- terminal skill 输入契约（`scenario/system-prompt.md` terminal_skill.input + `SKILL.md`）改为：**默认 glob `.context/*.evidence.json` 取证据行**，inline rows 变可选/省略。Skill 用每个 cache 文件里的 `source_id` + `N` 把行映射回 `papers[]` 的引文序号。
- **静默丢失防护**：pointer 带 `rowCount`；若某篇 cache 文件缺失或 `rows` 为空，Skill 在 §7/§8 标该篇“证据缺失”，不静默跳过。
- **对 fact-checker 的影响**：fact-checker 也能 glob `.context/` + 读最终综述做溯源校验，不依赖 master inline rows。需在 fact-checker 派发说明里点明证据源是 `.context/` + 综述产物。

### L3 — 结构化 `when` 谓词（修 A，提升 skimmer 触发率）

**目标**：把 “INCLUDE ONLY when…” 从 `input` 散文提出来，变成 step 上的 `when` 字段，master 机械求值而非读英文。复用已有的 `terminal_skill.condition` 机制（PLAN 协议 step 5 已能对 tool_results 求谓词）。

PLAN step 增加可选 `when`（dotted-path 比较，语法与 `terminal_skill.condition` 同形）：

```json
{ "subagent_type": "evidence-triager",
  "when": "papersInScope.length > 10",
  "input": "…只放输入，不再含 INCLUDE ONLY 散文…" },
{ "subagent_type": "evidence-skimmer",
  "when": "evidence-triager.light.length > 0",
  "input": "…" }
```

落地：
- `agent-prompt-builder.ts` PLAN 协议加一条：*step 可带可选 `when` 谓词；派发前对累积 tool_results 求值，false 则跳过该 step、继续后续。无 `when` 的 step 无条件派发。* —— 与 step 5 的 `terminal_skill.condition` 同一求值心智。
- `scenario/system-prompt.md` Turn-2 PLAN 把 triager / skimmer 的 “INCLUDE ONLY when…” 改写成 `when` 字段，`input` 只留真正的 dispatch 内容。
- 谓词词汇表保持极简：`<stepName|inputField>.<path> <op> <literal>`，op ∈ `> >= < <= == !=`、`.length`。不引入布尔组合以外的复杂度（必要时拆成两个 step 或在散文里补一句）。

## 4. 暂不做（后手）

- **L4 — PLAN 持久化**（Turn-2 PLAN 落 `.context/_plan.json`，压缩后 master 重读拿回配方）：L2 把 context 压力釜底抽薪后，压缩本就大概率不发生；L4 留作 L1+L2+L3 实测仍抖时的补强。
- **L5 — 代码驱动 pipeline**（把 Turn-2 序列写成 orchestrator 确定性代码）：结构终局，能根治 A+B+C+D，但架构改动大，不应是第一步。

## 5. 落地点清单

| 文件 | 改动 |
|------|------|
| `apps/electron/src/main/lib/agent-prompt-builder.ts` | PLAN 协议：step 5 加 terminal_skill 硬闸（禁 master 自写交付物）；新增 step `when` 谓词求值规则 |
| `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md` | Turn-2 PLAN：triager/skimmer 的 INCLUDE-ONLY 散文 → `when` 字段；terminal_skill.input 改为默认 glob `.context/`；Hard rule 回写 terminal_skill 硬闸 |
| `apps/electron/default-capability-packs/lit-review/sub-agents/reader.md` | 回传契约改 terse pointer（rows 只落 cache）；保留 cache 写入 |
| `apps/electron/default-capability-packs/lit-review/sub-agents/evidence-skimmer.md` | `covered[]` 同改 terse pointer |
| `apps/electron/default-skills/literature-review-result/SKILL.md` | `.context` glob 从 fallback 升级为常规输入通道；rowCount 缺失防护 |
| `apps/electron/default-capability-packs/lit-review/sub-agents/fact-checker.md` | 证据源点明 `.context/` + 综述产物 |
| `apps/electron/default-capability-packs/lit-review/manifest.json` | 版本 patch 递增（开 PR 时） |

## 6. 验证

- `bun run typecheck` + `bun test`（含 `default-capability-packs-load.test.ts` 守门，模板 token 不破）。
- 行为验证需 >10 篇综述、其中 >8 篇**已解析（wiki 已 parse）**的库，实跑一次 Turn-2，确认：
  1. master 不再自写 HTML（terminal skill 被调用）；
  2. reader 回传是 terse pointer，master context 不随 reader 数线性膨胀；
  3. skimmer 在 `light` 非空时被派发（`when` 生效）；
  4. 中途若压缩，综述仍从 `.context/` 重建产出。

## 7. 未决

- `when` 谓词仍是 master prose-evaluated（无真求值器）。论点：短结构化 `X.light.length > 0` 比埋在 200 词 input 里的整句更机械、更难漏——边际但真实改善。若仍不可靠，升级 L4/L5。
- terse 回传后，master 对单篇证据质量失去可见性（只见 rowCount）。可接受：质量判断本就归 terminal skill + fact-checker。
