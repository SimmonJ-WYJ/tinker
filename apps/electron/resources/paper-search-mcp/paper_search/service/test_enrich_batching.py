"""Tests for enrich_missing_abstracts batching knobs — P0-1 enrich 提速。

覆盖三个调优旋钮：
- ENRICH_MAX_PAPERS：本轮最多补多少篇（0 = 不限）。
- ENRICH_BATCH_SIZE：批内并发篇数（更大 = 更少「等最慢一篇」往返）。
- ENRICH_INTER_BATCH_SLEEP_SEC：批间等待（默认 0）。
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional

from . import process_service as ps
from . import search_service as ss
from ..models.paper import Paper


def _run(coro):
    return asyncio.run(coro)


def _rec(title: str) -> dict:
    """无摘要的候选记录。"""
    return {"title": title, "doi": "", "abstract": ""}


def _patch_enrich(monkeypatch, *, delay: float = 0.0, calls: Optional[list] = None) -> None:
    """把 PaperSearchService.enrich_paper 换成可控替身（返回 None，仅记录调用）。"""

    async def fake_enrich_paper(self, doi: str = "", title: str = "") -> Optional[Paper]:
        if calls is not None:
            calls.append(title or doi)
        if delay:
            await asyncio.sleep(delay)
        return None

    monkeypatch.setattr(ss.PaperSearchService, "enrich_paper", fake_enrich_paper)


# ---------------------------------------------------------------------------
# 1) ENRICH_MAX_PAPERS：超上限只补前 N 篇
# ---------------------------------------------------------------------------


def test_enrich_max_papers_caps_work(monkeypatch) -> None:
    monkeypatch.setattr(ps, "ENRICH_MAX_PAPERS", 2)
    monkeypatch.setattr(ps, "ENRICH_INTER_BATCH_SLEEP_SEC", 0.0)
    monkeypatch.setattr(ps, "ENRICH_BATCH_SIZE", 16)
    calls: list[str] = []
    _patch_enrich(monkeypatch, calls=calls)

    records = [_rec(f"P{i}") for i in range(5)]
    _run(ps.enrich_missing_abstracts(records))

    assert calls == ["P0", "P1"], f"应只补前 2 篇，实际 {calls}"


def test_enrich_max_papers_zero_means_unlimited(monkeypatch) -> None:
    monkeypatch.setattr(ps, "ENRICH_MAX_PAPERS", 0)
    monkeypatch.setattr(ps, "ENRICH_INTER_BATCH_SLEEP_SEC", 0.0)
    monkeypatch.setattr(ps, "ENRICH_BATCH_SIZE", 16)
    calls: list[str] = []
    _patch_enrich(monkeypatch, calls=calls)

    records = [_rec(f"P{i}") for i in range(5)]
    _run(ps.enrich_missing_abstracts(records))

    assert len(calls) == 5, f"0 = 不限，应补全部 5 篇，实际 {len(calls)}"


# ---------------------------------------------------------------------------
# 2) ENRICH_BATCH_SIZE：足够大时全批并发，wall ≈ 单篇延迟
# ---------------------------------------------------------------------------


def test_enrich_batch_concurrency(monkeypatch) -> None:
    monkeypatch.setattr(ps, "ENRICH_MAX_PAPERS", 0)
    monkeypatch.setattr(ps, "ENRICH_INTER_BATCH_SLEEP_SEC", 0.0)
    monkeypatch.setattr(ps, "ENRICH_BATCH_SIZE", 16)
    _patch_enrich(monkeypatch, delay=0.2)

    records = [_rec(f"P{i}") for i in range(6)]
    t0 = time.monotonic()
    _run(ps.enrich_missing_abstracts(records))
    elapsed = time.monotonic() - t0

    assert elapsed < 0.6, f"6 篇 batch=16 应单批并发 ≈0.2s，实际 {elapsed:.2f}s"


# ---------------------------------------------------------------------------
# 3) 批间 sleep 默认 0：多批不引入额外等待
# ---------------------------------------------------------------------------


def test_enrich_no_inter_batch_sleep_by_default(monkeypatch) -> None:
    monkeypatch.setattr(ps, "ENRICH_MAX_PAPERS", 0)
    monkeypatch.setattr(ps, "ENRICH_INTER_BATCH_SLEEP_SEC", 0.0)
    monkeypatch.setattr(ps, "ENRICH_BATCH_SIZE", 2)  # 强制多批
    _patch_enrich(monkeypatch, delay=0.05)

    records = [_rec(f"P{i}") for i in range(6)]  # 3 批
    t0 = time.monotonic()
    _run(ps.enrich_missing_abstracts(records))
    elapsed = time.monotonic() - t0

    # 3 批 × 0.05s = 0.15s，无批间 sleep；给 scheduler 余量
    assert elapsed < 0.5, f"批间无 sleep，3 批 ≈0.15s，实际 {elapsed:.2f}s"


# ---------------------------------------------------------------------------
# 4) 无缺摘要记录时直接返回 0，不调用 enrich
# ---------------------------------------------------------------------------


def test_enrich_skips_when_all_have_abstracts(monkeypatch) -> None:
    calls: list[str] = []
    _patch_enrich(monkeypatch, calls=calls)

    records = [{"title": "P0", "abstract": "already here"}]
    n = _run(ps.enrich_missing_abstracts(records))

    assert n == 0
    assert calls == []
