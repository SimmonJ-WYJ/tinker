> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 综述 reader 证据集会话内持久化（reader evidence `.context` cache）设计规格

- 状态：草案（待评审）
- 关联 issue：（待建）
- 关联 PR：（待建）
- 领域语言事实源：`CONTEXT.md`（EvidenceSet / reader / wiki 语料）
- 关联 spec：`docs/specs/lit-review-evidence-enrichment-spec.md`（覆盖率/扩库，正交）

## Context（为什么做）

综述流水线的 `reader` fan-out 是**最贵的一步**：每篇 deep-readable 论文派一个 reader，自解析 wiki 源
（`zotero_wiki_lookup`）→ outline-first 深读（`papers_read_outline` + 多次 `papers_read_article_section`）
→ 产出一组 evidence rows（`{ claim, source_id, locator, quote, confidence, status:read, bucket }`）。

**问题（用户锚定的唯一痛点）**：reader 的产物**只活在主 agent 的单轮对话上下文里**
（`lit-review/scenario/system-prompt.md:80-82`：主 agent 把"reader 返回的**全部** evidenceRows[]"作为 inline
参数交给 terminal skill）。**一次 context 压缩，这些证据行就被挤掉**——此时唯一退路是**重新派 reader 把论文
全文再读一遍**，综述时长被整段拉长（trace 实证：18 reader 跑完后压缩，只能去 grep 1.7MB transcript 反解，
否则就得重读 11 篇全文）。

**目标**：把每篇论文的 reader 证据集落到**会话目录下的 `.context/`**。压缩后无需重读原文——直接从
`.context/` 读回已抽好的证据集即可。**只解决"压缩→重读→变慢"，不追求跨会话/跨 workspace 复用**
（每个综述侧重点不同，跨综述复用价值低且会引入 topic 不匹配，明确不做）。

## 范围边界（明确不做）

- ❌ 跨会话 / 跨 workspace 复用。缓存随会话目录走，会话结束即随之归档/清理，不进全局 wiki 目录。
- ❌ topic 相关性、跨方向证据筛选。同一会话 = 同一综述 = 同一 topic，整体复用天然正确，无需判定。
- ❌ 跨 run 合并 / 去重。一个 reader 只写自己那一篇、只写一次（见决策 2）。
- ❌ 主进程 / orchestrator / IPC 改动（MVP）。全部落在 capability-pack + skill 提示层（见决策 3）。

## 关键事实（代码核实，写方案的前提）

| 事实 | 出处 |
|------|------|
| reader 派发时携带 `{ N, title, zoteroKey \| doi, abstract? }`；evidence row 的 `source_id` = zoteroKey（else doi） | `reader.md:56`、`system-prompt.md:74-78` |
| reader 已有 `Write` 工具；它的核心交付就是结构化 evidence rows（再 dump 成文件是小增量） | `reader.md`、capability pack tool 授权 |
| terminal skill `literature-review-result` 已有 `Write`，写 `reviews/*.html` 到 **session cwd**；session cwd 即文件面板根 | `SKILL.md:225-231` |
| session cwd = `~/.asci/agent-workspaces/{slug}/{sessionId}/`（按 sessionId 隔离，正是"会话内"粒度） | `config-paths.ts:874-894` |
| **先例**：reviews/ 由 skill 用 Write 写盘、orchestrator run 后扫 `reviews/` 落库（`persistReviewsFromSessionCwd`）——"Write 写 cwd + 事后扫盘"是成熟模式 | `agent-orchestrator.ts:2324-2378`、`review-cwd-scanner.ts:46-108` |
| orchestrator **无子 agent 完成 hook**：reader 输出埋在 Task 工具结果里流回父 agent，主进程拦不到 → 自动落盘成本高，排除 | `agent-orchestrator.ts:1895-2199` |
| papers-rg（进程内 MCP）当前只拿全局 `wikiDir`、不知 session cwd；注入需改 `HandlerDeps`（一行，非四联同步） | `papers-rg-tool.ts:132-141`、`agent-orchestrator.ts:709-711` |
| quote「单段连续、禁 `…` 桥接」当前仅 prompt 约束、无运行时校验（trace 里 reader 实际违约过） | `agent-prompt-builder.ts` QUOTE_RULE_LITREVIEW；trace |

## 锁定的设计决策

### 1. 位置 = 会话 cwd 下的 `.context/`，按派发身份命名

```
{session_cwd}/.context/{zoteroKey | doi-sanitized | N{index}}.evidence.json
```

- 相对 cwd 写，reader 用现有 `Write` 即可（`Write(".context/ABC123.evidence.json", ...)`）。
- 文件名取**派发身份**（reader 一上来就有的 `zoteroKey`，否则 sanitized `doi`，否则 `N{citationIndex}`）——
  无需先做 `zotero_wiki_lookup` 解析 attachmentKey 就能命名/查找，命中路径最便宜。`attachmentKey` 若已知则
  写进文件内容供 locator 对照。
- 不放全局 wiki 目录：那是为跨会话复用，已明确不做；放会话内随综述生命周期走，干净、可随会话清理。

### 2. 一论文一份 JSON，reader **只写一次**（无合并/去重）

会话内一个 reader 只负责一篇、跑一次、写一个文件 → 不同文件、无写竞争、无需合并去重。结构：

```jsonc
{
  "schemaVersion": 1,
  "N": 5,                              // 派发时的引用序号，回填 citation index
  "source_id": "E93C9ILE",            // = zoteroKey（else doi），body-writer 据此映射 N
  "zoteroKey": "E93C9ILE",
  "doi": "",
  "attachmentKey": "MM69RESN",        // 若 wiki_lookup 已解析；供 locator 对照
  "title": "Training language models to follow instructions ...",
  "bucket": "deep-read",              // deep-read | abstract-only | insufficient
  "createdAt": "2026-06-10T17:48:00+08:00",   // dayjs nowIso（@asci/shared）
  "rows": [
    {
      "claim": "对齐训练的计算成本仅为预训练的一小部分",
      "source_id": "E93C9ILE",
      "url": "",
      "source_type": "paper",
      "locator": "MM69RESN:p6_1#1",
      "quote": "The cost of increasing model alignment is modest relative to pretraining",
      "confidence": "high",
      "status": "read",
      "bucket": "deep-read"
    }
  ]
}
```

`rows[]` 就是 reader 本来要交回的 evidence rows，原样落盘——schema 与 inline 交回的完全一致。

### 3. 写/读机制 = 纯提示层（MVP），不碰主进程

- **写（reader）**：reader 完成深读、定好 evidence rows 后，**先 `Write` 到 `.context/{key}.evidence.json`**，
  再像现在一样把 rows 作为 summary 交回父 agent。落盘是"额外一步 Write"，schema 与交回内容一致。
- **读（terminal skill）**：`literature-review-result` 扩展输入契约——**当 inline `evidenceRows[]` 缺失/不全时，
  `Glob(".context/*.evidence.json")` + `Read` 把各篇 rows 拼回 `evidenceRows[]`**（按文件里的 `N` / `source_id`
  归位）。skill 已在同一 cwd 写 `reviews/`，读 `.context/` 是同目录操作。
- 给 skill 的 allowed-tools 增 `Glob`（当前只有 `Write papers_search_keywords papers_read_context
  workspace_papers_list`）。

> 选 (c) 提示层而非 (b) 新 MCP 工具：会话内一篇一写一读、无合并/校验刚需，Write/Glob/Read 足够；且**零主进程
> 改动、零 IPC、零打包风险**，完全落在 capability-pack + skill markdown，与 reviews 落盘先例同构。
> 新 MCP 工具（含 sessionCwd 注入 + 写时 strict 校验）留作 Phase 2 健壮性升级（见"未决"）。

### 4. 压缩后的两条复用路径（都在提示层）

`.context/` 落盘后，压缩导致 inline 证据丢失时：

1. **terminal skill 直接重建**（主路径）：skill 发现没收到 inline rows → 从 `.context/` 读回全部 rows →
   照常合成 §1–§8。**完全不重派 reader、不重读原文。**
2. **Turn-2 重规划时跳过已缓存论文**（兜底）：若主 agent 在压缩后重做 Turn-2 dispatch，scenario 提示要求
   "派 reader 前先看 `.context/{key}.evidence.json` 是否存在；存在则跳过该 reader"。即使重派，reader 的
   Step 0（决策 5）也会命中自身缓存秒回。

### 5. reader 流程改造：Step 0 查会话缓存 + 结束前落盘

reader.md 增两处：

```
0.（在 zotero_wiki_lookup 之前）查会话缓存：
   尝试 Read(".context/{zoteroKey|doi|N}.evidence.json")
   - 命中 → 直接以文件中的 rows 作为本次产出，跳过 wiki_lookup 与全部深读。结束。
   - 未命中 → 继续正常流程。

N.（深读完、定好 rows 后、交回父 agent 前）落盘：
   Write(".context/{key}.evidence.json", { meta..., rows })
```

主 agent Turn-2 dispatch、body-writer 的 inline 契约**保持兼容**（inline 仍可传；skill 缺 inline 时回退读盘）。
改的是 reader 内部 + skill 的回退读取。

### 6. 新鲜度：会话内极简

会话内 wiki 源基本不会中途变 → **文件存在即有效**，不做指纹/版本校验（那是跨会话方案的负担，已不做）。
唯一边缘情形：综述中途某篇 PDF 才解析完，早先落了 `abstract-only`。MVP 接受这种少见情形按 `abstract-only`
处理（与"不压缩、正常跑"时的行为一致，不退化）；不为此引入复检逻辑。

### 7. （可选，正交）quote 连续性校验

落盘是补 quote 运行时校验的好钩子，但与本痛点正交。MVP **不做**；若 Phase 2 走 MCP `papers_evidence_put`，
再在写时用 `papers_read_context` 按 locator byteOffset 校验单段连续、不过的标 `verified:false`。本 spec 仅记锚点。

## 落点（文件）

- `apps/electron/default-capability-packs/lit-review/sub-agents/reader.md`：增 Step 0（查 `.context/`）+ 结束前
  `Write` 落盘；写明缓存在**会话 cwd 的 `.context/`**、按派发身份命名、仅会话内。
- `apps/electron/default-capability-packs/lit-review/scenario/system-prompt.md`：Turn-2 dispatch 增"派 reader
  前先查 `.context/` 跳过已缓存论文"；terminal_skill input 说明"inline 缺失时 skill 从 `.context/` 重建"。
- `apps/electron/default-skills/literature-review-result/SKILL.md`：输入契约增"inline `evidenceRows[]` 缺失/不全时，
  `Glob(".context/*.evidence.json")` 读回拼装"；allowed-tools 增 `Glob`。
- （可选 Phase 2）`papers-rg-tool.ts` + `agent-orchestrator.ts:709`：注入 `sessionCwd`，新增
  `papers_evidence_get/put` 工具 + 写时 strict 校验。
- 版本号：MVP 仅改 capability-pack / skill markdown（无代码包），按约定在开 PR 时递增受影响包 patch；
  Phase 2 动 `apps/electron` 源码则该包 patch +1。

## 分阶段

- **Phase 1（MVP）**：reader Write 落盘 + Step 0 读盘 + skill `.context/` 回退读取 + scenario 跳过提示。
  纯提示层，零主进程/IPC/打包改动。**直接消除"压缩→重读全文"。**
- **Phase 2（可选健壮性）**：把 Write/Glob 约定换成进程内 MCP `papers_evidence_get/put`（papers-rg 注入
  sessionCwd），获得 schema 化写入 + 写时 quote strict 校验，降低对（弱模型）reader 手写 JSON 的依赖。

## 验证

1. `bun run typecheck` / `bun test`（capability-pack-loader / skill 守门测试不破）。
   - 提醒（见 memory）：worktree 内改 `@asci/*` 需先 `bun install`；`bun test` 从仓库根跑。
2. **落盘 golden path**：起一篇综述 → 每个 reader 跑完后 `.context/{key}.evidence.json` 存在、rows schema 正确、
   `N`/`source_id` 可回填。
3. **压缩重建（核心场景）**：模拟/构造 reader 跑完后 inline 证据丢失（context 压缩）→ terminal skill 从
   `.context/` 读回全部 rows、综述正常产出，且**全程无 `papers_read_outline`/`papers_read_article_section`/
   `Read(mdPath)` 再次调用**（断言无重读、综述质量不降）。
4. **reader Step 0 命中**：对同一会话同一篇二次派 reader（或重规划）→ 命中 `.context/` 秒回、跳过 wiki_lookup
   与深读。
5. **兼容回归**：不压缩、正常跑时，inline 路径仍工作；skill 同时收到 inline 与 `.context/` 时以 inline 为准、
   不重复计入。
6. **abstract-only 边缘**：PDF 未解析时落 `abstract-only` 缓存 → 重建时按 abstract-only 处理，与正常跑一致。

## 收益对照（对应 trace 暴露的问题）

| trace 问题 | 本方案（会话内） |
|------------|------------------|
| 证据行随 context 压缩丢失、只能 grep transcript 或重读全文 | reader 落盘 `.context/`；skill 缺 inline 时读盘重建，**不重读原文** |
| 重派 reader 重读全文导致综述时长拉长 | Step 0 命中会话缓存秒回；skill 直接读盘，省 outline+section |
| （正交）reader quote `…` 桥接无校验 | Phase 2 走 MCP put 时写时校验；MVP 不做 |

## 未决

1. **写机制 (c) 提示层 vs (b) MCP 工具**：MVP 选 (c)（零主进程改动）。若 reader 手写 JSON 实测不稳，或想要写时
   quote 校验，升到 (b)。需用户确认是否接受 MVP 先走提示层。
2. **inline 是否彻底退役**：可让 skill **总是**从 `.context/` 读、不再走 inline，顺带消灭 14KB inline args 撑爆
   prompt 的老问题。倾向先双轨（inline 优先、`.context/` 回退）验证稳定，再决定是否单轨读盘。
