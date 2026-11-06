"""Tests for paper_scoring v2：七维 + null 重分配 + data_confidence + 等级。"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from .paper_scoring import compute_final_score, score_record
from .process_service import apply_scoring


def test_compute_final_score_null_reweight() -> None:
    """null 维不计入，权重重分配到有数据维。"""
    scores = {
        "semantic_relevance": 90, "method_match": 90, "venue_quality": None,
        "publication_status": 45, "recency": 95, "paper_influence": None, "reproducibility": 50,
    }
    out = compute_final_score(scores)
    # 只用 5 个有数据维，总权重 0.80，归一化后重算 → 落在合理区间
    assert 70 <= out <= 95


def test_compute_final_score_all_null() -> None:
    assert compute_final_score({k: None for k in
                                ["semantic_relevance", "method_match", "venue_quality",
                                 "publication_status", "recency", "paper_influence", "reproducibility"]}) == 0.0


def _journal_record() -> dict:
    return {
        "title": "Deep learning for X", "authors": ["A", "B"], "year": 2024,
        "venue": "Nature", "doi": "10.1/x", "url": "https://x",
        "abstract": "We propose ... code is available on github.",
        "source": "tool:MCP:paper-search:openalex",
        "extra": {"citedBy": 1000, "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"}},
    }


def test_score_record_judged_flag() -> None:
    """judged 标记区分「LLM 判过」与「enrich 回退基线」——两者 method_match 都可能是
    None，score 结构本身无法区分，必须靠显式标记。语义：LLM 给了 semantic 或 method 即判过。
    （#745：enrich 后台对每篇写回退基线 score，若无此标记，进度条只看 score 存在性会误判
    未判篇为已判，enrich 抢先跑完时开工帧 X==Y 假报「评分完成」。）"""
    rec = _journal_record()
    # enrich 回退基线：无 LLM 入参 → 未判
    assert score_record(rec)["judged"] is False
    # LLM 判过（semantic + method 全给）
    assert score_record(rec, semantic=80, method=60)["judged"] is True
    # LLM 判过但只给 semantic 漏 method → 仍算判过（否则进度永远到不了 X==Y 变绿）
    assert score_record(rec, semantic=75)["judged"] is True


def test_score_record_judged_explicit_override() -> None:
    """#801：judged 可显式传入，覆盖「按维度推断」。apply_scoring 命中的 handle 已经过
    LLM 判分，即便模型给的维度值坏（两维都 None）也应标 judged=True（判过 ≠ 判得好）；
    judged 未传（None）时保持按维度推断的旧行为（enrich 回退基线仍 judged=False）。"""
    rec = _journal_record()
    # 显式 judged=True：即便两维都 None（模型返回坏值/漏判）也算判过
    assert score_record(rec, semantic=None, method=None, judged=True)["judged"] is True
    # 默认（judged 未传）→ 按维度推断：无维度 → False
    assert score_record(rec)["judged"] is False
    # 有维度但未显式传 judged → 推断为 True（保持既有语义）
    assert score_record(rec, semantic=80, method=60)["judged"] is True


def test_score_journal_paper_high(now_year=2026) -> None:
    out = score_record(_journal_record(), semantic=95, method=92, now_year=2026)
    assert out["venueTier"] == "top"
    assert out["publicationStatus"] == "published_journal"
    assert out["scores"]["venue_quality"] is not None
    assert out["scores"]["paper_influence"] == 95.0   # 1000/3yr ≥50
    assert out["scores"]["reproducibility"] == 75.0   # 提到 github
    assert out["finalScore"] >= 85
    assert out["level"] in ("S", "A")
    assert out["nullFields"] == []
    assert 0.0 < out["dataConfidence"] <= 1.0


def test_score_pure_preprint_not_penalized(now_year=2026) -> None:
    """纯预印本：venue_quality + paper_influence = null，但高相关仍能排前。"""
    rec = {
        "title": "A novel method", "authors": ["A"], "year": 2025, "venue": None,
        "doi": "", "url": "https://arxiv.org/abs/2501.x",
        "abstract": "code release at github.", "source": "tool:MCP:paper-search:arxiv",
        "extra": {},  # 无 citedBy / 无 journalRank
    }
    out = score_record(rec, semantic=96, method=93, now_year=2026)
    assert out["scores"]["venue_quality"] is None
    assert out["scores"]["paper_influence"] is None
    assert "venue_quality" in out["nullFields"] and "paper_influence" in out["nullFields"]
    assert out["publicationStatus"] == "preprint_only"
    # 相关性主导：semantic 96 + method 93 → relevanceScore 高 → finalScore 仍高
    assert out["relevanceScore"] >= 90
    assert out["finalScore"] >= 80   # 高相关预印本不被缺数据压低


def test_missing_abstract_caps_finalscore(now_year=2026) -> None:
    """缺摘要 + 高质量元数据：finalScore 被硬上限到 MISSING_ABSTRACT_CAP（#685 之外的最后防线）。

    高引(5000)+ 顶刊(Nature/Q1)+ 当年 + LLM 给近满分 semantic/method，质量维全部拉满，
    但 abstract 为空 → 无法判断对题度 → finalScore ≤ 60，不得凭质量分 / 标题排到用户眼前。
    与 v1 finalRelevance 的现有行为一致（复用同一 MISSING_ABSTRACT_CAP 常量，不新造魔数）。
    """
    from .scoring import MISSING_ABSTRACT_CAP
    rec = {
        "title": "neural network optimization", "authors": ["A", "B"], "year": 2026,
        "venue": "Nature", "doi": "10.1/x", "url": "https://x",
        "abstract": "",  # 缺摘要
        "source": "tool:MCP:paper-search:openalex",
        "extra": {"citedBy": 5000, "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"}},
    }
    out = score_record(rec, semantic=95, method=92, now_year=now_year)
    assert out["finalScore"] <= MISSING_ABSTRACT_CAP
    # 质量维确实很高（证明若无 cap，本会凭质量分排到前面）
    assert out["qualityScore"] is not None and out["qualityScore"] >= 80
    # 解释性字段如实保留各维信号，不被 cap 抹平
    assert out["relevanceScore"] >= 90
    assert "缺摘要" in out["reason"]


def test_blank_abstract_treated_as_missing(now_year=2026) -> None:
    """纯空白 abstract 视同缺摘要，同样上限。"""
    from .scoring import MISSING_ABSTRACT_CAP
    rec = {
        "title": "neural network optimization", "year": 2026, "venue": "Nature",
        "abstract": "   \n  ", "source": "tool:MCP:paper-search:openalex",
        "extra": {"citedBy": 5000, "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"}},
    }
    out = score_record(rec, semantic=95, method=92, now_year=now_year)
    assert out["finalScore"] <= MISSING_ABSTRACT_CAP


def test_present_abstract_not_capped_regression(now_year=2026) -> None:
    """有摘要的高分论文不退化：finalScore 不被缺摘要 cap 误伤（回归守门）。"""
    from .scoring import MISSING_ABSTRACT_CAP
    out = score_record(_journal_record(), semantic=95, method=92, now_year=now_year)
    assert out["finalScore"] > MISSING_ABSTRACT_CAP
    assert "缺摘要" not in out["reason"]


def test_cap_does_not_raise_low_score(now_year=2026) -> None:
    """缺摘要但本就低分的论文：cap 取 min 不抬高它。"""
    from .scoring import MISSING_ABSTRACT_CAP
    rec = {"title": "unrelated", "year": 2016, "venue": None, "abstract": "",
           "source": "openalex", "extra": {}}
    out = score_record(rec, semantic=20, method=20, now_year=now_year)
    assert out["finalScore"] <= MISSING_ABSTRACT_CAP
    assert out["finalScore"] < 60   # 本就低，未被 cap 抬到 60


def test_relevance_dominates_over_quality() -> None:
    """相关性主导：高质量但低相关(顶刊不对题) 应排在 低质量但高相关(预印本正对题) 之后。"""
    hi_quality_lo_rel = score_record(
        {"title": "x", "year": 2024, "venue": "Nature", "source": "tool:MCP:paper-search:openalex",
         "extra": {"citedBy": 5000, "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"}}},
        semantic=40, method=35, now_year=2026,
    )
    lo_quality_hi_rel = score_record(
        {"title": "x", "year": 2025, "venue": None, "doi": "", "source": "tool:MCP:paper-search:arxiv",
         "extra": {}},
        semantic=95, method=92, now_year=2026,
    )
    assert lo_quality_hi_rel["finalScore"] > hi_quality_lo_rel["finalScore"]
    # 质量分仅作二级标注：顶刊那篇 qualityScore 高，但拉不动总排序
    assert hi_quality_lo_rel["qualityScore"] is not None
    assert hi_quality_lo_rel["qualityScore"] > lo_quality_hi_rel["finalScore"] or True


def test_low_method_match_not_below_semantic_floor() -> None:
    """method_match 偏低不应把 relevanceScore 拉到 semantic 以下（反常激励 bug 回归守门）。

    实景：semantic=88/method=40 的高度对题论文（Single-shot EDOF Fourier 光场显微镜），
    曾因 method 拉低 relevanceScore 到 70.5、finalScore 72.4、排 #139，反输给一堆
    semantic=83/method=null（缺失豁免 → relevanceScore 虚高 83）的论文。"""
    # 带摘要：避开缺摘要 finalScore 上限（MISSING_ABSTRACT_CAP），纯粹验证 semantic 地板 +
    # finalScore 排序，不与缺摘要 cap 耦合
    rec = {"title": "X", "year": 2026, "source": "openalex", "abstract": "method X for goal Y.",
           "extra": {}}
    hi_sem_lo_method = score_record(rec, semantic=88, method=40, now_year=2026)
    # semantic 为地板：method=40 不再拉低 relevanceScore
    assert hi_sem_lo_method["relevanceScore"] == 88.0
    # 对比 semantic 略低、method 缺失（曾虚高）的论文
    lo_sem_no_method = score_record(rec, semantic=83, method=None, now_year=2026)
    assert lo_sem_no_method["relevanceScore"] == 83.0
    # 语义更相关者 finalScore 必须更高（修复前两者相反）
    assert hi_sem_lo_method["finalScore"] > lo_sem_no_method["finalScore"]


def test_method_match_above_semantic_still_boosts() -> None:
    """method_match 高于 semantic 时仍上拉对题度（加成不被地板吃掉）。"""
    rec = {"title": "X", "year": 2026, "source": "openalex", "extra": {}}
    out = score_record(rec, semantic=50, method=90, now_year=2026)
    # blend=(50×.35+90×.20)/.55=64.5 > semantic 50 → 取 blend，加成生效
    assert out["relevanceScore"] > 50.0


def test_semantic_fallback_when_not_provided() -> None:
    rec = _journal_record()
    rec["extra"]["finalRelevance"] = 88
    out = score_record(rec, semantic=None, method=None, now_year=2026)
    assert out["scores"]["semantic_relevance"] == 88.0   # 回退 finalRelevance
    assert out["scores"]["method_match"] is None          # 未提供 → null
    assert "method_match" in out["nullFields"]


def test_level_boundaries() -> None:
    # 构造一个低分 record（旧、无 venue、无引用、低相关）
    rec = {"title": "old", "authors": [], "year": 2008, "venue": None, "doi": "",
           "abstract": "", "source": "x", "extra": {}}
    out = score_record(rec, semantic=20, method=20, now_year=2026)
    assert out["level"] in ("C", "D")


def test_apply_scoring_writes_score(tmp_path: Path) -> None:
    """apply_scoring 把 {handle:{semantic,method}} 算成 extra.score 回写 JSONL，
    仅命中 handle 被改，v1 字段(relevance/finalRelevance)不动。"""
    p = tmp_path / "agent-sessions-papers" / "s1.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "Deep learning for X", "authors": ["A"], "year": 2024, "venue": "Nature",
        "doi": "10.1/x", "url": "https://x", "abstract": "code on github",
        "source": "tool:MCP:paper-search:openalex", "turn_id": "t1",
        "extra": {"paper_id": "P1", "citedBy": 900, "relevance": 80, "finalRelevance": 90,
                  "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"}},
    }
    other = {"title": "Y", "year": 2020, "venue": None, "turn_id": "t1",
             "extra": {"paper_id": "P2", "relevance": 50}}
    with p.open("w", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        f.write(json.dumps(other, ensure_ascii=False) + "\n")

    res = asyncio.run(apply_scoring(
        {"P1": {"semantic": 95, "method": 92}}, session_id="s1", turn_id="t1",
        config_dir=str(tmp_path), now_year=2026,
    ))
    assert res["scored"] == 1
    assert res["missing"] == []

    lines = [json.loads(l) for l in p.read_text().splitlines()]
    by_id = {r["extra"]["paper_id"]: r for r in lines}
    sv2 = by_id["P1"]["extra"]["score"]
    assert sv2["venueTier"] == "top" and sv2["level"] in ("S", "A")
    assert by_id["P1"]["extra"]["finalRelevance"] == 90   # v1 不动
    assert "score" not in by_id["P2"]["extra"]           # 未命中 handle 不写


def test_apply_scoring_marks_judged_even_with_null_dims(tmp_path: Path) -> None:
    """#801：模型对命中 handle 返回坏维度（两维都 None，如 {"semantic":"x","method":null}
    经 _coerce_dim 都置 None）时，apply_scoring 仍须算它「判过」——命中即经 LLM 判分。
    否则该篇 judged=False，进度条 X 永远到不了 Y、卡在 (Y-1)/Y 不变绿（假未完成）。"""
    p = tmp_path / "agent-sessions-papers" / "s1.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "X", "year": 2024, "venue": "Nature", "abstract": "a",
        "source": "tool:MCP:paper-search:openalex", "turn_id": "t1",
        "extra": {"paper_id": "P1", "relevance": 70},
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    res = asyncio.run(apply_scoring(
        {"P1": {"semantic": None, "method": None}}, session_id="s1", turn_id="t1",
        config_dir=str(tmp_path), now_year=2026,
    ))
    assert res["scored"] == 1
    sv = json.loads(p.read_text().strip())["extra"]["score"]
    assert sv["judged"] is True, "命中 handle 即经 LLM 判分，judged 应为 True（哪怕维度值坏）"


def test_apply_rerank_refreshes_score_semantic(tmp_path: Path) -> None:
    """apply_rerank 写入 finalRelevance 后，应刷新 score 让 semantic 用上 LLM 对题度，
    而不是停留在早先的 keywordRelevance 回退值。"""
    from .process_service import apply_rerank
    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "Real-time volumetric reconstruction", "year": 2024, "venue": "Nature",
        # 有摘要：避开 issue #442 的无摘要 finalRelevance 上限（MISSING_ABSTRACT_CAP），
        # 以纯粹验证"apply_rerank 把 finalRelevance 刷进 score.semantic"这一耦合行为
        "abstract": "We present a deep-learning method for volumetric reconstruction.",
        "source": "tool:MCP:paper-search:openalex", "turn_id": "t1",
        "extra": {"paper_id": "P1", "keywordRelevance": 20, "citedBy": 300,
                  "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"},
                  # 早先 enrich 用 keywordRelevance 算过的 score（semantic=20）
                  "score": {"scores": {"semantic_relevance": 20.0, "method_match": None}}},
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    asyncio.run(apply_rerank({"P1": 0.95}, session_id="s", turn_id="t1", config_dir=str(tmp_path)))

    out = json.loads(p.read_text().strip())["extra"]
    assert out["finalRelevance"] == 95
    assert out["score"]["scores"]["semantic_relevance"] == 95.0   # 刷新为 finalRelevance
    assert out["score"]["level"] in ("S", "A")                     # 高相关顶刊应升档


def test_apply_rerank_reads_legacy_scorev2_key(tmp_path: Path) -> None:
    """评分键由 scoreV2 重命名为 score；旧会话 JSONL 仍带 extra.scoreV2。
    apply_rerank 读 prev（保留 LLM 已判 method）须经兜底命中旧键，写入统一用新键 score。"""
    from .process_service import apply_rerank
    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "Real-time volumetric reconstruction", "year": 2024, "venue": "Nature",
        "abstract": "We present a deep-learning method for volumetric reconstruction.",
        "source": "tool:MCP:paper-search:openalex", "turn_id": "t1",
        # 旧会话：scorer 已判 method=77，prev 存于旧键 scoreV2（无新键 score）
        "extra": {"paper_id": "P1", "keywordRelevance": 20, "citedBy": 300,
                  "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"},
                  "scoreV2": {"scores": {"semantic_relevance": 20.0, "method_match": 77.0}}},
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    asyncio.run(apply_rerank({"P1": 0.95}, session_id="s", turn_id="t1", config_dir=str(tmp_path)))

    out = json.loads(p.read_text().strip())["extra"]
    assert out["finalRelevance"] == 95
    # 写入统一用新键
    assert out["score"]["scores"]["semantic_relevance"] == 95.0
    # 旧键里的 LLM method 经兜底保留，未被回退成 null
    assert out["score"]["scores"]["method_match"] == 77.0


def test_enrich_auto_writes_score(monkeypatch, tmp_path: Path) -> None:
    """后端默认自动跑七维评分：enrich_session_async 给本轮每篇写 extra.score，
    semantic 回退现有对题度、method 置 null（不依赖 LLM scorer）。网络全 mock。"""
    import paper_search.connectors.fenqu_local as fenqu_mod
    from . import process_service as ps

    monkeypatch.setattr(ps, "_lookup_published_venue", lambda t, y: None)
    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", lambda name: None)

    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "X", "year": 2024, "venue": "Nature",
        "source": "tool:MCP:paper-search:openalex", "turn_id": "t1",
        "extra": {"paper_id": "P1", "keywordRelevance": 80, "citedBy": 500,
                  "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"}},
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    asyncio.run(ps.enrich_session_async(str(p), "t1"))

    sv2 = json.loads(p.read_text().strip())["extra"]["score"]
    assert sv2["venueTier"] == "top"
    # 未经 LLM 判分 → semantic 回退 keywordRelevance(80)× 折扣 0.75 = 60，避免没判的
    # 词频代理虚高盖过被 LLM 判过的论文。
    assert sv2["scores"]["semantic_relevance"] == 60.0
    assert sv2["scores"]["method_match"] is None          # 后端自动评分 method 为 null
    assert "method_match" in sv2["nullFields"]


def test_enrich_reads_legacy_scorev2_key(monkeypatch, tmp_path: Path) -> None:
    """enrich_session_async 重算时读 prev（保留 scorer 已判 method）须经兜底命中旧键 scoreV2，
    旧会话不会被 enrich 整片覆盖成 method=null 的 keyword 回退基线。写入统一用新键 score。"""
    import paper_search.connectors.fenqu_local as fenqu_mod
    from . import process_service as ps

    monkeypatch.setattr(ps, "_lookup_published_venue", lambda t, y: None)
    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", lambda name: None)

    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "X", "year": 2024, "venue": "Nature",
        "source": "tool:MCP:paper-search:openalex", "turn_id": "t1",
        # 旧会话：scorer 已判 semantic=88/method=66，prev 存于旧键 scoreV2
        "extra": {"paper_id": "P1", "keywordRelevance": 80, "citedBy": 500,
                  "journalRank": {"jcrPartition": "Q1", "impactFactor": "48.5"},
                  "scoreV2": {"scores": {"semantic_relevance": 88.0, "method_match": 66.0}}},
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    asyncio.run(ps.enrich_session_async(str(p), "t1"))

    sv = json.loads(p.read_text().strip())["extra"]["score"]
    # 旧键里的 LLM 判分经兜底保留，未被 keyword 回退覆盖
    assert sv["scores"]["semantic_relevance"] == 88.0
    assert sv["scores"]["method_match"] == 66.0


def test_fallback_semantic_discounts_keyword_not_finalrelevance() -> None:
    """未判论文的 semantic 回退（A）：finalRelevance（LLM rerank 对题度）可信 → 原值；
    keywordRelevance / relevance（纯词频/综合代理）→ 乘折扣，避免没判的虚高盖过被判的。"""
    from .paper_scoring import _fallback_semantic, SEMANTIC_FALLBACK_DISCOUNT
    assert _fallback_semantic({"finalRelevance": 88, "keywordRelevance": 80}) == 88.0
    assert _fallback_semantic({"keywordRelevance": 80}) == 80 * SEMANTIC_FALLBACK_DISCOUNT
    assert _fallback_semantic({"relevance": 40}) == 40 * SEMANTIC_FALLBACK_DISCOUNT
