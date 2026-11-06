"""Tests for PaperSearchService.enrich_paper — P1-2 并发 first-success 行为。

并发 fan-out 后期望：
- 总 wall time ≈ max(3 source) 而非 sum，单源最坏 timeout=8s 不再连乘 3 次
- 保留源优先级语义：semantic 比 openalex 比 crossref 优先 —— 高优先源即使返回稍慢
  也应被优先采用（不会被低优先源的快速返回抢先）
- 高优先源已成功时，不再等待更低优先源 —— 通过及时取消 pending 任务实现
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

import pytest

from . import search_service as ss
from ..models.paper import Paper


def _run(coro):
    return asyncio.run(coro)


def _paper(title: str, abstract: str = "") -> Paper:
    """构造最小化的 Paper 对象，绕开 search_* 的真实 HTTP 调用。"""
    return Paper(
        paper_id=title.lower().replace(" ", "_"),
        title=title,
        authors=["Test Author"],
        abstract=abstract,
        url=f"https://example.com/{title}",
        doi="10.1000/test",
        source="test",
    )


class _FakeRegistry:
    """最小化 ConnectorRegistry 替身：只暴露 .get(name)。"""
    def __init__(self, mapping: dict[str, Any]):
        self._mapping = mapping

    def get(self, name: str) -> Any:
        return self._mapping.get(name)

    def all_names(self) -> list[str]:
        return list(self._mapping.keys())

    def __contains__(self, name: str) -> bool:
        return name in self._mapping


def _make_svc_with_fake_sources(
    monkeypatch: pytest.MonkeyPatch,
    per_source_behavior: dict[str, "_SourceBehavior"],
    timeout: float = 0.3,
) -> ss.PaperSearchService:
    """构造一个 svc，其 _enrich_from_source 根据 source_name 返回 per_source_behavior 配置的结果。"""
    monkeypatch.setattr(ss, "ENRICH_PER_SOURCE_TIMEOUT_SEC", timeout)
    # #685：默认 stub 掉出版社 HTML 末位兜底，避免单测打真网络（四源全空时
    # enrich_paper 会去抓 doi.org）。需要测兜底的用例在自己内部重新 monkeypatch。
    monkeypatch.setattr(ss, "fetch_abstract_from_landing_page", lambda *a, **k: "")

    svc = ss.PaperSearchService(
        registry=_FakeRegistry({name: object() for name in per_source_behavior})  # type: ignore[arg-type]
    )

    async def fake_enrich_from_source(
        connector: Any, source_name: str, doi: str, title: str
    ) -> Optional[Paper]:
        behavior = per_source_behavior.get(source_name)
        if behavior is None:
            return None
        await asyncio.sleep(behavior.delay)
        return behavior.result

    monkeypatch.setattr(svc, "_enrich_from_source", fake_enrich_from_source)
    return svc


class _SourceBehavior:
    """模拟一个 enrich source 的延迟 + 返回值。"""
    __slots__ = ("delay", "result")
    def __init__(self, delay: float, result: Optional[Paper]):
        self.delay = delay
        self.result = result


# ---------------------------------------------------------------------------
# 1) 并发：wall time ≈ max(单源) 而不是 sum
# ---------------------------------------------------------------------------


def test_enrich_concurrent_walltime_is_max_not_sum(monkeypatch: pytest.MonkeyPatch) -> None:
    """3 source 都需要 0.3s 才能返回（无人成功），并发后 wall time ≈ 0.3s 而非 0.9s。"""
    behaviors = {
        "semantic": _SourceBehavior(delay=0.3, result=None),
        "openalex": _SourceBehavior(delay=0.3, result=None),
        "crossref": _SourceBehavior(delay=0.3, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=1.0)

    t0 = time.monotonic()
    result = _run(svc.enrich_paper(doi="10.1/test"))
    elapsed = time.monotonic() - t0

    assert result is None
    assert elapsed < 0.6, (
        f"3 source 并发应在 ≈ 0.3s 完成（不是串行 0.9s），实际 {elapsed:.2f}s"
    )


# ---------------------------------------------------------------------------
# 2) first-wins：谁先返回非空摘要就用（#685 改为 4 源平等，不再优先 semantic）
# ---------------------------------------------------------------------------


def test_enrich_first_abstract_wins_regardless_of_source(monkeypatch: pytest.MonkeyPatch) -> None:
    """semantic 慢但成功（0.2s），openalex 快也成功（0.05s）。
    #685 first-wins → 应返回**先到**的 openalex，不再为偏好 semantic 而等它。"""
    semantic_paper = _paper("Semantic Result", abstract="from semantic")
    openalex_paper = _paper("OpenAlex Result", abstract="from openalex")
    behaviors = {
        "semantic": _SourceBehavior(delay=0.2, result=semantic_paper),
        "openalex": _SourceBehavior(delay=0.05, result=openalex_paper),
        "crossref": _SourceBehavior(delay=0.05, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=1.0)

    t0 = time.monotonic()
    result = _run(svc.enrich_paper(doi="10.1/test"))
    elapsed = time.monotonic() - t0

    assert result is not None
    assert result.title == "OpenAlex Result", (
        f"first-wins 应采用先到的 openalex，实际 {result.title!r}"
    )
    assert elapsed < 0.15, (
        f"openalex 0.05s 就到，不应等 semantic 的 0.2s，实际 {elapsed:.2f}s"
    )


# ---------------------------------------------------------------------------
# 3) 高优先源失败 → 回退到次优先源
# ---------------------------------------------------------------------------


def test_enrich_falls_back_when_high_priority_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """semantic 快返回 None，openalex 慢返回成功 → 应返回 openalex 的结果。"""
    openalex_paper = _paper("OpenAlex Result", abstract="abc")
    behaviors = {
        "semantic": _SourceBehavior(delay=0.02, result=None),
        "openalex": _SourceBehavior(delay=0.1, result=openalex_paper),
        "crossref": _SourceBehavior(delay=0.1, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=1.0)

    result = _run(svc.enrich_paper(doi="10.1/test"))

    assert result is not None and result.title == "OpenAlex Result"


# ---------------------------------------------------------------------------
# 4) 全失败 → None
# ---------------------------------------------------------------------------


def test_enrich_returns_none_when_all_sources_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    behaviors = {
        "semantic": _SourceBehavior(delay=0.05, result=None),
        "openalex": _SourceBehavior(delay=0.05, result=None),
        "crossref": _SourceBehavior(delay=0.05, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=1.0)

    result = _run(svc.enrich_paper(doi="10.1/test"))
    assert result is None


# ---------------------------------------------------------------------------
# 5) 高优先源已成功时，不再等待低优先源
# ---------------------------------------------------------------------------


def test_enrich_does_not_wait_for_slow_low_priority(monkeypatch: pytest.MonkeyPatch) -> None:
    """semantic 快速返回成功，crossref 慢（2s）。enrich_paper 应在 semantic 一返回就回来，
    不等 crossref —— wall time ≈ semantic 的 0.05s，远小于 crossref 的 2s。"""
    semantic_paper = _paper("Semantic Result", abstract="abc")
    behaviors = {
        "semantic": _SourceBehavior(delay=0.05, result=semantic_paper),
        "openalex": _SourceBehavior(delay=2.0, result=None),
        "crossref": _SourceBehavior(delay=2.0, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=3.0)

    t0 = time.monotonic()
    result = _run(svc.enrich_paper(doi="10.1/test"))
    elapsed = time.monotonic() - t0

    assert result is not None and result.title == "Semantic Result"
    assert elapsed < 0.5, (
        f"semantic 0.05s 就够，不应等 crossref 2s，实际 {elapsed:.2f}s"
    )


# ---------------------------------------------------------------------------
# 6) Timeout 后并发仍能继续 —— 不被一个 hang 源拖死全部
# ---------------------------------------------------------------------------


def test_enrich_timeout_does_not_block_others(monkeypatch: pytest.MonkeyPatch) -> None:
    """semantic 永远 hang（远大于 timeout），openalex 在 timeout 内成功返回。
    应返回 openalex 的结果，wall time 接近 openalex 返回时间。"""
    openalex_paper = _paper("OpenAlex Result", abstract="abc")
    behaviors = {
        "semantic": _SourceBehavior(delay=10.0, result=None),  # hang
        "openalex": _SourceBehavior(delay=0.1, result=openalex_paper),
        "crossref": _SourceBehavior(delay=0.1, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=0.3)

    t0 = time.monotonic()
    result = _run(svc.enrich_paper(doi="10.1/test"))
    elapsed = time.monotonic() - t0

    assert result is not None and result.title == "OpenAlex Result"
    # openalex 0.1s 返回，semantic hang 直到 timeout=0.3s；需要等 semantic 那个 slot 走完才能确认
    # 它不会出 result（pending），所以最坏 ≈ 0.3s
    assert elapsed < 0.6, f"应在 ≈ 0.3s（semantic timeout 后）返回，实际 {elapsed:.2f}s"


# ---------------------------------------------------------------------------
# #685 — Europe PMC 加进 fan-out + 出版社 HTML 末位兜底
# ---------------------------------------------------------------------------


def test_enrich_europepmc_recovers_when_others_have_no_abstract(monkeypatch: pytest.MonkeyPatch) -> None:
    """#685：SS/OpenAlex/Crossref 都没给摘要，europepmc（最低优先）给了 → 采用 europepmc。

    复刻触发用例 10.1038/nmeth.1315：三个常规源无摘要，Europe PMC 有结构化 abstractText。"""
    europepmc_paper = _paper("mRNA-Seq single cell", abstract="Next-generation sequencing ...")
    behaviors = {
        "semantic": _SourceBehavior(delay=0.02, result=None),
        "openalex": _SourceBehavior(delay=0.02, result=None),
        "crossref": _SourceBehavior(delay=0.02, result=None),
        "europepmc": _SourceBehavior(delay=0.05, result=europepmc_paper),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=1.0)

    result = _run(svc.enrich_paper(doi="10.1038/nmeth.1315"))

    assert result is not None
    assert result.abstract.startswith("Next-generation"), (
        f"应采用 europepmc 的摘要，实际 {result.abstract!r}"
    )


def test_enrich_publisher_html_last_resort(monkeypatch: pytest.MonkeyPatch) -> None:
    """#685：四个结构化源都没摘要 → 走出版社 landing page meta 抽取兜底。"""
    behaviors = {
        "semantic": _SourceBehavior(delay=0.02, result=None),
        "openalex": _SourceBehavior(delay=0.02, result=None),
        "crossref": _SourceBehavior(delay=0.02, result=None),
        "europepmc": _SourceBehavior(delay=0.02, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=1.0)
    # helper 默认把 HTML 抓取 stub 成 ""；这里重新启用并 mock 抓到摘要（不打真网络）。
    monkeypatch.setattr(ss, "PUBLISHER_HTML_ENABLED", True)
    monkeypatch.setattr(ss, "PUBLISHER_HTML_TIMEOUT_SEC", 1.0)
    monkeypatch.setattr(
        ss, "fetch_abstract_from_landing_page",
        lambda doi, *a, **k: "A recovered abstract from the publisher landing page. " * 5,
    )

    result = _run(svc.enrich_paper(doi="10.1038/nmeth.1315"))

    assert result is not None
    assert result.source == "publisher_html"
    assert "recovered abstract" in result.abstract


def test_enrich_skips_publisher_html_when_source_has_abstract(monkeypatch: pytest.MonkeyPatch) -> None:
    """#685 不回退：有结构化源给了摘要就直接用，绝不触发出版社 HTML 抓取（AC #6）。"""
    semantic_paper = _paper("Has Abstract", abstract="real abstract from semantic")
    behaviors = {
        "semantic": _SourceBehavior(delay=0.02, result=semantic_paper),
        "openalex": _SourceBehavior(delay=0.02, result=None),
        "crossref": _SourceBehavior(delay=0.02, result=None),
        "europepmc": _SourceBehavior(delay=0.02, result=None),
    }
    svc = _make_svc_with_fake_sources(monkeypatch, behaviors, timeout=1.0)
    calls: list[int] = []
    monkeypatch.setattr(ss, "PUBLISHER_HTML_ENABLED", True)
    monkeypatch.setattr(
        ss, "fetch_abstract_from_landing_page",
        lambda *a, **k: (calls.append(1), "")[1],
    )

    result = _run(svc.enrich_paper(doi="10.1038/nmeth.1315"))

    assert result is not None and result.title == "Has Abstract"
    assert calls == [], "有源给了摘要时不应触发出版社 HTML 抓取"
