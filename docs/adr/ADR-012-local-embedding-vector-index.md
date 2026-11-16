<a id="adr-012文献向量索引用本地-onnx-嵌入模型而非远程-embeddings-api"></a>

# ADR-012: Use a Local ONNX Embedding Model for the Literature Vector Index (Rather Than a Remote Embeddings API)

| Field | Content |
|------|------|
| **Status** | Accepted (grill-with-docs session decision, 2026-06-02) |
| **Decision date** | 2026-06-02 |
| **Decision maker** | alan@opensci.io |
| **Hard decision deadline** | Before implementation of `feat/vector-store-evidence` |
| **Related** | [CONTEXT.md literature corpus and retrieval domain](../../CONTEXT.md) · [docs/specs/vector-store-evidence-spec.md](../specs/vector-store-evidence-spec.md) · ADR-001 (local SQLite storage direction) |

---

<a id="一背景"></a>

## 1. Background

With many papers (dozens to hundreds), Agent Q&A/reviews read each wiki md in full, which is slow and consumes context; evidence assembly only reaches paper-level precision. Vector retrieval is needed (semantic paragraph recall + anchors written back to evidence).

The vector source is the hardest decision to reverse in the overall plan: once the embedding model is chosen, all corpus vectors are tied to it; changing the source means a full index rebuild plus possible dependency/configuration changes.

**Practical constraint**: all 6 channels in the project's Provider layer use Anthropic-style Messages APIs, with no guaranteed embeddings endpoint; Anthropic offers no official embeddings API. Reusing existing channel credentials for embeddings is not an available path by default.

<a id="二决策维度"></a>

## 2. Decision Dimensions

| Dimension | Reason for its weight |
|------|----------|
| User configuration barrier | Agent retrieval tools must be **reliably available**, independent of whether the user configured a particular channel |
| Literature privacy | Whether full research texts (including unpublished manuscripts) leave the local machine |
| Change scope | Whether the Provider adapter layer must change (a two-layer design where adding an endpoint type is a major operation) |
| Quality ceiling | Retrieval recall quality (partially supported by hybrid search) |

<a id="三候选方案"></a>

## 3. Options

| | Local ONNX model (**selected**) | Remote embeddings API |
|---|---|---|
| Configuration barrier | Zero configuration (first background model download ~135MB) | Users must configure a channel supporting embeddings (SiliconFlow/OpenAI/Voyage…) |
| Privacy | Full text stays local | Full text uploaded to a third party |
| Change scope | No Provider-layer changes; `onnxruntime-node` is already a dependency (N-API, usable in the main process) | Add OpenAI-compatible embeddings capability to the Provider layer + channel configuration UI |
| Quality | e5-small level (384 dimensions), multilingual; weak on exact terminology → supported by FTS5 hybrid search | Higher ceiling with top API models (voyage-3, etc.) |
| Cost | Zero token cost, works offline | Usage billing, network dependency |
| Speed | Batched CPU inference; initial full-library build is a background task taking minutes | Fast per batch, but subject to network/rate limits |

<a id="四决策"></a>

## 4. Decision

**Local ONNX embeddings**: quantized `multilingual-e5-small` (384 dimensions), inference in the main process through `onnxruntime-node`, tokenization using pure-JS `@huggingface/tokenizers`. At runtime, weights download from HF (primary) / hf-mirror (fallback mirror) into `~/.asci/models/`; they are not bundled with the app.

Supporting safeguards (making this difficult-to-reverse choice reversible):

1. **Index database meta records `model_id` + `embed_dim`** — automatically delete and rebuild the entire database when changing models or adding a remote API later (the index is a rebuildable cache; see spec)
2. **Hybrid retrieval (vectors + FTS5 BM25 + RRF)** — exact-term recall does not depend on embedding quality, covering the small model's weakness
3. Embedding calls are centralized in one `embedder` module; adding a remote path later only requires replacing its implementation

<a id="五后果"></a>

## 5. Consequences

- ✅ Retrieval tools work out of the box and offline, with full text staying local; Agent-tool availability does not depend on channel configuration
- ✅ Provider layer remains untouched; implementation scope stays within new modules
- ⚠️ Accept the e5-small quality ceiling; if measured recall is inadequate, upgrade to a larger local model (bge-m3, etc.) or add a remote path. Both follow "change model_id → delete and rebuild database"
- ⚠️ First use downloads a ~135MB model (background, mirror fallback, and resume support); failed downloads suspend indexing and explicitly degrade retrieval tools (`model_not_ready`) rather than throwing errors
