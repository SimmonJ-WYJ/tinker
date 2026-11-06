"""score_window 工具单测（#745 scorer 下沉）。

score_window：读 JSONL → select_scoring_window → round-robin 切批 →
asyncio.gather 并发判分（barrier）→ apply_scoring 写回。注入 fake judge_fn 验证
编排（并发 / barrier / 空窗口 / 写回），不碰真实模型 http。
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from .live_progress import live_file_path
from .process_service import score_window


def _write_session(tmp_path: Path, session_id: str, papers: list[dict]) -> Path:
    p = tmp_path / "agent-sessions-papers" / f"{session_id}.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        for rec in papers:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return p


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


def _read_records(tmp_path: Path, session_id: str) -> list[dict]:
    p = tmp_path / "agent-sessions-papers" / f"{session_id}.jsonl"
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_score_window_judges_all_shards_and_writes_back(tmp_path: Path) -> None:
    """6 候选切 3 批并发判分，全部回写 extra.score，scored==6、零失败。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    _write_session(tmp_path, "s1", papers)

    calls: list[list[str]] = []

    async def fake_judge(candidates, research_question, method_terms, object_terms):
        calls.append([c["handle"] for c in candidates])
        return {c["handle"]: {"semantic": 80, "method": 70} for c in candidates}

    res = asyncio.run(
        score_window(
            research_question="deep learning", method_terms=[], object_terms=[],
            shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
            judge_fn=fake_judge,
        )
    )

    assert res["window_total"] == 6
    assert res["scored"] == 6
    assert res["missing"] == 0  # 计数语义恒为 int（不透传 apply_scoring 的 list）
    assert res["failed_shards"] == 0
    assert len(calls) == 3  # 切成 3 批
    judged = sorted(h for batch in calls for h in batch)
    assert judged == sorted(f"P{i}" for i in range(6))  # 不重不漏
    records = _read_records(tmp_path, "s1")
    assert all("score" in r["extra"] for r in records)  # 全部回写


def test_score_window_barrier_one_batch_fails_others_complete(tmp_path: Path) -> None:
    """某批判分抛异常时，其余批照常完成回写、计入 failed_shards（barrier）。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    _write_session(tmp_path, "s1", papers)
    # window 按 F22 desc = P0..P5；shard_count=3 → batch0=[P0,P3] batch1=[P1,P4] batch2=[P2,P5]

    async def fake_judge(candidates, research_question, method_terms, object_terms):
        if any(c["handle"] == "P0" for c in candidates):  # 让含 P0 的批失败
            raise RuntimeError("model timeout")
        return {c["handle"]: {"semantic": 80, "method": 70} for c in candidates}

    res = asyncio.run(
        score_window(
            research_question="q", method_terms=[], object_terms=[],
            shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
            judge_fn=fake_judge,
        )
    )

    assert res["failed_shards"] == 1
    assert res["scored"] == 4  # 其余 2 批 4 篇正常
    scored = {r["extra"]["paper_id"] for r in _read_records(tmp_path, "s1") if "score" in r["extra"]}
    assert "P0" not in scored and "P3" not in scored  # 失败批未回写
    assert {"P1", "P2", "P4", "P5"} <= scored


def test_score_window_zero_hit_shard_counts_as_failed(tmp_path: Path) -> None:
    """AC②（issue #805）：某批 judge 返回非空映射、但 handle 全不匹配本轮 record（如 example-first
    先输出示例对象）时，该批计入 failed_shards、不被当成功；其余批正常回写。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    _write_session(tmp_path, "s1", papers)
    # shard_count=3 → batch0=[P0,P3] batch1=[P1,P4] batch2=[P2,P5]

    async def fake_judge(candidates, research_question, method_terms, object_terms):
        if any(c["handle"] == "P0" for c in candidates):
            # 模型输出了结构合法但 handle 全不对的对象（示例对象），解析层无法区分
            return {"example": {"semantic": 0, "method": 0}}
        return {c["handle"]: {"semantic": 80, "method": 70} for c in candidates}

    res = asyncio.run(
        score_window(
            research_question="q", method_terms=[], object_terms=[],
            shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
            judge_fn=fake_judge,
        )
    )

    assert res["failed_shards"] == 1  # 0 命中批被计入失败，而非静默 scored:0 成功
    assert res["scored"] == 4  # 其余 2 批 4 篇正常
    scored = {r["extra"]["paper_id"] for r in _read_records(tmp_path, "s1") if "score" in r["extra"]}
    assert "P0" not in scored and "P3" not in scored  # 0 命中批未回写
    assert {"P1", "P2", "P4", "P5"} <= scored


def test_score_window_empty_window_skips_judge(tmp_path: Path) -> None:
    """该 turn 无候选时，不调 judge、不报错，返回 window_total=0 + note。"""
    _write_session(tmp_path, "s1", [])  # 空 session
    called = False

    async def fake_judge(*args, **kwargs):
        nonlocal called
        called = True
        return {}

    res = asyncio.run(
        score_window(
            research_question="q", method_terms=[], object_terms=[],
            shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
            judge_fn=fake_judge,
        )
    )

    assert res["window_total"] == 0
    assert res["scored"] == 0
    assert called is False
    assert "note" in res


def test_score_window_emits_scoring_start_frame_before_judging(tmp_path: Path) -> None:
    """#775 衔接：发起并发 judge 前先写开工帧（phase=scoring, scored=0, score_total=Y），
    消除「searcher 跑完→打分」期间面板死等（score_window 不走 get_scoring_shard，须自己补这帧）。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    _write_session(tmp_path, "s1", papers)
    seen: dict = {}

    async def fake_judge(candidates, research_question, method_terms, object_terms):
        if "frame" not in seen:  # 首个 judge 被调时，开工帧应已落盘（在 gather 之前写）
            with open(live_file_path(str(tmp_path), "s1"), encoding="utf-8") as f:
                seen["frame"] = json.load(f)
        return {c["handle"]: {"semantic": 80, "method": 70} for c in candidates}

    asyncio.run(
        score_window(
            research_question="q", method_terms=[], object_terms=[],
            shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
            judge_fn=fake_judge,
        )
    )

    assert seen["frame"]["phase"] == "scoring"
    assert seen["frame"]["scored"] == 0  # 判分前无 score
    assert seen["frame"]["score_total"] == 6


def test_score_window_progress_increments_per_shard(tmp_path: Path, monkeypatch) -> None:
    """评分进度 X 应随分片逐次完成递增（0→中间→Y），而非从 0 直接跳到 Y。
    每片判完即 apply_scoring 写回并刷新帧 → 面板有中间过程。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    _write_session(tmp_path, "s1", papers)

    import paper_search.service.live_progress as lp
    frames: list = []
    orig = lp.write_scoring_progress

    def spy(config_dir, session_id, turn_id, scored, score_total):
        frames.append((scored, score_total))
        return orig(config_dir, session_id, turn_id, scored, score_total)

    monkeypatch.setattr(lp, "write_scoring_progress", spy)

    async def fake_judge(candidates, research_question, method_terms, object_terms):
        return {c["handle"]: {"semantic": 80, "method": 70} for c in candidates}

    asyncio.run(
        score_window(
            research_question="q", method_terms=[], object_terms=[],
            shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
            judge_fn=fake_judge,
        )
    )

    scored_seq = [s for s, _ in frames]
    assert scored_seq[0] == 0  # 开工帧
    assert scored_seq[-1] == 6  # 结束帧 Y/Y
    assert all(total == 6 for _, total in frames)  # 分母恒为窗口大小
    assert any(0 < s < 6 for s in scored_seq), f"缺中间过程帧（0 直接跳 6）: {scored_seq}"


def test_score_window_errors_when_channel_unconfigured(tmp_path: Path, monkeypatch) -> None:
    """渠道未配置（ASCI_SCORING_* env 缺失）且未注入 judge_fn 时，返回可判定 error，
    而不是拿空渠道去 POST、N 个分片全失败留下黑盒。"""
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    _write_session(tmp_path, "s1", papers)
    monkeypatch.delenv("ASCI_SCORING_MODEL", raising=False)
    monkeypatch.delenv("ASCI_SCORING_BASE_URL", raising=False)
    monkeypatch.delenv("ASCI_SCORING_API_KEY", raising=False)

    res = asyncio.run(
        score_window(
            research_question="q", method_terms=[], object_terms=[],
            shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
            judge_fn=None,  # 走 env 默认渠道
        )
    )

    assert "error" in res
    records = _read_records(tmp_path, "s1")
    assert all("score" not in r.get("extra", {}) for r in records)  # 未误写


def test_score_window_dispatches_all_shards_before_any_returns(tmp_path: Path) -> None:
    """可判定并发：N 批在任一返回前已全部发起。

    fake_judge 进入后等「所有批都已进入」才放行——串行派发（派一个等结果）会死锁，
    只有并发（gather 同批发起）才能让全部进入并通过。wait_for 兜底防 hang。
    """
    papers = [_paper(f"P{i}", relevance=90 - i) for i in range(6)]
    _write_session(tmp_path, "s1", papers)
    expected_batches = 3
    started = 0
    all_started = asyncio.Event()

    async def fake_judge(candidates, research_question, method_terms, object_terms):
        nonlocal started
        started += 1
        if started == expected_batches:
            all_started.set()
        await all_started.wait()  # 串行派发时此处永久阻塞 → wait_for 超时失败
        return {c["handle"]: {"semantic": 80, "method": 70} for c in candidates}

    async def _run():
        return await asyncio.wait_for(
            score_window(
                research_question="q", method_terms=[], object_terms=[],
                shard_count=3, session_id="s1", turn_id="t1", config_dir=str(tmp_path),
                judge_fn=fake_judge,
            ),
            timeout=5,
        )

    res = asyncio.run(_run())
    assert started == 3  # 三批全部发起
    assert res["scored"] == 6
