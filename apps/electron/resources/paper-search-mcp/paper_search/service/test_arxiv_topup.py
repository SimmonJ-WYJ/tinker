"""Tests for _arxiv_topup_allowed（#619 arxiv top-up 条件扩展）。

契约：
- arxiv 不在 sources → True（原始路径，不受 verdict 影响）
- arxiv 在 sources + verdict=failed → True（扩展：arxiv 失败时也补抓）
- arxiv 在 sources + verdict=empty  → True（扩展：arxiv 空时也补抓）
- arxiv 在 sources + verdict=ok     → False（已成功，不重复抓）
- arxiv 在 sources + 无 health 条目  → False（无弱信号，不触发）

注：distinct < 阈值 / registry 可用性是调用方的守门条件，不归本 helper。
"""
from __future__ import annotations

from . import search_service as ss


def _health(verdict: str) -> dict:
    return {"arxiv": {"verdict": verdict, "http_status": None, "error": None}}


# arxiv 不在 sources → 原始路径永远允许（既有行为不回归）
def test_arxiv_not_in_sources_always_allowed() -> None:
    assert ss._arxiv_topup_allowed(["openalex", "crossref"], {}) is True
    assert ss._arxiv_topup_allowed(None, {}) is True
    # 原始路径下 verdict=ok 也不影响（arxiv 根本没被请求）
    assert ss._arxiv_topup_allowed(["openalex"], _health("ok")) is True


# arxiv 在 sources + verdict=failed → 允许（扩展路径）
def test_arxiv_in_sources_failed_allowed() -> None:
    assert ss._arxiv_topup_allowed(["openalex", "arxiv"], _health("failed")) is True


# arxiv 在 sources + verdict=empty → 允许（扩展路径）
def test_arxiv_in_sources_empty_allowed() -> None:
    assert ss._arxiv_topup_allowed(["arxiv"], _health("empty")) is True


# arxiv 在 sources + verdict=ok → 不允许（已成功，不重复抓）
def test_arxiv_in_sources_ok_not_allowed() -> None:
    assert ss._arxiv_topup_allowed(["arxiv"], _health("ok")) is False


# arxiv 在 sources 但无 health 条目 → 无弱信号，不触发
def test_arxiv_in_sources_no_health_entry_not_allowed() -> None:
    assert ss._arxiv_topup_allowed(["arxiv"], {}) is False
