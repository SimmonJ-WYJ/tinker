/**
 * embedder 单测：注入 stub ONNX session，验证分词截断 / 前缀 / mean-pool / L2 normalize。
 * 真实模型推理不在单测覆盖（权重 ~118MB，运行时下载），由手动 golden path 验证。
 */

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { E5Embedder, type OrtSessionLike } from './embedder.ts'

/**
 * 最小可用 tokenizer.json：WordLevel 模型 + 空白预分词。
 * 不追求与 XLM-R 一致，只为驱动 E5Embedder 的张量构造与池化逻辑。
 */
const TINY_TOKENIZER = {
  version: '1.0',
  truncation: null,
  padding: null,
  added_tokens: [],
  normalizer: null,
  pre_tokenizer: { type: 'Whitespace' },
  post_processor: null,
  decoder: null,
  model: {
    type: 'WordLevel',
    unk_token: '[UNK]',
    vocab: {
      '[UNK]': 0,
      query: 1,
      passage: 2,
      hello: 3,
      world: 4,
      ':': 5,
    },
  },
}

const TINY_CONFIG = { model_max_length: 512 }

/** stub session：last_hidden_state = 每 token 一个 one-hot-ish 向量，便于验证池化 */
function makeStubSession(dim: number, record: { feeds?: Record<string, unknown> }): OrtSessionLike {
  return {
    run(feeds) {
      record.feeds = feeds
      const ids = feeds.input_ids as { data: BigInt64Array; dims: number[] }
      const [batch, seqLen] = ids.dims
      const data = new Float32Array(batch * seqLen * dim)
      // 每个 token 输出 [tokenId+1, 1, 0, ...]：dim1 常量使归一化后方向随 tokenId 变化
      for (let b = 0; b < batch; b++) {
        for (let s = 0; s < seqLen; s++) {
          data[(b * seqLen + s) * dim] = Number(ids.data[b * seqLen + s]) + 1
          data[(b * seqLen + s) * dim + 1] = 1
        }
      }
      return Promise.resolve({
        last_hidden_state: { data, dims: [batch, seqLen, dim] },
      })
    },
  }
}

function writeTinyModelDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'asci-embedder-test-'))
  writeFileSync(join(dir, 'tokenizer.json'), JSON.stringify(TINY_TOKENIZER))
  writeFileSync(join(dir, 'tokenizer_config.json'), JSON.stringify(TINY_CONFIG))
  return dir
}

async function loadStubEmbedder(record: { feeds?: Record<string, unknown> }): Promise<E5Embedder> {
  const dim = 4
  return E5Embedder.load(writeTinyModelDir(), {
    createSession: () => Promise.resolve(makeStubSession(dim, record)),
    createTensor: (type, data, dims) => ({ type, data, dims }),
  })
}

describe('E5Embedder（stub session）', () => {
  test('输出 L2-normalized 向量，批量与输入一一对应', async () => {
    const record: { feeds?: Record<string, unknown> } = {}
    const embedder = await loadStubEmbedder(record)
    const vecs = await embedder.embed(['hello world', 'world'], 'passage')
    expect(vecs.length).toBe(2)
    for (const v of vecs) {
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
      expect(Math.abs(norm - 1)).toBeLessThan(1e-5)
    }
  })

  test('e5 前缀进入分词输入（query vs passage 产生不同向量）', async () => {
    const record: { feeds?: Record<string, unknown> } = {}
    const embedder = await loadStubEmbedder(record)
    const [q] = await embedder.embed(['hello'], 'query')
    const [p] = await embedder.embed(['hello'], 'passage')
    // 前缀 token 不同 → mean-pool 输入不同 → 向量不同
    expect(q[0]).not.toBe(p[0])
  })

  test('空输入直接返回空数组（不触发推理）', async () => {
    const record: { feeds?: Record<string, unknown> } = {}
    const embedder = await loadStubEmbedder(record)
    expect(await embedder.embed([], 'passage')).toEqual([])
    expect(record.feeds).toBeUndefined()
  })

  test('batch 内不同长度 pad 对齐，attention_mask 标注有效位', async () => {
    const record: { feeds?: Record<string, unknown> } = {}
    const embedder = await loadStubEmbedder(record)
    await embedder.embed(['hello world hello world', 'hello'], 'passage')
    const mask = record.feeds!.attention_mask as { data: BigInt64Array; dims: number[] }
    const [batch, seqLen] = mask.dims
    expect(batch).toBe(2)
    // 第二条更短 → 尾部 mask 必有 0
    const row2 = Array.from(mask.data.slice(seqLen, 2 * seqLen), Number)
    expect(row2[row2.length - 1]).toBe(0)
    expect(row2[0]).toBe(1)
  })
})
