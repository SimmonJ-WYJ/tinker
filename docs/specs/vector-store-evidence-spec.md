# 文献向量索引 + 语义检索 Spec（Vector Index & Semantic Search Specification）

> **状态**：设计已裁决（grill-with-docs 九问 2026-06-02）· 实现完成（PR1/2/3 + simplify 复盘；待手动 golden path 验证）
> **关联分支**：`feat/vector-store-evidence`
> **关联 ADR**：[ADR-012 本地嵌入选型](../adr/ADR-012-local-embedding-vector-index.md)
> **领域语言事实源**：[CONTEXT.md「文献语料与检索」](../../CONTEXT.md)
> **关联 issue**：（开发完成后回填）

---

## 1. 问题与目标

文献多时（几十~几百篇）Agent 问答/综述靠 `papers_read_*` 逐篇通读 wiki md，慢且耗 context；证据组装只到论文级精度。

**成功标准**（grill Q1 裁决）：
1. **组装质量**：Agent 挑证据更准更全，引用锚点精确到段落
2. **响应速度**：文献多时问答/综述明显变快、少烧 context

不做（本期）：检索证据集自身（等 ADR-007 M:N 容器落地）；UI 语义搜索框（查询服务保持可被未来 IPC 复用）。

## 2. 九项设计裁决（与用户逐条确认）

| # | 决定 | 关键理由 |
|---|------|----------|
| Q1 | 成功标准 = 组装质量 + 响应速度 | 见上 |
| Q2 | 消费方 = 仅 Agent MCP 工具（`papers-rg` 进程内 server 新增 `papers_semantic_search`） | extractor 已有 papers-rg 扫描约定；主进程可直接开 SQLite/onnx |
| Q3 | 嵌入 = 本地 ONNX（multilingual-e5-small 量化，384 维） | ADR-012：零配置/隐私/不碰 Provider 层 |
| Q4 | 存储 = sqlite-vec + 独立索引库 `~/.asci/zotero/vector-index.db` | **可重建缓存**定位：不进 asci.db migration；换模型删库重建 |
| Q5 | 语料三层：raw 段落（保底）+ LLMWiki 摘要（增强）+ title/abstract（粗召回） | LLMWiki 升级为检索质量增强器 |
| Q6 | 作用域 = 全局一份；查询期可按 attachmentKeys 过滤 | 索引跟语料（文献库）走，不跟消费者（workspace）走 |
| Q7 | 触发 = 默认自动 + 事件驱动增量；**评估总开关**门控 worker + 工具注册 | 本地零成本 → 工具可用性稳定；开关关闭回退基线便于 A/B |
| Q8 | 召回 = 向量 KNN + FTS5(BM25, trigram) 混合，RRF 融合 | 科研精确术语（基因名/缩写）召回 + 小模型质量兜底 |
| Q9 | 证据回写 = extractor 新增扫描分支，段落级锚点 + chunk 原文作 snapshotText | "这段是依据"而非"这篇相关" |

## 3. 架构

```
┌─ 事件源 ──────────────────────────────────────────────┐
│ zotero-pdf-parser（解析完成/删除）                      │
│ zotero-article-generator（LLMWiki 生成完成）            │
└──────────────┬───────────────────────────────────────┘
               ▼ onEmbedSourceReady / onEmbedSourceDeleted
┌─ zotero-embedding-index（主进程，仿 article 三件套）────┐
│ queue → worker.runOne(key)：                           │
│   读 .md/.article.md/index.json → content_hash 增量判定 │
│   → chunker 切块（双轨锚点）→ embedder 批量推理          │
│   → vector-db 三表事务写入                              │
└──────────────┬───────────────────────────────────────┘
               ▼
┌─ vector-index.db（可重建缓存）─────────────────────────┐
│ meta（model_id/embed_dim）                             │
│ chunks（锚点+原文+hash） + vec_chunks（vec0） + fts_chunks│
└──────────────┬───────────────────────────────────────┘
               ▼ 混合检索（KNN ∪ BM25 → RRF → 每篇去重）
┌─ papers-rg MCP（进程内）────────────────────────────────┐
│ papers_semantic_search（评估开关门控注册，每会话判定）    │
└──────────────┬───────────────────────────────────────┘
               ▼ 工具结果（paperId + 锚点 + snippet）
┌─ evidence-conversation-citations-extractor ───────────┐
│ 新增扫描分支 → 段落级 EvidenceRef 候选（每篇去重 top 命中）│
└───────────────────────────────────────────────────────┘
```

### 3.1 双轨锚点（语料现实）

lite 策略（默认）解析的 raw md **没有** `<p id>` 锚点（本机实测 47 篇中 45 篇 lite）：

| 语料形态 | 切分 | 锚点格式 |
|----------|------|----------|
| structured md / .article.md（有 `<p id="pS_P">`） | 按段落标签 | `p3_1`（段落 id） |
| lite md（纯文本） | 按行合并至 ~300 token | `b12345`（body 内字节偏移，与 `papers_read_context` 的 byteOffset 寻址吻合） |
| title+abstract（index.json） | 每篇一条 | null |

### 3.2 vector-index.db schema

见 `apps/electron/src/main/lib/zotero-embedding-index/vector-db.ts` 头注释（事实源）。要点：
- `chunks`（id 主键）+ `vec_chunks`（vec0，rowid 对齐）+ `fts_chunks`（FTS5 external-content，trigram）
- meta.model_id / embed_dim 与当前模型不符 → 整库删除重建
- 每篇每层整体替换（事务内三表同步）；增量键 `attachment_key + content_hash + model_id`

### 3.3 模型分发

`multilingual-e5-small` 量化 ONNX（118MB）+ tokenizer.json（17MB）+ tokenizer_config.json，
运行时从 HF 主源 / hf-mirror 镜像下载到 `~/.asci/models/{modelId}/`（`embedding-model-service.ts`，
状态机仿 `asr-weights-service.ts`；走 `getEffectiveProxyUrl()` 代理；文件粒度断点）。

### 3.4 评估开关（A/B）

`~/.asci/zotero-embedding.json` 的 `enabled`（默认 true）同时门控：
1. embedding worker 是否跟随事件建索引
2. `agent-orchestrator` 创建 papers-rg server 时是否注册 `papers_semantic_search`（**每会话判定一次**，避免会话中途工具集抖动）

关闭 = Agent 回到逐篇阅读基线，与开启态对比即可评估检索价值。

## 4. MCP 工具契约（papers_semantic_search）

- 入参：`query`(1~512 字符)、`attachmentKeys?`、`maxResults?`(默认 10 上限 50)、`textKinds?`
- 出参：`ZoteroSemanticSearchResult`（见 `packages/shared/src/types/zotero-embedding.ts`）
  - `degraded: 'model_not_ready' | 'index_empty'`：降级显式可见，不抛错
  - hits 含 `paperId / textKind / anchorStart / anchorEnd / snippet / score`

## 5. 实现地图（PR 切分）

### PR1 — 索引基础设施 ✅
- `packages/shared/src/types/zotero-embedding.ts` — 类型 + 默认配置
- `apps/electron/src/main/lib/zotero-embedding-index/{vector-db,chunker,embedder}.ts` + 单测
- `apps/electron/src/main/lib/embedding-model-service.ts` — 模型下载
- `config-paths.ts`：`getZoteroVectorIndexPath` / `getEmbeddingModelsDir` / `getZoteroEmbeddingConfigPath`
- 依赖：`sqlite-vec@0.1.9`（须 --external + 打包白名单）、`@huggingface/tokenizers@0.1.3`（纯 JS 直接打包）
- 测试 driver 说明：bun test 不支持 better-sqlite3 native（bun#4290）→ `RawVectorDb` 最小接口 + bun:sqlite 适配；vec0 真路径由 Electron 冒烟覆盖

### PR2 — worker + 事件钩子 + Agent 工具 + 证据回写
- `zotero-embedding-index/{queue,worker,index}.ts`（仿 zotero-article-generator）
- 钩子：pdf-parser worker（写完 md / cleanupMd）、article-generator worker（写完 article）
- `papers-rg-tool.ts` 新增工具（deps 注入查询函数）；`agent-orchestrator.ts` 按开关注册
- `agent-prompt-builder.ts` 工具说明（英文）
- `evidence-conversation-citations-extractor.ts` 新分支 + 测试

### PR3 — 设置页 UI（IPC 四联 + i18n en/zh）
- `ZOTERO_IPC_CHANNELS` 新增 EMBED_* 通道 → ipc.ts → preload → atoms + `ZoteroEmbeddingPanel.tsx`

## 6. 打包硬约束（CLAUDE.md §7.1 对齐）

- esbuild `build:main`/`watch:main` 追加 `--external:sqlite-vec --external:onnxruntime-node`
- `electron-builder.yml` files 白名单追加 `node_modules/sqlite-vec/**/*` 与 `node_modules/sqlite-vec-*/**/*`
- **无 ABI 风险**：onnxruntime-node 是 N-API（免 rebuild）；sqlite-vec 是 SQLite loadable extension（dylib，由 SQLite 加载）
- ONNX 模型不进包（运行时下载）

## 7. 验证清单

1. `bun run typecheck` / `bun test` 全绿（含 key-parity）
2. `dist:fast` 冒烟：sqlite-vec/onnxruntime-node 进包、启动无 native 报错、vec0 真路径可建表
3. golden path：开开关 → 模型下载进度 → 解析新 PDF 自动入队 → Agent 调 `papers_semantic_search` → 生成证据带段落锚点 → 删 Zotero 论文联动清理 → 设置页 zh↔en 无 raw key
4. 边界：`model_not_ready` / `index_empty` 降级；attachmentKeys 过滤；开关关闭后新会话无该工具
