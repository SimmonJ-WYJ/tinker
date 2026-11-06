"""LiveProgress（live 进度文件）单测 + retrieve 集成回归。

覆盖：
  · on_source_done 累积每源 count / verdict 状态机（pending→ok/empty/failed，failed 可升回 ok）
  · records 按 PaperRecord 形状写入、带 turn_id、live 内部按 record_key 去重、上限截断
  · set_phase / finalize 生命周期；原子写无 .tmp 残留
  · session_id 为空 → 全程 no-op 不落盘
  · retrieve 集成：fan-out 期间 live 文件存在（phase=searching），结束后被删、
    canonical JSONL 正常落盘（零回归）
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

from .live_progress import (
    LIVE_RECORDS_CAP,
    LiveProgress,
    live_file_path,
    write_processing_progress,
    write_scoring_progress,
)
from .search_service import PaperSearchService
from ..models.paper import Paper


def _run(coro):
    return asyncio.run(coro)


def _paper(pid: str, title: str, *, doi: str = "", source: str = "") -> Paper:
    return Paper(
        paper_id=pid, title=title, doi=doi, abstract="abs",
        published_date=datetime(2024, 1, 1), source=source,
        url=f"https://example.org/{pid}",
    )


def _read_live(config_dir: str, session_id: str) -> dict:
    with open(live_file_path(config_dir, session_id), encoding="utf-8") as f:
        return json.load(f)


# ===== #775：retrieve 之后 scorer / report 阶段的进度续写 =====


def test_write_processing_progress(tmp_path: Path) -> None:
    """补摘要进度：phase=processing + processed/process_total（「补全摘要 X/Y」数据源）。"""
    write_processing_progress(str(tmp_path), "sess-proc", "turn-p", enriched=6, enrich_total=30)
    state = _read_live(str(tmp_path), "sess-proc")
    assert state["phase"] == "processing"
    assert state["processed"] == 6
    assert state["process_total"] == 30
    assert state["turn_id"] == "turn-p"


def test_write_processing_progress_preserves_records(tmp_path: Path) -> None:
    """processing 在 canonical 落地前，面板靠 live.records 渲染——续写补摘要进度必须
    保留 searching 阶段累积的 records/sources/raw_total，不能整片覆写成空（否则面板「暂无结果」）。"""
    live = LiveProgress(
        session_id="sess-keep", turn_id="t-keep",
        requested_sources=["openalex"], config_dir=str(tmp_path),
    )
    live.on_source_done("openalex", [_paper("p1", "T1"), _paper("p2", "T2")], True)
    live.set_phase("processing")

    write_processing_progress(str(tmp_path), "sess-keep", "t-keep", enriched=1, enrich_total=2)
    state = _read_live(str(tmp_path), "sess-keep")
    assert state["phase"] == "processing"
    assert state["processed"] == 1 and state["process_total"] == 2
    assert len(state["records"]) == 2, "补摘要续写丢失了流式 records"
    assert state["raw_total"] == 2
    assert "openalex" in state["sources"]


def test_write_processing_progress_empty_session_noop(tmp_path: Path) -> None:
    """session_id 为空 → no-op，不落盘（enrich 仍正常跑，进度只是不显示）。"""
    write_processing_progress(str(tmp_path), "", "t", 1, 2)
    assert not list(Path(tmp_path).glob("*.live.json"))


def test_write_scoring_progress(tmp_path: Path) -> None:
    """scorer 进度：phase=scoring + scored/score_total（「已评分 X/Y」数据源）。"""
    write_scoring_progress(str(tmp_path), "sess-score", "turn-x", scored=17, score_total=50)
    state = _read_live(str(tmp_path), "sess-score")
    assert state["phase"] == "scoring"
    assert state["scored"] == 17
    assert state["score_total"] == 50
    assert state["turn_id"] == "turn-x"


def test_scoring_empty_session_noop(tmp_path: Path) -> None:
    """session_id 为空 / None → no-op，不落任何文件（与 LiveProgress 语义一致）。"""
    write_scoring_progress(str(tmp_path), "", "t", 1, 2)
    write_scoring_progress(str(tmp_path), None, "t", 1, 2)
    assert not list(Path(tmp_path).glob("*.live.json"))


def test_on_source_done_accumulates_and_verdict_transitions(tmp_path: Path) -> None:
    live = LiveProgress(
        session_id="sess-live", turn_id="turn1",
        requested_sources=["openalex", "arxiv", "crossref"],
        config_dir=str(tmp_path),
    )
    # 初始化即写盘：全源 pending
    state = _read_live(str(tmp_path), "sess-live")
    assert state["phase"] == "searching"
    assert state["turn_id"] == "turn1"
    assert all(s["verdict"] == "pending" for s in state["sources"].values())

    # openalex cell 1 返回 2 篇 → ok
    live.on_source_done("openalex", [_paper("oa1", "T1"), _paper("oa2", "T2")], True)
    # arxiv cell 失败 → failed
    live.on_source_done("arxiv", [], False)
    # crossref cell 成功但 0 篇 → empty
    live.on_source_done("crossref", [], True)
    state = _read_live(str(tmp_path), "sess-live")
    assert state["sources"]["openalex"] == {"verdict": "ok", "count": 2}
    assert state["sources"]["arxiv"]["verdict"] == "failed"
    assert state["sources"]["crossref"]["verdict"] == "empty"
    assert state["raw_total"] == 2

    # arxiv 重试成功 → 升回 ok；ok 不被后续 failed cell 降级
    live.on_source_done("arxiv", [_paper("ax1", "T3")], True)
    live.on_source_done("openalex", [], False)
    state = _read_live(str(tmp_path), "sess-live")
    assert state["sources"]["arxiv"]["verdict"] == "ok"
    assert state["sources"]["openalex"]["verdict"] == "ok"

    # records 为 PaperRecord 形状且带 turn_id
    rec = state["records"][0]
    for field in ("ts", "source", "title", "authors", "year", "doi", "url", "abstract"):
        assert field in rec, f"records 缺 PaperRecord 字段 {field}"
    assert rec["turn_id"] == "turn1"
    assert rec["source"] == "tool:MCP:paper-search:openalex"
    live.finalize()


def test_records_dedupe_and_cap(tmp_path: Path) -> None:
    live = LiveProgress(
        session_id="sess-cap", turn_id="t",
        requested_sources=["openalex"], config_dir=str(tmp_path),
    )
    # 同一篇（同 paper_id → 同 record_key）重复返回只记一条
    live.on_source_done("openalex", [_paper("dup", "Same")], True)
    live.on_source_done("openalex", [_paper("dup", "Same")], True)
    state = _read_live(str(tmp_path), "sess-cap")
    assert len(state["records"]) == 1
    assert state["raw_total"] == 2  # 原始命中如实累计

    # 超过 LIVE_RECORDS_CAP 截断，raw_total 不截断
    big = [_paper(f"p{i}", f"Title {i}") for i in range(LIVE_RECORDS_CAP + 50)]
    live.on_source_done("openalex", big, True)
    state = _read_live(str(tmp_path), "sess-cap")
    assert len(state["records"]) == LIVE_RECORDS_CAP
    assert state["raw_total"] == 2 + LIVE_RECORDS_CAP + 50
    live.finalize()


def test_phase_finalize_and_no_tmp_leftover(tmp_path: Path) -> None:
    live = LiveProgress(
        session_id="sess-phase", turn_id="t",
        requested_sources=["openalex"], config_dir=str(tmp_path),
    )
    live.set_phase("processing")
    assert _read_live(str(tmp_path), "sess-phase")["phase"] == "processing"

    papers_dir = tmp_path / "agent-sessions-papers"
    assert not [p for p in papers_dir.iterdir() if p.name.endswith(".tmp")], "原子写残留 .tmp"

    live.finalize()
    assert not os.path.exists(live_file_path(str(tmp_path), "sess-phase"))
    # 二次 finalize 幂等不抛
    live.finalize()


def test_noop_without_session_id(tmp_path: Path) -> None:
    live = LiveProgress(
        session_id="", turn_id="t", requested_sources=["openalex"],
        config_dir=str(tmp_path),
    )
    live.on_source_done("openalex", [_paper("p1", "T")], True)
    live.set_phase("processing")
    live.finalize()
    assert not (tmp_path / "agent-sessions-papers").exists()


# ===== retrieve 集成 =====


class _LiveSpyConnector:
    """search() 被调时偷看 live 文件状态（此时 fan-out 进行中）。"""

    def __init__(self, papers: list[Paper], config_dir: str, session_id: str):
        self._papers = papers
        self._config_dir = config_dir
        self._session_id = session_id
        self.live_seen_during_search: dict | None = None

    def search(self, query: str, max_results: int = 10, **kwargs):
        path = live_file_path(self._config_dir, self._session_id)
        if os.path.exists(path) and self.live_seen_during_search is None:
            with open(path, encoding="utf-8") as f:
                self.live_seen_during_search = json.load(f)
        return list(self._papers)


class _FakeRegistry:
    def __init__(self, mapping: dict[str, object]):
        self._m = mapping

    def get(self, name: str):
        return self._m.get(name)


def test_retrieve_live_lifecycle_and_canonical_unaffected(tmp_path: Path) -> None:
    session_id = "sess-live-e2e"
    oa = _LiveSpyConnector(
        [_paper("oa1", "Sparse attention for LLM inference", source="openalex")],
        str(tmp_path), session_id,
    )
    svc = PaperSearchService(registry=_FakeRegistry({"openalex": oa}))

    res = _run(svc.retrieve(
        research_question="sparse attention",
        keywords=["sparse attention"],
        sources=["openalex"],
        enrich=False,
        session_id=session_id,
        config_dir=str(tmp_path),
        turn_id="turn-fixed",
    ))

    # 检索期间 live 文件存在且 phase=searching、turn_id 与传入一致
    assert oa.live_seen_during_search is not None, "fan-out 期间 live 文件不存在"
    assert oa.live_seen_during_search["phase"] == "searching"
    assert oa.live_seen_during_search["turn_id"] == "turn-fixed"

    # 结束后 live 文件被删；turn_id 复用（process_results_core 未重新生成）
    assert not os.path.exists(live_file_path(str(tmp_path), session_id))
    assert res["turn_id"] == "turn-fixed"

    # canonical JSONL 零回归：正常落盘且带 turn_id
    jsonl = tmp_path / "agent-sessions-papers" / f"{session_id}.jsonl"
    lines = [json.loads(x) for x in jsonl.read_text(encoding="utf-8").splitlines() if x.strip()]
    assert len(lines) == 1
    assert lines[0]["turn_id"] == "turn-fixed"


def test_retrieve_finalizes_live_on_failure(tmp_path: Path) -> None:
    """process 阶段抛错 → live 文件仍被 finally 清理。"""

    class _BoomConnector:
        def search(self, query: str, max_results: int = 10, **kwargs):
            return [_paper("p1", "T", source="openalex")]

    svc = PaperSearchService(registry=_FakeRegistry({"openalex": _BoomConnector()}))
    session_id = "sess-boom"

    async def _go() -> None:
        # session_id 传空串以外的值、config_dir 指向只读不可写路径难以构造稳定失败；
        # 改为 monkeypatch 内核：直接让 _retrieve_inner 抛错验证 finally 路径。
        orig = svc._retrieve_inner

        async def _boom(**kwargs):
            raise RuntimeError("boom")

        svc._retrieve_inner = _boom  # type: ignore[method-assign]
        try:
            try:
                await svc.retrieve(
                    research_question="q", keywords=["k"], sources=["openalex"],
                    enrich=False, session_id=session_id, config_dir=str(tmp_path),
                )
            except RuntimeError:
                pass
        finally:
            svc._retrieve_inner = orig  # type: ignore[method-assign]

    _run(_go())
    assert not os.path.exists(live_file_path(str(tmp_path), session_id))
