"""Tests for retrieve 的「失败源单次重试」边界（_fanout_with_single_retry）。

边界契约（服务端，唯一一处自动重试）：
- 只对 **失败**（verdict=failed：超时 / 非 200 / 错误，ok=False）的源重跑 **恰好一次**；
- **真空**（verdict=empty：204，0 数据）不重试 —— 0 数据不重试；
- 已出结果的源不重试；绝不二次重试（无循环，调用次数有上界）；
- 返回 failed_sources（重试后仍失败的请求源），供上层上报 + 用户触发补救。
"""
from __future__ import annotations

from typing import Any

import pytest

from ..models.paper import Paper
from . import search_service as ss


class _SeqConnector:
    """按调用次序返回结果的连接器替身。

    sequence[i] 为第 i+1 次 search 的行为：
    - `list[Paper]` → 返回该列表（空列表 = 204 真空）；
    - `Exception` 实例 → 抛出（→ _timed_search 标 ok=False = 失败）。
    超出序列长度后固定取最后一项。`call_count` 用于断言重试次数。
    """

    def __init__(self, sequence: list[Any]) -> None:
        self.sequence = sequence
        self.call_count = 0

    def search(self, query: str, max_results: int = 5, **kwargs: Any) -> list[Paper]:
        i = min(self.call_count, len(self.sequence) - 1)
        self.call_count += 1
        item = self.sequence[i]
        if isinstance(item, Exception):
            raise item
        return item


class _FakeRegistry:
    def __init__(self, mapping: dict[str, Any]) -> None:
        self._mapping = mapping

    def get(self, name: str) -> Any:
        return self._mapping.get(name)

    def all_names(self) -> list[str]:
        return list(self._mapping.keys())


def _paper(title: str = "Hit") -> Paper:
    return Paper(paper_id="x", title=title, abstract="abc")


def _cell(source: str, query: str = "q") -> dict[str, Any]:
    return {"source": source, "query": query, "max_results": 5, "kwargs": {}}


@pytest.mark.asyncio
async def test_failed_source_retried_once_and_recovers() -> None:
    """首轮失败（抛错=ok=False）→ 重试 1 次拿到结果，并入 by_source、不留在 failed。"""
    conn = _SeqConnector([RuntimeError("429 rate limited"), [_paper("Recovered")]])
    svc = ss.PaperSearchService(registry=_FakeRegistry({"openalex": conn}))  # type: ignore[arg-type]

    by_source, health, failed = await svc._fanout_with_single_retry(
        [_cell("openalex")], ["openalex"]
    )

    assert conn.call_count == 2, "失败源应被重试恰好 1 次（共 2 次调用）"
    assert failed == []
    assert health["openalex"]["verdict"] == "ok"
    assert [p.title for p in by_source.get("openalex", [])] == ["Recovered"]


@pytest.mark.asyncio
async def test_empty_source_NOT_retried() -> None:
    """首轮真空（204，0 数据）→ **不重试**（0 数据不重试），verdict=empty。"""
    conn = _SeqConnector([[]])  # 干净空结果，不抛错
    svc = ss.PaperSearchService(registry=_FakeRegistry({"openalex": conn}))  # type: ignore[arg-type]

    by_source, health, failed = await svc._fanout_with_single_retry(
        [_cell("openalex")], ["openalex"]
    )

    assert conn.call_count == 1, "真空源不得重试（0 数据不重试）"
    assert failed == []
    assert health["openalex"]["verdict"] == "empty"
    assert by_source.get("openalex", []) == []


@pytest.mark.asyncio
async def test_nonempty_source_not_retried() -> None:
    """首轮即有结果 → 不重试。"""
    conn = _SeqConnector([[_paper("First")]])
    svc = ss.PaperSearchService(registry=_FakeRegistry({"openalex": conn}))  # type: ignore[arg-type]

    by_source, health, failed = await svc._fanout_with_single_retry(
        [_cell("openalex")], ["openalex"]
    )

    assert conn.call_count == 1
    assert failed == []
    assert health["openalex"]["verdict"] == "ok"


@pytest.mark.asyncio
async def test_failed_twice_is_exactly_once_and_reported() -> None:
    """失败 + 重试仍失败 → 恰好 1 次重试（共 2 次），列入 failed_sources。"""
    conn = _SeqConnector([RuntimeError("timeout"), RuntimeError("timeout")])
    svc = ss.PaperSearchService(registry=_FakeRegistry({"crossref": conn}))  # type: ignore[arg-type]

    by_source, health, failed = await svc._fanout_with_single_retry(
        [_cell("crossref")], ["crossref"]
    )

    assert conn.call_count == 2, "恰好 1 次重试，不得二次重试"
    assert failed == ["crossref"]
    assert health["crossref"]["verdict"] == "failed"
    assert by_source.get("crossref", []) == []


@pytest.mark.asyncio
async def test_only_failed_sources_retried_empty_and_ok_untouched() -> None:
    """混合：失败源重试，真空源 + 已出结果源都不重试。"""
    failed_then_ok = _SeqConnector([RuntimeError("5xx"), [_paper("LateHit")]])
    genuine_empty = _SeqConnector([[]])
    has_result = _SeqConnector([[_paper("Early")]])
    svc = ss.PaperSearchService(  # type: ignore[arg-type]
        registry=_FakeRegistry({
            "openalex": failed_then_ok,
            "crossref": genuine_empty,
            "arxiv": has_result,
        })
    )

    by_source, health, failed = await svc._fanout_with_single_retry(
        [_cell("openalex"), _cell("crossref"), _cell("arxiv")],
        ["openalex", "crossref", "arxiv"],
    )

    assert failed_then_ok.call_count == 2, "失败源 openalex 重试 1 次"
    assert genuine_empty.call_count == 1, "真空源 crossref 不重试"
    assert has_result.call_count == 1, "已出结果的 arxiv 不重试"
    assert failed == []
    assert health["openalex"]["verdict"] == "ok"
    assert health["crossref"]["verdict"] == "empty"
    assert health["arxiv"]["verdict"] == "ok"
    assert [p.title for p in by_source["openalex"]] == ["LateHit"]
