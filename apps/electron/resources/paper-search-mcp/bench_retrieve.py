#!/usr/bin/env python
"""§8 检索基准回归:新 retrieve(塑形+capped+补源) vs 旧式最大 fan-out 基线。

目的:用数字给「Stage 3 收敛后召回是否退化」盖章。固定 query 集 + 固定关键词/源,
去掉规划器(LLM)的不确定性,使 before/after 可复现、可比较。

每个 query 量:
  - 召回:new_distinct vs baseline_distinct(baseline = 每关键词×每源最大 fan-out)
  - top-20 Jaccard:两侧按 F22 relevance 排序的 top-20 handle 集合重合度
  - 墙钟:new vs baseline
  - 补源:new 是否触发 arxiv top-up

⚠️ 打实时 API,需网络。用法:
    cd apps/electron/resources/paper-search-mcp
    uv run python bench_retrieve.py
"""
from __future__ import annotations

import asyncio
import tempfile
import time
from typing import Any

from paper_search.service.search_service import PaperSearchService, source_timeout
from paper_search.service.process_service import process_results_core


# 固定基准 query 集(跨域,各自固定 keywords/terms/sources —— 不经 LLM 规划)
QUERIES: list[dict[str, Any]] = [
    {
        "name": "rag-hallucination",
        "q": "How does retrieval-augmented generation reduce hallucinations in LLMs?",
        "keywords": ["RAG", "retrieval-augmented generation", "hallucination",
                     "factuality", "knowledge grounding"],
        "method_terms": ["RAG", "retrieval-augmented generation", "knowledge grounding"],
        "object_terms": ["large language model", "hallucination", "LLM"],
        "sources": ["openalex", "crossref"],
        "arxiv_categories": ["cs.CL", "cs.LG", "cs.AI"],
    },
    {
        "name": "llm-context-window",
        "q": "Extending the context window of large language models",
        "keywords": ["context window", "position interpolation", "RoPE scaling",
                     "long context", "context extension"],
        "method_terms": ["context window", "position interpolation", "RoPE"],
        "object_terms": ["large language model", "transformer", "LLM"],
        "sources": ["openalex", "crossref"],
        "arxiv_categories": ["cs.CL", "cs.LG", "cs.AI", "stat.ML"],
    },
    {
        "name": "kv-cache-compression",
        "q": "KV cache compression for efficient LLM inference",
        "keywords": ["KV cache", "KV cache compression", "KV cache quantization",
                     "token eviction", "attention sparsity"],
        "method_terms": ["KV cache", "quantization", "sparse attention"],
        "object_terms": ["large language model", "LLM", "inference"],
        "sources": ["openalex", "crossref"],
        "arxiv_categories": ["cs.CL", "cs.LG"],
    },
    {
        "name": "diffusion-text2image",
        "q": "Diffusion models for text-to-image generation",
        "keywords": ["diffusion model", "text-to-image", "latent diffusion",
                     "score-based generative", "denoising diffusion"],
        "method_terms": ["diffusion model", "latent diffusion", "denoising"],
        "object_terms": ["text-to-image", "image generation"],
        "sources": ["openalex", "crossref"],
        "arxiv_categories": ["cs.CV", "cs.LG"],
    },
    {
        "name": "federated-learning-privacy",
        "q": "Privacy-preserving federated learning",
        "keywords": ["federated learning", "differential privacy",
                     "secure aggregation", "privacy-preserving"],
        "method_terms": ["federated learning", "differential privacy", "secure aggregation"],
        "object_terms": ["privacy", "distributed training"],
        "sources": ["openalex", "crossref"],
        "arxiv_categories": ["cs.LG", "cs.CR"],
    },
]


def _handle(rec: dict) -> str:
    e = rec.get("extra") if isinstance(rec.get("extra"), dict) else {}
    return e.get("paper_id") or rec.get("doi") or rec.get("url") or ""


def _rel(rec: dict) -> float:
    v = (rec.get("extra") or {}).get("relevance")
    return float(v) if isinstance(v, (int, float)) else 0.0


async def _baseline(svc: PaperSearchService, q: dict, cfg: str) -> dict:
    """旧式最大 fan-out:每关键词 × 每源,无塑形/无 cap,dedup + F22。"""
    cells = []
    for src in q["sources"]:
        conn = svc.registry.get(src)
        if conn is None:
            continue
        for kw in q["keywords"]:
            cells.append((src, svc._timed_search(src, conn, kw, 10, timeout=source_timeout(src))))
    outs = await asyncio.gather(*[c for _, c in cells], return_exceptions=True)
    by_source: dict[str, list] = {}
    for (src, _), r in zip(cells, outs):
        if isinstance(r, Exception):
            continue
        papers, _e, _s = r
        by_source.setdefault(src, []).extend(papers)
    inputs = [{"source": s, "papers": [p.to_api_dict() for p in ps]} for s, ps in by_source.items()]
    return await process_results_core(
        query=q["q"], inputs=inputs, enrich=False, session_id=f"bench-base-{q['name']}",
        config_dir=cfg, method_terms=q["method_terms"], object_terms=q["object_terms"],
        return_records=True,
    )


async def main() -> None:
    svc = PaperSearchService()
    cfg = tempfile.mkdtemp(prefix="asci-bench-")
    print(f"config_dir={cfg}\n")
    # recall@20:把 new 全量结果 ∪ baseline 结果建成并集池,按 F22 取 top-20 作"地面真值";
    # 分别看 new / baseline 覆盖了多少参照 top-20 —— 量"谁漏了重要论文",而非"检的集合不同"。
    hdr = (f"{'query':<26}{'new':>5}{'base':>6}{'union':>6}"
           f"{'R@20_new':>9}{'R@20_base':>10}{'t_new':>8}{'t_base':>8}  topup")
    print(hdr); print("-" * len(hdr))
    rn, rb = [], []
    for q in QUERIES:
        t0 = time.monotonic()
        new = await svc.retrieve(
            research_question=q["q"], keywords=q["keywords"], sources=q["sources"],
            method_terms=q["method_terms"], object_terms=q["object_terms"],
            arxiv_categories=q["arxiv_categories"], enrich=False, top_k=10_000,
            session_id=f"bench-new-{q['name']}", config_dir=cfg,
        )
        t_new = time.monotonic() - t0
        t0 = time.monotonic()
        base = await _baseline(svc, q, cfg)
        t_base = time.monotonic() - t0

        # 并集池:handle -> 最高 F22 relevance（两侧同一 F22,可比）
        pool: dict[str, float] = {}
        new_handles: set[str] = set()
        for it in new.get("top_k", []):  # top_k=10000 → 全量已排序
            h = it.get("handle")
            if not h:
                continue
            new_handles.add(h)
            pool[h] = max(pool.get(h, 0.0), float(it.get("relevance") or 0.0))
        base_handles: set[str] = set()
        for r in base.get("records", []):
            h = _handle(r)
            if not h:
                continue
            base_handles.add(h)
            pool[h] = max(pool.get(h, 0.0), _rel(r))

        ref_top20 = {h for h, _ in sorted(pool.items(), key=lambda x: -x[1])[:20]}
        r_new = len(ref_top20 & new_handles) / len(ref_top20) if ref_top20 else 1.0
        r_base = len(ref_top20 & base_handles) / len(ref_top20) if ref_top20 else 1.0
        rn.append(r_new); rb.append(r_base)
        print(f"{q['name']:<26}{len(new_handles):>5}{len(base_handles):>6}{len(pool):>6}"
              f"{r_new:>9.2f}{r_base:>10.2f}{t_new:>7.1f}s{t_base:>7.1f}s  {new.get('arxiv_top_up')}")

    n = len(rn) or 1
    print("-" * len(hdr))
    print(f"{'MEAN':<43}{sum(rn)/n:>9.2f}{sum(rb)/n:>10.2f}")
    print("\n判读(需稳定网络才可信):")
    print("  R@20_new ≈ R@20_base 且都接近 1.0 → 新链路没漏重要论文,召回未退。")
    print("  R@20_new 明显 < R@20_base → 塑形/cap 漏了基线能找到的重要论文,调 per_source_cap / 补源阈值。")
    print("  R@20_new > R@20_base → 新链路(含 arxiv 补源)反而覆盖更全。")


if __name__ == "__main__":
    asyncio.run(main())
