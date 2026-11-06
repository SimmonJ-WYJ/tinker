"""retrieve() 的 journal 自动并入行为测试。

spec §2.6「登录态自动参与」：
  - journal 连接器已注册（=已登录、token 已注入）时，无论调用方传入哪些 sources，
    都自动并入 journal，确保登录态下每次检索都覆盖机构自有语料。
  - 未登录（连接器未注册）时不加入。
  - 已在 sources 中的 journal 不重复添加。

测试覆盖：
  1. journal 已注册 + 调用方显式传 sources（不含 journal） → 自动追加
  2. journal 已注册 + sources=None（默认路径） → 追加到默认 ["openalex","crossref","arxiv"]
  3. journal 未注册 + 显式 sources → 不追加
  4. journal 已注册 + sources 已含 journal → 不重复
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from paper_search.service.search_service import PaperSearchService


def _make_svc_with_journal_registered() -> PaperSearchService:
    """构造 journal 已注册的 PaperSearchService（模拟已登录态）。"""
    svc = PaperSearchService()
    # 用 MagicMock 替换 registry.get：journal 返回一个非 None 对象，其他返回 None（不影响断言）
    real_get = svc.registry.get

    def patched_get(name: str):
        if name == "journal":
            return MagicMock()  # 非 None → 视为已注册
        return real_get(name)

    svc.registry.get = patched_get  # type: ignore[method-assign]
    return svc


def _make_svc_journal_not_registered() -> PaperSearchService:
    """构造 journal 未注册的 PaperSearchService（模拟未登录态）。"""
    svc = PaperSearchService()
    real_get = svc.registry.get

    def patched_get(name: str):
        if name == "journal":
            return None  # 未注册
        return real_get(name)

    svc.registry.get = patched_get  # type: ignore[method-assign]
    return svc


# ---------------------------------------------------------------------------
# 测试 1：journal 已注册 + 调用方显式传 sources（不含 journal）→ 自动追加
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_journal_registered_explicit_sources_appended(monkeypatch: pytest.MonkeyPatch) -> None:
    """核心回归：lit-review planner 传了显式 sources 但未含 journal，登录态下应自动并入。"""
    svc = _make_svc_with_journal_registered()
    captured: dict[str, object] = {}

    async def fake_inner(**kwargs):
        captured["sources"] = kwargs["sources"]
        return {"ok": True}

    monkeypatch.setattr(svc, "_retrieve_inner", fake_inner)

    await svc.retrieve(
        "some research question",
        ["machine learning"],
        sources=["openalex", "crossref"],
    )

    assert "journal" in captured["sources"], (
        f"journal 已注册时应自动追加，但 captured sources={captured['sources']!r}"
    )
    # 顺序：journal 追加到末尾
    assert captured["sources"] == ["openalex", "crossref", "journal"]


# ---------------------------------------------------------------------------
# 测试 2：journal 已注册 + sources=None（默认路径）→ 追加到默认列表末尾
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_journal_registered_default_path_appended(monkeypatch: pytest.MonkeyPatch) -> None:
    """sources=None 走默认列表，默认为 ["openalex","crossref","arxiv"]，已注册时追加 journal。"""
    svc = _make_svc_with_journal_registered()
    captured: dict[str, object] = {}

    async def fake_inner(**kwargs):
        captured["sources"] = kwargs["sources"]
        return {"ok": True}

    monkeypatch.setattr(svc, "_retrieve_inner", fake_inner)

    await svc.retrieve("some question", ["machine learning"], sources=None)

    assert captured["sources"] == ["openalex", "crossref", "arxiv", "journal"], (
        f"默认路径 + journal 已注册 → 应为四元列表，实际={captured['sources']!r}"
    )


# ---------------------------------------------------------------------------
# 测试 3：journal 未注册 + 显式 sources → 不追加
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_journal_not_registered_not_appended(monkeypatch: pytest.MonkeyPatch) -> None:
    """未登录（journal 未注册）时，不应将 journal 追加到 sources。"""
    svc = _make_svc_journal_not_registered()
    captured: dict[str, object] = {}

    async def fake_inner(**kwargs):
        captured["sources"] = kwargs["sources"]
        return {"ok": True}

    monkeypatch.setattr(svc, "_retrieve_inner", fake_inner)

    await svc.retrieve(
        "some question",
        ["machine learning"],
        sources=["openalex", "crossref"],
    )

    assert "journal" not in captured["sources"], (
        f"journal 未注册时不应追加，但 captured sources={captured['sources']!r}"
    )
    assert captured["sources"] == ["openalex", "crossref"]


# ---------------------------------------------------------------------------
# 测试 4：journal 已注册 + sources 已含 journal → 不重复
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_journal_registered_already_in_sources_no_duplicate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """journal 已在 sources 里时不重复添加（去重保证）。"""
    svc = _make_svc_with_journal_registered()
    captured: dict[str, object] = {}

    async def fake_inner(**kwargs):
        captured["sources"] = kwargs["sources"]
        return {"ok": True}

    monkeypatch.setattr(svc, "_retrieve_inner", fake_inner)

    await svc.retrieve(
        "some question",
        ["machine learning"],
        sources=["openalex", "journal"],
    )

    assert captured["sources"].count("journal") == 1, (  # type: ignore[union-attr]
        f"journal 不应重复，实际={captured['sources']!r}"
    )
    assert captured["sources"] == ["openalex", "journal"]
