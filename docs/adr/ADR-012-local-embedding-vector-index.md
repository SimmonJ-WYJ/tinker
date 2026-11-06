# ADR-012：文献向量索引用本地 ONNX 嵌入模型（而非远程 embeddings API）

| 字段 | 内容 |
|------|------|
| **状态** | Accepted（grill-with-docs 会话裁决 2026-06-02） |
| **决策日期** | 2026-06-02 |
| **拍板人** | alan@opensci.io |
| **决策时点硬约束** | `feat/vector-store-evidence` 实现落地前 |
| **关联** | [CONTEXT.md 文献语料与检索领域](../../CONTEXT.md) · [docs/specs/vector-store-evidence-spec.md](../specs/vector-store-evidence-spec.md) · ADR-001（本地存储 SQLite 路线） |

---

## 一、背景

文献多时（几十~几百篇）Agent 问答/综述靠逐篇通读 wiki md，慢且耗 context；证据组装只到论文级精度。需要接入向量检索（语义召回段落 + 锚点回写证据）。

向量从哪来是整个方案里最难回头的决定——嵌入模型一旦选定，全部语料的向量都绑定该模型；换来源 = 全量重建索引 + 可能的依赖/配置形态变化。

**现实约束**：项目 Provider 层 6 个渠道全部是 Anthropic-skin Messages API，无一保证有 embeddings 端点；Anthropic 官方不提供 embeddings API。"复用现有渠道凭证调 embeddings"这条路默认不存在。

## 二、决策维度

| 维度 | 权重理由 |
|------|----------|
| 用户配置门槛 | Agent 的检索工具必须**稳定可用**，不能取决于用户是否配了特定渠道 |
| 文献隐私 | 科研全文（含未发表稿）是否出本机 |
| 手术面 | 是否要动 Provider 适配器层（两层设计，新增端点类型是大手术） |
| 质量上限 | 检索召回质量（可被混合检索部分兜底） |

## 三、候选方案

| | 本地 ONNX 模型（**选中**） | 远程 embeddings API |
|---|---|---|
| 配置门槛 | 零配置（模型首次后台下载 ~135MB） | 用户须自配支持 embeddings 的渠道（SiliconFlow/OpenAI/Voyage…） |
| 隐私 | 全文不出本机 | 全文上传第三方 |
| 手术面 | 不碰 Provider 层；`onnxruntime-node` 已是依赖（N-API，主进程可用） | Provider 层新增 OpenAI-compatible embeddings 能力 + 渠道配置 UI |
| 质量 | e5-small 级（384 维），多语言；精确术语弱 → 由 FTS5 混合检索兜底 | 顶级 API 模型（voyage-3 等）上限更高 |
| 成本 | 零 token 成本、可离线 | 按量计费、网络依赖 |
| 速度 | CPU 批量推理，全库首建分钟级后台任务 | 单批快，但受网络/限流 |

## 四、决策

**本地 ONNX 嵌入**：`multilingual-e5-small` 量化版（384 维），`onnxruntime-node` 主进程推理，分词用纯 JS `@huggingface/tokenizers`。权重运行时从 HF（主源）/ hf-mirror（镜像兜底）下载到 `~/.asci/models/`，不随应用打包。

配套护栏（让"难回头"变成"可回头"）：

1. **索引库 meta 记录 `model_id` + `embed_dim`**——换模型/未来接远程 API 时自动整库删除重建（索引定位是可重建缓存，见 spec）
2. **混合检索（向量 + FTS5 BM25 + RRF）**——精确术语召回不依赖嵌入质量，兜住小模型的弱项
3. 嵌入调用收敛在单一 `embedder` 模块——未来若加远程路径，只替换该模块实现

## 五、后果

- ✅ 检索工具开箱即用、离线可用、全文不出本机；Agent 工具可用性不依赖渠道配置
- ✅ 不动 Provider 层，实现面收敛在新增模块内
- ⚠️ 接受 e5-small 的质量上限；若实测召回不足，升级路径是换更大本地模型（bge-m3 等）或补远程路径，两者都走"换 model_id → 删库重建"
- ⚠️ 首次使用有 ~135MB 模型下载（后台、带镜像兜底与断点）；下载失败时索引任务挂起，检索工具显式降级（`model_not_ready`）而非报错
