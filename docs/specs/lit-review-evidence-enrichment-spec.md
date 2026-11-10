> 历史科研规格：保存旧设计和数据语义，不作为当前新增功能或恢复运行接线的要求。科研主动功能正按[退役规格](./2026-11-10-research-retirement.md)分批收口，实际完成与未验收范围以对应执行记录为准。

# 综述证据集语义补全（lit-review evidence enrichment）设计规格

- 状态：草案（待评审）
- 关联 issue：（待建）
- 关联 PR：（待建）
- 领域语言事实源：`CONTEXT.md`（EvidenceSet / 混合检索 / 语义检索）

## Context（为什么做）

综述（lit-review）当前在**固定的 EvidenceSet** 上写：来源论文由用户上游 curate（经 lit-search）或 @提及，
综述阶段**刻意禁止扩库**（scenario prompt 的 "No ad-hoc retrieval" + R2 + Turn-2 `do_not`）。
该边界是有意的：发现=lit-search、写作=lit-review，"方向比文字更重要"的 30 秒 UX 依赖固定集合。

**问题**：评估显示综述最大短板是**覆盖率/全面性**——用户库里常有**已拥有但没加进证据集**的相关论文，
没有任何环节用**本地混合检索（`papers_semantic_search`）**把它们捞出来。lit-search 用的是 `paper-search`
（**外部**发现），本地混合检索目前只服务自由问答。这是一块空白。

**目标**：在写综述前，用本地混合检索从**当前 workspace 已拥有的论文**里，找出与综述主题相关、但不在证据集中的
论文/段落，**以建议形式**呈现给用户，确认后并入证据集，让最终证据集更全——同时不破坏"综述不静默扩库"的精神。

## 锁定的设计决策（已与用户确认）

1. **并入方式 = 建议性、待确认**：语义检索出候选后，列出"建议补充 N 篇/段"，**用户确认后才并入**；不静默自动并入
   （检索精度非 100%，英文 P@5≈0.8、中文更低，静默并入会污染综述）。
2. **检索范围 = 当前 workspace 内**：用 `papers_semantic_search` 的 `attachmentKeys` 过滤到本次综述 workspace
   已引用的论文集，聚焦、不跑题、不引入整库噪声。
3. **接入点 = 综述 Turn 1（选方向阶段）**，不是 Turn 2：Turn 2 的"不检索"铁律保持不动；补全只发生在写作之前。
4. **跨语言**：主题为中文时，补全检索的 query 用**英文改写**（方案 A 同理），否则补进来的多是噪声。
5. **可溯源 + 同等校验**：补进来的证据照常带 snapshotText 锚点，并经 `fact-checker` 校验，不因"自动捞的"而免检。

## 边界放宽（需在 scenario prompt 显式改）

`lit-review/scenario/system-prompt.md` 现有 R2 / "No ad-hoc retrieval" / Turn-2 `do_not` 三处禁止扩库。
本特性**只放宽 Turn 1 的一种扩库**：本地库（非外部 paper-search）、workspace 内、用户确认式。
明确保留：① Turn 2 仍绝对不检索；② 仍禁止 `mcp__paper-search__search_papers` 外部发现；③ 禁止静默并入。

## 实现取舍（待定，本 spec 的核心未决点）

Agent 目前**不能程序化往 EvidenceSet 加论文**——加入证据集是 UI 动作（`AddToEvidenceSetButton` + 既有 IPC，
`notes-service.addPaperToEvidenceSet` / `evidence-conversation-service`）。"确认后并入"两条路：

- **路 A（复用现有 UI）**：Turn 1 的 ChoiceCard / 对话里列出候选 paperId + 命中段落，用户用现有
  "加入证据集" UI 勾选并入，再继续 Turn 2。改动小、不新增 agent 写权限；但交互是两步（看建议 → 手动加）。
- **路 B（新增 agent 工具）**：新增一个 in-process MCP 工具 `evidence_set_add_papers`（确认门控），
  Agent 在用户确认后调用直接并入。交互顺滑、一步到位；但给了 agent 写 EvidenceSet 的能力，需谨慎门控
  （仅确认后、仅 workspace 内、记 provenance）。

> 倾向：先做**路 A**（MVP，零新增写权限，复用成熟 UI），验证价值后再评估路 B 的顺滑度收益。

## 落点（文件）

- `apps/electron/default-capability-packs/lit-review/manifest.json`：给 scenario 或新增 `evidence-broadener`
  子 agent 授 `mcp__papers-rg__papers_semantic_search`（仅 vector/both 模式可用，天然受 3 档开关门控）。
- `lit-review/scenario/system-prompt.md`：Turn 1 增「确认式 workspace 语义补全」步 + 改 R2 措辞（窄放宽）。
- （路 B 才需）`apps/electron/src/main/mcp/` 新增 `evidence_set_add_papers` 工具 + 复用
  `notes-service.addPaperToEvidenceSet`；`agent-orchestrator` 注入。
- 复用：`semanticSearchPapers`（`zotero-embedding-index/index.ts`）、`papers_semantic_search`
  （`papers-rg-tool.ts`）、`notes-service` / `evidence-conversation-service` 的证据集写入。

## 分阶段

- **Phase 1（路 A，MVP）**：scenario 授工具 + Turn 1 prompt 增补全步（英文 query、workspace 过滤、列建议）；
  用户用现有 UI 并入。改动局限在 capability pack，零新 native/IPC。
- **Phase 2（路 B，可选）**：新增确认门控的 `evidence_set_add_papers` 工具，一步并入。
- **评估**：用 `rag-review-eval-playbook.md` 对比「开补全 vs 不开」同一综述题的覆盖度提升（judge 评）。

## 验证

1. `bun run typecheck` / `bun test`（pack 改动不破坏 capability-pack-loader 测试）。
2. 手动 golden path：库里放几篇相关但未加进证据集的论文 → 起综述 → Turn 1 应列出"建议补充" → 确认并入 →
   Turn 2 综述确实纳入了补充论文且引用可溯源。
3. 边界回归：检索模式切「仅关键词(papers-rg)」→ 补全步不触发（工具未注册）；Turn 2 仍绝不检索。
4. 跨语言：中文主题 → 确认补全 query 用英文改写、候选相关。
