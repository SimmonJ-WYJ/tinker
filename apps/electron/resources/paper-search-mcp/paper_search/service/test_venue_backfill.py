"""Tests for 异步富化：venue 反查正刊 + 本地分区/IF 回写。

覆盖：
  · _lookup_published_venue —— 按标题反查正刊 venue 的严格防误配（标题须完全相等、
    限 journal-article、venue 非空、年份 ±1）；
  · _compute_journal_ranks —— 本地分区表(fenqu_local)命中映射 + "空壳"（IF/分区全空）过滤；
  · enrich_session_async —— 端到端：读 JSONL → 反查 venue → 查分区 → 按 handle 合并
    回写，且保留已有字段（如 relevance-scorer 写的 finalRelevance）不被覆盖。

crossref 网络 monkeypatch 掉;分区查询改为本地,monkeypatch fenqu_local.lookup_journal_rank。
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path

import paper_search.connectors.fenqu_local as fenqu_mod
from ..models.paper import Paper
from . import process_service as ps


def _run(coro):
    return asyncio.run(coro)


def _write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def _patch_crossref(monkeypatch, papers: list[Paper]) -> None:
    """把 CrossRefConnector 换成返回固定 papers 的假实现。"""
    class _FakeCR:
        def search(self, query, max_results=5):
            return papers

    monkeypatch.setattr("paper_search.connectors.crossref.CrossRefConnector", lambda: _FakeCR())


def _patch_openalex(monkeypatch, papers: list[Paper]) -> None:
    """把 OpenAlexConnector 换成返回固定 papers 的假实现（兜底反查用）。"""
    class _FakeOA:
        def search(self, query, max_results=5):
            return papers

    monkeypatch.setattr("paper_search.connectors.openalex.OpenAlexConnector", lambda: _FakeOA())


# ---------- _lookup_published_venue：严格防误配 ----------

def test_lookup_venue_exact_journal_match(monkeypatch) -> None:
    """归一化标题完全相等 + journal-article + venue 非空 → 返回 venue。"""
    _patch_crossref(monkeypatch, [
        Paper(paper_id="j", title="End-to-end Wiener–CNN optimization",
              venue="Optics Communications",
              extra={"crossref_type": "journal-article"},
              published_date=datetime(2023, 6, 1)),
    ])
    _patch_openalex(monkeypatch, [])
    v = ps._lookup_published_venue("End-to-End Wiener-CNN Optimization", 2023)
    assert v == "Optics Communications"


def test_lookup_venue_rejects_wrong_title(monkeypatch) -> None:
    """标题归一化后不相等 → 不回填（防误配）。"""
    _patch_crossref(monkeypatch, [
        Paper(paper_id="j", title="A completely different paper",
              venue="Optics Communications",
              extra={"crossref_type": "journal-article"}),
    ])
    _patch_openalex(monkeypatch, [])
    assert ps._lookup_published_venue("End-to-End Wiener-CNN Optimization", 2023) is None


def test_lookup_venue_rejects_preprint_type(monkeypatch) -> None:
    """命中的是 posted-content（预印本）→ 跳过，不当正刊 venue。"""
    _patch_crossref(monkeypatch, [
        Paper(paper_id="p", title="End-to-end Wiener CNN optimization",
              venue="SSRN Electronic Journal",
              extra={"crossref_type": "posted-content"}),
    ])
    _patch_openalex(monkeypatch, [])
    assert ps._lookup_published_venue("End-to-End Wiener CNN Optimization", 2023) is None


def test_lookup_venue_rejects_year_far_off(monkeypatch) -> None:
    """标题对得上但年份相差 >1 → 拒绝（可能是同名不同篇）。"""
    _patch_crossref(monkeypatch, [
        Paper(paper_id="j", title="Deep learning for imaging",
              venue="Nature", extra={"crossref_type": "journal-article"},
              published_date=datetime(2010, 1, 1)),
    ])
    _patch_openalex(monkeypatch, [])
    assert ps._lookup_published_venue("Deep Learning for Imaging", 2023) is None


def test_lookup_venue_openalex_fallback(monkeypatch) -> None:
    """crossref 查不到 → openalex 兜底命中正刊 venue。"""
    _patch_crossref(monkeypatch, [])  # crossref 空
    _patch_openalex(monkeypatch, [
        Paper(paper_id="oa", title="DSER Spectral Epipolar Representation",
              venue="IEEE Transactions on Image Processing",
              published_date=datetime(2026, 1, 1)),
    ])
    v = ps._lookup_published_venue("DSER: Spectral Epipolar Representation", 2026)
    assert v == "IEEE Transactions on Image Processing"


def test_lookup_venue_openalex_excludes_preprint(monkeypatch) -> None:
    """crossref 查不到,openalex 命中的 venue 是预印本平台（arXiv）→ 排除,返回 None。"""
    _patch_crossref(monkeypatch, [])
    _patch_openalex(monkeypatch, [
        Paper(paper_id="oa", title="Some Preprint Paper",
              venue="arXiv (Cornell University)"),
    ])
    assert ps._lookup_published_venue("Some Preprint Paper", 2026) is None


# ---------- _compute_journal_ranks：命中映射 + 空壳过滤 ----------

def test_journal_ranks_maps_and_filters_empty_shell(monkeypatch) -> None:
    """真期刊 → 进 map；空壳（四项全空，如纯会议）→ 不进 map。"""
    def fake_lookup(name):
        if name == "Nature":
            return {"impactFactor": "48.5", "impactFactor5Year": None,
                    "casPartition": None, "jcrPartition": "Q1"}
        if name == "Some Conference":
            # 空壳：IF / 分区全 None
            return {"impactFactor": None, "impactFactor5Year": None,
                    "casPartition": None, "jcrPartition": None}
        return None

    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", fake_lookup)

    records = [
        {"title": "a", "venue": "Nature", "extra": {"paper_id": "A"}},
        {"title": "b", "venue": "Some Conference", "extra": {"paper_id": "B"}},
        {"title": "c", "venue": "Unknown Journal", "extra": {"paper_id": "C"}},
    ]
    out = _run(ps._compute_journal_ranks(records))
    assert "A" in out and out["A"]["jcrPartition"] == "Q1"
    assert "B" not in out, "空壳应被过滤"
    assert "C" not in out, "查不到的不进 map"


# ---------- enrich_session_async：端到端回写 ----------

def test_enrich_session_backfills_and_preserves_fields(monkeypatch, tmp_path: Path) -> None:
    """venue 空的预印本 → 反查正刊回填 + 查分区写 journalRank；
    已有字段（relevance / finalRelevance）按 handle 合并不被覆盖。"""
    # 反查：该标题 → Optics Communications
    monkeypatch.setattr(
        ps, "_lookup_published_venue",
        lambda title, year: "Optics Communications" if "wiener" in (title or "").lower() else None,
    )
    # 本地分区表：Optics Communications → 有分区
    def fake_lookup(name):
        if name == "Optics Communications":
            return {"impactFactor": "2.5", "impactFactor5Year": None,
                    "casPartition": None, "jcrPartition": "Q2"}
        return None
    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", fake_lookup)

    path = tmp_path / "s.jsonl"
    _write_jsonl(path, [{
        "title": "End-to-End Wiener-Cnn Optimization", "venue": None,
        "doi": "10.2139/ssrn.x", "turn_id": "T1",
        # 模拟 relevance-scorer 已写入 finalRelevance（合并不能丢）
        "extra": {"paper_id": "P1", "relevance": 70, "finalRelevance": 95},
    }])

    _run(ps.enrich_session_async(str(path), "T1"))

    rec = json.loads(path.read_text().strip())
    assert rec["venue"] == "Optics Communications"           # venue 回填
    assert rec["extra"]["journalRank"]["jcrPartition"] == "Q2"  # 分区写入
    assert rec["extra"]["finalRelevance"] == 95              # 不被覆盖
    assert rec["extra"]["relevance"] == 70                   # F22 保留


def test_enrich_session_no_venue_no_rank_leaves_file(monkeypatch, tmp_path: Path) -> None:
    """反查不到 venue、查不到分区 → 不写 journalRank、venue 保持 None。"""
    monkeypatch.setattr(ps, "_lookup_published_venue", lambda title, year: None)
    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", lambda name: None)

    path = tmp_path / "s.jsonl"
    _write_jsonl(path, [{
        "title": "Obscure preprint", "venue": None, "turn_id": "T1",
        "extra": {"paper_id": "P1"},
    }])
    _run(ps.enrich_session_async(str(path), "T1"))

    rec = json.loads(path.read_text().strip())
    assert rec.get("venue") is None
    assert "journalRank" not in (rec.get("extra") or {})


# ---------- _atomic_rewrite_jsonl ----------

def test_enrich_only_queries_top_n_venues(monkeypatch, tmp_path: Path) -> None:
    """富化只对 F22 排序的 top-N 篇查分区，避免大候选集拖垮后台任务。"""
    monkeypatch.setattr(ps, "_ENRICH_TOP_N", 3)
    monkeypatch.setattr(ps, "_lookup_published_venue", lambda t, y: None)
    queried: list[str] = []

    def fake_lookup(name):
        queried.append(name)
        return {"impactFactor": "5", "impactFactor5Year": None,
                "casPartition": None, "jcrPartition": "Q2"}

    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", fake_lookup)

    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        for i in range(8):  # relevance 0,10,...,70
            f.write(json.dumps({
                "title": f"p{i}", "venue": f"Journal {i}", "turn_id": "t1",
                "extra": {"paper_id": f"P{i}", "relevance": i * 10},
            }, ensure_ascii=False) + "\n")

    _run(ps.enrich_session_async(str(p), "t1"))
    # 只查 F22 最高的 3 篇（relevance 70/60/50 → Journal 7/6/5）
    assert sorted(queried) == ["Journal 5", "Journal 6", "Journal 7"]


def test_enrich_preserves_scorer_score(monkeypatch, tmp_path: Path) -> None:
    """enrich 不能覆盖 scorer 已写的 score(method≠null)：保留 semantic+method，只重算确定性维。"""
    monkeypatch.setattr(ps, "_lookup_published_venue", lambda t, y: None)
    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", lambda name: None)

    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "x", "year": 2024, "venue": "Nature", "turn_id": "t1",
        "extra": {
            "paper_id": "P1", "keywordRelevance": 20,
            # scorer 已写的 score（method 非 null）
            "score": {"scores": {"semantic_relevance": 95.0, "method_match": 90.0}},
        },
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    _run(ps.enrich_session_async(str(p), "t1"))

    sv = json.loads(p.read_text().strip())["extra"]["score"]
    assert sv["scores"]["semantic_relevance"] == 95.0   # 保留 scorer 的 semantic（非回退到 20）
    assert sv["scores"]["method_match"] == 90.0          # 保留 scorer 的 method（非被抹成 null）


def test_enrich_preserves_scorer_semantic_only(monkeypatch, tmp_path: Path) -> None:
    """#745：scorer 只给 semantic 漏 method（judged=True, method_match=None）也是「已判」，
    enrich 重算不能凭 method_match=None 当没判过、覆盖成回退基线（会丢 scorer 的 semantic +
    judged 标记，进度条随后把这篇算回「未判」→ X<Y 到不了变绿）。判「已判」须认 judged。"""
    monkeypatch.setattr(ps, "_lookup_published_venue", lambda t, y: None)
    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", lambda name: None)

    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "x", "year": 2024, "venue": "Nature", "turn_id": "t1",
        "extra": {
            "paper_id": "P1", "keywordRelevance": 20,
            # scorer 只判了 semantic、漏给 method → judged=True 标记「已判」
            "score": {"judged": True, "scores": {"semantic_relevance": 88.0, "method_match": None}},
        },
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    _run(ps.enrich_session_async(str(p), "t1"))

    sv = json.loads(p.read_text().strip())["extra"]["score"]
    assert sv["scores"]["semantic_relevance"] == 88.0   # 保留 scorer 的 semantic（非回退到 keyword 20）
    assert sv["judged"] is True                          # 仍标记已判（未被覆盖成回退基线）


def test_enrich_preserves_judged_flag_even_with_null_dims(monkeypatch, tmp_path: Path) -> None:
    """#801：apply_scoring 对模型坏维度篇写 score={judged:True, scores:{都 null}}。enrich 重算
    该已判篇时须显式保留 judged=True，不能退回「按维度推断」——否则维度全 null 时推断出 False、
    把已判篇翻回未判，进度条 X 退回卡在 (Y-1)/Y 不变绿（#801 从 enrich 路径复活）。"""
    monkeypatch.setattr(ps, "_lookup_published_venue", lambda t, y: None)
    monkeypatch.setattr(fenqu_mod, "lookup_journal_rank", lambda name: None)

    p = tmp_path / "agent-sessions-papers" / "s.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    rec = {
        "title": "x", "year": 2024, "venue": "Nature", "turn_id": "t1",
        "extra": {
            "paper_id": "P1", "keywordRelevance": 20,
            # apply_scoring 对模型坏维度篇写的：judged=True，但两维都 null
            "score": {"judged": True, "scores": {"semantic_relevance": None, "method_match": None}},
        },
    }
    p.write_text(json.dumps(rec, ensure_ascii=False) + "\n", encoding="utf-8")

    _run(ps.enrich_session_async(str(p), "t1"))

    sv = json.loads(p.read_text().strip())["extra"]["score"]
    assert sv["judged"] is True, "已判篇（judged=True）经 enrich 重算须保留 judged，不靠维度推断翻回"


def test_atomic_rewrite_no_tmp_left(tmp_path: Path) -> None:
    path = tmp_path / "s.jsonl"
    ps._atomic_rewrite_jsonl(str(path), [{"a": 1}, {"b": 2}])
    lines = path.read_text().splitlines()
    assert [json.loads(l) for l in lines] == [{"a": 1}, {"b": 2}]
    assert not (tmp_path / "s.jsonl.tmp").exists(), "临时文件应已 rename 掉"
