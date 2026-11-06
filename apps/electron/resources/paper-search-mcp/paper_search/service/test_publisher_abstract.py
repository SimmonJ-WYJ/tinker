"""#685 出版社页面摘要解析单测 —— 纯解析，不打网络。

覆盖：高置信 meta（citation_abstract / dc.description）、JSON-LD description、
低置信内容（短 og:description / Access options / 导航）被拒、优先级顺序。
"""
from __future__ import annotations

from .publisher_abstract import MIN_ABSTRACT_LEN, extract_abstract_from_html

# 一段足够长（≥ MIN_ABSTRACT_LEN）的真实摘要式文本。
_LONG_ABS = (
    "Previous whole-transcriptome analysis by RNA-Seq required large amounts of "
    "material. Here we describe a single-cell digital gene expression profiling "
    "assay that detects many more genes per cell than previous methods, enabling "
    "transcriptome analysis at single-cell resolution with high sensitivity."
)


def test_extracts_citation_abstract_highest_priority() -> None:
    html = (
        f'<html><head><meta name="citation_abstract" content="{_LONG_ABS}">'
        f'<meta property="og:description" content="short tagline"></head></html>'
    )
    assert extract_abstract_from_html(html) == _LONG_ABS


def test_extracts_dc_description() -> None:
    html = f'<html><head><meta name="dc.description" content="{_LONG_ABS}"></head></html>'
    assert extract_abstract_from_html(html) == _LONG_ABS


def test_extracts_jsonld_article_description() -> None:
    import json
    ld = json.dumps({"@type": "ScholarlyArticle", "description": _LONG_ABS})
    html = f'<html><head><script type="application/ld+json">{ld}</script></head></html>'
    assert extract_abstract_from_html(html) == _LONG_ABS


def test_prefers_dc_over_og_description() -> None:
    long_og = _LONG_ABS + " Extra OG content to exceed the threshold as well."
    html = (
        f'<html><head><meta name="dc.description" content="{_LONG_ABS}">'
        f'<meta property="og:description" content="{long_og}"></head></html>'
    )
    # dc.description 优先级高于 og:description，即使两者都够长。
    assert extract_abstract_from_html(html) == _LONG_ABS


def test_rejects_short_og_description() -> None:
    """低置信 og:description 太短（截断版/标语）→ 不接受，返回空。"""
    html = '<html><head><meta property="og:description" content="A brief tagline."></head></html>'
    assert extract_abstract_from_html(html) == ""


def test_rejects_access_options_and_nav_noise() -> None:
    """页面只有 access options / 导航 / 参考文献等正文区块，无高置信 meta → 返回空（不误抓）。"""
    html = (
        "<html><body>"
        "<nav>Home About Subscribe</nav>"
        "<div class='access-options'>Access options. Buy this article. "
        "Subscribe to journal. Rent or buy.</div>"
        "<ul><li>Reference 1</li><li>Reference 2</li></ul>"
        "</body></html>"
    )
    assert extract_abstract_from_html(html) == ""


def test_empty_html_returns_empty() -> None:
    assert extract_abstract_from_html("") == ""


def test_long_og_description_accepted_as_last_resort() -> None:
    """无任何高置信源、但 og:description 足够长（含真实摘要）→ 作为最后兜底接受。"""
    assert len(_LONG_ABS) >= MIN_ABSTRACT_LEN
    html = f'<html><head><meta property="og:description" content="{_LONG_ABS}"></head></html>'
    assert extract_abstract_from_html(html) == _LONG_ABS
