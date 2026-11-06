"""V2 评分窗口分片 + 并发回写测试（issue #689）。

覆盖：候选窗口分片不相交+合并完整、空 shard、越界 shard 参数、单 scorer fallback、
并发 apply_scoring 写回不丢分。
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from .process_service import (
    _emit_scoring_progress,
    apply_scoring,
    get_scoring_shard,
    select_scoring_window,
)
from .live_progress import live_file_path


def _write_session(tmp_path: Path, session_id: str, papers: list[dict]) -> Path:
    p = tmp_path / "agent-sessions-papers" / f"{session_id}.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        for rec in papers:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return p


def _read_records(tmp_path: Path, session_id: str) -> list[dict]:
    p = tmp_path / "agent-sessions-papers" / f"{session_id}.jsonl"
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def _paper(pid: str, relevance: float, turn: str = "t1") -> dict:
    return {
        "title": f"Paper {pid}",
        "year": 2024,
        "venue": "Nature",
        "abstract": f"Abstract for {pid} about deep learning.",
        "source": "tool:MCP:paper-search:openalex",
        "turn_id": turn,
        "ts": "2026-06-23T00:00:00+00:00",
        "extra": {"paper_id": pid, "relevance": relevance},
    }


def test_window_sharding_disjoint_and_complete(tmp_path: Path) -> None:
    """N shard 互不重叠、合并后 == 完整 V2 scoring window。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(12)]  # 全 >50 → window=12
    _write_session(tmp_path, "s1", papers)

    _, window = select_scoring_window(papers, turn_id="t1")
    assert len(window) == 12
    window_handles = [w["extra"]["paper_id"] for w in window]

    seen: list[str] = []
    sizes: list[int] = []
    for idx in range(3):
        res = asyncio.run(get_scoring_shard(idx, shard_count=3, session_id="s1",
                                            turn_id="t1", config_dir=str(tmp_path)))
        assert res["window_total"] == 12
        assert res["shard_index"] == idx and res["shard_count"] == 3
        handles = [c["handle"] for c in res["candidates"]]
        assert len(handles) == res["shard_size"]
        sizes.append(res["shard_size"])
        seen.extend(handles)

    assert sizes == [4, 4, 4]                       # round-robin 均分
    assert len(seen) == len(set(seen)) == 12        # 互不重叠
    assert set(seen) == set(window_handles)         # 合并即完整窗口


def test_single_shard_fallback_returns_full_window(tmp_path: Path) -> None:
    """单 scorer fallback：shard_count=1 / shard_index=0 → 整窗。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(8)]
    _write_session(tmp_path, "s1", papers)
    res = asyncio.run(get_scoring_shard(0, shard_count=1, session_id="s1",
                                        turn_id="t1", config_dir=str(tmp_path)))
    assert res["shard_size"] == res["window_total"] == 8


def test_empty_shard_is_explainable_not_error(tmp_path: Path) -> None:
    """窗口比 shard_count 小 → 末尾 shard 为空，返回 scored-able 空结果 + note，不报错。"""
    papers = [_paper("P0", relevance=80), _paper("P1", relevance=70)]  # window=2
    _write_session(tmp_path, "s1", papers)
    res = asyncio.run(get_scoring_shard(2, shard_count=3, session_id="s1",
                                        turn_id="t1", config_dir=str(tmp_path)))
    assert "error" not in res
    assert res["shard_size"] == 0
    assert res["candidates"] == []
    assert "note" in res


def test_no_candidates_window_is_explainable(tmp_path: Path) -> None:
    """无候选（空 session）→ window_total 0、candidates []、note，不报错。"""
    _write_session(tmp_path, "s1", [])
    res = asyncio.run(get_scoring_shard(0, shard_count=3, session_id="s1",
                                        turn_id="t1", config_dir=str(tmp_path)))
    assert "error" not in res
    assert res["window_total"] == 0 and res["shard_size"] == 0
    assert "note" in res


def test_out_of_bounds_shard_params_error(tmp_path: Path) -> None:
    """越界 shard 参数报明确错误（不静默返回错分片）。"""
    _write_session(tmp_path, "s1", [_paper("P0", relevance=80)])
    # shard_index 越界
    bad_idx = asyncio.run(get_scoring_shard(3, shard_count=3, session_id="s1",
                                            turn_id="t1", config_dir=str(tmp_path)))
    assert "error" in bad_idx
    neg_idx = asyncio.run(get_scoring_shard(-1, shard_count=3, session_id="s1",
                                            turn_id="t1", config_dir=str(tmp_path)))
    assert "error" in neg_idx
    # shard_count 非法
    bad_cnt = asyncio.run(get_scoring_shard(0, shard_count=0, session_id="s1",
                                            turn_id="t1", config_dir=str(tmp_path)))
    assert "error" in bad_cnt


def test_concurrent_apply_scoring_no_lost_updates(tmp_path: Path) -> None:
    """3 个 shard 并发对各自 handle 子集回写 score，互不覆盖、全部落盘（不丢分）。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(9)]
    p = _write_session(tmp_path, "s1", papers)

    _, window = select_scoring_window(papers, turn_id="t1")
    handles = [w["extra"]["paper_id"] for w in window]
    shards = [handles[i::3] for i in range(3)]  # 不相交 handle 子集

    async def _run() -> list[dict]:
        return await asyncio.gather(*[
            apply_scoring(
                {h: {"semantic": 80, "method": 70} for h in shard},
                session_id="s1", turn_id="t1",
                config_dir=str(tmp_path), now_year=2026,
            )
            for shard in shards
        ])

    results = asyncio.run(_run())
    # 每个 shard 各自命中自己的 handle 数
    assert sorted(r["scored"] for r in results) == sorted(len(s) for s in shards)

    # 关键：所有 9 篇都写上了 score —— 没有后写 shard 用旧快照覆盖先写 shard 的分。
    lines = [json.loads(l) for l in p.read_text().splitlines()]
    scored_handles = {r["extra"]["paper_id"] for r in lines if "score" in r.get("extra", {})}
    assert scored_handles == set(handles)
    assert len(scored_handles) == 9


def test_enrich_and_apply_scoring_concurrent_no_lost_updates(monkeypatch, tmp_path: Path) -> None:
    """后台 enrich 与 scorer shard 的 apply_scoring 并发跑同一份 JSONL：两者的写都不丢。

    回归 #689 review #1：apply_scoring 引入 await(to_thread) 后产生 yield，若 enrich 的
    read→merge→rewrite 不进同一把写锁，enrich 会用"读时还没有 scorer 分"的旧快照把 shard 刚写的
    LLM method 覆盖成 keyword 回退（method=null）。两段同锁串行化后，无论谁先跑，scorer 判过的
    method 都保留。
    """
    import paper_search.connectors.fenqu_local as fenqu_mod
    from . import process_service as ps

    # enrich 写入一个真实 journalRank（它"会丢的东西"），scorer 写入 LLM semantic/method。
    # 两者落在同一份 JSONL 的不同字段：未串行化时，谁的整份重写后落地，对方的写就被旧快照覆盖。
    monkeypatch.setattr(ps, "_lookup_published_venue", lambda t, y: None)
    monkeypatch.setattr(
        fenqu_mod, "lookup_journal_rank",
        lambda name: {"jcrPartition": "Q1", "impactFactor": "50.0"},
    )

    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    p = _write_session(tmp_path, "s1", papers)
    _, window = select_scoring_window(papers, turn_id="t1")
    handles = [w["extra"]["paper_id"] for w in window]

    async def _run() -> None:
        await asyncio.gather(
            apply_scoring(
                {h: {"semantic": 88, "method": 77} for h in handles},
                session_id="s1", turn_id="t1", config_dir=str(tmp_path), now_year=2026,
            ),
            ps.enrich_session_async(str(p), "t1"),
        )

    asyncio.run(_run())

    lines = [json.loads(line) for line in p.read_text().splitlines()]
    for r in lines:
        extra = r["extra"]
        # 串行化后两边的写都在：scorer 的 semantic/method 与 enrich 的 journalRank 同时存在。
        assert extra.get("journalRank") == {"jcrPartition": "Q1", "impactFactor": "50.0"}
        assert extra["score"]["scores"]["method_match"] == 77.0
        assert extra["score"]["scores"]["semantic_relevance"] == 88.0


# ===== apply_scoring 0 命中兜底（issue #805）=====


def test_apply_scoring_all_handles_mismatch_is_error(tmp_path: Path) -> None:
    """AC①/⑤①：judge 返回非空 handle 映射、但 handle 全不匹配本轮任何 record（如 example-first
    的示例对象 handle）时，apply_scoring 返回带 error 的结果——与正常 scored:0 区分，不静默丢分。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(3)]
    _write_session(tmp_path, "s1", papers)

    res = asyncio.run(
        apply_scoring(
            {"example": {"semantic": 0, "method": 0}, "sample": {"semantic": 50, "method": 50}},
            session_id="s1", turn_id="t1", config_dir=str(tmp_path), now_year=2026,
        )
    )

    assert "error" in res
    assert res["scored"] == 0
    # 一篇都不该被写分（handle 全不对，未误写）
    records = _read_records(tmp_path, "s1")
    assert all("score" not in r.get("extra", {}) for r in records)


def test_apply_scoring_all_blank_handles_is_error(tmp_path: Path) -> None:
    """AC①边界（#805 /review）：judge 返回非空 scores 但 handle 全为空白字符串（norm 去空白后为空）
    时，仍应报 error、不静默 scored:0——「非空 scores + 0 命中」黑洞的另一残留角落，与 handle 全不
    匹配同源。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(3)]
    _write_session(tmp_path, "s1", papers)

    res = asyncio.run(
        apply_scoring(
            {"": {"semantic": 0, "method": 0}, "   ": {"semantic": 50, "method": 50}},
            session_id="s1", turn_id="t1", config_dir=str(tmp_path), now_year=2026,
        )
    )

    assert "error" in res
    assert res["scored"] == 0
    records = _read_records(tmp_path, "s1")
    assert all("score" not in r.get("extra", {}) for r in records)


def test_apply_scoring_partial_match_is_ok(tmp_path: Path) -> None:
    """AC⑤②：部分 handle 命中（含一个不存在的 handle）→ 命中的正常回写、不报错。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(3)]
    _write_session(tmp_path, "s1", papers)

    res = asyncio.run(
        apply_scoring(
            {"P0": {"semantic": 80, "method": 70}, "ghost": {"semantic": 60, "method": 60}},
            session_id="s1", turn_id="t1", config_dir=str(tmp_path), now_year=2026,
        )
    )

    assert "error" not in res
    assert res["scored"] == 1
    assert res["missing"] == ["ghost"]
    scored = {r["extra"]["paper_id"] for r in _read_records(tmp_path, "s1") if "score" in r["extra"]}
    assert scored == {"P0"}


def test_apply_scoring_empty_turn_no_false_error(tmp_path: Path) -> None:
    """AC④/⑤③：本轮无 record（total_in_turn==0，合法空窗口的等价情形）时，即便传入非空 scores
    也不误报 error——0 命中源于「没东西可评」，不是 handle 不匹配。"""
    papers = [_paper(f"P{i}", relevance=90 - i, turn="t0") for i in range(3)]
    _write_session(tmp_path, "s1", papers)

    res = asyncio.run(
        apply_scoring(
            {"P0": {"semantic": 80, "method": 70}},
            session_id="s1", turn_id="t1",  # t1 无任何 record
            config_dir=str(tmp_path), now_year=2026,
        )
    )

    assert "error" not in res
    assert res["scored"] == 0
    assert res["total_in_turn"] == 0


def test_select_scoring_window_picks_latest_turn(tmp_path: Path) -> None:
    """不传 turn_id 时取 ts 最新的 turn；旧 turn 不进窗口。"""
    old = [{**_paper(f"O{i}", 80, turn="t0"), "ts": "2026-06-22T00:00:00+00:00"} for i in range(3)]
    new = [{**_paper(f"N{i}", 80, turn="t1"), "ts": "2026-06-23T00:00:00+00:00"} for i in range(4)]
    resolved, window = select_scoring_window(old + new)
    assert resolved == "t1"
    assert {w["extra"]["paper_id"] for w in window} == {"N0", "N1", "N2", "N3"}


# ===== #775 scorer 进度续写 _emit_scoring_progress（A③/A④ 回归守护）=====


def _has_live(tmp_path: Path, session_id: str) -> bool:
    import os
    return os.path.exists(live_file_path(str(tmp_path), session_id))


def _read_live(tmp_path: Path, session_id: str) -> dict:
    with open(live_file_path(str(tmp_path), session_id), encoding="utf-8") as f:
        return json.load(f)


def test_emit_scoring_progress_empty_window_no_frame(tmp_path: Path) -> None:
    """A④：空 window（无候选过阈值）不写 scoring 帧——避免面板蹦「正在评分 (0/0)」。"""
    _emit_scoring_progress([], "t1", "sess-empty", str(tmp_path))
    assert not _has_live(tmp_path, "sess-empty")


def test_score_is_judged_single_source() -> None:
    """#801：_score_is_judged 是「是否 LLM 判过」的单一事实源——优先 judged 标记，旧 JSONL
    无该字段兜底 method_match 非 null。_is_scored（进度条）/ enrich / apply_rerank 三处共用，
    杜绝各自手写副本口径漂移。"""
    from .process_service import _score_is_judged
    assert _score_is_judged({"judged": True, "scores": {}}) is True
    # 标记优先于维度值：judged=False 即便 method 有值也算未判（enrich 回退基线）
    assert _score_is_judged({"judged": False, "scores": {"method_match": 60}}) is False
    # 旧 JSONL 无 judged → 兜底看 method_match
    assert _score_is_judged({"scores": {"method_match": 60}}) is True
    assert _score_is_judged({"scores": {"method_match": None}}) is False
    # 非法/空输入安全兜底
    assert _score_is_judged(None) is False
    assert _score_is_judged({}) is False


def test_emit_scoring_progress_counts_judged_only(tmp_path: Path) -> None:
    """A③：X 数「LLM 判过」的篇（extra.score.judged=True），**不**数 enrich 回退基线。
    #745 时序竞态：enrich 后台对本轮每篇都写 score（judged=False, method_match=None），
    若按 score 存在性数 X，enrich 抢在 score_window 开工帧前跑完时，开工帧 X==Y 会假报
    「评分完成」（实际 LLM judge 才刚发起）。judged=True 覆盖 scorer 只给 semantic 漏
    method 的已判篇（method_match=None 仍算判过），保证能到 X==Y 变绿。"""
    window = [
        {"extra": {"score": {"judged": True, "scores": {"semantic_relevance": 80, "method_match": 60}}}},   # LLM 判过(全给)
        {"extra": {"score": {"judged": True, "scores": {"semantic_relevance": 75, "method_match": None}}}},  # LLM 判过(漏 method)
        {"extra": {"score": {"judged": False, "scores": {"semantic_relevance": 40, "method_match": None}}}},  # enrich 回退基线（未判）
        {"extra": {"relevance": 70}},  # 未判（无 score）
    ]
    _emit_scoring_progress(window, "t1", "sess-x", str(tmp_path))
    state = _read_live(tmp_path, "sess-x")
    assert state["phase"] == "scoring"
    assert state["score_total"] == 4
    assert state["scored"] == 2, "只数 judged=True 的 LLM 已判篇，enrich 回退基线不计入"


def test_emit_scoring_progress_counts_legacy_scorev2_key(tmp_path: Path) -> None:
    """评分键由 scoreV2 重命名为 score；旧会话 window 仍带 extra.scoreV2，存在性判定须兜底计入 X。"""
    window = [
        {"extra": {"scoreV2": {"scores": {"semantic_relevance": 80, "method_match": 60}}}},  # 旧键已判
        {"extra": {"relevance": 70}},  # 未判
    ]
    _emit_scoring_progress(window, "t1", "sess-legacy", str(tmp_path))
    state = _read_live(tmp_path, "sess-legacy")
    assert state["score_total"] == 2
    assert state["scored"] == 1, "旧键 scoreV2 的已判篇应经兜底计入 X"
