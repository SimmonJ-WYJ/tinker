"""Tests for build_query_matrix — 把"第 3 步 用关键词调 API"从 LLM 子 Agent
降级为确定性代码的核心:按源塑形查询、跳过已知死格。

依据线上 dump 的实测教训:
- arxiv 全文检索对多词短语命中差(`context window`→10,但 `context compression`/
  `sliding window`/`KV cache`/`attention sink` 全 0),且有 3s/req 串行节流 →
  arxiv 只发少量宽查询(headline 关键词 + categories),不盲发全部关键词。
- openalex/crossref 需要对象锚定:`LLM <term>` 才有命中,裸 `<term>` 常 0 →
  这两源的查询统一加对象锚(object anchor)前缀。
- 不再对三个源盲发笛卡尔积(run2 实测 18 个查询里 9 个返回 0)。
"""
from __future__ import annotations

from .search_service import build_query_matrix


def _by_source(matrix: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for e in matrix:
        out.setdefault(e["source"], []).append(e)
    return out


def test_arxiv_anchored_queries_with_categories() -> None:
    """arxiv(2b 锚版优先):数量受 arxiv_cap 限,带 categories,有锚且 kw 未含锚时
    发锚版 `<anchor> <kw>`(收紧到对题域,避免裸泛词宽匹配引入跨域噪声)。"""
    m = build_query_matrix(
        ["context window", "context compression", "sliding window", "KV cache"],
        sources=["arxiv"],
        object_terms=["LLM"],
        arxiv_categories=["cs.CL", "cs.LG"],
        arxiv_cap=2,
    )
    arx = _by_source(m).get("arxiv", [])
    assert 1 <= len(arx) <= 2, f"arxiv 查询数应 ≤ arxiv_cap=2,实际 {len(arx)}"
    for e in arx:
        assert e["kwargs"].get("categories") == ["cs.CL", "cs.LG"]
        # 2b:kw 未含锚 → 锚版优先,query 以锚前缀打头
        assert e["query"].lower().startswith("llm "), f"arxiv 应走锚版,实际 {e['query']!r}"
    # headline 关键词以锚版形式在内
    assert any(e["query"] == "LLM context window" for e in arx)


def test_openalex_crossref_get_raw_and_anchored() -> None:
    """openalex/crossref:每个关键词发「裸版」+「对象锚版」两版。"""
    m = build_query_matrix(
        ["context compression", "KV cache"],
        sources=["openalex", "crossref"],
        object_terms=["LLM"],
    )
    by = _by_source(m)
    for src in ("openalex", "crossref"):
        qs = {e["query"] for e in by.get(src, [])}
        # 裸版(保召回)
        assert "context compression" in qs, f"{src} 缺裸版,实际 {qs}"
        assert "KV cache" in qs
        # 对象锚版(保精度)
        assert "LLM context compression" in qs, f"{src} 缺锚版,实际 {qs}"
        assert "LLM KV cache" in qs


def test_anchor_skipped_when_keyword_already_contains_it() -> None:
    """防冗余:关键词已含锚词 → 只发裸版,不产 "<anchor> <anchor>..." 重复。
    锚取最具体:object_terms=["differential privacy","privacy"] → 锚="differential privacy"。"""
    m = build_query_matrix(
        ["differential privacy", "federated learning"],
        sources=["openalex"], object_terms=["differential privacy", "privacy"],
    )
    qs = {e["query"] for e in _by_source(m)["openalex"]}
    assert "differential privacy" in qs                            # 裸版
    assert "differential privacy differential privacy" not in qs   # 含锚 → 不重复锚
    assert "federated learning" in qs                              # 裸版
    assert "differential privacy federated learning" in qs         # 不含锚 → 锚版保留


def test_no_full_cartesian_blowup() -> None:
    """不盲发笛卡尔积:总查询数远小于 keywords × sources。"""
    kws = ["a", "b", "c", "d", "e", "f"]
    m = build_query_matrix(
        kws, sources=["arxiv", "openalex", "crossref"],
        object_terms=["LLM"], per_source_cap=5, arxiv_cap=2,
    )
    # arxiv≤2 + openalex≤10(5 关键词×裸+锚)+1(精确核心词 LLM 全量 cell)
    #   + crossref≤10 = ≤23,而非笛卡尔积爆炸
    assert len(m) <= 23
    assert len(_by_source(m).get("arxiv", [])) <= 2
    # openalex:10 个关键词 cell + 每个 object_term 1 个 title_exhaust cell
    assert len(_by_source(m).get("openalex", [])) <= 10 + 1
    assert len(_by_source(m).get("crossref", [])) <= 10


def test_openalex_multi_anchor_all_object_terms() -> None:
    """多锚(spec B):openalex 每个关键词对【全部】object_term(≤ANCHOR_CAP)各发
    一份锚版,而非只用单个最具体锚。降低"锚选谁"的单点敏感性。"""
    m = build_query_matrix(
        ["deep learning"],
        sources=["openalex"],
        object_terms=["light field microscopy", "depth of field", "computational microscopy"],
    )
    qs = {e["query"] for e in _by_source(m)["openalex"]}
    # 三个 object_term 各自都有锚版(不再只有最具体那个)
    assert "light field microscopy deep learning" in qs
    assert "depth of field deep learning" in qs
    assert "computational microscopy deep learning" in qs
    assert "deep learning" in qs  # 裸版仍在(保召回)


def test_multi_anchor_capped_most_specific_first() -> None:
    """ANCHOR_CAP 截断时优先保留最具体(token 最多)的 object_term 作锚。
    默认 cap=3:4/3/2 token 的留锚版,1 token 的被截断。"""
    from .search_service import QUERY_MATRIX_ANCHOR_CAP

    m = build_query_matrix(
        ["x"], sources=["openalex"],
        object_terms=["aa bb cc dd", "ee ff gg", "hh ii", "jj"],  # 4/3/2/1 token
    )
    anchored = {
        e["query"] for e in _by_source(m)["openalex"]
        if e["query"].endswith(" x") and e["kwargs"].get("mode") != "title_exhaust"
    }
    assert len(anchored) == QUERY_MATRIX_ANCHOR_CAP  # 恰好 cap 份锚版
    assert "aa bb cc dd x" in anchored  # 最具体,保留
    assert "jj x" not in anchored       # 最泛(1 token),被 cap 截断


def test_arxiv_uses_single_most_specific_anchor() -> None:
    """arxiv 节流严格,仍用【单个】最具体锚(不走多锚),避免请求膨胀。"""
    m = build_query_matrix(
        ["deep learning"],
        sources=["arxiv"],
        object_terms=["microscopy", "light field microscopy", "depth of field"],
        arxiv_cap=2,
    )
    qs = {e["query"] for e in _by_source(m)["arxiv"]}
    assert "light field microscopy deep learning" in qs  # 单锚 = 最具体(3 token)
    assert "microscopy deep learning" not in qs          # 泛词不当锚
    assert "depth of field deep learning" not in qs      # arxiv 不发第二个锚版


def test_no_anchor_when_no_object_terms() -> None:
    """没有 object_terms 时,openalex/crossref 用裸关键词(不硬塞锚)。"""
    m = build_query_matrix(
        ["sparse attention"], sources=["openalex"], object_terms=None,
    )
    assert _by_source(m)["openalex"][0]["query"] == "sparse attention"


def test_unrequested_source_absent_and_empty_keywords() -> None:
    """未请求的源不出现;空/全空白关键词 → 空矩阵。"""
    m = build_query_matrix(["x"], sources=["openalex"], object_terms=["LLM"])
    assert all(e["source"] == "openalex" for e in m)
    assert build_query_matrix([], sources=["openalex", "arxiv"]) == []
    assert build_query_matrix(["  ", ""], sources=["openalex"]) == []


def test_dedupe_identical_cells() -> None:
    """重复关键词去重:大小写不敏感折叠成一个关键词,产出裸版 + 锚版各一,无重复格。"""
    m = build_query_matrix(
        ["KV cache", "kv cache", "KV cache"],
        sources=["openalex"], object_terms=["LLM"],
    )
    queries = [e["query"] for e in _by_source(m)["openalex"]]
    assert len(queries) == len(set(queries))  # 无重复 (source,query) 格
    # 裸 + 锚 + 精确核心词全量 cell(object_term "LLM")
    assert set(queries) == {"KV cache", "LLM KV cache", "LLM"}


# ── 精确核心词全量召回(spec: lit-search-precise-core-exhaustion)─────────────


def _exhaust_cells(matrix: list[dict]) -> list[dict]:
    return [e for e in matrix if e["kwargs"].get("mode") == "title_exhaust"]


def test_precise_core_adds_title_exhaust_cell_per_object_term() -> None:
    """openalex 在源里时,每个 object_term 追加一条 title_exhaust 全量 cell,
    带 core_threshold,且 max_results 用 HARD_CAP(非默认 cap=10)。"""
    from .search_service import PRECISE_CORE_COUNT_THRESHOLD, PRECISE_CORE_HARD_CAP

    m = build_query_matrix(
        ["deep learning"],
        sources=["openalex"],
        object_terms=["light field microscopy", "computational microscopy"],
        max_results=10,
    )
    ex = _exhaust_cells(m)
    assert {e["query"] for e in ex} == {"light field microscopy", "computational microscopy"}
    for e in ex:
        assert e["source"] == "openalex"
        assert e["kwargs"]["core_threshold"] == PRECISE_CORE_COUNT_THRESHOLD
        assert e["max_results"] == PRECISE_CORE_HARD_CAP  # 全量上限,非 10
        # 泛词兜底量 = 裸 cell 的 cap(顶替后泛词召回不归零,review #553 P1)
        assert e["kwargs"]["generic_fallback"] == 10


def test_precise_core_only_for_openalex() -> None:
    """title_exhaust 只给 openalex;crossref/arxiv 不加全量 cell。"""
    m = build_query_matrix(
        ["deep learning"],
        sources=["crossref", "arxiv"],
        object_terms=["light field microscopy"],
    )
    assert _exhaust_cells(m) == []


def test_precise_core_term_cap_most_specific_first() -> None:
    """object_terms 超过 TERM_CAP 时只保留前 N 个最具体的(token 多者优先)——
    防规划层 LLM 给 6–8 个词时同样多条 25s exhaust cell 拉爆尾延迟(review #553 P2)。"""
    from .search_service import PRECISE_CORE_TERM_CAP

    terms = [
        "imaging",                                  # 1 token,最泛
        "volumetric imaging",                       # 2
        "computational microscopy",                 # 2
        "light field microscopy",                   # 3
        "extended depth of field",                  # 4
        "deep learning light field microscopy",     # 5,最具体
    ]
    m = build_query_matrix(
        ["deep learning"], sources=["openalex"], object_terms=terms,
    )
    ex = _exhaust_cells(m)
    assert len(ex) == PRECISE_CORE_TERM_CAP
    # 截断保留最具体的:1-token 的 "imaging" 必须被挤出(默认 cap=4,6 词去尾 2)
    assert "imaging" not in {e["query"] for e in ex}
    # 排序最具体优先
    assert ex[0]["query"] == "deep learning light field microscopy"


def test_precise_core_supersedes_bare_openalex_cell() -> None:
    """object_term 与某裸关键词 cell 同 query 时,exhaust cell 顶替裸 cell
    (同 query 不重复,且该 query 变成 title_exhaust)。"""
    m = build_query_matrix(
        ["light field microscopy", "deep learning"],  # 关键词里也有 "light field microscopy"
        sources=["openalex"],
        object_terms=["light field microscopy"],
    )
    oa = _by_source(m)["openalex"]
    lfm = [e for e in oa if e["query"] == "light field microscopy"]
    assert len(lfm) == 1  # 不重复
    assert lfm[0]["kwargs"].get("mode") == "title_exhaust"  # 被 exhaust 顶替


# ── method_terms 有限并入召回 query 池(#617)──────────────────────────────────


def test_method_terms_merged_into_query_pool_deduped_and_capped() -> None:
    """#617:method_terms 与 keywords 去重合并进召回 query 池,最多额外并入 4 个。
    与 keyword 重叠的 method_term 去重(不占额度);第 5 个 method_term 超额度被截断。"""
    m = build_query_matrix(
        ["context window"],
        sources=["openalex"],
        method_terms=[
            "context window",          # 与 keyword 重叠 → 去重,不占额度
            "rotary embedding",        # +1
            "position interpolation",  # +2
            "kv cache",                # +3
            "sparse attention",        # +4
            "flash attention",         # 第 5 个 → 超 max_extra=4,截断
        ],
        object_terms=None,  # 无对象锚,query == 裸关键词,便于逐项断言
    )
    qs = {e["query"] for e in _by_source(m)["openalex"]}
    assert "context window" in qs            # 原 keyword
    assert "rotary embedding" in qs          # 并入的 method_term
    assert "position interpolation" in qs
    assert "kv cache" in qs
    assert "sparse attention" in qs
    assert "flash attention" not in qs       # 超额度被截断
    assert len(qs) == 5                       # base(1) + 额外 4,去重后恰好 5


def test_method_terms_cap_bump_respects_hard_ceiling() -> None:
    """#617:并入 method_terms 时 per_source/arxiv cap 各 +2/+1,但封在硬上限内
    (per_source ≤ 10、arxiv ≤ 5),防 query matrix 膨胀拖慢检索。"""
    from .search_service import (
        QUERY_MATRIX_ARXIV_CAP_HARD,
        QUERY_MATRIX_PER_SOURCE_CAP_HARD,
    )

    kws = [f"kw{i}" for i in range(12)]
    methods = [f"m{i}" for i in range(12)]
    m = build_query_matrix(
        kws,
        sources=["openalex", "arxiv"],
        method_terms=methods,
        object_terms=None,   # 无锚/无 exhaust cell,openalex 仅产裸关键词 cell
        per_source_cap=9,    # +2 → 11,应被硬上限钳到 10
        arxiv_cap=5,         # +1 → 6,应被硬上限钳到 5
    )
    by = _by_source(m)
    assert len(by.get("openalex", [])) == QUERY_MATRIX_PER_SOURCE_CAP_HARD  # 10
    assert len(by.get("arxiv", [])) == QUERY_MATRIX_ARXIV_CAP_HARD          # 5


def test_no_method_terms_matrix_unchanged_cell_for_cell() -> None:
    """#617 回归:不传 method_terms(None / 空列表)时,query matrix 与现状逐 cell 一致。"""
    common = dict(
        sources=["openalex", "crossref", "arxiv"],
        object_terms=["LLM", "large language model"],
        arxiv_categories=["cs.CL"],
    )
    baseline = build_query_matrix(["context window", "KV cache"], **common)
    assert build_query_matrix(["context window", "KV cache"], method_terms=None, **common) == baseline
    assert build_query_matrix(["context window", "KV cache"], method_terms=[], **common) == baseline


def test_method_terms_fully_overlapping_keywords_is_noop() -> None:
    """method_terms 全在 keywords 里 → 不新增 query;少量关键词下 cap 上调也不改矩阵。"""
    kw = ["context window", "sparse attention"]
    base = build_query_matrix(kw, sources=["openalex"], object_terms=["LLM"])
    same = build_query_matrix(kw, sources=["openalex"], object_terms=["LLM"], method_terms=kw)
    assert same == base
