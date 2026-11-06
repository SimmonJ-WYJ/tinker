"""Tests for 失败触发扩源的备用源选择（_pick_backup_sources）。

契约（spec: lit-search-failure-source-expansion §4.2）：
- 优先级：领域专用源 → semantic（仅当配 key）→ 通用 doaj/openaire；
- 排除：已请求源、registry 不可用 / 死源（registry.get → None）；
- 去重、按优先级取前 cap 个。
"""
from __future__ import annotations

import pytest

from . import search_service as ss


class _FakeRegistry:
    """registry 替身：available 内的源 get→object，其余 get→None（=死源/未注册）。"""

    def __init__(self, available: set[str]) -> None:
        self._a = set(available)

    def get(self, name: str):
        return object() if name in self._a else None

    def all_names(self) -> list[str]:
        return list(self._a)


def _svc(available: set[str]) -> ss.PaperSearchService:
    return ss.PaperSearchService(registry=_FakeRegistry(available))  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def _no_semantic_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认无 semantic key，单独的测试再显式 setenv。"""
    monkeypatch.delenv("PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY", raising=False)


def test_general_default_no_domains_no_key() -> None:
    svc = _svc({"doaj", "openaire", "semantic", "europepmc"})
    picked = svc._pick_backup_sources(["openalex", "crossref", "arxiv"], None)
    assert picked == ["doaj", "openaire"]  # 无领域、无 key → 仅通用源


def test_excludes_requested_sources() -> None:
    svc = _svc({"doaj", "openaire"})
    picked = svc._pick_backup_sources(["openalex", "doaj"], None)
    assert picked == ["openaire"]  # doaj 已请求 → 排除


def test_domain_bio_prioritized_and_capped() -> None:
    svc = _svc({"europepmc", "pmc", "pubmed", "doaj", "openaire"})
    picked = svc._pick_backup_sources(["openalex"], ["Bioinformatics", "NLP"])
    # 生物领域 3 个填满 cap=3 → 通用源被挤出
    assert picked == ["europepmc", "pmc", "pubmed"]


def test_domain_crypto() -> None:
    svc = _svc({"iacr", "doaj", "openaire"})
    picked = svc._pick_backup_sources(["openalex"], ["Security"])
    assert picked == ["iacr", "doaj", "openaire"]


def test_semantic_only_when_key_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    svc = _svc({"semantic", "doaj", "openaire"})
    monkeypatch.setenv("PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY", "sk-test")
    assert svc._pick_backup_sources(["openalex"], None) == ["semantic", "doaj", "openaire"]
    monkeypatch.delenv("PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY", raising=False)
    assert "semantic" not in svc._pick_backup_sources(["openalex"], None)


def test_dead_source_skipped() -> None:
    # 只有 openaire alive；doaj 不在 registry（死源/未注册）→ 跳过
    svc = _svc({"openaire"})
    assert svc._pick_backup_sources(["openalex"], None) == ["openaire"]


def test_cap_respected() -> None:
    svc = _svc({"europepmc", "pmc", "pubmed", "doaj", "openaire"})
    picked = svc._pick_backup_sources(["openalex"], ["medicine"], cap=2)
    assert picked == ["europepmc", "pmc"]


def test_no_candidates_available_returns_empty() -> None:
    # 备用源一个都没注册（极端 / 全网死）→ 空列表，调用方不扩源
    svc = _svc(set())
    assert svc._pick_backup_sources(["openalex"], ["NLP"]) == []


# --- 默认关闭开关（opt-in）---------------------------------------------------


def test_failure_expansion_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """默认 off：未设 env / 设非 "1" → 关闭。"""
    monkeypatch.delenv("PAPER_SEARCH_FAILURE_EXPANSION", raising=False)
    assert ss._failure_expansion_enabled() is False
    monkeypatch.setenv("PAPER_SEARCH_FAILURE_EXPANSION", "0")
    assert ss._failure_expansion_enabled() is False
    monkeypatch.setenv("PAPER_SEARCH_FAILURE_EXPANSION", "true")  # 非 "1" 一律视为关
    assert ss._failure_expansion_enabled() is False


def test_failure_expansion_enabled_only_when_flag_is_1(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PAPER_SEARCH_FAILURE_EXPANSION", "1")
    assert ss._failure_expansion_enabled() is True
