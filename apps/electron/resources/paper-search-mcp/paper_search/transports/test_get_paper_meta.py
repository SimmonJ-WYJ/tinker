"""Tests for `get_paper_meta` identifier source detection (spec §5.6)."""

import pytest

from . import mcp_server
from .mcp_server import _detect_identifier_source, get_paper_meta


class TestDetectIdentifierSource:
    """`auto` 模式启发式：识别 DOI / arXiv / PMID 三种形态。"""

    # DOI: 永远含 "/" 且 registrant prefix 总是 "10."
    def test_doi_with_slash(self) -> None:
        assert _detect_identifier_source("10.1038/nature14539") == "doi"

    def test_doi_with_prefix_only(self) -> None:
        # 罕见但合法：纯 registrant 部分
        assert _detect_identifier_source("10.18653") == "doi"

    def test_doi_emnlp(self) -> None:
        assert _detect_identifier_source("10.18653/v1/2024.emnlp-main.341") == "doi"

    # arXiv: "1706.03762" / "2306.15595" / "2306.15595v1"
    def test_arxiv_classic(self) -> None:
        assert _detect_identifier_source("1706.03762") == "arxiv"

    def test_arxiv_with_version(self) -> None:
        assert _detect_identifier_source("2306.15595v1") == "arxiv"

    def test_arxiv_recent(self) -> None:
        assert _detect_identifier_source("2502.20082") == "arxiv"

    # PMID: 纯数字（永远是整数 id）
    def test_pmid_short(self) -> None:
        assert _detect_identifier_source("19872477") == "pmid"

    def test_pmid_long(self) -> None:
        assert _detect_identifier_source("123456789") == "pmid"

    # 边界
    def test_empty_falls_back_to_doi(self) -> None:
        # 空字符串虽然由 caller 拦截，启发式自身不应崩
        assert _detect_identifier_source("") == "doi"

    def test_whitespace_only(self) -> None:
        assert _detect_identifier_source("   ") == "doi"

    def test_unknown_format_falls_back_to_doi(self) -> None:
        # 未识别形态默认当 DOI 试（让 semantic API miss 时返回 None，不抛错）
        assert _detect_identifier_source("abc-xyz") == "doi"

    # 优先级：DOI 形态 > arXiv 形态（含 "/" 时强制 DOI）
    def test_doi_priority_over_arxiv_pattern(self) -> None:
        # 老式 arXiv "math.AG/0309136" 含 "/" — 我们当 DOI 走 semantic，
        # semantic API miss 时返回 None 是可接受的（避免误归类损坏现代 DOI 路径）。
        assert _detect_identifier_source("math.AG/0309136") == "doi"


class _FakePaper:
    """to_api_dict() 桩：返回构造时给的 dict。"""

    def __init__(self, data: dict) -> None:
        self._data = data

    def to_api_dict(self) -> dict:
        return self._data


class _FakeSemantic:
    """可配置的 semantic 连接器桩：命中 / 真·未命中(None) / provider 故障(抛异常)。"""

    def __init__(self, *, result=None, exc: Exception | None = None) -> None:
        self._result = result
        self._exc = exc

    def get_paper_details(self, identifier: str):
        if self._exc is not None:
            raise self._exc
        return self._result


class _FakeRegistry:
    def __init__(self, semantic) -> None:
        self._semantic = semantic

    def get(self, name: str):
        return self._semantic if name == "semantic" else None


@pytest.fixture
def patch_service(monkeypatch):
    """注入桩 semantic 连接器 + enrich_paper 行为到模块级 search_service。"""

    def _apply(*, semantic, enrich_result=None, enrich_exc: Exception | None = None) -> None:
        monkeypatch.setattr(mcp_server.search_service, "registry", _FakeRegistry(semantic))

        async def _fake_enrich(doi: str = "", title: str = ""):
            if enrich_exc is not None:
                raise enrich_exc
            return enrich_result

        monkeypatch.setattr(mcp_server.search_service, "enrich_paper", _fake_enrich)

    return _apply


class TestGetPaperMetaErrorVsEmpty:
    """#589：provider 故障必须抛错（MCP → isError:true），仅"确实查不到"才返回 `{}`。"""

    @pytest.mark.asyncio
    async def test_hit_returns_dict(self, patch_service) -> None:
        patch_service(semantic=_FakeSemantic(result=_FakePaper({"paper_id": "x"})))
        assert await get_paper_meta("2005.11401", "arxiv") == {"paper_id": "x"}

    @pytest.mark.asyncio
    async def test_arxiv_genuine_miss_returns_empty(self, patch_service) -> None:
        # semantic 返回 None = 真·未命中（无异常）→ 空字典，不抛错
        patch_service(semantic=_FakeSemantic(result=None))
        assert await get_paper_meta("9999.99999", "arxiv") == {}

    @pytest.mark.asyncio
    async def test_arxiv_provider_error_raises(self, patch_service) -> None:
        # arxiv 源无降级；semantic 抛 Connection refused → 必须抛错，不能吞成 {}
        patch_service(semantic=_FakeSemantic(exc=ConnectionError("Connection refused")))
        with pytest.raises(RuntimeError):
            await get_paper_meta("2005.11401", "arxiv")

    @pytest.mark.asyncio
    async def test_doi_genuine_miss_returns_empty(self, patch_service) -> None:
        # semantic miss + enrich 也 miss，且全程无异常 → 真查不到 → {}
        patch_service(semantic=_FakeSemantic(result=None), enrich_result=None)
        assert await get_paper_meta("10.1038/nonexistent", "doi") == {}

    @pytest.mark.asyncio
    async def test_doi_provider_error_raises(self, patch_service) -> None:
        # DOI 路径：semantic 抛错、enrich 也拿不到 → provider 故障 → 抛错
        patch_service(
            semantic=_FakeSemantic(exc=ConnectionError("Connection refused")),
            enrich_result=None,
        )
        with pytest.raises(RuntimeError):
            await get_paper_meta("10.1038/nature14539", "doi")
