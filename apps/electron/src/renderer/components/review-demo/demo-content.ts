/**
 * [mockup] P4 证据链 demo 数据（hardcoded）
 *
 * 对齐 prototypes-v0.2-v0.3.html#p4 的 RAG 综述示例。
 * 不走 i18n —— 综述正文与引用片段保留中文/英文混排，作为 demo 内容展示。
 */

export type DemoRelationType = 'supports' | 'contradicts'

export interface DemoCitationRef {
  id: string
  label: string
  type: DemoRelationType
  source: {
    paperLabel: string
    location: string
  }
  quote: string
}

export type DemoTextPart = string | { refId: string }

export interface DemoParagraph {
  parts: DemoTextPart[]
}

export interface DemoSection {
  heading: string
  paragraphs: DemoParagraph[]
}

export interface DemoReview {
  title: string
  subtitle: string
  sections: DemoSection[]
  refs: Record<string, DemoCitationRef>
}

export const DEMO_REVIEW: DemoReview = {
  title: '检索增强生成（RAG）技术综述',
  subtitle: '由 Agent 生成 · 14 篇论文 · 3,420 字',
  sections: [
    {
      heading: '2. 端到端 RAG 训练方法',
      paragraphs: [
        {
          parts: [
            'RAG 的核心创新在于将检索过程纳入梯度反传链路。',
            { refId: 'lewis-2020' },
            ' 首次提出端到端训练框架，将参数化记忆（生成器）与非参数化记忆（检索器 + 索引）联合优化。在 Natural Questions 数据集上 RAG-Token 取得 56.8 EM 准确率，相比纯参数化的 BART-large 提升 12.4 个点。',
          ],
        },
        {
          parts: [
            '然而，',
            { refId: 'izacard-2022' },
            ' 后续证明，在开放生成任务上 RAG 反而比纯参数化模型表现稍差（BLEU 低 3 个点），',
            { refId: 'asai-2024' },
            ' 提出 Self-RAG 通过自适应检索机制部分缓解了这个问题。',
          ],
        },
      ],
    },
    {
      heading: '3. 检索质量对生成的影响',
      paragraphs: [
        {
          parts: [
            '检索 recall@K 与最终 EM 准确率呈正相关，但收益边际明显（',
            { refId: 'karpukhin-2020' },
            '）。当 recall@100 ≥ 95% 时，cross-encoder re-rank 的额外收益不超过 1% nDCG@10。',
          ],
        },
      ],
    },
  ],
  refs: {
    'lewis-2020': {
      id: 'lewis-2020',
      label: 'Lewis 2020',
      type: 'supports',
      source: {
        paperLabel: 'Paper · arXiv:2005.11401 · Lewis et al. 2020',
        location: '第 3 节第 2 段',
      },
      quote: '"Our RAG models, fine-tuned end-to-end, achieve state-of-the-art results on multiple knowledge-intensive NLP tasks. Specifically, on Natural Questions, RAG-Token reaches 56.8 EM, outperforming our BART baseline by 12.4 points..."',
    },
    'izacard-2022': {
      id: 'izacard-2022',
      label: 'Izacard 2022',
      type: 'supports',
      source: {
        paperLabel: 'Paper · arXiv:2208.03299 · Izacard et al. 2022',
        location: '第 4 节第 1 段',
      },
      quote: '"Atlas matches parameter-only models on open-ended generation tasks, with retrieval-augmented variants trailing behind on BLEU by approximately 3 points across our benchmark suite..."',
    },
    'asai-2024': {
      id: 'asai-2024',
      label: 'Asai 2024 · 反驳',
      type: 'contradicts',
      source: {
        paperLabel: 'Paper · arXiv:2310.11511 · Asai et al. 2024',
        location: '第 2 节第 3 段',
      },
      quote: '"We introduce Self-RAG, a framework that enhances an LM\'s quality and factuality through retrieval and self-reflection. Unlike static retrieval, Self-RAG adaptively retrieves and critiques its own generation, recovering much of the open-generation gap..."',
    },
    'karpukhin-2020': {
      id: 'karpukhin-2020',
      label: 'Karpukhin 2020',
      type: 'supports',
      source: {
        paperLabel: 'Paper · arXiv:2004.04906 · Karpukhin et al. 2020',
        location: '第 5 节第 4 段',
      },
      quote: '"Dense Passage Retrieval (DPR) achieves recall@100 of 95.0 on Natural Questions. We further observe that re-ranking via a cross-encoder yields marginal nDCG@10 gains below 1 percentage point at this recall ceiling..."',
    },
  },
}

export const DEMO_SESSION_ID_PREFIX = '__demo__:'
export const DEMO_RAG_SESSION_ID = '__demo__:p4-rag-survey'
