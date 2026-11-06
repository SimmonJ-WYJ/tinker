"""Tests for apply_rerank — Stage 3 / P1-1：rerank 分数工具回写。

验证:LLM 只给 {handle: 分数},服务端按 final=(1-w)·F22 + w·(llm×100) 就地
更新 JSONL（extra.finalRelevance / extra.llmRelevance），保留 F22 基分不变,
不匹配的 handle 计入 missing,未评分的 record 原样保留。
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from .process_service import apply_rerank


def _run(coro):
    return asyncio.run(coro)


def _write_jsonl(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def _rec(
    handle: str,
    relevance: float,
    *,
    turn: str = "t1",
    doi: str = "",
    abstract: str | None = "An abstract for this paper.",
) -> dict:
    # 默认带摘要（元数据齐全），rerank 数学测试不应被 issue #442 的缺摘要 cap 干扰
    return {
        "title": f"paper {handle}",
        "doi": doi,
        "turn_id": turn,
        "abstract": abstract,
        "extra": {"paper_id": handle, "relevance": relevance},
    }


def _papers_path(tmp_path: Path, session: str) -> Path:
    return tmp_path / "agent-sessions-papers" / f"{session}.jsonl"


def test_apply_rerank_writes_llm_as_relevance(tmp_path: Path) -> None:
    """finalRelevance = round(llm×100)（纯对题度）。llm=1.0 → 100(精确命中);
    F22 基分 extra.relevance 保留不变。"""
    p = _papers_path(tmp_path, "s1")
    _write_jsonl(p, [_rec("A", 80.0), _rec("B", 50.0)])

    res = _run(apply_rerank(
        {"A": 1.0, "B": 0.35}, session_id="s1", turn_id="t1",
        config_dir=str(tmp_path),
    ))
    assert res["updated"] == 2
    assert res["missing"] == []

    recs = {json.loads(l)["extra"]["paper_id"]: json.loads(l)
            for l in p.read_text().splitlines()}
    assert recs["A"]["extra"]["finalRelevance"] == 100  # llm 1.0 → 满分(精确命中)
    assert recs["A"]["extra"]["llmRelevance"] == 1.0
    assert recs["A"]["extra"]["relevance"] == 80.0  # F22 综合分保留(质量信号)
    assert recs["B"]["extra"]["finalRelevance"] == 35  # 0.35×100


def test_apply_rerank_clamps_and_reports_missing(tmp_path: Path) -> None:
    """llm 越界 clamp;不存在的 handle 计入 missing。"""
    p = _papers_path(tmp_path, "s2")
    _write_jsonl(p, [_rec("A", 60.0)])

    res = _run(apply_rerank(
        {"A": 2.0, "GHOST": 0.5}, session_id="s2", turn_id="t1",
        config_dir=str(tmp_path),
    ))
    assert res["updated"] == 1
    assert res["missing"] == ["GHOST"]
    rec = json.loads(p.read_text().splitlines()[0])
    assert rec["extra"]["llmRelevance"] == 1.0  # clamp 2.0 → 1.0
    assert rec["extra"]["finalRelevance"] == 100  # llm(clamp 1.0)×100


def test_apply_rerank_only_touches_target_turn(tmp_path: Path) -> None:
    """指定 turn_id 时,其它 turn 的同 handle 不被改。"""
    p = _papers_path(tmp_path, "s3")
    _write_jsonl(p, [_rec("A", 70.0, turn="t1"), _rec("A", 70.0, turn="t2")])

    _run(apply_rerank({"A": 0.8}, session_id="s3", turn_id="t2",
                      config_dir=str(tmp_path)))
    lines = [json.loads(l) for l in p.read_text().splitlines()]
    by_turn = {r["turn_id"]: r for r in lines}
    assert "finalRelevance" not in by_turn["t1"]["extra"], "t1 不应被改"
    assert by_turn["t2"]["extra"]["finalRelevance"] == 80  # 0.8×100


def test_apply_rerank_empty_scores_errors(tmp_path: Path) -> None:
    res = _run(apply_rerank({}, session_id="s", config_dir=str(tmp_path)))
    assert "error" in res


def test_apply_rerank_caps_missing_abstract(tmp_path: Path) -> None:
    """issue #442：缺摘要论文即便 LLM 给近满分，finalRelevance 也被硬上限到
    MISSING_ABSTRACT_CAP——这是用户可见字段，必须反映元数据完整度。"""
    from .scoring import MISSING_ABSTRACT_CAP

    p = _papers_path(tmp_path, "s_cap")
    _write_jsonl(p, [
        _rec("NOABS", 90.0, abstract=None),
        _rec("BLANK", 90.0, abstract="   "),
        _rec("FULL", 90.0, abstract="Real abstract."),
    ])

    _run(apply_rerank(
        {"NOABS": 0.95, "BLANK": 0.95, "FULL": 0.95},
        session_id="s_cap", turn_id="t1", config_dir=str(tmp_path),
    ))
    recs = {json.loads(l)["extra"]["paper_id"]: json.loads(l)
            for l in p.read_text().splitlines()}
    # 缺/空摘要：llm 0.95→95 被压到 cap
    assert recs["NOABS"]["extra"]["finalRelevance"] == MISSING_ABSTRACT_CAP
    assert recs["BLANK"]["extra"]["finalRelevance"] == MISSING_ABSTRACT_CAP
    # 原始 llm 分仍如实保留，供解释
    assert recs["NOABS"]["extra"]["llmRelevance"] == 0.95
    # 元数据齐全：不受影响
    assert recs["FULL"]["extra"]["finalRelevance"] == 95


def test_apply_rerank_missing_abstract_below_cap_unchanged(tmp_path: Path) -> None:
    """缺摘要但 LLM 本就给低分（<cap）时，不被 cap 抬高。"""
    from .scoring import MISSING_ABSTRACT_CAP

    p = _papers_path(tmp_path, "s_low")
    _write_jsonl(p, [_rec("LOW", 90.0, abstract=None)])
    _run(apply_rerank({"LOW": 0.2}, session_id="s_low", turn_id="t1",
                      config_dir=str(tmp_path)))
    rec = json.loads(p.read_text().splitlines()[0])
    assert rec["extra"]["finalRelevance"] == 20
    assert 20 <= MISSING_ABSTRACT_CAP
