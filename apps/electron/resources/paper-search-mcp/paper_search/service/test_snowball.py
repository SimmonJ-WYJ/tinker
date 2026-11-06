"""Tests for PaperSearchService.snowball — P0-4 引文追溯提速。

提速后期望：
- 同一 seed 的 backward(references) 与 forward(citations) 并发拉取，
  wall time ≈ max(单向) 而非 sum + 1.5s 方向间硬 sleep。
- 服务端深度硬限到 SNOWBALL_MAX_DEPTH（默认 1），depth>cap 时被夹紧、不递归扩层。
- 单 seed 双向不再有任何 inter-pid sleep（idx 0）。
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, List

from . import search_service as ss
from ..models.paper import Paper


def _run(coro):
    return asyncio.run(coro)


def _paper(pid: str) -> Paper:
    return Paper(paper_id=pid, title=pid, authors=[], abstract="", source="semantic")


class _FakeSemantic:
    """Semantic 连接器替身：get_references / get_citations 各自可配延迟与返回。"""

    def __init__(
        self,
        ref_delay: float = 0.0,
        cite_delay: float = 0.0,
        refs: List[Paper] | None = None,
        cites: List[Paper] | None = None,
    ) -> None:
        self.ref_delay = ref_delay
        self.cite_delay = cite_delay
        self.refs = refs if refs is not None else []
        self.cites = cites if cites is not None else []
        self.ref_calls: list[str] = []
        self.cite_calls: list[str] = []

    def get_references(self, pid: str, n: int) -> List[Paper]:
        self.ref_calls.append(pid)
        if self.ref_delay:
            time.sleep(self.ref_delay)
        return self.refs

    def get_citations(self, pid: str, n: int) -> List[Paper]:
        self.cite_calls.append(pid)
        if self.cite_delay:
            time.sleep(self.cite_delay)
        return self.cites


class _FakeRegistry:
    def __init__(self, mapping: dict[str, Any]) -> None:
        self._mapping = mapping

    def get(self, name: str) -> Any:
        return self._mapping.get(name)

    def all_names(self) -> list[str]:
        return list(self._mapping.keys())


def _svc(fake: _FakeSemantic) -> ss.PaperSearchService:
    return ss.PaperSearchService(registry=_FakeRegistry({"semantic": fake}))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 1) 双向并发：wall time ≈ max(单向) 而非 sum + 方向间 sleep
# ---------------------------------------------------------------------------


def test_snowball_directions_run_concurrently(monkeypatch) -> None:
    monkeypatch.setattr(ss, "SNOWBALL_MAX_DEPTH", 1)
    fake = _FakeSemantic(ref_delay=0.3, cite_delay=0.3)
    svc = _svc(fake)

    t0 = time.monotonic()
    result = _run(svc.snowball("seed", direction="both", depth=1))
    elapsed = time.monotonic() - t0

    # 并发 0.3 + 0.3 ≈ 0.3s（而非串行 0.6s + 旧实现额外 1.5s 方向间 sleep）
    assert elapsed < 0.6, f"双向应并发 ≈0.3s，实际 {elapsed:.2f}s"
    assert fake.ref_calls == ["seed"]
    assert fake.cite_calls == ["seed"]
    assert result.seed_paper_id == "seed"


# ---------------------------------------------------------------------------
# 2) 单向只调一个方向
# ---------------------------------------------------------------------------


def test_snowball_backward_only(monkeypatch) -> None:
    monkeypatch.setattr(ss, "SNOWBALL_MAX_DEPTH", 1)
    fake = _FakeSemantic(refs=[_paper("r1")])
    svc = _svc(fake)

    result = _run(svc.snowball("seed", direction="backward", depth=1))

    assert fake.ref_calls == ["seed"]
    assert fake.cite_calls == []
    assert any(p.paper_id == "r1" for p in result.papers)


# ---------------------------------------------------------------------------
# 3) 深度硬限：depth>cap 被夹紧，不递归扩层
# ---------------------------------------------------------------------------


def test_snowball_depth_hard_capped(monkeypatch) -> None:
    monkeypatch.setattr(ss, "SNOWBALL_MAX_DEPTH", 1)
    monkeypatch.setattr(ss, "SNOWBALL_INTER_PID_SLEEP_SEC", 0.0)
    # seed 的 references 返回两个新 id；若错误地扩到 layer 1，会对 r1/r2 再发请求。
    fake = _FakeSemantic(refs=[_paper("r1"), _paper("r2")])
    svc = _svc(fake)

    result = _run(svc.snowball("seed", direction="backward", depth=3))

    assert result.depth == 1, "depth 应被夹紧到 SNOWBALL_MAX_DEPTH=1"
    # 只对 seed 发过 references；没有对 r1/r2 扩层
    assert fake.ref_calls == ["seed"], f"不应递归扩层，实际 ref_calls={fake.ref_calls}"


# ---------------------------------------------------------------------------
# 4) semantic 不可用时返回错误而非崩溃
# ---------------------------------------------------------------------------


def test_snowball_no_semantic_connector() -> None:
    svc = ss.PaperSearchService(registry=_FakeRegistry({}))  # type: ignore[arg-type]
    result = _run(svc.snowball("seed", direction="both", depth=1))
    assert result.papers == []
    assert result.errors
