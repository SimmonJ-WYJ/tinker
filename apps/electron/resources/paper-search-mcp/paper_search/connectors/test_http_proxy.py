"""ProxyFallbackSession 三档代理选路单测（issue #743）—— 全部脱网。

覆盖 AC：直连成功 / 直连失败回退代理成功 / 两者都失败优雅返回（连接器吞掉异常）/
三档 mode（auto / direct / system）选路正确 / 召回路径零变化。

测试通过 monkeypatch ``_send`` seam 模拟「直连」「代理」两种发送结果，不打真网络。
"""
from __future__ import annotations

from typing import Any, Optional

import pytest
import requests

from . import http_proxy as hp
from .http_proxy import ProxyFallbackSession, enrich_proxy_context


_SENTINEL_DIRECT = object()
_SENTINEL_PROXY = object()


class _Recorder:
    """记录每次 _send 的 proxies，并按「直连/代理」分别给出结果或抛错。"""

    def __init__(self, *, direct: Any, proxy: Any):
        self.calls: list[Optional[dict]] = []
        self._direct = direct
        self._proxy = proxy

    def __call__(self, method: str, url: str, *, proxies: Optional[dict], **kwargs: Any):
        self.calls.append(proxies)
        # _NO_PROXY（含 http+https=None）= 直连；其余（含 None=trust_env / 显式代理 dict）= 代理侧
        is_direct = proxies == hp._NO_PROXY
        outcome = self._direct if is_direct else self._proxy
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def _attach(session: ProxyFallbackSession, recorder: _Recorder) -> None:
    session._send = recorder  # type: ignore[assignment,method-assign]


# --------------------------------------------------------------------------
# resolve_proxy_mode
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        (None, hp.PROXY_MODE_AUTO),
        ("", hp.PROXY_MODE_AUTO),
        ("auto", hp.PROXY_MODE_AUTO),
        ("DIRECT", hp.PROXY_MODE_DIRECT),
        (" system ", hp.PROXY_MODE_SYSTEM),
        ("garbage", hp.PROXY_MODE_AUTO),
    ],
)
def test_resolve_proxy_mode(monkeypatch: pytest.MonkeyPatch, raw, expected) -> None:
    if raw is None:
        monkeypatch.delenv("PAPER_SEARCH_HTTP_PROXY_MODE", raising=False)
    else:
        monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", raw)
    assert hp.resolve_proxy_mode() == expected


# --------------------------------------------------------------------------
# 召回路径：不进 enrich 上下文 → 透传父类，零行为变化
# --------------------------------------------------------------------------

def test_recall_path_bypasses_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """上下文外调用 request → 直接走 requests.Session.request，绝不触碰 _send/选路逻辑。"""
    sentinel = object()
    monkeypatch.setattr(
        requests.Session, "request",
        lambda self, method, url, **kwargs: sentinel,
    )
    session = ProxyFallbackSession()
    _attach(session, _Recorder(direct=AssertionError("不应调用 _send"), proxy=AssertionError()))

    # 没有 enrich_proxy_context 包裹
    result = session.request("GET", "https://api.crossref.org/works")
    assert result is sentinel


# --------------------------------------------------------------------------
# auto 模式
# --------------------------------------------------------------------------

def test_auto_direct_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "auto")
    session = ProxyFallbackSession()
    rec = _Recorder(direct=_SENTINEL_DIRECT, proxy=_SENTINEL_PROXY)
    _attach(session, rec)
    # 直连成功就不该探测系统代理
    monkeypatch.setattr(hp, "detect_system_proxy", lambda: (_ for _ in ()).throw(AssertionError()))

    with enrich_proxy_context() as info:
        resp = session.get("https://api.crossref.org/works")

    assert resp is _SENTINEL_DIRECT
    assert info["route"] == "direct"
    assert rec.calls == [hp._NO_PROXY]  # 只发了一次、走直连


def test_auto_fallback_to_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    """直连 SSL EOF → 检测到系统代理 → 同请求经代理重试成功。"""
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "auto")
    session = ProxyFallbackSession()
    fake_proxy = {"http": "http://127.0.0.1:7890", "https": "http://127.0.0.1:7890"}
    monkeypatch.setattr(hp, "detect_system_proxy", lambda: fake_proxy)
    rec = _Recorder(
        direct=requests.exceptions.SSLError("UNEXPECTED_EOF_WHILE_READING"),
        proxy=_SENTINEL_PROXY,
    )
    _attach(session, rec)

    with enrich_proxy_context() as info:
        resp = session.get("https://api.crossref.org/works")

    assert resp is _SENTINEL_PROXY
    assert info["route"] == "proxy"
    assert info["fallback_reason"] == "SSLError"
    # 第一次直连（_NO_PROXY），第二次回退（显式系统代理 dict）
    assert rec.calls == [hp._NO_PROXY, fake_proxy]


def test_auto_no_system_proxy_reraises(monkeypatch: pytest.MonkeyPatch) -> None:
    """直连失败但系统无代理可回退 → 直接抛连接错误（上层连接器吞掉）。"""
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "auto")
    session = ProxyFallbackSession()
    monkeypatch.setattr(hp, "detect_system_proxy", lambda: {})
    rec = _Recorder(direct=requests.exceptions.ConnectionError("boom"), proxy=_SENTINEL_PROXY)
    _attach(session, rec)

    with enrich_proxy_context() as info:
        with pytest.raises(requests.exceptions.ConnectionError):
            session.get("https://api.openalex.org/works")

    assert info["route"] == "direct-failed-no-proxy"
    assert rec.calls == [hp._NO_PROXY]  # 没有第二次（无代理可走）


def test_auto_both_fail_reraises(monkeypatch: pytest.MonkeyPatch) -> None:
    """直连 + 代理双失败 → 抛错（route=proxy-failed），不静默。"""
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "auto")
    session = ProxyFallbackSession()
    monkeypatch.setattr(hp, "detect_system_proxy", lambda: {"https": "http://127.0.0.1:7890"})
    rec = _Recorder(
        direct=requests.exceptions.SSLError("eof"),
        proxy=requests.exceptions.ConnectionError("proxy down"),
    )
    _attach(session, rec)

    with enrich_proxy_context() as info:
        with pytest.raises(requests.exceptions.ConnectionError):
            session.get("https://api.openalex.org/works")

    assert info["route"] == "proxy-failed"
    assert len(rec.calls) == 2


# --------------------------------------------------------------------------
# direct 模式：永不走代理
# --------------------------------------------------------------------------

def test_direct_mode_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "direct")
    session = ProxyFallbackSession()
    rec = _Recorder(direct=_SENTINEL_DIRECT, proxy=_SENTINEL_PROXY)
    _attach(session, rec)

    with enrich_proxy_context() as info:
        resp = session.get("https://api.crossref.org/works")

    assert resp is _SENTINEL_DIRECT
    assert info["route"] == "direct"


def test_direct_mode_never_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "direct")
    session = ProxyFallbackSession()
    # direct 模式即使有系统代理也不许探测/回退
    monkeypatch.setattr(hp, "detect_system_proxy", lambda: (_ for _ in ()).throw(AssertionError()))
    rec = _Recorder(direct=requests.exceptions.SSLError("eof"), proxy=_SENTINEL_PROXY)
    _attach(session, rec)

    with enrich_proxy_context() as info:
        with pytest.raises(requests.exceptions.SSLError):
            session.get("https://api.crossref.org/works")

    assert info["route"] == "direct-failed"
    assert rec.calls == [hp._NO_PROXY]


# --------------------------------------------------------------------------
# system 模式：永远走系统代理（proxies=None → 交给 trust_env）
# --------------------------------------------------------------------------

def test_system_mode_uses_trust_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "system")
    session = ProxyFallbackSession()
    rec = _Recorder(direct=_SENTINEL_DIRECT, proxy=_SENTINEL_PROXY)
    _attach(session, rec)

    with enrich_proxy_context() as info:
        resp = session.get("https://www.ebi.ac.uk/europepmc/webservices/rest/search")

    # proxies=None → recorder 归入「代理侧」（非 _NO_PROXY）
    assert resp is _SENTINEL_PROXY
    assert info["route"] == "system"
    assert rec.calls == [None]


def test_explicit_mode_arg_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """enrich_proxy_context(mode=...) 显式参数优先于 env。"""
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "system")
    session = ProxyFallbackSession()
    rec = _Recorder(direct=_SENTINEL_DIRECT, proxy=_SENTINEL_PROXY)
    _attach(session, rec)

    with enrich_proxy_context(mode="direct") as info:
        resp = session.get("https://api.crossref.org/works")

    assert resp is _SENTINEL_DIRECT
    assert info["route"] == "direct"


# --------------------------------------------------------------------------
# auto 直连尝试：连接超时被压短，读取超时保留
# --------------------------------------------------------------------------

def test_auto_caps_direct_connect_and_read_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "auto")
    monkeypatch.setenv("PAPER_SEARCH_HTTP_DIRECT_CONNECT_TIMEOUT_SEC", "2.0")
    monkeypatch.setenv("PAPER_SEARCH_HTTP_DIRECT_READ_TIMEOUT_SEC", "3.0")
    session = ProxyFallbackSession()
    captured: dict[str, Any] = {}

    def _send(method, url, *, proxies, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        return _SENTINEL_DIRECT

    session._send = _send  # type: ignore[assignment,method-assign]

    with enrich_proxy_context():
        session.get("https://api.crossref.org/works", timeout=30)

    # #743：直连尝试连接 + 读取超时都被压到上限 → (connect=2.0, read=3.0)，
    # 不再沿用连接器默认 30s 读超时（否则读卡住时回退代理来不及跑）。
    assert captured["timeout"] == (2.0, 3.0)


def test_auto_direct_timeout_takes_min_with_original(monkeypatch: pytest.MonkeyPatch) -> None:
    """原超时比上限还小时取原值（不放大）。"""
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "auto")
    monkeypatch.setenv("PAPER_SEARCH_HTTP_DIRECT_CONNECT_TIMEOUT_SEC", "2.5")
    monkeypatch.setenv("PAPER_SEARCH_HTTP_DIRECT_READ_TIMEOUT_SEC", "2.5")
    session = ProxyFallbackSession()
    captured: dict[str, Any] = {}

    def _send(method, url, *, proxies, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        return _SENTINEL_DIRECT

    session._send = _send  # type: ignore[assignment,method-assign]

    with enrich_proxy_context():
        session.get("https://api.crossref.org/works", timeout=1.0)

    assert captured["timeout"] == (1.0, 1.0)  # 原值 1.0 < 上限 2.5 → 取 1.0


# --------------------------------------------------------------------------
# detect_system_proxy 只回 http/https 非空键
# --------------------------------------------------------------------------

def test_detect_system_proxy_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        hp, "getproxies",
        lambda: {"http": "http://127.0.0.1:7890", "https": "http://127.0.0.1:7890",
                 "ftp": "", "no": "localhost"},
    )
    assert hp.detect_system_proxy() == {
        "http": "http://127.0.0.1:7890",
        "https": "http://127.0.0.1:7890",
    }


def test_detect_system_proxy_handles_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hp, "getproxies", lambda: (_ for _ in ()).throw(RuntimeError("nope")))
    assert hp.detect_system_proxy() == {}


# --------------------------------------------------------------------------
# 连接器级优雅降级：两者都失败 → 连接器 try/except 吞掉 → 返回空（不抛）
# --------------------------------------------------------------------------

def test_connector_swallows_double_failure_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """模拟 crossref 的 try/except requests.RequestException 包着 session.get。

    helper 双失败抛 ConnectionError（属 RequestException），连接器吞掉返回 [] →
    enrich 上层据此回落到下一源/None，不会把异常冒泡（AC「两者都失败优雅返回」）。
    """
    monkeypatch.setenv("PAPER_SEARCH_HTTP_PROXY_MODE", "auto")
    monkeypatch.setattr(hp, "detect_system_proxy", lambda: {"https": "http://127.0.0.1:7890"})
    session = ProxyFallbackSession()
    _attach(session, _Recorder(
        direct=requests.exceptions.SSLError("eof"),
        proxy=requests.exceptions.ConnectionError("down"),
    ))

    def fake_connector_search(query: str):
        try:
            with enrich_proxy_context():
                resp = session.get("https://api.crossref.org/works", params={"query": query})
            return [resp]
        except requests.RequestException:
            return []

    assert fake_connector_search("foo") == []
