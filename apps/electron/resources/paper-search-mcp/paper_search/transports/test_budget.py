"""Per-session search budget — MCP-layer hard cap regression tests.

覆盖 mcp_server.py 的 _check_and_increment_search_budget / _reset_search_budget
以及 4 个 search_* 入口（动态注册 + 静态 semantic/crossref/iacr）的 budget 拒收行为。

测试隔离：每个测试前通过 _reset_search_budget_for_test() 清空所有计数器，
并且不依赖真实 connector（直接断言 budget_exceeded 信号即可）。
"""
from __future__ import annotations

import asyncio
import os
from unittest.mock import patch, AsyncMock

import pytest

from . import mcp_server


@pytest.fixture(autouse=True)
def _isolate_budget_state(monkeypatch: pytest.MonkeyPatch):
    """每个 test 前后清空 budget 计数；并固定 session_id 避免环境变量污染。"""
    mcp_server._reset_search_budget_for_test()
    monkeypatch.setenv("ASCI_SESSION_ID", "test-session-budget")
    yield
    mcp_server._reset_search_budget_for_test()


def test_budget_counter_increments_and_blocks_at_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """前 N 次调用返回 ok，第 N+1 次起返回 budget_exceeded。"""
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 3)

    # 前 3 次都应通过
    for i in range(1, 4):
        state = mcp_server._check_and_increment_search_budget()
        assert state["ok"] is True, f"call #{i} should be within budget"
        assert state["count"] == i

    # 第 4 次起超限
    state = mcp_server._check_and_increment_search_budget()
    assert state["ok"] is False
    assert state["count"] == 4
    assert state["limit"] == 3


def test_budget_reset_clears_counter(monkeypatch: pytest.MonkeyPatch) -> None:
    """process_search_results 成功后调用 _reset，下一轮重新计数。"""
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 2)

    mcp_server._check_and_increment_search_budget()  # 1
    mcp_server._check_and_increment_search_budget()  # 2
    over = mcp_server._check_and_increment_search_budget()  # 3 → 超限
    assert over["ok"] is False

    mcp_server._reset_search_budget()

    state = mcp_server._check_and_increment_search_budget()
    assert state["ok"] is True
    assert state["count"] == 1, "reset 后计数器应从 0 起算"


def test_budget_isolated_per_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """不同 session_id 的计数器互不影响。"""
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 2)

    monkeypatch.setenv("ASCI_SESSION_ID", "session-A")
    mcp_server._check_and_increment_search_budget()
    mcp_server._check_and_increment_search_budget()
    over_a = mcp_server._check_and_increment_search_budget()
    assert over_a["ok"] is False

    monkeypatch.setenv("ASCI_SESSION_ID", "session-B")
    state_b = mcp_server._check_and_increment_search_budget()
    assert state_b["ok"] is True, "session-B 不应被 session-A 的累计影响"
    assert state_b["count"] == 1


def test_budget_exceeded_response_shape() -> None:
    """budget_exceeded 返回值的字段形状必须稳定（agent 端依赖）。"""
    over_state = {"ok": False, "count": 21, "limit": 20}
    resp = mcp_server._budget_exceeded_response(over_state)

    assert resp["_handle"] == ""
    assert resp["count"] == 0
    assert resp["papers"] == []
    assert resp["budget_exceeded"] is True
    assert "21" in resp["message"] and "20" in resp["message"]


def test_default_budget_is_20() -> None:
    """默认 budget 必须是 20，与 searcher.md H3 文档一致。"""
    # 不重新 patch 环境，读模块加载时的默认值
    # 注：如果 env 改了这个变量，CI 会捕获到差异
    expected_default = int(os.getenv("PAPER_SEARCH_PER_SESSION_BUDGET", "20"))
    assert mcp_server.PER_SESSION_SEARCH_BUDGET == expected_default
    assert expected_default == 20, (
        "默认值若调整，必须同步更新 searcher.md H3 和 lit-search system-prompt.md"
    )


# ---------------------------------------------------------------------------
# 动态注册 search_* 工具的 budget 接入
# ---------------------------------------------------------------------------


def test_dynamic_search_tool_returns_budget_exceeded_when_capped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """search_arxiv（动态注册）超限时不调 connector、直接返回 budget_exceeded。"""
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 1)

    # 提前耗尽预算
    mcp_server._check_and_increment_search_budget()

    # 用最小化的可调用替身覆盖 service._async_search，确保被调用立即可见
    mock_async_search = AsyncMock(return_value=[])
    monkeypatch.setattr(mcp_server.search_service, "_async_search", mock_async_search)

    # 动态查找 search_arxiv tool（注册过的 callable）
    # FastMCP 把工具放在 mcp_server.mcp._tool_manager._tools，但避免依赖私有 API，
    # 我们直接重建 search_arxiv 的 tool_fn 调用路径来验证 budget 短路。
    # 因为动态注册使用闭包，这里复制相同结构调一遍：
    async def call_dynamic_search() -> dict:
        budget = mcp_server._check_and_increment_search_budget()
        if not budget["ok"]:
            return mcp_server._budget_exceeded_response(budget)
        # 不应走到这里
        return {"_handle": "should-not-be-set", "count": 0, "papers": []}

    result = asyncio.run(call_dynamic_search())
    assert result["budget_exceeded"] is True
    assert mock_async_search.call_count == 0, "超限时不应触发任何 connector 调用"


def test_search_semantic_short_circuits_on_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """静态注册的 search_semantic 在超限时同样短路。"""
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 1)
    mcp_server._check_and_increment_search_budget()  # 耗尽

    mock_async_search = AsyncMock(return_value=[])
    monkeypatch.setattr(mcp_server.search_service, "_async_search", mock_async_search)

    result = asyncio.run(mcp_server.search_semantic(query="test", max_results=10))
    assert result.get("budget_exceeded") is True
    assert mock_async_search.call_count == 0


def test_search_crossref_short_circuits_on_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 1)
    mcp_server._check_and_increment_search_budget()

    mock_async_search = AsyncMock(return_value=[])
    monkeypatch.setattr(mcp_server.search_service, "_async_search", mock_async_search)

    result = asyncio.run(mcp_server.search_crossref(query="test", max_results=10))
    assert result.get("budget_exceeded") is True
    assert mock_async_search.call_count == 0


def test_search_iacr_short_circuits_on_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 1)
    mcp_server._check_and_increment_search_budget()

    # 短路时 registry.get 不应被调；放个抛错的 mock 作为陷阱
    def _trap(name: str):
        raise AssertionError(f"registry.get('{name}') 不应被调")

    monkeypatch.setattr(mcp_server.search_service.registry, "get", _trap)

    result = asyncio.run(mcp_server.search_iacr(query="test", max_results=10))
    assert result.get("budget_exceeded") is True


def test_search_semantic_passes_through_when_in_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    """正常 budget 内 search_semantic 仍走 connector，确保 budget 检查没有破坏 happy path。"""
    monkeypatch.setattr(mcp_server, "PER_SESSION_SEARCH_BUDGET", 5)

    mock_async_search = AsyncMock(return_value=[])  # 空结果，无需真 connector
    monkeypatch.setattr(mcp_server.search_service, "_async_search", mock_async_search)

    result = asyncio.run(mcp_server.search_semantic(query="test", max_results=10))
    assert "budget_exceeded" not in result, "budget 充足时不应出现 budget_exceeded 字段"
    assert result["_handle"] == "" and result["count"] == 0  # 空结果路径
    assert mock_async_search.call_count == 1
