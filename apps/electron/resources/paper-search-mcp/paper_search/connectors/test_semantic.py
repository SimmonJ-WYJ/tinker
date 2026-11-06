"""Tests for Semantic Scholar connector — no-API-key fail-fast.

覆盖 semantic.py search() 入口的门控逻辑：
- 无 SEMANTIC_SCHOLAR_API_KEY 时立即返 [] 不发请求（避免 ~15s 429 退避）
- env PAPER_SEARCH_MCP_SEMANTIC_ALLOW_NO_KEY=1 时允许无 key 走旧路径
- 有 key 时走原有 request_api 流程

测试用 monkeypatch 拦截 session.get / request_api，避免真实网络请求。
"""
from __future__ import annotations

from unittest.mock import Mock

import pytest

from .semantic import SemanticConnector


def test_no_key_returns_empty_without_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """无 API key 且无 opt-in env → 直接返 []，不调 request_api。"""
    monkeypatch.delenv("PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY", raising=False)
    monkeypatch.delenv("SEMANTIC_SCHOLAR_API_KEY", raising=False)
    monkeypatch.delenv("PAPER_SEARCH_MCP_SEMANTIC_ALLOW_NO_KEY", raising=False)
    monkeypatch.delenv("SEMANTIC_ALLOW_NO_KEY", raising=False)
    # 清掉模块级 _api_key_rejected 状态防污染
    SemanticConnector._api_key_rejected = False

    conn = SemanticConnector()
    mock_req = Mock(side_effect=AssertionError("request_api MUST NOT be called when no key"))
    monkeypatch.setattr(conn, "request_api", mock_req)

    papers = conn.search("anything", max_results=5)

    assert papers == []
    assert mock_req.call_count == 0


def test_no_key_opt_in_via_env_proceeds(monkeypatch: pytest.MonkeyPatch) -> None:
    """SEMANTIC_ALLOW_NO_KEY=1 → 即使无 key 也进入原有流程（用 mock request_api 验证）。"""
    monkeypatch.delenv("PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY", raising=False)
    monkeypatch.delenv("SEMANTIC_SCHOLAR_API_KEY", raising=False)
    monkeypatch.setenv("PAPER_SEARCH_MCP_SEMANTIC_ALLOW_NO_KEY", "1")
    SemanticConnector._api_key_rejected = False

    conn = SemanticConnector()
    # request_api 返回 dict 带 error 让搜索快速结束，但确认它被调到了
    mock_req = Mock(return_value={"error": "rate_limited", "message": "test stub"})
    monkeypatch.setattr(conn, "request_api", mock_req)

    papers = conn.search("anything", max_results=5)

    assert papers == []  # rate-limit 路径返空
    assert mock_req.call_count == 1, "with opt-in env, request_api must be called"


def test_with_api_key_proceeds_normally(monkeypatch: pytest.MonkeyPatch) -> None:
    """有 API key → 正常进入 request_api。"""
    monkeypatch.setenv("PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY", "stub-key-xxx")
    monkeypatch.delenv("PAPER_SEARCH_MCP_SEMANTIC_ALLOW_NO_KEY", raising=False)
    SemanticConnector._api_key_rejected = False

    conn = SemanticConnector()
    mock_req = Mock(return_value={"error": "rate_limited", "message": "test stub"})
    monkeypatch.setattr(conn, "request_api", mock_req)

    papers = conn.search("anything", max_results=5)

    assert mock_req.call_count == 1
    assert papers == []


def test_concurrent_requests_throttled_to_min_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    """并发多 cell（retrieve 经查询矩阵用 asyncio.to_thread 并发跑 semantic）下，
    节流仍把请求**起始**间隔串行化到 ≥ _MIN_REQUEST_INTERVAL，不超过 1 req/s。

    回归：之前类级 _last_request_time 无锁，并发线程读同一旧时间戳会一起开火，
    一秒内突发多请求、违反审批邮件的 1/s 限速。_rate_lock 串行化发射闸门修复之。
    """
    import threading
    import time as _time

    # 缩短间隔让测试快（0.2s × 6 ≈ 1.2s）；monkeypatch 自动还原类属性
    monkeypatch.setattr(SemanticConnector, "_MIN_REQUEST_INTERVAL", 0.2)
    SemanticConnector._last_request_time = 0
    SemanticConnector._api_key_rejected = False

    conn = SemanticConnector()
    send_times: list[float] = []
    record_lock = threading.Lock()

    def fake_get(url, params=None, headers=None, timeout=None):  # noqa: ANN001
        with record_lock:
            send_times.append(_time.monotonic())
        resp = Mock()
        resp.status_code = 200
        resp.raise_for_status = Mock()
        return resp

    monkeypatch.setattr(conn.session, "get", fake_get)

    n = 6
    threads = [
        threading.Thread(target=lambda: conn.request_api("paper/search", {}))
        for _ in range(n)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(send_times) == n, "every thread should have fired exactly one request"
    send_times.sort()
    gaps = [send_times[i + 1] - send_times[i] for i in range(len(send_times) - 1)]
    # 每个相邻间隔都应 ≥ interval（留 10% 容差应对线程调度抖动）。
    # 无锁竞态下这些 gap 会接近 0（突发），断言即回归守门。
    assert all(g >= 0.2 * 0.9 for g in gaps), f"requests not throttled (burst): gaps={gaps}"
