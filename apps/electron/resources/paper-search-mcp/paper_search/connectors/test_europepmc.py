"""Tests for Europe PMC connector — lite 字段缺失一揽子修复（#560 作者 / #570 摘要）。

背景：Europe PMC 旧默认 resultType=lite，lite 既不返回结构化 authorList、也不返回
abstractText → 该源作者与摘要双双 100% 缺失。

两处修复：
- 作者（#560）：_parse_item 在 authorList 缺失/为空时回落解析扁平字符串 authorString
  （按逗号切分、去首尾空白与尾点、过滤空串）；authorList 存在时仍走结构化解析。
- 摘要（#570）：默认 resultType 改为 core（lite 无 abstractText 字段可回落，只能换 core；
  实测 lite/core hitCount 相同，切 core 无召回代价）。env 仍可切回 lite。
"""
from __future__ import annotations

from typing import Any, Optional

from ..models.paper import Paper
from .europepmc import EuropePMCConnector


def _item(**overrides: Any) -> dict[str, Any]:
    """工厂：一条最小可解析的 Europe PMC 记录（含必需的 id/title）。"""
    base: dict[str, Any] = {
        "id": "12345",
        "source": "MED",
        "title": "A Paper on Osimertinib",
        "pubYear": "2024",
    }
    base.update(overrides)
    return base


def _parse(**overrides: Any) -> Optional[Paper]:
    return EuropePMCConnector()._parse_item(_item(**overrides))


def test_lite_falls_back_to_author_string() -> None:
    """lite：无 authorList、有 authorString → 作者非空且第一作者正确。"""
    paper = _parse(authorString="Smith J, Jones K, Lee A.")
    assert paper is not None
    assert paper.authors == ["Smith J", "Jones K", "Lee A"]
    assert paper.authors[0] == "Smith J"


def test_author_string_split_is_clean() -> None:
    """切分去尾点与空白、无空串、顺序保持（含多余空格与尾随逗号）。"""
    paper = _parse(authorString="  Smith J ,Jones K,  Lee A. ,")
    assert paper is not None
    assert paper.authors == ["Smith J", "Jones K", "Lee A"]


def test_core_author_list_takes_precedence() -> None:
    """兼容 core：authorList 存在 → 走结构化解析，不回落 authorString。"""
    paper = _parse(
        authorList={"author": [{"fullName": "Structured A"}, {"fullName": "Structured B"}]},
        authorString="Should Not Use S, Other O.",
    )
    assert paper is not None
    assert paper.authors == ["Structured A", "Structured B"]


def test_empty_author_string_yields_empty() -> None:
    """边界-真空：authorString 为空 → authors=[]，不报错（报告显示「—」属预期）。"""
    paper = _parse(authorString="")
    assert paper is not None
    assert paper.authors == []


def test_missing_author_fields_yields_empty() -> None:
    """边界：authorList 与 authorString 字段都缺失 → authors=[]，不报错。"""
    paper = _parse()
    assert paper is not None
    assert paper.authors == []


def test_non_string_author_string_is_safe() -> None:
    """边界-异常：authorString 非字符串 → 安全回落 []，不抛异常。"""
    paper = _parse(authorString=["unexpected", "list"])
    assert paper is not None
    assert paper.authors == []


# ===== 摘要（#570）=====

def test_default_result_type_is_core() -> None:
    """默认 resultType=core（lite 无 abstractText 可回落，只能换 core 取摘要）。"""
    from . import europepmc
    assert europepmc.EUROPEPMC_RESULT_TYPE == "core"


def test_abstract_parsed_from_abstract_text() -> None:
    """core：返回 abstractText → abstract 字段非空且正确。"""
    paper = _parse(abstractText="Osimertinib shows efficacy in EGFR-mutated NSCLC.")
    assert paper is not None
    assert paper.abstract == "Osimertinib shows efficacy in EGFR-mutated NSCLC."


def test_abstract_empty_when_field_missing_is_safe() -> None:
    """边界：abstractText 缺失（如 env 切回 lite）→ abstract 为空串，不报错。"""
    paper = _parse()
    assert paper is not None
    assert paper.abstract == ""
