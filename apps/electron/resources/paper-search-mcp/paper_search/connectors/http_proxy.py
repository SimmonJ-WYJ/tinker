"""enrich HTTP 代理自适应（issue #743）。

问题（已实测坐实）：开着 macOS 系统代理（ClashX 等，127.0.0.1:7890）时，
Python ``requests`` 默认经系统代理出网（``trust_env=True`` → ``getproxies()`` 读
系统网络代理），对 crossref / openalex / europepmc / semantic 这几个 enrich 源的
TLS 连接间歇性失败（``SSL: UNEXPECTED_EOF_WHILE_READING``），导致摘要补全四源全挂、
静默缺摘要——而同机 curl 直连三源全 200、绕过代理后 europepmc 1s 返回摘要。

方案：enrich 的 HTTP 请求走「直连优先 + 失败回退代理」三档自适应（env
``PAPER_SEARCH_HTTP_PROXY_MODE``）：

- ``direct`` —— 永远绕过系统代理直连。
- ``system`` —— 永远走系统代理（``trust_env`` 自然解析），给「直连被墙、只能靠
  VPN 出网」的 power user。
- ``auto``（默认）—— 先直连（**连接 + 读取都用短超时**，确保被墙 / 读卡住时都能
  快速失败），若发生**连接级失败**（SSL EOF / ConnectionError / 超时）且检测到系统
  代理，对同一请求用代理重试一次。直连读超时也必须压短：enrich 每源总预算
  ``wait_for(5s)`` 是死线，若直连读超时沿用连接器默认 30s，读卡住时 5s 预算先到、
  整个源被放弃，**回退代理那一步在预算内根本来不及跑**（回退就只对"秒挂"有效、
  对"读卡住"失效）。压短直连读超时后，直连快速失败 → 代理回退仍在 5s 内有机会。

实现要点：
- ``ProxyFallbackSession`` 是 ``requests.Session`` 子类，只在 **enrich 上下文**内
  改变行为；召回（search 阶段）调用不进上下文 → 走父类原生逻辑，**零行为变化**
  （本 issue 不动召回，留给 follow-up）。
- enrich 上下文用 ``contextvars`` 传递：``asyncio.to_thread`` 会把当前 context 复制
  到工作线程，连接器内 ``self.session.get(...)`` 即可拿到上下文，**无需改连接器
  方法签名**，召回与 enrich 复用同一套 ``search()`` 而行为不同。
- 直连/代理都用 **per-request** ``proxies`` 显式指定，不改 session 状态 —— 实测
  ``proxies={'http': None, 'https': None}`` 会让 ``merge_environment_settings`` 的
  结果变空、压过 ``trust_env`` 的系统代理（无需 ``trust_env=False``）。per-request
  也意味着 16 篇并发 enrich 共享同一连接器实例时互不踩（race-safe）。
"""
from __future__ import annotations

import contextlib
import contextvars
import logging
import os
from typing import Any, Iterator, Optional
from urllib.parse import urlsplit
from urllib.request import getproxies

import requests

logger = logging.getLogger(__name__)

# 三档代理模式取值。
PROXY_MODE_AUTO = "auto"
PROXY_MODE_DIRECT = "direct"
PROXY_MODE_SYSTEM = "system"
_VALID_MODES = frozenset({PROXY_MODE_AUTO, PROXY_MODE_DIRECT, PROXY_MODE_SYSTEM})

# per-request「绕过代理」标记：http + https 两键都置 None，requests 在
# merge_environment_settings 里对已存在的键 setdefault 不覆盖、随后清掉 None 值 →
# merged proxies 变空 → 不选任何代理（直连），即便 trust_env=True 也压得住系统代理。
_NO_PROXY: dict[str, Any] = {"http": None, "https": None}

# 触发回退的「连接级失败」异常集合：requests 里 SSLError ⊂ ConnectionError、
# ConnectTimeout ⊂ (ConnectionError, Timeout)、ReadTimeout ⊂ Timeout，故这两类即可
# 覆盖 SSL EOF / 连接重置 / 连接&读取超时。**不含 HTTPError**——4xx/5xx 表示请求已
# 成功到达服务端，不为状态码回退（#685 约束：只在连接级失败时回退，不为空摘要重试）。
_CONNECTION_ERRORS = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
)


def resolve_proxy_mode() -> str:
    """读取 PAPER_SEARCH_HTTP_PROXY_MODE，非法值回落 auto。"""
    raw = (os.getenv("PAPER_SEARCH_HTTP_PROXY_MODE", PROXY_MODE_AUTO) or "").strip().lower()
    return raw if raw in _VALID_MODES else PROXY_MODE_AUTO


def _auto_direct_connect_timeout() -> float:
    """auto 模式直连探测的**连接**超时上限（秒）。

    被墙时直连 connect 阶段会一直挂，必须用短连接超时快速失败，给「回退代理」
    留出 enrich 每源 5s 预算内的时间（否则外层 wait_for 先到、回退根本来不及跑）。
    SSL EOF 是握手期异常、会立即抛出，不受此超时影响。
    """
    try:
        return float(os.getenv("PAPER_SEARCH_HTTP_DIRECT_CONNECT_TIMEOUT_SEC", "2.5"))
    except ValueError:
        return 2.5


def _auto_direct_read_timeout() -> float:
    """auto 模式直连尝试的**读取**超时上限（秒）。

    与连接超时同理：链路拥塞时直连「连上但服务端不及时回」（ReadTimeout）若沿用
    连接器默认 30s，会吃满 enrich 每源 5s 预算、让回退代理来不及跑。压短到此值，
    让直连读卡住时也快速失败、把剩余预算让给代理回退。正常响应（实测 <2s）接得住。
    """
    try:
        return float(os.getenv("PAPER_SEARCH_HTTP_DIRECT_READ_TIMEOUT_SEC", "2.5"))
    except ValueError:
        return 2.5


def detect_system_proxy() -> dict[str, str]:
    """返回系统 / env 配置的 http+https 代理映射；无则空 dict。

    ``getproxies()`` 在 macOS = env 代理 or 系统网络代理（getproxies_macosx_sysconf），
    故同时覆盖 ClashX 这类系统代理与 HTTP(S)_PROXY 环境变量。
    """
    try:
        proxies = getproxies()
    except Exception:  # getproxies_macosx_sysconf 偶发异常也优雅降级为「无代理」
        return {}
    return {k: v for k, v in proxies.items() if k in ("http", "https") and v}


def _direct_attempt_timeout(orig: Any) -> Any:
    """auto 模式下把直连尝试的**连接与读取超时都压到上限**（取与原值的较小者），
    确保直连失败足够快、给代理回退留出 5s 预算内的时间。"""
    connect_cap = _auto_direct_connect_timeout()
    read_cap = _auto_direct_read_timeout()
    if orig is None:
        return (connect_cap, read_cap)
    if isinstance(orig, (int, float)):
        o = float(orig)
        return (min(connect_cap, o), min(read_cap, o))
    try:
        connect, read = orig  # (connect, read) 元组
    except (TypeError, ValueError):
        return (connect_cap, read_cap)
    connect = min(connect_cap, float(connect)) if connect else connect_cap
    read = min(read_cap, float(read)) if read else read_cap
    return (connect, read)


def _host(url: str) -> str:
    try:
        return urlsplit(url).hostname or url
    except Exception:
        return url


# enrich 上下文：值为一个可变 dict —— 既作「当前在 enrich 内」的开关（None = 召回，
# 走父类原生逻辑），又承载本次请求的选路结果（route / mode / fallback_reason）供上层
# 记日志。dict 是同一对象引用，工作线程内的写入对 async 侧可见。
_enrich_ctx: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "paper_search_enrich_proxy_ctx", default=None
)


@contextlib.contextmanager
def enrich_proxy_context(mode: Optional[str] = None) -> Iterator[dict]:
    """进入 enrich HTTP 代理上下文。

    ``with`` 块内（含其经 ``asyncio.to_thread`` 派生的子线程）的
    ``ProxyFallbackSession`` 请求走三档自适应；退出后恢复召回原生逻辑。
    yield 出的 info dict 暴露 ``route`` / ``mode`` / ``fallback_reason`` 供调用方记日志。
    """
    info: dict[str, Any] = {"mode": mode or resolve_proxy_mode(), "route": None}
    token = _enrich_ctx.set(info)
    try:
        yield info
    finally:
        _enrich_ctx.reset(token)


class ProxyFallbackSession(requests.Session):
    """直连优先 + 失败回退代理的 ``requests.Session``（见模块头注释）。

    仅在 enrich 上下文（``enrich_proxy_context``）内生效；上下文外 = 召回路径，
    透传父类逻辑、行为与原生 ``requests.Session`` 完全一致。
    """

    def request(self, method: str, url: str, **kwargs: Any):  # type: ignore[override]
        info = _enrich_ctx.get()
        if info is None:
            # 召回路径：零变化，沿用 trust_env / 系统代理的原生行为。
            return super().request(method, url, **kwargs)
        return self._enrich_request(method, url, info, **kwargs)

    def _enrich_request(self, method: str, url: str, info: dict, **kwargs: Any):
        mode = info.get("mode") or resolve_proxy_mode()

        if mode == PROXY_MODE_SYSTEM:
            # 永远走系统代理：不覆盖 per-request proxies，交给 trust_env 解析。
            resp = self._send(method, url, proxies=None, **kwargs)
            info["route"] = "system"
            return resp

        # auto / direct：先直连（auto 额外把连接超时压短，给回退留预算）。
        direct_kwargs = dict(kwargs)
        if mode == PROXY_MODE_AUTO:
            direct_kwargs["timeout"] = _direct_attempt_timeout(kwargs.get("timeout"))
        try:
            resp = self._send(method, url, proxies=_NO_PROXY, **direct_kwargs)
            info["route"] = "direct"
            return resp
        except _CONNECTION_ERRORS as exc:
            if mode == PROXY_MODE_DIRECT:
                info["route"] = "direct-failed"
                logger.warning(
                    "enrich 直连失败（mode=direct，不回退）host=%s err=%s",
                    _host(url), exc.__class__.__name__,
                )
                raise
            # mode == auto：连接级失败 → 检测系统代理，有则同请求回退重试一次。
            proxy = detect_system_proxy()
            if not proxy:
                info["route"] = "direct-failed-no-proxy"
                logger.warning(
                    "enrich 直连失败且无系统代理可回退 host=%s err=%s",
                    _host(url), exc.__class__.__name__,
                )
                raise
            info["fallback_reason"] = exc.__class__.__name__
            logger.info(
                "enrich 直连失败，回退系统代理重试 host=%s err=%s",
                _host(url), exc.__class__.__name__,
            )
            try:
                resp = self._send(method, url, proxies=proxy, **kwargs)
            except _CONNECTION_ERRORS as exc2:
                info["route"] = "proxy-failed"
                logger.warning(
                    "enrich 直连+代理双失败 host=%s direct_err=%s proxy_err=%s",
                    _host(url), exc.__class__.__name__, exc2.__class__.__name__,
                )
                raise
            info["route"] = "proxy"
            return resp

    def _send(self, method: str, url: str, *, proxies: Optional[dict], **kwargs: Any):
        """单次真实请求 seam（测试可 monkeypatch 此方法模拟直连/代理，无需真网络）。

        proxies=None → 不覆盖 per-request 代理（system 模式交给 trust_env）；
        否则按显式 proxies 发送（_NO_PROXY 直连 / 系统代理 dict 回退）。
        """
        if proxies is None:
            return super().request(method, url, **kwargs)
        return super().request(method, url, proxies=proxies, **kwargs)
