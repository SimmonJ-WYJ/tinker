"""Integration tests for PaperSearchService.retrieve — Stage 3 确定性检索内核。

用 fake registry/connector(无网络)验证 retrieve 把"第 3+4+5a 步"合成一次代码调用:
  · 按 build_query_matrix 塑形并 fan-out(arxiv 不被盲发);
  · 复用 process_results_core 去重 + F22 打分 + 写 JSONL;
  · 返回 process_search_results 的统计字段 + 按 relevance 降序的 top_k。
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

from .search_service import PaperSearchService
from ..models.paper import Paper


def _run(coro):
    return asyncio.run(coro)


def _paper(pid: str, title: str, *, doi: str = "", abstract: str = "abs",
           source: str = "") -> Paper:
    return Paper(
        paper_id=pid, title=title, doi=doi, abstract=abstract,
        published_date=datetime(2024, 1, 1), source=source,
    )


class _FakeConnector:
    """记录收到的查询,返回固定 papers。"""

    def __init__(self, papers: list[Paper]):
        self._papers = papers
        self.queries: list[tuple[str, dict]] = []

    def search(self, query: str, max_results: int = 10, **kwargs):
        self.queries.append((query, kwargs))
        return list(self._papers)


class _FakeRegistry:
    def __init__(self, mapping: dict[str, _FakeConnector]):
        self._m = mapping

    def get(self, name: str):
        return self._m.get(name)


def test_retrieve_returns_ranked_topk_and_stats(tmp_path: Path) -> None:
    oa = _FakeConnector([
        _paper("oa1", "Sparse attention for large language model inference", source="openalex"),
        _paper("oa2", "A study of context window in transformer LLM", source="openalex"),
    ])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))

    res = _run(svc.retrieve(
        research_question="how to handle limited context window in LLMs",
        keywords=["context window", "sparse attention"],
        sources=["openalex"],
        method_terms=["context window", "sparse attention"],
        object_terms=["LLM", "large language model"],
        enrich=False,
        session_id="sess-retrieve",
        config_dir=str(tmp_path),
    ))

    # 统计字段在(计数语义兼容)
    for k in ("new_records", "display_count", "duplicates_removed", "turn_id", "top_k"):
        assert k in res, f"缺字段 {k}"
    assert res["new_records"] == 2
    # top_k 按 relevance 降序
    rels = [p["relevance"] for p in res["top_k"]]
    assert rels == sorted(rels, reverse=True)
    assert {p["handle"] for p in res["top_k"]} == {"oa1", "oa2"}


def test_retrieve_shapes_arxiv_not_blasted(tmp_path: Path) -> None:
    """arxiv 只收到 ≤ arxiv_cap 个宽查询(裸关键词 + categories),不盲发全部关键词。"""
    arx = _FakeConnector([_paper("ax1", "LongRoPE context window", source="arxiv")])
    svc = PaperSearchService(registry=_FakeRegistry({"arxiv": arx}))

    _run(svc.retrieve(
        research_question="q",
        keywords=["context window", "context compression", "sliding window", "KV cache"],
        sources=["arxiv"],
        arxiv_categories=["cs.CL", "cs.LG"],
        object_terms=["LLM"],
        enrich=False,
        session_id="sess-arxiv",
        config_dir=str(tmp_path),
    ))

    assert len(arx.queries) <= 2, f"arxiv 被盲发了 {len(arx.queries)} 次"
    for q, kwargs in arx.queries:
        assert kwargs.get("categories") == ["cs.CL", "cs.LG"]
        assert q.lower().startswith("llm ")  # 2b:arxiv 锚版优先,收紧到对题域


def test_retrieve_dedupes_across_sources(tmp_path: Path) -> None:
    """同一篇(同 DOI)从两个源召回 → 去重后只算一条。"""
    same = dict(title="Identical Paper on LLM Context", doi="10.1/same")
    oa = _FakeConnector([_paper("oa-x", source="openalex", **same)])
    cr = _FakeConnector([_paper("cr-x", source="crossref", **same)])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa, "crossref": cr}))

    res = _run(svc.retrieve(
        research_question="q",
        keywords=["context"],
        sources=["openalex", "crossref"],
        object_terms=["LLM"],
        enrich=False,
        session_id="sess-dedup",
        config_dir=str(tmp_path),
    ))
    assert res["new_records"] == 1, f"跨源同篇应去重为 1,实际 {res['new_records']}"


def test_retrieve_arxiv_topup_when_under_threshold(tmp_path: Path, monkeypatch) -> None:
    """requested 源召回不足且 sources 未含 arxiv → 自动补一轮 arxiv 宽查询合并。"""
    # 本测试验证补源/合并，与 F22 进判分窗口的阈值无关 → 阈值置 0 让 mock 论文全进 top_k
    from . import search_service as _ss
    monkeypatch.setattr(_ss, "TOPK_F22_THRESHOLD", 0.0)
    oa = _FakeConnector([_paper("oa1", "RAG reduces LLM hallucination", source="openalex")])
    arx = _FakeConnector([
        _paper("ax1", "Self-RAG: retrieval and self-reflection", source="arxiv"),
        _paper("ax2", "Active retrieval augmented generation", source="arxiv"),
    ])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa, "arxiv": arx}))

    res = _run(svc.retrieve(
        research_question="RAG hallucination",
        keywords=["retrieval augmented generation", "hallucination"],
        sources=["openalex"],  # 未含 arxiv
        object_terms=["LLM"],
        arxiv_categories=["cs.CL"],
        enrich=False,
        session_id="sess-topup",
        config_dir=str(tmp_path),
    ))
    assert res["arxiv_top_up"] is True, "openalex 仅 1 篇 < 阈值,应触发 arxiv 补源"
    assert len(arx.queries) >= 1, "arxiv 连接器应被补源查询调用"
    # arxiv 补源也走 build_query_matrix,2b 下锚版优先(带 categories)
    for q, kwargs in arx.queries:
        assert kwargs.get("categories") == ["cs.CL"]
        assert q.lower().startswith("llm ")
    assert res["new_records"] == 3  # oa1 + ax1 + ax2 去重后
    assert {p["handle"] for p in res["top_k"]} == {"oa1", "ax1", "ax2"}


def test_retrieve_no_topup_when_arxiv_absent_from_registry(tmp_path: Path) -> None:
    """召回不足但 registry 无 arxiv 连接器 → 不补源(no-op),不报错。"""
    oa = _FakeConnector([_paper("oa1", "RAG hallucination", source="openalex")])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    res = _run(svc.retrieve(
        research_question="q", keywords=["RAG"], sources=["openalex"],
        object_terms=["LLM"], enrich=False, session_id="s", config_dir=str(tmp_path),
    ))
    assert res["arxiv_top_up"] is False
    assert res["new_records"] == 1


def test_retrieve_topk_window_is_f22_threshold_not_fixed_rank(tmp_path: Path, monkeypatch) -> None:
    """进 LLM 判分窗口的是 F22 relevance > 阈值的动态集合，而非固定前 N 名。
    阈值设到没有论文能过线时 top_k 为空（绝对阈值，不硬凑数量）。"""
    from . import search_service as _ss
    oa = _FakeConnector([
        _paper("oa1", "context window in large language model", source="openalex"),
        _paper("oa2", "sparse attention for LLM inference", source="openalex"),
    ])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    monkeypatch.setattr(_ss, "TOPK_F22_THRESHOLD", 999.0)  # 无人过线
    res = _run(svc.retrieve(
        research_question="context window in LLMs", keywords=["context window"],
        sources=["openalex"], object_terms=["LLM"], enrich=False,
        session_id="s-thr", config_dir=str(tmp_path),
    ))
    assert res["top_k"] == [], "F22 无人过阈值 → 判分窗口为空"


def test_retrieve_topk_caps_qualified_pool(tmp_path: Path, monkeypatch) -> None:
    """top_k 退化为防爆上限：F22>阈值的论文超过 cap 时按 F22 降序截断到 cap。"""
    from . import search_service as _ss
    # 5 篇语义不同但都对题（标题仅差数字会被去重合并，故用不同措辞）
    oa = _FakeConnector([
        _paper("oa0", "context window extension for large language model", source="openalex"),
        _paper("oa1", "sparse attention in large language model inference", source="openalex"),
        _paper("oa2", "KV cache compression for large language model long context", source="openalex"),
        _paper("oa3", "retrieval augmentation for large language model", source="openalex"),
        _paper("oa4", "efficient large language model serving", source="openalex"),
    ])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    monkeypatch.setattr(_ss, "TOPK_F22_THRESHOLD", 0.0)  # 全部过线，纯测 cap
    res = _run(svc.retrieve(
        research_question="large language model efficiency", keywords=["large language model"],
        sources=["openalex"], object_terms=["LLM"], enrich=False,
        top_k=2, session_id="s-cap", config_dir=str(tmp_path),
    ))
    assert len(res["top_k"]) == 2, "超 cap 应按 F22 降序截断到 cap"


def test_retrieve_empty_keywords_errors(tmp_path: Path) -> None:
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": _FakeConnector([])}))
    res = _run(svc.retrieve(
        research_question="q", keywords=["", "   "], sources=["openalex"],
        enrich=False, session_id="s", config_dir=str(tmp_path),
    ))
    assert "error" in res


# ===== required_seeds (#614)：seed 精确查回 + force include + seed_recall =====

import json as _json


class _RaisingConnector:
    """search 抛指定异常，模拟 429 / 超时；用于验证单源异常隔离。"""

    def __init__(self, exc: Exception):
        self._exc = exc
        self.queries: list[tuple[str, dict]] = []

    def search(self, query: str, max_results: int = 10, **kwargs):
        self.queries.append((query, kwargs))
        raise self._exc


class _CrossrefByDoiConnector(_FakeConnector):
    """带 get_paper_by_doi 直连的 crossref fake（/works/{doi} 路径）。"""

    def __init__(self, papers: list[Paper], by_doi: dict[str, Paper] | None = None):
        super().__init__(papers)
        self._by_doi = {k.lower(): v for k, v in (by_doi or {}).items()}
        self.doi_queries: list[str] = []

    def get_paper_by_doi(self, doi: str):
        self.doi_queries.append(doi)
        return self._by_doi.get((doi or "").lower())


def _read_jsonl(tmp_path: Path, session_id: str) -> list[dict]:
    p = Path(tmp_path) / "agent-sessions-papers" / f"{session_id}.jsonl"
    if not p.exists():
        return []
    return [_json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def test_resolve_seed_continues_to_crossref_when_openalex_raises_429() -> None:
    """单源异常隔离（AC）：openalex 抛 429 时，crossref DOI 直连仍能查回，seed 不阵亡。"""
    target = "10.1126/science.1225829"
    paper = _paper("cr-1", "A programmable dual-RNA-guided DNA endonuclease",
                   doi=target, source="crossref")
    oa = _RaisingConnector(RuntimeError("429 rate limited"))
    cr = _CrossrefByDoiConnector([], by_doi={target: paper})
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa, "crossref": cr}))

    resolved = _run(svc._resolve_seed({"id": f"doi:{target}", "title": "x"}))
    assert resolved is not None, "openalex 429 不应让整条 seed 解析阵亡"
    p, strat = resolved
    assert strat == "doi"
    assert p.doi == target
    assert oa.queries, "openalex 应被尝试过（随后被隔离）"
    assert cr.doi_queries, "crossref /works/{doi} 直连应被作为 fallback 调用"

    # _force_include_seeds 层：verified==1 且 seed_keys 含该 DOI
    seed_recall, seed_keys = _run(
        svc._force_include_seeds([{"id": f"doi:{target}", "title": "x"}], {})
    )
    assert seed_recall["verified"] == 1
    assert target.lower() in seed_keys


def test_resolve_seed_by_doi() -> None:
    """阶段 1（DOI 身份级）：openalex search 命中归一 DOI → strategy='doi'。"""
    target = "10.1/abc"
    oa = _FakeConnector([_paper("oa-1", "Some Paper", doi=target, source="openalex")])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    resolved = _run(svc._resolve_seed({"id": f"doi:{target}", "title": ""}))
    assert resolved is not None and resolved[1] == "doi"


def test_resolve_seed_by_exact_title() -> None:
    """阶段 2（exact title）：归一标题精确相等 → strategy='exact_title'。"""
    title = "LoRA: Low-Rank Adaptation of Large Language Models"
    oa = _FakeConnector([_paper("oa-lora", title, source="openalex")])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    resolved = _run(svc._resolve_seed({"id": "", "title": title}))
    assert resolved is not None and resolved[1] == "exact_title"


def test_resolve_seed_by_arxiv_fallback() -> None:
    """阶段 3（arXiv 兜底）：无 DOI、无 title，仅 arxiv id → strategy='arxiv_id'。"""
    arx = _FakeConnector([_paper("ax1", "LoRA paper on arxiv", source="arxiv")])
    svc = PaperSearchService(registry=_FakeRegistry({"arxiv": arx}))
    resolved = _run(svc._resolve_seed({"id": "arxiv:2106.09685", "title": ""}))
    assert resolved is not None and resolved[1] == "arxiv_id"


def test_force_include_seeds_missing_when_unresolvable() -> None:
    """全源查不到 → 进 missing，verified=0，seed_keys 为空。"""
    oa = _FakeConnector([])  # 任何查询都返回空
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    seed_recall, seed_keys = _run(
        svc._force_include_seeds(
            [{"id": "doi:10.0/nope", "title": "Nonexistent Paper Title"}], {}
        )
    )
    assert seed_recall["verified"] == 0
    assert seed_recall["total"] == 1
    assert seed_recall["missing"] == ["doi:10.0/nope"]
    assert not seed_keys


# ===== planner-proactive seeds（#646，origin="model"：title-only + exact-only + 静默 miss）=====


def test_resolve_seed_exact_only_rejects_fuzzy() -> None:
    """#646 防线2：exact_only=True 时近似（prefix）标题不再 fuzzy 命中 → None；
    同输入在 exact_only=False 下仍 fuzzy 命中，证明差异只在 exact_only 开关。"""
    want = "deep residual learning for image"
    cand = _paper("oa-resnet", "Deep Residual Learning for Image Recognition", source="openalex")
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": _FakeConnector([cand])}))

    loose = _run(svc._resolve_seed({"id": "", "title": want}))
    assert loose is not None and loose[1] == "fuzzy_title", "user 路径应 fuzzy 命中前缀近似标题"

    strict = _run(svc._resolve_seed({"id": "", "title": want}, exact_only=True))
    assert strict is None, "exact_only 应拒绝 fuzzy 命中（防幻觉标题误配）"


def test_proactive_seed_miss_silent() -> None:
    """#646 防线3：origin=model 查不到时静默 —— 不进 missing、user 队列 total=0、
    proactive_total 计数但不触发 incomplete_retrieval。"""
    oa = _FakeConnector([])  # 任何查询返回空
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    seed_recall, seed_keys = _run(
        svc._force_include_seeds(
            [{"id": "", "title": "Nonexistent Foundational Paper", "origin": "model"}], {}
        )
    )
    assert seed_recall["missing"] == []        # 静默，不计入 missing
    assert seed_recall["total"] == 0           # user 队列为空 → incomplete_retrieval 不触发
    assert seed_recall["proactive_total"] == 1
    assert seed_recall["proactive_verified"] == 0
    assert not seed_keys


def test_proactive_seed_verified_force_included_and_marked() -> None:
    """#646：origin=model exact 命中 → proactive_verified=1、进 seed_keys（后续标 extra.seed）、
    并入 by_source；不污染 user 队列 total。"""
    title = "Attention Is All You Need"
    oa = _FakeConnector([_paper("oa-attn", title, doi="10.9/attn", source="openalex")])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    by_source: dict = {}
    seed_recall, seed_keys = _run(
        svc._force_include_seeds([{"id": "", "title": title, "origin": "model"}], by_source)
    )
    assert seed_recall["proactive_verified"] == 1
    assert seed_recall["proactive_total"] == 1
    assert seed_recall["total"] == 0
    assert "10.9/attn" in seed_keys
    assert title.lower() in seed_keys
    assert any(p.title == title for ps in by_source.values() for p in ps)


def test_proactive_seed_ignores_fabricated_id() -> None:
    """#646 防线2：origin=model 即便带 id，服务端忽略 id、只按 title 解析（幻觉 id 零危害）。
    构造 id 指向 A、title 指向 B → 命中 B，且不触发 DOI 直连。"""
    title_b = "Generative Adversarial Nets"
    paper_a = _paper("A", "WRONG Paper A", doi="10.0/fake", source="crossref")
    paper_b = _paper("B", title_b, source="openalex")
    cr = _CrossrefByDoiConnector([], by_doi={"10.0/fake": paper_a})
    oa = _FakeConnector([paper_b])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa, "crossref": cr}))
    by_source: dict = {}
    seed_recall, _ = _run(
        svc._force_include_seeds(
            [{"id": "doi:10.0/fake", "title": title_b, "origin": "model"}], by_source
        )
    )
    assert seed_recall["proactive_verified"] == 1
    hit_titles = [p.title for ps in by_source.values() for p in ps]
    assert title_b in hit_titles, "应按 title 命中 B"
    assert "WRONG Paper A" not in hit_titles, "不应按伪造 id 命中 A"
    assert not cr.doi_queries, "model 路径忽略 id，不应触发 crossref DOI 直连"


def test_resolve_seed_doi_normalization() -> None:
    """DOI 归一（AC）：seed 给带 https://doi.org/ 前缀的 DOI 也能命中裸 DOI。"""
    target = "10.1126/science.1225829"
    paper = _paper("cr1", "CRISPR paper", doi=target, source="crossref")
    cr = _CrossrefByDoiConnector([], by_doi={target: paper})
    svc = PaperSearchService(registry=_FakeRegistry({"crossref": cr}))
    resolved = _run(svc._resolve_seed(
        {"id": "https://doi.org/10.1126/science.1225829", "title": ""}
    ))
    assert resolved is not None and resolved[1] == "doi"
    assert resolved[0].doi == target


def test_parse_required_seeds_invalid_json() -> None:
    """非法 JSON → 明确 error，不静默（AC）。"""
    from ..transports.mcp_server import _parse_required_seeds
    seeds, err = _parse_required_seeds("{not valid json")
    assert seeds == []
    assert err and "解析失败" in err


def test_parse_required_seeds_not_array() -> None:
    """非数组 → 明确 error（AC）。"""
    from ..transports.mcp_server import _parse_required_seeds
    seeds, err = _parse_required_seeds('{"id": "x"}')
    assert seeds == []
    assert err and "数组" in err


def test_parse_required_seeds_ok() -> None:
    """对象 / 纯字符串项都被归一为 {id,title,origin}；origin 缺省为 user。"""
    from ..transports.mcp_server import _parse_required_seeds
    seeds, err = _parse_required_seeds(
        '[{"id":"arxiv:2106.09685","title":"LoRA"}, "doi:10.1/x", "Bare Title"]'
    )
    assert err is None
    assert seeds[0] == {"id": "arxiv:2106.09685", "title": "LoRA", "origin": "user"}
    assert seeds[1] == {"id": "doi:10.1/x", "title": "", "origin": "user"}
    assert seeds[2] == {"id": "", "title": "Bare Title", "origin": "user"}


def test_parse_required_seeds_origin() -> None:
    """#646：origin 解析 —— 显式 model 保留，缺省 / 脏值 / 纯字符串项一律归一为 user。"""
    from ..transports.mcp_server import _parse_required_seeds
    seeds, err = _parse_required_seeds(
        '[{"id":"","title":"A","origin":"model"}, {"title":"B"}, '
        '{"title":"C","origin":"garbage"}, "Bare"]'
    )
    assert err is None
    assert seeds[0]["origin"] == "model"   # 显式 model 保留
    assert seeds[1]["origin"] == "user"    # 缺省
    assert seeds[2]["origin"] == "user"    # 脏值归一
    assert seeds[3]["origin"] == "user"    # 纯字符串项


def test_retrieve_marks_extra_seed_and_seed_recall(tmp_path: Path, monkeypatch) -> None:
    """端到端（AC）：retrieve(required_seeds=...) → seed_recall.verified>=1，
    JSONL 中 seed 论文落盘且 extra.seed=true。"""
    from . import search_service as _ss
    monkeypatch.setattr(_ss, "TOPK_F22_THRESHOLD", 0.0)
    seed_title = "LoRA: Low-Rank Adaptation of Large Language Models"
    oa = _FakeConnector([
        _paper("oa-seed", seed_title, doi="10.5/lora", source="openalex"),
        _paper("oa-other", "Unrelated paper on cooking", source="openalex"),
    ])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))

    res = _run(svc.retrieve(
        research_question="parameter efficient fine-tuning",
        keywords=["parameter efficient fine-tuning"],
        sources=["openalex"],
        enrich=False,
        required_seeds=[{"id": "arxiv:2106.09685", "title": seed_title}],
        session_id="s-seed",
        config_dir=str(tmp_path),
    ))

    assert "seed_recall" in res
    assert res["seed_recall"]["verified"] >= 1
    assert res["seed_recall"]["total"] == 1
    assert res["incomplete_retrieval"] is False

    recs = _read_jsonl(tmp_path, "s-seed")
    seeded = [r for r in recs if (r.get("extra") or {}).get("seed") is True]
    assert any(r["title"] == seed_title for r in seeded), \
        "seed 论文应落盘且 extra.seed=true"
    assert all(r["title"] != "Unrelated paper on cooking" for r in seeded), \
        "非 seed 论文不应被标 seed"


def test_retrieve_without_seeds_no_seed_recall_keys(tmp_path: Path) -> None:
    """不传 required_seeds → 返回结构与改动前一致（无 seed_recall/incomplete_retrieval 键，AC #1）。"""
    oa = _FakeConnector([_paper("oa1", "context window in large language model", source="openalex")])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))
    res = _run(svc.retrieve(
        research_question="q", keywords=["context window"], sources=["openalex"],
        object_terms=["LLM"], enrich=False, session_id="s-noseed", config_dir=str(tmp_path),
    ))
    assert "seed_recall" not in res
    assert "incomplete_retrieval" not in res


# ===== seed 保护进 top_k / scorer 判分窗口（#615，F22 gate bypass）=====


def test_retrieve_seed_enters_topk_below_f22_threshold(tmp_path: Path, monkeypatch) -> None:
    """#615 AC：F22 低于阈值的 seed 仍进 top_k；同分布非 seed 低分被截断。

    阈值抬到 999（无人靠 F22 过线）→ top_k 里出现的论文只能来自 seed bypass。"""
    from . import search_service as _ss
    monkeypatch.setattr(_ss, "TOPK_F22_THRESHOLD", 999.0)
    seed_title = "LoRA: Low-Rank Adaptation of Large Language Models"
    oa = _FakeConnector([
        _paper("oa-seed", seed_title, doi="10.5/lora", source="openalex"),
        _paper("oa-non", "Unrelated paper on cooking recipes", source="openalex"),
    ])
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))

    res = _run(svc.retrieve(
        research_question="parameter efficient fine-tuning",
        keywords=["parameter efficient fine-tuning"],
        sources=["openalex"], enrich=False,
        required_seeds=[{"id": "", "title": seed_title}],
        session_id="s-seed-topk", config_dir=str(tmp_path),
    ))

    titles = {p["title"] for p in res["top_k"]}
    assert seed_title in titles, "F22 低于阈值的 seed 应绕过 F22 门进 top_k"
    assert "Unrelated paper on cooking recipes" not in titles, \
        "同分布非 seed 低 F22 论文应被正常截断"


def test_retrieve_seed_preserved_when_over_cap(tmp_path: Path, monkeypatch) -> None:
    """#615 AC：seed 并入后超 cap 时，截断顺序明确且 seed 优先保留。

    确定性地直测门控：stub process_results_core 返回手工 records —— seed 给最低 F22(10)、
    三篇非 seed 给高分(90/80/70)，cap=2。旧逻辑 sorted(F22)[:2] 会把低分 seed 截掉只留
    非 seed；新逻辑超 cap 时先放 seed，被截断的只会是最低分非 seed。"""
    from . import process_service as _ps

    def _rec(handle: str, rel: float, *, seed: bool = False) -> dict:
        extra = {"relevance": rel, "paper_id": handle}
        if seed:
            extra["seed"] = True
        return {"title": handle, "doi": "", "url": f"u/{handle}",
                "year": 2024, "venue": "", "extra": extra}

    fake_records = [
        _rec("seed-low", 10, seed=True),  # F22 远低于阈值，仅靠 seed bypass 进窗
        _rec("non-a", 90), _rec("non-b", 80), _rec("non-c", 70),
    ]

    async def _fake_core(**kwargs):
        return {
            "records": [dict(r, extra=dict(r["extra"])) for r in fake_records],
            "new_records": 4, "display_count": 4, "duplicates_removed": 0,
            "turn_id": "t1", "output_path": None,
        }

    # 延迟导入点是 process_service.process_results_core，patch 模块属性即可拦截
    monkeypatch.setattr(_ps, "process_results_core", _fake_core)
    oa = _FakeConnector([_paper("x", "x", source="openalex")])  # 仅供 fan-out 不报空
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))

    # 默认阈值 50：非 seed(90/80/70) 过线，seed(10) 不过线但靠 bypass 进 qualified
    res = _run(svc.retrieve(
        research_question="q", keywords=["llm"], sources=["openalex"],
        enrich=False, top_k=2, session_id="s-seed-cap", config_dir=str(tmp_path),
    ))

    handles = [p["handle"] for p in res["top_k"]]
    assert len(handles) == 2, "cap=2 应截断到 2 篇"
    assert "seed-low" in handles, "超 cap 截断时低 F22 的 seed 应优先保留（旧逻辑会丢）"
    assert "non-c" not in handles, "被截断的应是最低分非 seed"
