/**
 * 本地嵌入推理器：multilingual-e5-small（ONNX，384 维）
 *
 * 技术栈：
 *   - 分词：@huggingface/tokenizers（纯 JS，离线读本地 tokenizer.json，esbuild 直接打包）
 *   - 推理：onnxruntime-node（N-API，主进程 Electron 可直接用，须 --external 打包）
 *
 * e5 系列约定：
 *   - 输入需加前缀："query: "（检索查询）/ "passage: "（被检索语料）
 *   - 输出取 last_hidden_state 按 attention_mask 做 mean-pool，再 L2 normalize
 *   - 最大序列长 512 token，超长截断（保留尾部 </s>）
 *
 * 测试性：InferenceSession 通过 deps 注入，单测用 stub session 脱离真实模型权重。
 */

import { readFileSync } from 'node:fs'
import { loadOnnxRuntime } from '../../../../resources/optional-runtime'
import { join } from 'node:path'
import { Tokenizer } from '@huggingface/tokenizers'

/** 当前嵌入模型固定参数（换模型时同步改 modelId → 索引库自动整库重建） */
export const EMBEDDING_MODEL = {
  modelId: 'multilingual-e5-small-q8',
  displayName: 'Multilingual E5 Small（量化，100+ 语言）',
  embedDim: 384,
  maxTokens: 512,
  /** 模型目录下的必需文件（embedding-model-service 下载并校验） */
  requiredFiles: ['model_quantized.onnx', 'tokenizer.json', 'tokenizer_config.json'] as const,
} as const

export type EmbedKind = 'query' | 'passage'

/** onnxruntime InferenceSession 的最小接口（便于注入 stub） */
export interface OrtSessionLike {
  /** 模型声明的输入名（决定是否需要补 token_type_ids）；stub 可省略 */
  inputNames?: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>
}

export interface EmbedderDeps {
  /** 创建 ONNX session（默认动态 import onnxruntime-node） */
  createSession?: (modelPath: string) => Promise<OrtSessionLike>
  /** Tensor 构造器（默认 onnxruntime-node 的 Tensor） */
  createTensor?: (type: 'int64', data: BigInt64Array, dims: number[]) => unknown
}

async function defaultCreateSession(modelPath: string): Promise<OrtSessionLike> {
  const ort = await loadOnnxRuntime()
  return ort.InferenceSession.create(modelPath, {
    // CPU 推理；限制线程数避免抢主进程资源
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  }) as Promise<OrtSessionLike>
}

export class E5Embedder {
  readonly modelId = EMBEDDING_MODEL.modelId
  readonly embedDim = EMBEDDING_MODEL.embedDim

  private constructor(
    private readonly session: OrtSessionLike,
    private readonly tokenizer: Tokenizer,
    private readonly createTensor: NonNullable<EmbedderDeps['createTensor']>,
  ) {}

  /**
   * 从本地模型目录加载（目录由 embedding-model-service 下载就绪）。
   */
  static async load(modelDir: string, deps?: EmbedderDeps): Promise<E5Embedder> {
    const tokenizerJson = JSON.parse(readFileSync(join(modelDir, 'tokenizer.json'), 'utf-8')) as object
    const tokenizerConfig = JSON.parse(
      readFileSync(join(modelDir, 'tokenizer_config.json'), 'utf-8'),
    ) as object
    const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig)
    const session = await (deps?.createSession ?? defaultCreateSession)(
      join(modelDir, 'model_quantized.onnx'),
    )
    const createTensor =
      deps?.createTensor ??
      (await (async () => {
        const ort = await loadOnnxRuntime()
        return (type: 'int64', data: BigInt64Array, dims: number[]) => new ort.Tensor(type, data, dims)
      })())
    return new E5Embedder(session, tokenizer, createTensor)
  }

  /**
   * 批量嵌入。返回与输入一一对应的 L2-normalized Float32Array（embedDim 维）。
   *
   * @param kind query（检索查询）/ passage（语料入库）——决定 e5 前缀
   */
  async embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    const max = EMBEDDING_MODEL.maxTokens

    // 1. 分词 + 截断（保留尾部 </s>）
    const encoded = texts.map((t) => {
      const enc = this.tokenizer.encode(`${kind}: ${t}`)
      let ids = enc.ids
      let mask = enc.attention_mask
      if (ids.length > max) {
        const eos = ids[ids.length - 1] ?? 0
        ids = [...ids.slice(0, max - 1), eos]
        mask = mask.slice(0, max)
      }
      return { ids, mask }
    })

    // 2. pad 到 batch 内最大长度
    const seqLen = Math.max(...encoded.map((e) => e.ids.length))
    const batch = encoded.length
    const inputIds = new BigInt64Array(batch * seqLen)
    const attentionMask = new BigInt64Array(batch * seqLen)
    encoded.forEach((e, row) => {
      for (let i = 0; i < e.ids.length; i++) {
        // 防御：个别 tokenizer 实现对 OOV 返回 null id（真实 Unigram 模型不会），兜底为 0
        inputIds[row * seqLen + i] = BigInt(e.ids[i] ?? 0)
        attentionMask[row * seqLen + i] = BigInt(e.mask[i] ?? 0)
      }
      // pad 区默认 0（XLM-R pad id = 1，但 attention_mask=0 时 pad id 取值不影响输出；
      // 为稳妥仍填 1）
      for (let i = e.ids.length; i < seqLen; i++) {
        inputIds[row * seqLen + i] = 1n
      }
    })

    // 3. 推理（部分 ONNX 导出声明 token_type_ids 输入；单序列任务全 0 即可）
    const feeds: Record<string, unknown> = {
      input_ids: this.createTensor('int64', inputIds, [batch, seqLen]),
      attention_mask: this.createTensor('int64', attentionMask, [batch, seqLen]),
    }
    if (this.session.inputNames?.includes('token_type_ids')) {
      feeds.token_type_ids = this.createTensor('int64', new BigInt64Array(batch * seqLen), [batch, seqLen])
    }
    const outputs = await this.session.run(feeds)
    const hidden = outputs.last_hidden_state ?? Object.values(outputs)[0]
    if (!hidden) throw new Error('[嵌入] ONNX 输出缺少 last_hidden_state')
    const dim = hidden.dims[2] ?? this.embedDim
    const data = hidden.data as Float32Array

    // 4. mean-pool（按 attention_mask）+ L2 normalize
    return encoded.map((e, row) => {
      const out = new Float32Array(dim)
      let count = 0
      for (let i = 0; i < e.ids.length; i++) {
        if ((e.mask[i] ?? 0) === 0) continue
        count++
        const base = (row * seqLen + i) * dim
        for (let d = 0; d < dim; d++) out[d] = (out[d] ?? 0) + (data[base + d] ?? 0)
      }
      if (count > 0) for (let d = 0; d < dim; d++) out[d] = (out[d] ?? 0) / count
      let norm = 0
      for (let d = 0; d < dim; d++) norm += (out[d] ?? 0) ** 2
      norm = Math.sqrt(norm)
      if (norm > 0) for (let d = 0; d < dim; d++) out[d] = (out[d] ?? 0) / norm
      return out
    })
  }
}
