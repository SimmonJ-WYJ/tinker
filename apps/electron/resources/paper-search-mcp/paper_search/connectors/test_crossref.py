"""Tests for CrossRef connector — 非论文类型降噪。

背景：CrossRef 索引远不止研究论文（reference-entry 人物/词典条目、peer-review
评审报告、grant 资助记录、component 图表组件等），仅靠标题词命中会污染候选集
并虚高 display_count。

解法：在 _parse_crossref_item 处按 crossref `type` 黑名单剔除"明确非论文"
的条目，只剔不可能是研究论文的类型，不碰任何真实论文类型（journal-article /
proceedings-article / posted-content 预印本 / book-chapter / dissertation 等
全部保留），因此不降召回。黑名单可经 env 覆盖作逃生通道。

注意（实测）：Brill 名人录条目 "Short, Dr Emile Francis…" 被 CrossRef 错标成
`dataset` 而非 reference-entry，故本黑名单不覆盖它——这类残留交由下游评分沉底，
详见 crossref.py `_load_type_denylist` 注释。
"""
from __future__ import annotations

from typing import Any

from .crossref import CrossRefConnector


def _item(*, doi: str = "10.0/x", title: str = "A Real Research Paper on LLMs",
          type_: str = "journal-article") -> dict[str, Any]:
    """工厂：一条最小可解析的 CrossRef 记录。"""
    return {
        "DOI": doi,
        "title": [title],
        "type": type_,
        "author": [{"given": "Jane", "family": "Doe"}],
        "issued": {"date-parts": [[2024, 1, 1]]},
    }


def test_reference_entry_is_dropped() -> None:
    """reference-entry（百科 / 词典条目）不是论文 → 解析为 None。

    注：真实 Brill 名人录条目实测被 CrossRef 标成 dataset 而非 reference-entry
    （见模块 docstring），故此处用一个被正确标注为 reference-entry 的合成样本，
    仅验证"被标成 reference-entry 即剔除"这一行为。"""
    conn = CrossRefConnector()
    item = _item(
        doi="10.1093/acref/9780199234899.013.0042",
        title="Transformer (encyclopedia entry)",
        type_="reference-entry",
    )
    assert conn._parse_crossref_item(item) is None


def test_peer_review_grant_component_dropped() -> None:
    """peer-review / grant / component 均非论文 → 解析为 None。"""
    conn = CrossRefConnector()
    for t in ("peer-review", "grant", "component"):
        assert conn._parse_crossref_item(_item(type_=t)) is None, f"{t} 应被剔除"


def test_journal_article_is_kept() -> None:
    """journal-article 是真实论文类型 → 正常解析，不受降噪影响。"""
    conn = CrossRefConnector()
    paper = conn._parse_crossref_item(_item(type_="journal-article"))
    assert paper is not None
    assert paper.title == "A Real Research Paper on LLMs"


def test_preprint_and_proceedings_and_dissertation_kept() -> None:
    """预印本 / 会议论文 / 学位论文都是合法学术产出 → 保留（不降召回）。"""
    conn = CrossRefConnector()
    for t in ("posted-content", "proceedings-article", "dissertation", "book-chapter"):
        assert conn._parse_crossref_item(_item(type_=t)) is not None, f"{t} 不应被剔除"


def test_denylist_env_override(monkeypatch) -> None:
    """env 覆盖黑名单作逃生通道：清空后即使 reference-entry 也保留。"""
    monkeypatch.setenv("PAPER_SEARCH_CROSSREF_TYPE_DENYLIST", "")
    import importlib
    from . import crossref as crossref_mod
    importlib.reload(crossref_mod)
    conn = crossref_mod.CrossRefConnector()
    assert conn._parse_crossref_item(_item(type_="reference-entry")) is not None
    # 还原模块状态，避免污染其它测试
    importlib.reload(crossref_mod)
