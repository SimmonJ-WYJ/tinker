"""Tests for JournalConnector — OPENSCI /journal（OpenAlex-/works 兼容）。

覆盖：
- Bearer 头来自 JOURNAL_ACCESS_TOKEN env；BASE_URL 来自 JOURNAL_BASE_URL env
- source == "journal"（复用 OpenAlex 解析）
- 用普通 requests.Session（非 ProxyFallbackSession），避免 Bearer 走代理泄漏
- requires_key 门控：env 无 token → 注册表不实例化 journal

测试用 monkeypatch 拦截 session.get，避免真实网络请求。
"""
from __future__ import annotations

from unittest.mock import Mock

import pytest
import requests

from .journal import JournalConnector
from .openalex import OpenAlexConnector
from .http_proxy import ProxyFallbackSession
from .registry import ConnectorRegistry


def _make_response(status: int, payload: dict | None = None) -> Mock:
    resp = Mock(spec=requests.Response)
    resp.status_code = status
    resp.json = Mock(return_value=payload or {"results": []})
    return resp


def _item(*, id_url: str = "https://openalex.org/W1", title: str = "Sample") -> dict:
    return {
        "id": id_url, "title": title, "authorships": [],
        "abstract_inverted_index": None, "doi": None,
        "primary_location": {"source": {"display_name": "Journal of X"}},
        "open_access": None, "publication_date": None,
        "concepts": [], "cited_by_count": 0,
    }


def test_uses_bearer_token_and_base_url_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JOURNAL_ACCESS_TOKEN", "tok-123")
    monkeypatch.setenv("JOURNAL_BASE_URL", "https://asci-test.opensci.io/journal")
    conn = JournalConnector()
    assert conn.session.headers.get("Authorization") == "Bearer tok-123"
    assert conn.BASE_URL == "https://asci-test.opensci.io/journal"
    # 私有鉴权接口禁止代理回退
    assert not isinstance(conn.session, ProxyFallbackSession)
    assert isinstance(conn.session, requests.Session)


def test_parses_results_with_source_journal(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JOURNAL_ACCESS_TOKEN", "tok-123")
    conn = JournalConnector()
    payload = {"results": [_item(id_url="https://openalex.org/W1", title="Paper A")]}
    monkeypatch.setattr(conn.session, "get", Mock(return_value=_make_response(200, payload)))
    monkeypatch.setenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", "1")

    papers = conn.search("anything", max_results=5)

    assert len(papers) == 1
    assert papers[0].source == "journal"
    assert papers[0].title == "Paper A"
    assert papers[0].venue == "Journal of X"
    # 请求确实打到 journal base url
    called_url = conn.session.get.call_args.args[0] if conn.session.get.call_args.args \
        else conn.session.get.call_args.kwargs.get("url")
    assert called_url == conn.BASE_URL


def test_is_subclass_of_openalex() -> None:
    assert issubclass(JournalConnector, OpenAlexConnector)


def test_uses_prefixed_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证生产注入的带前缀 env 变量路径。

    生产环境注入 PAPER_SEARCH_MCP_JOURNAL_ACCESS_TOKEN / PAPER_SEARCH_MCP_JOURNAL_BASE_URL；
    此测试验证 get_env 的前缀优先逻辑，仅通过前缀路径获取配置。
    """
    monkeypatch.delenv("JOURNAL_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("JOURNAL_BASE_URL", raising=False)
    monkeypatch.setenv("PAPER_SEARCH_MCP_JOURNAL_ACCESS_TOKEN", "ptok-456")
    monkeypatch.setenv("PAPER_SEARCH_MCP_JOURNAL_BASE_URL", "https://example.test/journal")

    conn = JournalConnector()

    assert conn.session.headers.get("Authorization") == "Bearer ptok-456"
    assert conn.BASE_URL == "https://example.test/journal"
    assert isinstance(conn.session, requests.Session)


def test_requires_key_gating(monkeypatch: pytest.MonkeyPatch) -> None:
    """无 JOURNAL_ACCESS_TOKEN → 注册表不实例化 journal；有则实例化。"""
    monkeypatch.delenv("JOURNAL_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("PAPER_SEARCH_MCP_JOURNAL_ACCESS_TOKEN", raising=False)
    assert "journal" not in ConnectorRegistry()

    monkeypatch.setenv("JOURNAL_ACCESS_TOKEN", "tok-xyz")
    assert "journal" in ConnectorRegistry()
