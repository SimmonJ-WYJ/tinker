"""Tests for arxiv connector retry / split-timeout / fencepost behavior.

覆盖 arxiv.py:35-55 的 retry 循环：
- bounded retry（max_retries + 1 次尝试）
- split (connect, read) timeout
- fencepost 修复（最后一次失败不再 sleep）
- P0: per-process polite throttle（每 ≥ 3s 一次请求）

测试用 monkeypatch 拦截 self.session.get，避免真实网络请求。
"""
from __future__ import annotations

from typing import Any
from unittest.mock import Mock

import pytest
import requests

from . import arxiv as arxiv_module
from .arxiv import ArxivConnector


def _reset_throttle(monkeypatch: pytest.MonkeyPatch) -> None:
    """每个 throttle 测试前 reset 模块级 last_request_ts，避免测试相互影响。"""
    monkeypatch.setattr(arxiv_module, "_arxiv_last_request_ts", 0.0)


def _make_response(status: int, content: bytes = b"") -> Mock:
    """构造一个最小化的 requests.Response 替身。"""
    resp = Mock(spec=requests.Response)
    resp.status_code = status
    resp.content = content
    return resp


def _patch_env(monkeypatch: pytest.MonkeyPatch, *, max_retries: int = 1, backoff: float = 0.01) -> None:
    """把模块级 retry 常量 monkeypatch 成测试值，避免真实 sleep。

    默认把 random.random 固定到 0，让 _jittered_backoff 退化为线性 backoff，
    确保 sleep 精确值断言可重现。jitter 行为本身由 test_jittered_backoff_*
    单独覆盖。

    同时禁用 polite throttle（默认 3s/req），避免跨测试的共享状态 `_arxiv_last_request_ts`
    把本测试入口的 throttle sleep 拖到秒级。throttle 行为本身由 test_arxiv_throttle_*
    专门覆盖。
    """
    monkeypatch.setattr(arxiv_module, "ARXIV_MAX_RETRIES", max_retries)
    monkeypatch.setattr(arxiv_module, "ARXIV_BACKOFF_SEC", backoff)
    monkeypatch.setattr(arxiv_module.random, "random", lambda: 0.0)
    monkeypatch.setattr(arxiv_module, "ARXIV_MIN_INTERVAL_SEC", 0.0)
    monkeypatch.setattr(arxiv_module, "_arxiv_last_request_ts", 0.0)


# ---------------------------------------------------------------------------
# 200 不重试
# ---------------------------------------------------------------------------


def test_arxiv_search_200_no_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_env(monkeypatch)
    conn = ArxivConnector()

    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search("test", max_results=5)

    assert mock_get.call_count == 1
    assert papers == []  # 空 feed → 0 papers，但 retry 行为是关键


# ---------------------------------------------------------------------------
# 5xx 重试一次然后失败
# ---------------------------------------------------------------------------


def test_arxiv_search_5xx_retries_once_then_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_env(monkeypatch, max_retries=1)
    conn = ArxivConnector()

    mock_get = Mock(side_effect=[
        _make_response(503),
        _make_response(503),
    ])
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search("test", max_results=5)

    # max_retries=1 → total_attempts=2 → 两次都试到
    assert mock_get.call_count == 2
    assert papers == []


# ---------------------------------------------------------------------------
# 5xx → 200 恢复
# ---------------------------------------------------------------------------


def test_arxiv_search_5xx_then_200_recovers(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_env(monkeypatch, max_retries=1)
    conn = ArxivConnector()

    mock_get = Mock(side_effect=[
        _make_response(503),
        _make_response(200, b"<feed></feed>"),  # 空 feed，但 200
    ])
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search("test", max_results=5)

    assert mock_get.call_count == 2
    assert papers == []  # feed 空，但走完了 200 分支不再 retry


# ---------------------------------------------------------------------------
# Fencepost 修复：最后一次失败不再 sleep
# ---------------------------------------------------------------------------


def test_arxiv_search_no_trailing_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    """两次 5xx 全失败时，只在第一次失败后 sleep，不在最后一次后 sleep。"""
    _patch_env(monkeypatch, max_retries=1, backoff=0.05)
    conn = ArxivConnector()

    mock_get = Mock(side_effect=[
        _make_response(503),
        _make_response(503),
    ])
    monkeypatch.setattr(conn.session, "get", mock_get)

    sleep_calls: list[float] = []
    monkeypatch.setattr(arxiv_module.time, "sleep", lambda s: sleep_calls.append(s))

    papers = conn.search("test", max_results=5)

    assert mock_get.call_count == 2
    assert papers == []
    # 关键断言：5xx → sleep 一次 → 5xx → 不 sleep 退出
    assert sleep_calls == [0.05], f"应仅在中间 1 次 sleep，实际 {sleep_calls}"


# ---------------------------------------------------------------------------
# Connect timeout / RequestException 快速失败
# ---------------------------------------------------------------------------


def test_arxiv_search_connect_timeout_fast_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    """session.get 抛 ConnectionError 时，按 RequestException 分支走，不卡死。"""
    _patch_env(monkeypatch, max_retries=1)
    conn = ArxivConnector()

    mock_get = Mock(side_effect=requests.ConnectionError("simulated connect timeout"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search("test", max_results=5)

    # 两次尝试都抛 ConnectionError → 全失败返回 []
    assert mock_get.call_count == 2
    assert papers == []


# ---------------------------------------------------------------------------
# 4xx 非 429 不重试
# ---------------------------------------------------------------------------


def test_arxiv_search_4xx_non_429_no_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    """404 等非 5xx/429 错误不触发 retry。"""
    _patch_env(monkeypatch, max_retries=1)
    conn = ArxivConnector()

    mock_get = Mock(return_value=_make_response(404))
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search("test", max_results=5)

    assert mock_get.call_count == 1, "404 应立即退出循环，不重试"
    assert papers == []


# ---------------------------------------------------------------------------
# Bonus: max_retries=0 等同 0 retry，与 pubmed/openalex 等价
# ---------------------------------------------------------------------------


def test_arxiv_search_max_retries_zero_no_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_env(monkeypatch, max_retries=0)
    conn = ArxivConnector()

    mock_get = Mock(return_value=_make_response(503))
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search("test", max_results=5)

    assert mock_get.call_count == 1, "max_retries=0 应只尝试一次"
    assert papers == []


def test_arxiv_default_max_retries_is_zero() -> None:
    """回归：默认 ARXIV_MAX_RETRIES 必须是 0（fail-fast）。

    历史曾默认 1（即 2 次尝试）。实测 arxiv 故障窗口期通常持续数十分钟，
    重试基本救不回，反而让单次搜索拖到 18s。默认 fail-fast，让 lit-search
    通过 openalex/crossref 等 healthy 源补足。需要重试的场景显式设
    PAPER_SEARCH_ARXIV_MAX_RETRIES=1 即可。
    """
    assert arxiv_module.ARXIV_MAX_RETRIES == 0, (
        f"arxiv 默认应不重试，当前 ARXIV_MAX_RETRIES={arxiv_module.ARXIV_MAX_RETRIES}"
    )


# ---------------------------------------------------------------------------
# 排序默认值：必须按 relevance 排序
# ---------------------------------------------------------------------------


def test_arxiv_search_default_sort_is_relevance(monkeypatch: pytest.MonkeyPatch) -> None:
    """回归测试：arxiv 默认 sortBy 必须是 relevance，不能再退回 submittedDate。

    历史 bug：sortBy=submittedDate 让 arxiv 先匹配关键词再按时间倒排，
    导致最新论文（含 query 词但与意图无关）总占据 top-N。
    """
    _patch_env(monkeypatch)
    # 复位 env 改写（避免外部环境变量污染断言）
    monkeypatch.setattr(arxiv_module, "ARXIV_SORT_BY", "relevance")
    monkeypatch.setattr(arxiv_module, "ARXIV_SORT_ORDER", "descending")

    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("transformer attention", max_results=5)

    sent_params = mock_get.call_args.kwargs.get("params", {})
    assert sent_params.get("sortBy") == "relevance", (
        f"arxiv 默认 sortBy 必须是 relevance（见 ARXIV_SORT_BY），实际 {sent_params.get('sortBy')!r}"
    )
    assert sent_params.get("sortOrder") == "descending"


def test_arxiv_search_sort_overridable_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """env 覆盖路径仍可用：调试或专门拉时间排序时不需要改代码。"""
    _patch_env(monkeypatch)
    monkeypatch.setattr(arxiv_module, "ARXIV_SORT_BY", "submittedDate")
    monkeypatch.setattr(arxiv_module, "ARXIV_SORT_ORDER", "ascending")

    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("anything", max_results=5)

    sent_params = mock_get.call_args.kwargs.get("params", {})
    assert sent_params.get("sortBy") == "submittedDate"
    assert sent_params.get("sortOrder") == "ascending"


# ---------------------------------------------------------------------------
# Categories 过滤：限定 arxiv 分类（cs.CL / cs.LG 等），避免跨学科噪声
# ---------------------------------------------------------------------------
#
# 背景：arxiv search API 对 query 做全文匹配，"rope" 同时命中 RoPE 位置编码
# 与纤维绳 / 太阳磁绳；不加分类过滤时一次 query 可能返回 50% 离题论文。
# 通过传 categories=["cs.CL", "cs.LG"] 让 connector 把分类约束拼到 search_query
# 里：(cat:cs.CL OR cat:cs.LG) AND all:<query>。
# 调用方（scenario PLAN）按 domains 字段决定是否传，不传 = 向后兼容。


def test_arxiv_search_categories_multi_wraps_with_or(monkeypatch: pytest.MonkeyPatch) -> None:
    """多分类用括号 + OR 包裹，再 AND 上原 query。"""
    _patch_env(monkeypatch)
    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("rope", max_results=5, categories=["cs.CL", "cs.LG"])

    sent_params = mock_get.call_args.kwargs.get("params", {})
    assert sent_params.get("search_query") == "(cat:cs.CL OR cat:cs.LG) AND all:rope", (
        f"多分类应包成 (cat:A OR cat:B) AND all:<q>，实际 {sent_params.get('search_query')!r}"
    )


def test_arxiv_search_categories_single_no_parens(monkeypatch: pytest.MonkeyPatch) -> None:
    """单分类不用括号包，AND 上原 query 即可。"""
    _patch_env(monkeypatch)
    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("transformer", max_results=5, categories=["cs.CL"])

    sent_params = mock_get.call_args.kwargs.get("params", {})
    assert sent_params.get("search_query") == "cat:cs.CL AND all:transformer", (
        f"单分类应为 cat:X AND all:<q>，实际 {sent_params.get('search_query')!r}"
    )


def test_arxiv_search_categories_none_backward_compat(monkeypatch: pytest.MonkeyPatch) -> None:
    """不传 categories 时行为与改前一致：仅 all:<query>。"""
    _patch_env(monkeypatch)
    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("attention", max_results=5)

    sent_params = mock_get.call_args.kwargs.get("params", {})
    assert sent_params.get("search_query") == "all:attention", (
        f"不传 categories 时不应改变 search_query，实际 {sent_params.get('search_query')!r}"
    )


def test_arxiv_search_categories_empty_list_equiv_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """空 list 与未传等价 —— scenario 端 PLAN 没识别出 domains 时会传空 list。"""
    _patch_env(monkeypatch)
    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("attention", max_results=5, categories=[])

    sent_params = mock_get.call_args.kwargs.get("params", {})
    assert sent_params.get("search_query") == "all:attention"


# ---------------------------------------------------------------------------
# Polite throttle (P0)：每次 search() 前阻塞到距离上次 ≥ ARXIV_MIN_INTERVAL_SEC
# ---------------------------------------------------------------------------
#
# 背景：arxiv polite policy 是 3s/request；searcher H4 fan-out 一次性 6 个并发
# arxiv 请求会触发 429 持续 ban（实测 PR #380 端到端 6 次 arxiv 调用全 0）。
# Connector 内部加 per-process 模块级节流，让并发 thread 自动排队，arxiv 看到
# 的是 3s/req 而非 1s/6req。


def test_arxiv_throttle_first_call_no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    """首次调用 _arxiv_throttle 时 last_ts=0，elapsed 极大，wait = 0。"""
    _reset_throttle(monkeypatch)
    monkeypatch.setattr(arxiv_module, "ARXIV_MIN_INTERVAL_SEC", 3.0)

    sleeps: list[float] = []
    monkeypatch.setattr(arxiv_module.time, "sleep", lambda s: sleeps.append(s))

    wait = arxiv_module._arxiv_throttle()
    assert wait == 0.0
    assert sleeps == []


def test_arxiv_throttle_second_call_waits_until_min_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    """两次连续调用之间应 sleep 接近 ARXIV_MIN_INTERVAL_SEC。"""
    _reset_throttle(monkeypatch)
    monkeypatch.setattr(arxiv_module, "ARXIV_MIN_INTERVAL_SEC", 3.0)

    sleeps: list[float] = []
    monkeypatch.setattr(arxiv_module.time, "sleep", lambda s: sleeps.append(s))

    # mock time.monotonic：第一次调返回 100.0；之后第二次调返回 101.0（1s 后）
    ticks = iter([100.0, 100.0, 101.0, 101.0])
    monkeypatch.setattr(arxiv_module.time, "monotonic", lambda: next(ticks))

    arxiv_module._arxiv_throttle()  # 第一次
    wait = arxiv_module._arxiv_throttle()  # 第二次，1s 后
    # 距离 ts=100.0 才过了 1s，需要再等 2s
    assert wait == pytest.approx(2.0)
    assert sleeps == [pytest.approx(2.0)]


def test_arxiv_throttle_after_interval_no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    """过了 ARXIV_MIN_INTERVAL_SEC 之后再调，不应 sleep。"""
    _reset_throttle(monkeypatch)
    monkeypatch.setattr(arxiv_module, "ARXIV_MIN_INTERVAL_SEC", 3.0)

    sleeps: list[float] = []
    monkeypatch.setattr(arxiv_module.time, "sleep", lambda s: sleeps.append(s))

    # 第一次 ts=100.0，第二次 ts=110.0（10s 后，远超 3s 间隔）
    ticks = iter([100.0, 100.0, 110.0, 110.0])
    monkeypatch.setattr(arxiv_module.time, "monotonic", lambda: next(ticks))

    arxiv_module._arxiv_throttle()
    wait = arxiv_module._arxiv_throttle()
    assert wait == 0.0
    assert sleeps == []


def test_arxiv_search_invokes_throttle(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证 search() 入口调用 _arxiv_throttle —— 不只在 helper level，也要在
    实际 search 流程中触发。"""
    _reset_throttle(monkeypatch)
    _patch_env(monkeypatch)
    monkeypatch.setattr(arxiv_module, "ARXIV_MIN_INTERVAL_SEC", 0.0)  # 避免实际 sleep

    throttle_calls: list[None] = []
    real_throttle = arxiv_module._arxiv_throttle

    def spy_throttle() -> float:
        throttle_calls.append(None)
        return real_throttle()

    monkeypatch.setattr(arxiv_module, "_arxiv_throttle", spy_throttle)

    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("test", max_results=5)
    assert len(throttle_calls) == 1, "search() 应在 HTTP GET 前调用 _arxiv_throttle 恰好 1 次"


# ---------------------------------------------------------------------------
# Bonus: split timeout 透传给 session.get
# ---------------------------------------------------------------------------


def test_arxiv_search_passes_split_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证 session.get 收到的 timeout 是 (connect, read) tuple。"""
    monkeypatch.setattr(arxiv_module, "ARXIV_CONNECT_TIMEOUT_SEC", 2.5)
    monkeypatch.setattr(arxiv_module, "ARXIV_READ_TIMEOUT_SEC", 7.0)
    _patch_env(monkeypatch)

    conn = ArxivConnector()
    mock_get = Mock(return_value=_make_response(200, b"<feed></feed>"))
    monkeypatch.setattr(conn.session, "get", mock_get)

    conn.search("test", max_results=5)

    call_kwargs = mock_get.call_args.kwargs
    assert call_kwargs.get("timeout") == (2.5, 7.0), (
        f"应为 (connect=2.5, read=7.0) tuple，实际 {call_kwargs.get('timeout')!r}"
    )


# ---------------------------------------------------------------------------
# Jittered backoff — retry sleep lands in [backoff, 2*backoff]
# ---------------------------------------------------------------------------


def test_jittered_backoff_within_bounds(monkeypatch: pytest.MonkeyPatch) -> None:
    """sleep 实际值 = backoff * (1 + random()), random∈[0,1) → sleep∈[backoff, 2*backoff)."""
    monkeypatch.setattr(arxiv_module, "ARXIV_MAX_RETRIES", 1)
    monkeypatch.setattr(arxiv_module, "ARXIV_BACKOFF_SEC", 0.05)
    # 固定 random.random=0.5 → sleep 应该是 0.05 * (1 + 0.5) = 0.075
    monkeypatch.setattr(arxiv_module.random, "random", lambda: 0.5)

    conn = ArxivConnector()
    mock_get = Mock(side_effect=[_make_response(503), _make_response(503)])
    monkeypatch.setattr(conn.session, "get", mock_get)

    sleep_calls: list[float] = []
    monkeypatch.setattr(arxiv_module.time, "sleep", lambda s: sleep_calls.append(s))

    conn.search("test", max_results=5)

    assert mock_get.call_count == 2
    assert len(sleep_calls) == 1, f"应只 sleep 1 次（fencepost 修复），实际 {sleep_calls}"
    assert sleep_calls[0] == pytest.approx(0.075), (
        f"sleep 应为 backoff * (1 + 0.5) = 0.075，实际 {sleep_calls[0]}"
    )


def test_jittered_backoff_random_zero_equals_linear(monkeypatch: pytest.MonkeyPatch) -> None:
    """random=0 时 jitter 退化为线性 backoff（保护既有断言）。"""
    monkeypatch.setattr(arxiv_module, "ARXIV_MAX_RETRIES", 1)
    monkeypatch.setattr(arxiv_module, "ARXIV_BACKOFF_SEC", 0.05)
    monkeypatch.setattr(arxiv_module.random, "random", lambda: 0.0)
    monkeypatch.setattr(arxiv_module, "ARXIV_MIN_INTERVAL_SEC", 0.0)
    monkeypatch.setattr(arxiv_module, "_arxiv_last_request_ts", 0.0)

    conn = ArxivConnector()
    mock_get = Mock(side_effect=[_make_response(503), _make_response(503)])
    monkeypatch.setattr(conn.session, "get", mock_get)

    sleep_calls: list[float] = []
    monkeypatch.setattr(arxiv_module.time, "sleep", lambda s: sleep_calls.append(s))

    conn.search("test", max_results=5)

    assert sleep_calls == [0.05]
