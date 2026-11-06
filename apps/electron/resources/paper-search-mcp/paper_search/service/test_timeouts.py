"""Tests for per-source asyncio.wait_for timeout hard upper bounds.

覆盖 P0 (`_timed_search`) 与 P1 (`enrich_paper`) 两处 hard timeout，
确保失败/慢连接器不会拖死整个搜索流水线。
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest

from ..models.paper import Paper
from . import search_service as ss


# ---------------------------------------------------------------------------
# 测试替身
# ---------------------------------------------------------------------------


class _FakeConnector:
    """连接器测试替身，按需控制 search() 的阻塞时长与返回值。

    `search` 在 to_thread 线程里执行 time.sleep，模拟真实连接器内部
    重试栈的阻塞耗时（arxiv 3×30s / semantic 指数退避）。
    """

    def __init__(
        self,
        sleep_seconds: float = 0.0,
        papers: list[Paper] | None = None,
    ) -> None:
        self.sleep_seconds = sleep_seconds
        self.papers = papers if papers is not None else []
        self.call_count = 0

    def search(self, query: str, max_results: int = 5, **kwargs: Any) -> list[Paper]:
        self.call_count += 1
        if self.sleep_seconds:
            time.sleep(self.sleep_seconds)
        return self.papers


def _paper(title: str = "Test", abstract: str = "abc") -> Paper:
    return Paper(paper_id="x", title=title, abstract=abstract)


# ---------------------------------------------------------------------------
# P0: _timed_search 单源硬超时
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_timed_search_times_out(monkeypatch: pytest.MonkeyPatch) -> None:
    """连接器阻塞 > timeout 时，应在 timeout 后立即返回 408 状态而非等阻塞结束。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 0.3)
    conn = _FakeConnector(sleep_seconds=2.0)

    t0 = time.monotonic()
    papers, _elapsed_ms, status = await ss.PaperSearchService._timed_search(
        "fake", conn, "q", max_results=5
    )
    elapsed = time.monotonic() - t0

    assert elapsed < 1.0, f"应在 timeout (0.3s) 后立即返回，实际 {elapsed:.2f}s"
    assert papers == []
    assert status.http_status == 408
    assert status.ok is False
    assert "timeout" in status.error.lower()


@pytest.mark.asyncio
async def test_timed_search_fast_path_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    """连接器立即返回 papers 时，fast-path 行为不变。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 5.0)
    papers_returned = [_paper("Hit 1"), _paper("Hit 2")]
    conn = _FakeConnector(sleep_seconds=0.0, papers=papers_returned)

    papers, _elapsed_ms, status = await ss.PaperSearchService._timed_search(
        "fake", conn, "q", max_results=5
    )

    assert papers == papers_returned
    # 默认 SourceStatus(http_status=200, ok=True)：有 papers 时不进入空分支
    assert status.http_status == 200
    assert status.ok is True


@pytest.mark.asyncio
async def test_timed_search_empty_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    """连接器立即返回 [] 时，应标 204（真 0），与 408（timeout）区分。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 5.0)
    conn = _FakeConnector(sleep_seconds=0.0, papers=[])

    papers, _elapsed_ms, status = await ss.PaperSearchService._timed_search(
        "fake", conn, "q", max_results=5
    )

    assert papers == []
    assert status.http_status == 204
    assert status.ok is True


# ---------------------------------------------------------------------------
# P0.1: _async_search 单源硬超时（per-source MCP 工具入口）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_async_search_times_out(monkeypatch: pytest.MonkeyPatch) -> None:
    """_async_search 超时返回 []，与 connector 内部失败行为一致。

    这是 search_arxiv / search_semantic / search_crossref 等 per-source
    MCP 工具的入口；早期版本无 wait_for，导致 P0 在 per-source 路径下失效。
    """
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 0.3)
    conn = _FakeConnector(sleep_seconds=2.0)

    t0 = time.monotonic()
    papers = await ss.PaperSearchService._async_search(
        conn, "q", max_results=5
    )
    elapsed = time.monotonic() - t0

    assert elapsed < 1.0, f"应在 timeout (0.3s) 后立即返回，实际 {elapsed:.2f}s"
    assert papers == []


@pytest.mark.asyncio
async def test_async_search_fast_path_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    """快速返回的 connector，行为不变（返回 papers 列表）。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 5.0)
    papers_returned = [_paper("Hit 1"), _paper("Hit 2")]
    conn = _FakeConnector(sleep_seconds=0.0, papers=papers_returned)

    papers = await ss.PaperSearchService._async_search(
        conn, "q", max_results=5
    )

    assert papers == papers_returned


# ---------------------------------------------------------------------------
# P1: enrich_paper 单源硬超时
# ---------------------------------------------------------------------------


class _FakeRegistry:
    """ConnectorRegistry 测试替身：按名字返回预置的 connector。"""

    def __init__(self, mapping: dict[str, Any]) -> None:
        self._mapping = mapping

    def get(self, name: str) -> Any:
        return self._mapping.get(name)

    def all_names(self) -> list[str]:
        return list(self._mapping.keys())


@pytest.mark.asyncio
async def test_enrich_paper_advances_on_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """第一源 hang > timeout 时，并发模式下另两个源仍能继续，整体在 timeout 内返回。

    注：P1-2 改为并发后，所有源同时启动而非"串行试下一个"；call_log 包含 3 个源。
    详细的并发/优先级行为见 test_enrich.py（同步包装无需 pytest-asyncio）。"""
    monkeypatch.setattr(ss, "ENRICH_PER_SOURCE_TIMEOUT_SEC", 0.3)

    slow_paper_holder: dict[str, Any] = {}
    fast_paper = _paper("Fast hit", abstract="real abstract text")

    async def slow_enrich(*_args: Any, **_kwargs: Any) -> Paper:
        await asyncio.sleep(2.0)  # > 0.3s timeout
        slow_paper_holder["reached_return"] = True
        return _paper("Slow")

    async def fast_enrich(*_args: Any, **_kwargs: Any) -> Paper:
        return fast_paper

    svc = ss.PaperSearchService(registry=_FakeRegistry({  # type: ignore[arg-type]
        "semantic": object(),
        "openalex": object(),
        "crossref": object(),
    }))

    call_log: list[str] = []

    async def fake_enrich_from_source(
        connector: Any, source_name: str, doi: str, title: str
    ) -> Paper | None:
        call_log.append(source_name)
        if source_name == "semantic":
            return await slow_enrich()
        return await fast_enrich()

    monkeypatch.setattr(svc, "_enrich_from_source", fake_enrich_from_source)

    t0 = time.monotonic()
    result = await svc.enrich_paper(doi="10.1000/test")
    elapsed = time.monotonic() - t0

    # semantic hang 直到 0.3s timeout，并发的 openalex/crossref 立即返回 fast_paper；
    # enrich_paper 等 semantic timeout 后用 openalex 的结果（次优先 fallback）。
    assert elapsed < 1.0, f"应在 ~0.3s（semantic timeout 后）返回，实际 {elapsed:.2f}s"
    assert result is not None and result.title == "Fast hit"
    # P1-2 并发后所有源都被启动；调用顺序非确定（取决于 asyncio scheduler）
    assert set(call_log) == {"semantic", "openalex", "crossref"}
    # 慢源 coroutine 的返回值应被取消，不应跑到 return 语句
    assert "reached_return" not in slow_paper_holder


@pytest.mark.asyncio
async def test_enrich_paper_all_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """三源全 hang 时，应在 N×timeout 内返回 None。"""
    monkeypatch.setattr(ss, "ENRICH_PER_SOURCE_TIMEOUT_SEC", 0.2)

    svc = ss.PaperSearchService(registry=_FakeRegistry({  # type: ignore[arg-type]
        "semantic": object(),
        "openalex": object(),
        "crossref": object(),
    }))

    async def always_hang(*_args: Any, **_kwargs: Any) -> Paper | None:
        await asyncio.sleep(5.0)  # 远大于 0.2s timeout
        return _paper("never returned")

    monkeypatch.setattr(svc, "_enrich_from_source", always_hang)

    t0 = time.monotonic()
    result = await svc.enrich_paper(title="Some paper")
    elapsed = time.monotonic() - t0

    # 3 源 × 0.2s = 0.6s，给点 scheduler 余量
    assert elapsed < 1.5, f"应在 ~0.6s 内全部超时，实际 {elapsed:.2f}s"
    assert result is None


# ---------------------------------------------------------------------------
# P2-2: 分级超时（fast 源短超时，未覆盖源回退全局默认）
# ---------------------------------------------------------------------------


def test_source_timeout_fast_sources_use_override(monkeypatch: pytest.MonkeyPatch) -> None:
    """overrides 内的 fast 源用短超时。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 20.0)
    monkeypatch.setattr(ss, "SOURCE_TIMEOUT_OVERRIDES", {"openalex": 8.0, "crossref": 8.0})
    assert ss.source_timeout("openalex") == 8.0
    assert ss.source_timeout("crossref") == 8.0


def test_source_timeout_unknown_falls_back_to_global(monkeypatch: pytest.MonkeyPatch) -> None:
    """未在 overrides 列出的源回退到全局 PER_SOURCE_TIMEOUT_SEC。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 17.0)
    monkeypatch.setattr(ss, "SOURCE_TIMEOUT_OVERRIDES", {"openalex": 8.0})
    assert ss.source_timeout("arxiv") == 17.0
    assert ss.source_timeout("semantic") == 17.0


def test_parse_source_timeout_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """env 解析：合法项保留、缺 = / 非数字项跳过。"""
    monkeypatch.setenv("PAPER_SEARCH_SOURCE_TIMEOUTS", "openalex=8, crossref=9 , bad, x=notnum")
    parsed = ss._parse_source_timeout_overrides()
    assert parsed == {"openalex": 8.0, "crossref": 9.0}


@pytest.mark.asyncio
async def test_timed_search_applies_per_source_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """fast 源（overrides 内）应用短超时立即 408，而非等全局 20s。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 20.0)
    monkeypatch.setattr(ss, "SOURCE_TIMEOUT_OVERRIDES", {"openalex": 0.3})
    conn = _FakeConnector(sleep_seconds=2.0)

    t0 = time.monotonic()
    papers, _elapsed_ms, status = await ss.PaperSearchService._timed_search(
        "openalex", conn, "q", max_results=5, timeout=ss.source_timeout("openalex")
    )
    elapsed = time.monotonic() - t0

    assert elapsed < 1.0, f"openalex 应用 0.3s 分级超时，实际 {elapsed:.2f}s"
    assert papers == []
    assert status.http_status == 408
    assert "0.3" in status.error


@pytest.mark.asyncio
async def test_timed_search_explicit_timeout_overrides_tier(monkeypatch: pytest.MonkeyPatch) -> None:
    """显式传入 timeout 优先于分级表。"""
    monkeypatch.setattr(ss, "PER_SOURCE_TIMEOUT_SEC", 20.0)
    monkeypatch.setattr(ss, "SOURCE_TIMEOUT_OVERRIDES", {"openalex": 10.0})
    conn = _FakeConnector(sleep_seconds=2.0)

    t0 = time.monotonic()
    _papers, _elapsed_ms, status = await ss.PaperSearchService._timed_search(
        "openalex", conn, "q", max_results=5, timeout=0.3
    )
    elapsed = time.monotonic() - t0

    assert elapsed < 1.0
    assert status.http_status == 408
    assert "0.3" in status.error
