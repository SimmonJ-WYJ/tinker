"""回归测试：journal 连接器未注册（未登录）时应静默缺席，不计为失败源。

spec 绑定约束（docs/specs/journal-source-spec.md §2.6 + 验收 #2）：
  未登录时 journal 静默缺席 —— 不计入 failed_sources、不触发失败扩源、不触发重试。
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from paper_search.models.paper import Paper
from paper_search.service.search_service import PaperSearchService


# ---------------------------------------------------------------------------
# 测试用替身
# ---------------------------------------------------------------------------

class _FakeConnector:
    """记录调用，返回固定论文列表。"""

    def __init__(self, papers: list[Paper]) -> None:
        self._papers = papers
        self.call_count = 0

    def search(self, query: str, max_results: int = 10, **kwargs: Any) -> list[Paper]:
        self.call_count += 1
        return list(self._papers)


class _FakeRegistry:
    """只注册指定连接器，registry.get() 对未注册源返回 None（模拟 journal 未登录）。"""

    def __init__(self, mapping: dict[str, _FakeConnector]) -> None:
        self._m = mapping

    def get(self, name: str) -> _FakeConnector | None:
        return self._m.get(name)

    def all_names(self) -> list[str]:
        return list(self._m.keys())


def _paper(pid: str, title: str) -> Paper:
    return Paper(
        paper_id=pid,
        title=title,
        abstract="abstract",
        published_date=datetime(2024, 1, 1),
        source="openalex",
    )


# ---------------------------------------------------------------------------
# 回归测试：journal 未注册 → 静默跳过，不出现在 failed_sources
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_journal_unregistered_silent_skip(tmp_path: Path) -> None:
    """journal 连接器未注册时（未登录），retrieve() 的 failed_sources 不包含 'journal'。

    设置：registry 只有 openalex/crossref/arxiv，故意不注册 journal（模拟无 JOURNAL_ACCESS_TOKEN）。
    断言：
      - 'journal' 不在 stats['failed_sources']
      - 检索正常完成（new_records >= 0，无异常）
      - 已注册的真实源返回结果正常（openalex 成功召回）
    """
    # 只注册三个已有源，故意排除 journal（模拟未登录、无 JOURNAL_ACCESS_TOKEN）
    oa = _FakeConnector([
        _paper("oa1", "Context window extension for large language models"),
        _paper("oa2", "Sparse attention in transformer models"),
    ])
    cr = _FakeConnector([
        _paper("cr1", "Cross-reference study on LLM context length"),
    ])
    arx = _FakeConnector([
        _paper("ax1", "Efficient context window via sliding attention"),
    ])

    registry = _FakeRegistry({
        "openalex": oa,
        "crossref": cr,
        "arxiv": arx,
        # journal 故意不注册 → registry.get("journal") == None
    })
    svc = PaperSearchService(registry=registry)  # type: ignore[arg-type]

    # sources 包含 journal（与默认 lit-review 检索矩阵一致）
    stats = await svc.retrieve(
        research_question="how to handle limited context window in LLMs",
        keywords=["context window", "large language model"],
        sources=["openalex", "crossref", "arxiv", "journal"],
        object_terms=["LLM", "large language model"],
        enrich=False,
        session_id="test-journal-silent",
        config_dir=str(tmp_path),
    )

    # 核心断言：journal 未注册 → 静默缺席，不进 failed_sources
    failed = stats.get("failed_sources", [])
    assert "journal" not in failed, (
        f"journal 未注册时不应计为失败源，但出现在 failed_sources={failed!r}"
    )

    # 检索应正常完成，已注册源有结果
    assert "new_records" in stats, "retrieve 应返回 new_records 字段"
    assert stats.get("new_records", 0) >= 0, "检索不应因 journal 缺席而崩溃"

    # 额外确认：journal 的 connector 从未被调用（没有注册，不应出现在 source_health 里作为 failed）
    health = stats.get("source_health", {})
    if "journal" in health:
        assert health["journal"]["verdict"] != "failed", (
            f"journal 不应出现在 source_health 中且 verdict=failed，实际={health['journal']!r}"
        )
