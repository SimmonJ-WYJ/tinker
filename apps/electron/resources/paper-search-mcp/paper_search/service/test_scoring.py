"""Tests for paper relevance scoring (F22 #93, F21 #98)."""

import pytest
from .scoring import (
    score_papers,
    _current_year,
    _score_keyword_relevance,
    _method_axis_score,
    MISSING_ABSTRACT_CAP,
    OFF_DOMAIN_PENALTY_DEFAULT,
    _off_domain_penalty,
    _should_apply_off_domain_penalty,
    _has_domain_signal,
)


def _make_record(
    title: str = "Test Paper",
    year: int | None = None,
    venue: str | None = None,
    abstract: str | None = None,
    cited_by: int | None = None,
) -> dict:
    extra: dict = {}
    if cited_by is not None:
        extra["citedBy"] = cited_by
    return {
        "ts": "2024-01-01T00:00:00Z",
        "query": None,
        "source": "tool:test",
        "title": title,
        "authors": [],
        "year": year,
        "venue": venue,
        "doi": None,
        "url": None,
        "abstract": abstract,
        "extra": extra if extra else None,
    }


class TestScorePapers:
    """score_papers 核心逻辑"""

    def test_empty_list(self) -> None:
        records: list[dict] = []
        score_papers(records)
        assert records == []

    def test_all_fields_present(self) -> None:
        rec = _make_record(
            title="Machine Learning",
            year=_current_year(),
            venue="NeurIPS",
            abstract="A study on machine learning methods",
            cited_by=500,
        )
        score_papers([rec], query="machine learning")
        assert "extra" in rec
        assert isinstance(rec["extra"]["relevance"], int)
        assert 0 <= rec["extra"]["relevance"] <= 100
        assert rec["extra"]["relevance"] > 0
        assert isinstance(rec["extra"]["relevanceBreakdown"], list)
        assert len(rec["extra"]["relevanceBreakdown"]) > 0

    def test_all_dimensions_used_when_all_data_present(self) -> None:
        rec = _make_record(
            title="Deep Learning",
            year=_current_year(),
            venue="ICML",
            abstract="Deep learning survey",
            cited_by=100,
        )
        score_papers([rec], query="deep learning")
        dims = set(rec["extra"]["relevanceBreakdown"])
        assert "citations" in dims
        assert "recency" in dims
        assert "citation_velocity" in dims
        assert "venue_presence" in dims
        assert "keyword_relevance" in dims

    def test_no_data_scores_zero(self) -> None:
        rec = _make_record(title="Unknown", year=None, venue=None)
        score_papers([rec])
        assert rec["extra"]["relevance"] == 0
        assert rec["extra"]["relevanceBreakdown"] == []

    def test_only_year_scores_nonzero(self) -> None:
        rec = _make_record(year=_current_year())
        score_papers([rec])
        assert rec["extra"]["relevance"] > 0

    def test_old_paper_low_recency(self) -> None:
        rec = _make_record(year=_current_year() - 10)
        score_papers([rec])
        # 10 年前 recency = 0，只有 year 维度但值为 0
        assert rec["extra"]["relevance"] == 0

    def test_high_citations_high_score(self) -> None:
        high = _make_record(cited_by=5000)
        low = _make_record(cited_by=1)
        score_papers([high, low])
        assert high["extra"]["relevance"] > low["extra"]["relevance"]

    def test_keyword_match_boosts_score(self) -> None:
        match = _make_record(title="Neural network optimization")
        nomatch = _make_record(title="Cooking recipes")
        score_papers([match, nomatch], query="neural network")
        assert match["extra"]["relevance"] > nomatch["extra"]["relevance"]

    def test_relevance_dominates_over_citations(self) -> None:
        """对题度主导（keyword_relevance=0.50）：完全对题但低引用的近期论文，
        应排在高引但完全不对题的老论文之前。旧权重（citations+recency=0.50，
        keyword=0.20）下高引论文会赢；调权后对题论文必须反超。"""
        cur = _current_year()
        # 完全对题（method+object 全命中），低引用、近期
        on_topic = _make_record(
            title="Deep learning for light field microscopy",
            abstract="A deep learning method for light field microscopy.",
            year=cur, cited_by=2,
        )
        # 完全不对题，高引用、老
        off_topic_hi_cite = _make_record(
            title="A study of medieval pottery",
            abstract="Pottery classification in medieval Europe.",
            year=cur - 8, cited_by=8000,
        )
        score_papers(
            [off_topic_hi_cite, on_topic],
            method_terms=["deep learning"],
            object_terms=["light field microscopy"],
        )
        assert on_topic["extra"]["relevance"] > off_topic_hi_cite["extra"]["relevance"]

    def test_score_clamped_to_100(self) -> None:
        # 即使极端值也不超 100
        rec = _make_record(
            year=_current_year(),
            venue="Nature",
            cited_by=100000,
        )
        score_papers([rec], query=rec["title"])
        assert rec["extra"]["relevance"] <= 100

    def test_score_is_integer(self) -> None:
        rec = _make_record(year=2022, cited_by=42, venue="AAAI")
        score_papers([rec])
        assert isinstance(rec["extra"]["relevance"], int)

    def test_missing_extra_creates_extra(self) -> None:
        rec = _make_record()
        rec["extra"] = None
        score_papers([rec])
        assert rec["extra"] is not None
        assert "relevance" in rec["extra"]

    def test_multiple_records(self) -> None:
        records = [
            _make_record(title="A", cited_by=100, year=_current_year()),
            _make_record(title="B", cited_by=10, year=_current_year() - 5),
            _make_record(title="C"),
        ]
        score_papers(records)
        scores = [r["extra"]["relevance"] for r in records]
        # A 应该最高（引用多 + 最近），C 最低（无数据）
        assert scores[0] > scores[1] > scores[2]


class TestMetadataCompleteness:
    """issue #442 — 缺摘要论文不得获得接近满分的置信度。

    缺摘要时无法充分判断相关性，F22 综合分被硬上限到 MISSING_ABSTRACT_CAP，
    并写 metadataComplete=false + missingMetadata 供 UI 标注「因缺摘要置信度受限」。
    元数据齐全的论文不受影响（无回归）。
    """

    def _high_score_kwargs(self) -> dict:
        # 高引用 + 当年 + 顶会 + 标题命中 query → 原本接近满分
        return dict(
            title="neural network optimization",
            year=_current_year(),
            venue="NeurIPS",
            cited_by=10000,
        )

    def test_missing_abstract_capped(self) -> None:
        rec = _make_record(abstract=None, **self._high_score_kwargs())
        score_papers([rec], query="neural network optimization")
        assert rec["extra"]["relevance"] <= MISSING_ABSTRACT_CAP
        assert rec["extra"]["metadataComplete"] is False
        assert "abstract" in rec["extra"]["missingMetadata"]

    def test_blank_abstract_treated_as_missing(self) -> None:
        rec = _make_record(abstract="   \n  ", **self._high_score_kwargs())
        score_papers([rec], query="neural network optimization")
        assert rec["extra"]["relevance"] <= MISSING_ABSTRACT_CAP
        assert rec["extra"]["metadataComplete"] is False

    def test_complete_metadata_not_capped(self) -> None:
        rec = _make_record(
            abstract="A study on neural network optimization methods.",
            **self._high_score_kwargs(),
        )
        score_papers([rec], query="neural network optimization")
        # 元数据齐全的高分论文不受本改动影响
        assert rec["extra"]["relevance"] > MISSING_ABSTRACT_CAP
        assert rec["extra"]["metadataComplete"] is True
        assert rec["extra"]["missingMetadata"] == []

    def test_low_score_missing_abstract_not_raised_by_cap(self) -> None:
        # 缺摘要但本就低分的论文：cap 不应把它抬高，标志仍为 False
        rec = _make_record(title="unrelated", year=_current_year() - 8, abstract=None)
        score_papers([rec], query="neural network")
        assert rec["extra"]["relevance"] <= MISSING_ABSTRACT_CAP
        assert rec["extra"]["metadataComplete"] is False

    def test_complete_outranks_missing_when_otherwise_equal(self) -> None:
        # 其它维度完全相同，缺摘要的应被 cap 压到齐全论文之后（同情况同降权）
        common = dict(year=_current_year(), venue="NeurIPS", cited_by=10000)
        complete = _make_record(
            title="neural network", abstract="neural network study", **common
        )
        missing = _make_record(title="neural network", abstract=None, **common)
        score_papers([complete, missing], query="neural network")
        assert complete["extra"]["relevance"] > missing["extra"]["relevance"]


class TestKeywordRelevanceDualAxis:
    """F21 / issue #98 — _score_keyword_relevance 在 method/object 双维模式下的行为。

    每轴用饱和分（A）：命中即 base(0.6) + 覆盖加成，而非线性比率。单词项轴（n=1）
    满命中→1.0、不命中→0.0，故双维都用单词项时返回 {0.0, 0.5, 1.0} 三档（向后兼容）。
    多词项轴下"命中 1 个核心词"不再被稀释到 1/n（修复聚焦论文沉底）。
    任一为空时回退到 query 词袋逻辑（与 #93 现状一致）。
    """

    METHOD = ["transformer"]
    OBJECT = ["mouse model"]

    def test_method_only_hit_returns_half(self) -> None:
        # title 仅命中 method（transformer），未命中 object（mouse model）
        score = _score_keyword_relevance(
            title="Transformer for NLP",
            abstract="",
            query_terms=[],
            method_terms=self.METHOD,
            object_terms=self.OBJECT,
        )
        assert score == 0.5

    def test_object_only_hit_returns_half(self) -> None:
        # title 仅命中 object（mouse model），未命中 method
        score = _score_keyword_relevance(
            title="Mouse model of aging",
            abstract="",
            query_terms=[],
            method_terms=self.METHOD,
            object_terms=self.OBJECT,
        )
        assert score == 0.5

    def test_dual_hit_returns_one(self) -> None:
        # title + abstract 同时命中 method 与 object
        score = _score_keyword_relevance(
            title="Transformer applied to mouse model neural recordings",
            abstract="",
            query_terms=[],
            method_terms=self.METHOD,
            object_terms=self.OBJECT,
        )
        assert score == 1.0

    def test_no_hit_returns_zero(self) -> None:
        # title 与 method/object 都不相关
        score = _score_keyword_relevance(
            title="Quantum chemistry methods",
            abstract="",
            query_terms=[],
            method_terms=self.METHOD,
            object_terms=self.OBJECT,
        )
        assert score == 0.0

    def test_fallback_when_axes_empty_matches_legacy(self) -> None:
        # method=[]、object=[] 时应回退到 query 词袋逻辑，与现有算法逐位相等
        # query 切词为 ["climate", "adaptation"]，title 命中 2/2
        score = _score_keyword_relevance(
            title="Climate adaptation in coastal cities",
            abstract="",
            query_terms=["climate", "adaptation"],
            method_terms=[],
            object_terms=[],
        )
        assert score == 1.0

        # 只命中一半
        score_half = _score_keyword_relevance(
            title="Climate change overview",
            abstract="",
            query_terms=["climate", "adaptation"],
            method_terms=[],
            object_terms=[],
        )
        assert score_half == 0.5

    def test_fallback_when_axes_none_matches_legacy(self) -> None:
        # method_terms=None / object_terms=None（默认值，等价于 score_papers 当前调用形态）
        # 应与 method=[]/object=[] 路径行为完全一致 — 防御调用形态变化导致的隐藏 regression
        score_with_none = _score_keyword_relevance(
            title="Climate adaptation in coastal cities",
            abstract="",
            query_terms=["climate", "adaptation"],
        )
        score_with_empty = _score_keyword_relevance(
            title="Climate adaptation in coastal cities",
            abstract="",
            query_terms=["climate", "adaptation"],
            method_terms=[],
            object_terms=[],
        )
        assert score_with_none == 1.0
        assert score_with_none == score_with_empty

    def test_single_axis_provided_method(self) -> None:
        # 只提供 method_terms，object_terms 为空 → 退化为单轴 0/1
        score_hit = _score_keyword_relevance(
            title="Transformer model",
            abstract="",
            query_terms=[],
            method_terms=self.METHOD,
            object_terms=[],
        )
        assert score_hit == 1.0

        score_miss = _score_keyword_relevance(
            title="Quantum chemistry",
            abstract="",
            query_terms=[],
            method_terms=self.METHOD,
            object_terms=[],
        )
        assert score_miss == 0.0

    def test_substring_match_case_insensitive(self) -> None:
        # method/object 大小写不敏感
        score = _score_keyword_relevance(
            title="TRANSFORMER on MOUSE MODEL studies",
            abstract="",
            query_terms=[],
            method_terms=["transformer"],
            object_terms=["mouse model"],
        )
        assert score == 1.0

    def test_abstract_also_searched(self) -> None:
        # title 不命中 object 但 abstract 命中 → 仍算 object 命中
        score = _score_keyword_relevance(
            title="Transformer for sequence modeling",
            abstract="Experiments on the mouse model demonstrate efficacy.",
            query_terms=[],
            method_terms=self.METHOD,
            object_terms=self.OBJECT,
        )
        assert score == 1.0

    def test_empty_string_terms_filtered(self) -> None:
        # 输入序列中带空串的元素应被过滤，不参与匹配
        score = _score_keyword_relevance(
            title="Transformer for NLP",
            abstract="",
            query_terms=[],
            method_terms=["", "transformer", "  "],
            object_terms=["mouse model"],
        )
        assert score == 0.5  # 仅 method 命中

    # ------------------------------------------------------------------
    # A：多词项轴用饱和分（命中即 base + 覆盖加成），不再线性稀释
    # ------------------------------------------------------------------

    def test_method_partial_hit_saturating(self) -> None:
        """method=[A,B,C,D] 仅命中 A → 饱和分 0.6+0.4×(1/4)=0.7（旧线性比率仅 0.25）；
        object=[X] 命中 → 1.0。平均 = 0.85。"""
        score = _score_keyword_relevance(
            title="A study on Transformer applied to mouse model",
            abstract="",
            query_terms=[],
            method_terms=["transformer", "RoPE", "sparse attention", "KV cache"],
            object_terms=["mouse model"],
        )
        assert score == pytest.approx((0.7 + 1.0) / 2.0)

    def test_both_partial_hit_saturating(self) -> None:
        """method 2/4 → 0.6+0.4×0.5=0.8；object 1/3 → 0.6+0.4×(1/3)≈0.733。平均 ≈ 0.767。"""
        score = _score_keyword_relevance(
            title="Transformer and RoPE for large language model",
            abstract="",
            query_terms=[],
            method_terms=["transformer", "RoPE", "sparse attention", "KV cache"],
            object_terms=["large language model", "mouse model", "graph"],
        )
        expected = (0.8 + (0.6 + 0.4 / 3)) / 2.0
        assert score == pytest.approx(expected)

    def test_focused_paper_not_diluted_by_long_term_list(self) -> None:
        """A 回归:6+6 长词表里只命中各 1 个核心词的【聚焦论文】,不应被稀释到 ~0.17
        （旧 (1/6+1/6)/2）。饱和分下应 ≥0.6（明确"对题"），避免沉底出 top_k。"""
        score = _score_keyword_relevance(
            title="Deep learning for light field microscopy",
            abstract="",
            query_terms=[],
            method_terms=["deep learning", "cnn", "deconvolution",
                          "wavefront coding", "psf", "digital refocusing"],
            object_terms=["light field microscopy", "extended depth of field",
                          "volumetric imaging", "computational imaging",
                          "light field", "3d microscopy"],
        )
        assert score >= 0.6  # 旧公式仅 (1/6+2/6)/2≈0.25

    def test_variant_normalization_hyphen(self) -> None:
        """B 回归:连字符变体可匹配——'extended depth-of-field' 命中词条
        'extended depth of field';'light-field' 命中 'light field'。"""
        score = _score_keyword_relevance(
            title="DeepDOF: deep learning extended depth-of-field for light-field imaging",
            abstract="",
            query_terms=[],
            method_terms=["deep learning"],
            object_terms=["extended depth of field", "light field"],
        )
        # method 1/1=1.0；object 2/2 命中（连字符归一化后）→ 1.0；平均 1.0
        assert score == pytest.approx(1.0)

    def test_full_hit_in_multi_term_still_one(self) -> None:
        """全部 method+object term 命中 → 仍是 1.0（边界）。"""
        score = _score_keyword_relevance(
            title="Transformer RoPE sparse attention KV cache for large language model",
            abstract="and the mouse model graph",
            query_terms=[],
            method_terms=["transformer", "RoPE", "sparse attention", "KV cache"],
            object_terms=["large language model", "mouse model", "graph"],
        )
        assert score == pytest.approx(1.0)

    def test_single_term_lists_preserve_legacy_behavior(self) -> None:
        """每个 list 只含 1 个 term 时，新公式退化为 0/1 二档，与老公式逐位相等。"""
        # 命中：method 1/1 = 1, object 1/1 = 1 → 1.0
        s_hit = _score_keyword_relevance(
            title="Transformer on mouse model",
            abstract="",
            query_terms=[],
            method_terms=["transformer"],
            object_terms=["mouse model"],
        )
        assert s_hit == 1.0
        # 部分命中：method 1/1 = 1, object 0/1 = 0 → 0.5（与老公式相同）
        s_half = _score_keyword_relevance(
            title="Transformer on quantum chemistry",
            abstract="",
            query_terms=[],
            method_terms=["transformer"],
            object_terms=["mouse model"],
        )
        assert s_half == 0.5


class TestScorePapersDualAxis:
    """F21 / issue #98 — score_papers 对 method/object 参数的整合行为。"""

    def test_writes_method_object_to_extra(self) -> None:
        # 即使空字符串的 method/object 在 score_papers 输入侧应被原样过滤后写回（小写化后）
        rec = _make_record(title="Transformer for mouse model", year=_current_year())
        score_papers(
            [rec],
            query="x",
            method_terms=["Transformer", " ", ""],
            object_terms=["Mouse Model"],
        )
        assert rec["extra"]["methodTerms"] == ["transformer"]
        assert rec["extra"]["objectTerms"] == ["mouse model"]

    def test_dual_hit_outranks_single_outranks_none(self) -> None:
        # 4 篇论文，4 个维度（除 keyword_relevance 外）完全相同
        # abstract 给中性占位（不含 method/object 词），既避免触发 issue #442
        # 的缺摘要 cap 抹平排序，又不影响 keyword 维度（命中仍由 title 决定）。
        common = {
            "year": _current_year(),
            "venue": "NeurIPS",
            "cited_by": 100,
            "abstract": "A study.",
        }
        dual = _make_record(title="Transformer on mouse model", **common)
        method_only = _make_record(title="Transformer for NLP", **common)
        object_only = _make_record(title="Mouse model of aging", **common)
        neither = _make_record(title="Quantum chemistry overview", **common)

        records = [dual, method_only, object_only, neither]
        score_papers(
            records,
            query="transformer mouse model",
            method_terms=["transformer"],
            object_terms=["mouse model"],
        )

        assert dual["extra"]["relevance"] > method_only["extra"]["relevance"]
        assert method_only["extra"]["relevance"] == object_only["extra"]["relevance"]
        assert object_only["extra"]["relevance"] > neither["extra"]["relevance"]

    def test_legacy_call_without_axes_unchanged(self) -> None:
        # 不传 method_terms / object_terms，行为应与现有完全一致；extra 也不应出现新字段
        rec = _make_record(title="Neural network optimization", year=_current_year())
        score_papers([rec], query="neural network")
        assert "methodTerms" not in rec["extra"]
        assert "objectTerms" not in rec["extra"]
        # 仍有 relevance / relevanceBreakdown
        assert isinstance(rec["extra"]["relevance"], int)
        assert "keyword_relevance" in rec["extra"]["relevanceBreakdown"]


# ── method 轴分（判分门槛用：method 强命中 → 进 LLM 判分窗口） ─────────────


def test_method_axis_score_saturates_with_hits() -> None:
    """method 轴：命中 ≥1 给 base 0.6；命中越多越高。无 method_terms → None。"""
    # 命中 2/2 method 词
    s2 = _method_axis_score(
        "Deep learning extended depth-of-field microscope", "",
        method_terms=["deep learning", "extended depth of field"],
    )
    assert s2 is not None and s2 >= 0.7  # 满命中 → 1.0
    # 命中 0 → 0
    s0 = _method_axis_score("Quantum chemistry", "", method_terms=["deep learning"])
    assert s0 == 0.0
    # 无 method_terms → None
    assert _method_axis_score("anything", "", method_terms=[]) is None


def test_method_strong_hit_writes_methodRelevance_even_when_object_misses() -> None:
    """还原沉底场景：method 强命中(深度学习+EDOF)但 object(光场)不命中 →
    F22 偏低，但 extra.methodRelevance ≥70，足以触发判分门槛。"""
    rec = {
        "title": "Deep learning extended depth-of-field microscope for histology",
        "abstract": "", "year": 2023, "venue": None, "extra": {},
    }
    score_papers(
        [rec], query="deep learning extended depth of field",
        method_terms=["deep learning", "extended depth of field", "deconvolution"],
        object_terms=["light field microscopy"],  # 不命中（这篇非光场）
    )
    mr = rec["extra"]["methodRelevance"]
    assert mr >= 70, f"method 强命中应 ≥70，实际 {mr}"
    # object 不命中 → keywordRelevance 被 object 轴(0)拉低，明显低于 methodRelevance
    assert rec["extra"]["keywordRelevance"] < mr


# ── off-domain penalty（issue #620）─────────────────────────────────────────


class TestOffDomainPenaltyGate:
    """broad query 守门纯逻辑：method 信号足够明确时才启用 off-domain penalty。"""

    def test_two_method_terms_enables(self) -> None:
        assert _should_apply_off_domain_penalty(["a", "b"], []) is True

    def test_one_method_one_object_enables(self) -> None:
        assert _should_apply_off_domain_penalty(["a"], ["x"]) is True

    def test_single_method_no_object_disabled(self) -> None:
        # AC：method_terms 仅 1 个且无 object_terms（broad query）→ 整体不启用
        assert _should_apply_off_domain_penalty(["a"], []) is False

    def test_only_object_terms_disabled(self) -> None:
        assert _should_apply_off_domain_penalty([], ["x", "y"]) is False

    def test_empty_disabled(self) -> None:
        assert _should_apply_off_domain_penalty([], []) is False


class TestHasDomainSignal:
    """标题+摘要是否含任一 method/object 信号（归一化子串匹配）。"""

    def test_method_hit_in_title(self) -> None:
        assert _has_domain_signal("Deep learning paper", "", ["deep learning"], []) is True

    def test_object_hit_in_title(self) -> None:
        assert _has_domain_signal("Mouse model study", "", [], ["mouse model"]) is True

    def test_hit_in_abstract(self) -> None:
        assert _has_domain_signal(
            "Generic title", "uses a transformer encoder", ["transformer"], []
        ) is True

    def test_hyphen_variant_normalized(self) -> None:
        # 连字符变体：'light-field' 命中词条 'light field'
        assert _has_domain_signal("light-field imaging", "", [], ["light field"]) is True

    def test_no_signal_returns_false(self) -> None:
        assert _has_domain_signal(
            "A study of medieval pottery", "Pottery in medieval Europe",
            ["deep learning"], ["light field"],
        ) is False

    def test_empty_terms_no_signal(self) -> None:
        assert _has_domain_signal("anything", "", [], []) is False


class TestOffDomainPenaltyEnv:
    """惩罚系数 env 可调且有默认值（不重打包临场调，AC）。"""

    def test_default_is_quarter(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", raising=False)
        assert _off_domain_penalty() == OFF_DOMAIN_PENALTY_DEFAULT == 0.25

    def test_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", "0.4")
        assert _off_domain_penalty() == 0.4

    def test_invalid_env_falls_back_to_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", "not-a-number")
        assert _off_domain_penalty() == OFF_DOMAIN_PENALTY_DEFAULT


class TestOffDomainPenaltyScoring:
    """score_papers 集成：守门通过时，非 seed 且无 method/object 信号的论文 F22 被打沉。

    统一用「2 个 method 词 + 1 个 object 词」让 broad query 守门通过；abstract 给中性
    占位（不含任何 method/object 词），既规避 #442 缺摘要 cap、又保持"无信号"。
    """

    METHOD = ["deep learning", "transformer"]
    OBJECT = ["light field"]

    def _off_domain(self) -> dict:
        # 完全无 method/object 信号、非 seed
        return _make_record(
            title="A study of medieval pottery",
            abstract="Pottery classification in medieval Europe.",
            year=_current_year(), venue="Nature", cited_by=8000,
        )

    def _with_signal(self) -> dict:
        # 标题含 method 信号（deep learning），其余条件与 _off_domain 相同
        return _make_record(
            title="Deep learning for histology imaging",
            abstract="Pottery classification in medieval Europe.",
            year=_current_year(), venue="Nature", cited_by=8000,
        )

    def _seed_off_domain(self) -> dict:
        # 与 _off_domain 完全相同的无信号记录，但标记 extra.seed=true（应豁免）
        rec = self._off_domain()
        rec["extra"] = {"citedBy": 8000, "seed": True}
        return rec

    def test_targets_only_off_domain_non_seed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # 系数设 0 便于精确断言：被惩罚 → 0；未被惩罚 → >0
        monkeypatch.setenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", "0")
        off = self._off_domain()
        sig = self._with_signal()
        seed = self._seed_off_domain()
        score_papers(
            [off, sig, seed], method_terms=self.METHOD, object_terms=self.OBJECT
        )
        assert off["extra"]["relevance"] == 0
        assert sig["extra"]["relevance"] > 0
        assert seed["extra"]["relevance"] > 0

    def test_default_factor_quarter(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # 不设 env → 默认 0.25；seed 版作为未惩罚 baseline（除 seed flag 外完全相同）
        monkeypatch.delenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", raising=False)
        off = self._off_domain()
        seed = self._seed_off_domain()
        score_papers([off, seed], method_terms=self.METHOD, object_terms=self.OBJECT)
        base = seed["extra"]["relevance"]
        assert off["extra"]["relevance"] > 0
        assert off["extra"]["relevance"] < base
        assert off["extra"]["relevance"] == pytest.approx(base * 0.25, abs=1)

    def test_env_override_factor(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", "0.5")
        off = self._off_domain()
        seed = self._seed_off_domain()
        score_papers([off, seed], method_terms=self.METHOD, object_terms=self.OBJECT)
        base = seed["extra"]["relevance"]
        assert off["extra"]["relevance"] == pytest.approx(base * 0.5, abs=1)

    def test_disabled_for_broad_query(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # method 仅 1 个、无 object → 守门不通过 → 即便系数=0 也不作用
        monkeypatch.setenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", "0")
        off = self._off_domain()
        score_papers([off], method_terms=["deep learning"], object_terms=[])
        assert off["extra"]["relevance"] > 0

    def test_penalty_does_not_touch_keyword_relevance(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # off-domain penalty 只动 F22 relevance；keywordRelevance 走独立路径
        monkeypatch.setenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", "0")
        off = self._off_domain()
        score_papers([off], method_terms=self.METHOD, object_terms=self.OBJECT)
        assert off["extra"]["relevance"] == 0
        assert off["extra"]["keywordRelevance"] == 0
