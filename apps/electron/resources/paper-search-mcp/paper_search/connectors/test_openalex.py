"""Tests for OpenAlex connector — defensive None handling + title-first strategy.

覆盖：
- openalex.py 的 doi=null / id=null / primary_location 内层 null 防御（之前 .get(k,"")
  在 OpenAlex 返回 {"doi": null} 时会把 None 喂给 Paper(doi=str) 触发 Pydantic 早退）
- 两阶段 search()：先 filter=title.search 后 fallback search=
- env PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST=1 时跳过 stage 1

测试用 monkeypatch 拦截 session.get，避免真实网络请求。
"""
from __future__ import annotations

from typing import Any, List
from unittest.mock import Mock

import pytest
import requests

from .openalex import OpenAlexConnector


def _make_response(status: int, payload: dict | None = None) -> Mock:
    """构造一个最小化的 requests.Response 替身。"""
    resp = Mock(spec=requests.Response)
    resp.status_code = status
    resp.json = Mock(return_value=payload or {"results": []})
    return resp


def _item(
    *,
    id_url: str | None = "https://openalex.org/W1",
    title: str | None = "Sample Paper",
    doi: str | None = "https://doi.org/10.0/x",
    primary_location: dict | None = None,
    open_access: dict | None = None,
) -> dict:
    """工厂：一条最小可解析的 OpenAlex 记录。"""
    return {
        "id": id_url,
        "title": title,
        "authorships": [],
        "abstract_inverted_index": None,
        "doi": doi,
        "primary_location": primary_location,
        "open_access": open_access,
        "publication_date": None,
        "concepts": [],
        "cited_by_count": 0,
    }


# ---------------------------------------------------------------------------
# 关键回归：null 字段不再静默吞掉整个 batch
# ---------------------------------------------------------------------------


def test_doi_null_does_not_break_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    """OpenAlex 返回 {"doi": null} 时，整批解析不应早退。"""
    payload = {
        "results": [
            _item(id_url="https://openalex.org/W1", doi="https://doi.org/10.0/a"),
            _item(id_url="https://openalex.org/W2", doi=None),  # 关键：null DOI
            _item(id_url="https://openalex.org/W3", doi="https://doi.org/10.0/c"),
            _item(id_url="https://openalex.org/W4", doi=None),
            _item(id_url="https://openalex.org/W5", doi="https://doi.org/10.0/e"),
        ]
    }
    conn = OpenAlexConnector()
    mock_get = Mock(return_value=_make_response(200, payload))
    monkeypatch.setattr(conn.session, "get", mock_get)
    # 关掉 title-first 走单次 broad，便于精确断言 GET 次数
    monkeypatch.setenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", "1")

    papers = conn.search("anything", max_results=10)

    assert len(papers) == 5, "all 5 records must parse; null DOI must not abort the loop"
    assert all(p.doi != None for p in papers)  # noqa: E711
    assert papers[1].doi == ""  # null coerced to empty string
    assert papers[3].doi == ""


def test_id_null_does_not_break(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {"results": [_item(id_url=None, doi=None)]}
    conn = OpenAlexConnector()
    monkeypatch.setattr(conn.session, "get", Mock(return_value=_make_response(200, payload)))
    monkeypatch.setenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", "1")

    papers = conn.search("anything", max_results=5)

    assert len(papers) == 1
    assert papers[0].paper_id == ""


def test_primary_location_null_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    """primary_location 内部字段为 null 时不应抛 AttributeError。"""
    payload = {
        "results": [
            _item(
                primary_location={"landing_page_url": None, "pdf_url": None},
                open_access={"is_oa": True, "oa_url": None},
            )
        ]
    }
    conn = OpenAlexConnector()
    monkeypatch.setattr(conn.session, "get", Mock(return_value=_make_response(200, payload)))
    monkeypatch.setenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", "1")

    papers = conn.search("anything", max_results=5)

    assert len(papers) == 1
    assert papers[0].pdf_url == ""
    assert papers[0].url == "https://openalex.org/W1"  # fallback to id


# ---------------------------------------------------------------------------
# Title-first 两阶段策略
# ---------------------------------------------------------------------------


def test_title_first_then_broad_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """stage 1 (title.search) 返回 3 条 < max=5，stage 2 (search=) 补 2 条。"""
    stage1 = {"results": [
        _item(id_url=f"https://openalex.org/W{i}", doi=None) for i in range(1, 4)
    ]}
    stage2 = {"results": [
        # W3 与 stage1 重复，应被去重
        _item(id_url=f"https://openalex.org/W{i}", doi=None) for i in range(3, 8)
    ]}
    conn = OpenAlexConnector()
    mock_get = Mock(side_effect=[
        _make_response(200, stage1),
        _make_response(200, stage2),
    ])
    monkeypatch.setattr(conn.session, "get", mock_get)
    monkeypatch.delenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", raising=False)

    papers = conn.search("ML", max_results=5)

    assert mock_get.call_count == 2, "must call stage1 + stage2"
    # 第一次参数应含 filter=title.search:
    first_params = mock_get.call_args_list[0].kwargs.get("params", {})
    assert "filter" in first_params and "title.search" in first_params["filter"]
    # 第二次参数应用 search=
    second_params = mock_get.call_args_list[1].kwargs.get("params", {})
    assert second_params.get("search") == "ML"
    # 去重后总数 == max_results=5
    assert len(papers) == 5
    ids = [p.paper_id for p in papers]
    assert ids == ["W1", "W2", "W3", "W4", "W5"], "stage1 keeps order, stage2 dedups W3 then appends W4,W5"


def test_title_first_sufficient_skips_broad(monkeypatch: pytest.MonkeyPatch) -> None:
    """stage 1 已凑齐 max_results，不应再调 stage 2。"""
    stage1 = {"results": [
        _item(id_url=f"https://openalex.org/W{i}", doi=None) for i in range(1, 11)
    ]}
    conn = OpenAlexConnector()
    mock_get = Mock(return_value=_make_response(200, stage1))
    monkeypatch.setattr(conn.session, "get", mock_get)
    monkeypatch.delenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", raising=False)

    papers = conn.search("ML", max_results=5)

    assert mock_get.call_count == 1, "stage 2 must NOT be called when stage 1 fills the quota"
    assert len(papers) == 5


def test_non_200_raises_not_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    """非 200（429 等）必须抛 HTTPError 向上传，而非吞成空列表。

    否则上层 _timed_search 会把「被限速失败」误判成「204 真空」，
    自动重试 / 失败上报都失灵（P0）。
    """
    conn = OpenAlexConnector()
    resp = _make_response(429)
    resp.raise_for_status = Mock(
        side_effect=requests.exceptions.HTTPError("429 Too Many Requests")
    )
    monkeypatch.setattr(conn.session, "get", Mock(return_value=resp))
    monkeypatch.setenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", "1")

    with pytest.raises(requests.exceptions.HTTPError):
        conn.search("anything", max_results=5)


def test_title_first_disabled_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """env 旁路：DISABLE_TITLE_FIRST=1 时只调一次 (broad search)。"""
    payload = {"results": [_item(id_url="https://openalex.org/W1")]}
    conn = OpenAlexConnector()
    mock_get = Mock(return_value=_make_response(200, payload))
    monkeypatch.setattr(conn.session, "get", mock_get)
    monkeypatch.setenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST", "1")

    papers = conn.search("ML", max_results=5)

    assert mock_get.call_count == 1
    only_params = mock_get.call_args.kwargs.get("params", {})
    assert only_params.get("search") == "ML"
    assert "filter" not in only_params
    assert len(papers) == 1


# ---------------------------------------------------------------------------
# 精确核心词全量召回 mode="title_exhaust"
# (spec: lit-search-precise-core-exhaustion)
# ---------------------------------------------------------------------------


def _page(ids: list[int], *, count: int, next_cursor: str | None) -> dict:
    return {
        "results": [_item(id_url=f"https://openalex.org/W{i}", doi=None) for i in ids],
        "meta": {"count": count, "next_cursor": next_cursor},
    }


def test_title_exhaust_paginates_full_core_term(monkeypatch: pytest.MonkeyPatch) -> None:
    """count ≤ threshold:cursor 翻页拉全量。两页共 5 条,count=5。"""
    conn = OpenAlexConnector()
    mock_get = Mock(side_effect=[
        _make_response(200, _page([1, 2, 3], count=5, next_cursor="CUR2")),
        _make_response(200, _page([4, 5], count=5, next_cursor=None)),
    ])
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search(
        "light field microscopy", max_results=1000,
        mode="title_exhaust", core_threshold=1000,
    )

    assert [p.paper_id for p in papers] == ["W1", "W2", "W3", "W4", "W5"]
    # 第一页用 filter=title.search + cursor='*'
    first = mock_get.call_args_list[0].kwargs.get("params", {})
    assert "title.search" in first["filter"]
    assert first["cursor"] == "*"
    assert first["per_page"] == 200
    # 第二页用 next_cursor
    assert mock_get.call_args_list[1].kwargs["params"]["cursor"] == "CUR2"
    # 单页 timeout 须明显小于 cell 级 25s 预算(review #553 P3:挂页 fail-fast,
    # 不烧光整个 cell 预算)
    assert mock_get.call_args_list[0].kwargs["timeout"] < 25


def test_title_exhaust_generic_term_falls_back_to_first_page_head(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """count > threshold:泛词不翻页,返回第 1 页前 generic_fallback 篇兜底——
    exhaust cell 顶替了同 query 的裸 cell,泛词返回 [] 会把该 query 的 OpenAlex
    召回直接归零(review #553 P1)。"""
    conn = OpenAlexConnector()
    mock_get = Mock(return_value=_make_response(
        200, _page([1, 2, 3, 4, 5], count=29370, next_cursor="CUR2")
    ))
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search(
        "microscopy imaging", max_results=1000,
        mode="title_exhaust", core_threshold=1000, generic_fallback=3,
    )

    assert [p.paper_id for p in papers] == ["W1", "W2", "W3"]  # 截到 fallback 上限
    assert mock_get.call_count == 1, "泛词不应翻页"


def test_title_exhaust_generic_fallback_defaults_to_ten(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未显式传 generic_fallback 时默认 10(与裸 cell 的 title-first @10 对齐)。"""
    conn = OpenAlexConnector()
    mock_get = Mock(return_value=_make_response(
        200, _page(list(range(1, 13)), count=29370, next_cursor="CUR2")
    ))
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search(
        "microscopy imaging", max_results=1000,
        mode="title_exhaust", core_threshold=1000,
    )

    assert len(papers) == 10
    assert mock_get.call_count == 1


def test_title_exhaust_stops_at_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """max_results(HARD_CAP)封顶:count=5 但 limit=2,只取 2 条即停。"""
    conn = OpenAlexConnector()
    mock_get = Mock(return_value=_make_response(
        200, _page([1, 2, 3, 4, 5], count=5, next_cursor="CUR2")
    ))
    monkeypatch.setattr(conn.session, "get", mock_get)

    papers = conn.search(
        "extended depth of field", max_results=2,
        mode="title_exhaust", core_threshold=1000,
    )

    assert [p.paper_id for p in papers] == ["W1", "W2"]


# ---------------------------------------------------------------------------
# figshare collection 等打不开的数据仓库聚合页 → url 回退
# ---------------------------------------------------------------------------


def _full_item(*, url: str, best_oa_url: str | None, oa_id: str) -> dict:
    """构造含 primary_location/best_oa_location 的完整 item（_parse_item 直测用）。"""
    return {
        "id": oa_id,
        "title": "Single-Shot EDOF Fourier Light Field Microscopy",
        "authorships": [], "abstract_inverted_index": None,
        "doi": "https://doi.org/10.6084/m9.figshare.c.8303284",
        "primary_location": {"landing_page_url": url, "source": {"display_name": "Figshare"}},
        "best_oa_location": ({"landing_page_url": best_oa_url} if best_oa_url else None),
        "open_access": None, "publication_date": None, "concepts": [], "cited_by_count": 0,
    }


def test_figshare_collection_url_falls_back_to_openalex_page() -> None:
    """primary 是 figshare collection（打不开）且无可用 best_oa → 回退 OpenAlex 详情页。"""
    conn = OpenAlexConnector()
    item = _full_item(
        url="https://doi.org/10.6084/m9.figshare.c.8303284",
        best_oa_url="https://doi.org/10.6084/m9.figshare.c.8303284",  # best_oa 同样是 figshare collection
        oa_id="https://openalex.org/W7133201566",
    )
    p = conn._parse_item(item)
    assert p.url == "https://openalex.org/W7133201566", "应回退 OpenAlex 详情页，而非打不开的 collection"


def test_figshare_collection_url_prefers_journal_best_oa() -> None:
    """primary 是 figshare collection，但 best_oa 是正式来源 → 用 best_oa。"""
    conn = OpenAlexConnector()
    item = _full_item(
        url="https://doi.org/10.6084/m9.figshare.c.8303284",
        best_oa_url="https://opg.optica.org/ol/abstract.cfm?uri=ol-50-1-1",
        oa_id="https://openalex.org/W7133201566",
    )
    p = conn._parse_item(item)
    assert p.url == "https://opg.optica.org/ol/abstract.cfm?uri=ol-50-1-1"


def test_normal_landing_url_unchanged() -> None:
    """正常 landing url（非数据仓库聚合页）保持不变。"""
    conn = OpenAlexConnector()
    item = _full_item(
        url="https://opg.optica.org/ol/abstract.cfm?uri=ol-50-1-1",
        best_oa_url=None,
        oa_id="https://openalex.org/W1",
    )
    p = conn._parse_item(item)
    assert p.url == "https://opg.optica.org/ol/abstract.cfm?uri=ol-50-1-1"


def test_source_name_is_class_attr_overridable() -> None:
    """OpenAlexConnector.SOURCE_NAME 默认 openalex，且 _parse_item 用它而非硬编码字面量。"""
    conn = OpenAlexConnector()
    assert conn.SOURCE_NAME == "openalex"
    paper = conn._parse_item(_item(id_url="https://openalex.org/W1", title="T", doi=None))
    assert paper is not None
    assert paper.source == "openalex"
