"""Tests for ConnectorRegistry — env-driven disabled-source blacklist.

覆盖 registry.py 的 _resolve_disabled / _DEFAULT_DEAD / _STATIC_DISABLED 解析逻辑：
- 默认：4 个网络死源（zenodo / base / citeseerx / google_scholar）被禁
- PAPER_SEARCH_MCP_DISABLED_SOURCES="" → 死源被允许（仅 _STATIC_DISABLED 保留）
- 自定义 env list → 完全替换默认死源
- _STATIC_DISABLED（chemrxiv / ssrn）永不可被 env 解禁
"""
from __future__ import annotations

import pytest

from .registry import ConnectorRegistry

# 4 个网络死源默认应被禁用
_DEFAULT_DEAD = {"zenodo", "base", "citeseerx", "google_scholar"}
# 2 个 connector 级死源，env 永远救不回来
_STATIC_DEAD = {"chemrxiv", "ssrn"}


def _names(monkeypatch: pytest.MonkeyPatch, env_value: str | None) -> set[str]:
    """以指定 env 值构造一个新 registry，返回 all_names()。"""
    if env_value is None:
        monkeypatch.delenv("PAPER_SEARCH_MCP_DISABLED_SOURCES", raising=False)
        monkeypatch.delenv("DISABLED_SOURCES", raising=False)
    else:
        monkeypatch.setenv("PAPER_SEARCH_MCP_DISABLED_SOURCES", env_value)
    return set(ConnectorRegistry().all_names())


def test_default_dead_sources_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """无 env 时，4 个网络死源不应被注册。"""
    names = _names(monkeypatch, None)
    for dead in _DEFAULT_DEAD:
        assert dead not in names, f"{dead} 应被默认禁用，但出现在 {names}"


def test_static_disabled_still_disabled_when_env_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """env 设空字符串 → 网络死源恢复，但 _STATIC_DISABLED 仍禁。"""
    names = _names(monkeypatch, "")
    # 网络死源应恢复
    for src in _DEFAULT_DEAD:
        # 注意：connector 实例化失败也算未注册，所以只能断言"环境给了机会"
        # 不一定 4 个全成功 — 但至少其中之一应该出现（不是全部被禁）
        pass
    # 关键断言：static 死源永不出现
    for static_dead in _STATIC_DEAD:
        assert static_dead not in names, f"{static_dead} 是 _STATIC_DISABLED 应永远禁用"
    # 同时确认 env=空确实让网络死源进入注册流程
    # （只要 zenodo 或 base 任一能实例化即证明 env 生效；连接器自身可能因网络/SSL 报错跳过）
    # 兜底断言：至少 1 个网络死源进了注册
    enabled_dead = _DEFAULT_DEAD & names
    assert len(enabled_dead) >= 1, (
        f"env=空应让至少 1 个网络死源进注册，实际网络死源都不在 names: "
        f"_DEFAULT_DEAD={_DEFAULT_DEAD}, names={names}"
    )


def test_env_custom_disabled_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """env="arxiv,openalex" → 仅这两个被额外禁用，默认死源恢复。"""
    names = _names(monkeypatch, "arxiv,openalex")
    assert "arxiv" not in names
    assert "openalex" not in names
    # static 死源仍禁
    for static_dead in _STATIC_DEAD:
        assert static_dead not in names
    # 默认死源不再被禁（env 完全替换 _DEFAULT_DEAD）
    enabled_dead = _DEFAULT_DEAD & names
    assert len(enabled_dead) >= 1, (
        f"自定义 env 应替换默认死源，实际默认死源都不在 names: {names}"
    )


def test_env_with_whitespace_and_case(monkeypatch: pytest.MonkeyPatch) -> None:
    """env 含空格/大小写 → 解析时 strip + lower 归一化。"""
    names = _names(monkeypatch, "  Arxiv ,  ZENODO ,base")
    assert "arxiv" not in names
    assert "zenodo" not in names
    assert "base" not in names


def test_healthy_sources_always_available(monkeypatch: pytest.MonkeyPatch) -> None:
    """sanity check：openalex / crossref 等健康源在默认 env 下应注册。"""
    names = _names(monkeypatch, None)
    # 4 次实测里 100% ok-rate 的源
    healthy_must_register = {"openalex", "crossref", "pmc", "hal", "medrxiv", "openaire"}
    missing = healthy_must_register - names
    assert not missing, f"健康源应始终注册，缺失：{missing}"
