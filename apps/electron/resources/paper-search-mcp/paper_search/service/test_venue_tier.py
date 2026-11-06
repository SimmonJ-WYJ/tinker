"""Tests for venue_tier：normalize_venue / map_venue_tier / infer_publication_status。"""
from __future__ import annotations

from .venue_tier import infer_publication_status, map_venue_tier, normalize_venue


def test_normalize_venue_conference_fullname() -> None:
    n = normalize_venue("IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR) 2024")
    assert n["canonical_key"] == "CVPR"
    assert n["year"] == 2024


def test_normalize_venue_emnlp_proceedings() -> None:
    n = normalize_venue("Proceedings of the 2020 Conference on Empirical Methods in Natural Language Processing (EMNLP)")
    assert n["canonical_key"] == "EMNLP"


def test_tier_top_from_jcr_high_if() -> None:
    t = map_venue_tier({"jcrPartition": "Q1", "impactFactor": "48.5"}, "Nature")
    assert t["tier"] == "top"
    assert t["match_confidence"] >= 0.9


def test_tier_strong_from_q1_low_if() -> None:
    t = map_venue_tier({"jcrPartition": "Q1", "impactFactor": "3.6"}, "Some Journal")
    assert t["tier"] == "strong"


def test_tier_from_cas_zone() -> None:
    assert map_venue_tier({"casPartition": "综合性期刊1区"}, "X")["tier"] == "top"
    assert map_venue_tier({"casPartition": "医学4区"}, "X")["tier"] == "weak"


def test_tier_conference_local_table() -> None:
    t = map_venue_tier(None, "Proceedings of the IEEE/CVF CVPR 2024")
    assert t["tier"] == "top"  # CVPR → CCF-A/CORE-A*


def test_tier_unknown_when_no_signal() -> None:
    t = map_venue_tier(None, "Some Obscure Local Workshop on Things")
    assert t["tier"] == "unknown"
    assert t["match_confidence"] == 0.0


def test_tier_takes_strongest_signal() -> None:
    # CCF-C 会议但 IF 高 → 取最强（top）
    t = map_venue_tier({"jcrPartition": "Q1", "impactFactor": "12"}, "3DV 2024")
    assert t["tier"] == "top"


def test_pub_status_journal() -> None:
    s = infer_publication_status({"venue": "Nature", "doi": "10.1/x", "source": "tool:MCP:paper-search:openalex"})
    assert s["status"] == "published_journal"


def test_pub_status_conference() -> None:
    s = infer_publication_status({"venue": "Proceedings of the AAAI Conference on Artificial Intelligence"})
    assert s["status"] == "published_conference"


def test_pub_status_preprint_only() -> None:
    s = infer_publication_status({"venue": None, "doi": "", "source": "tool:MCP:paper-search:arxiv"})
    assert s["status"] == "preprint_only"


def test_pub_status_preprint_with_doi() -> None:
    s = infer_publication_status({"venue": None, "doi": "10.2139/ssrn.x", "source": "tool:MCP:paper-search:crossref"})
    assert s["status"] == "preprint_with_doi"
