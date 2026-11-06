"""venue 指标 → venue_tier 映射 + venue 名归一化 + 出版状态推断（评分 v2 / Layer 4-5 轻量版）。

设计母本：《ASCI_文献评分排序Agent方案_修订版v3》Layer 4/5。MVP 不建独立 venue 表，
期刊指标直接取 record 的 `extra.journalRank`（本地分区表 fenqu_simple_2025.json），会议靠本地 CCF/CORE 种子表。
"""
from __future__ import annotations

import functools
import json
import os
import re
from typing import Optional

# ---------- 本地 CCF/CORE + 顶刊白名单种子表 ----------

@functools.lru_cache(maxsize=1)
def _load_local_table() -> dict:
    path = os.path.join(os.path.dirname(__file__), "..", "resources", "venue_ranking_local.json")
    try:
        with open(os.path.abspath(path), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"conferences": {}, "journal_top_whitelist": []}


# ---------- venue 名归一化 ----------

_YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
_PAREN_ABBR_RE = re.compile(r"\(([A-Za-z][A-Za-z0-9/\- ]{1,20})\)")

# 常见会议全名片段 → canonical_key（小写子串匹配）
_NAME_TO_KEY = [
    ("computer vision and pattern recognition", "CVPR"),
    ("international conference on computer vision", "ICCV"),
    ("european conference on computer vision", "ECCV"),
    ("neural information processing systems", "NEURIPS"),
    ("international conference on machine learning", "ICML"),
    ("international conference on learning representations", "ICLR"),
    ("aaai conference", "AAAI"),
    ("international joint conference on artificial intelligence", "IJCAI"),
    ("association for computational linguistics", "ACL"),
    ("empirical methods in natural language processing", "EMNLP"),
    ("acm international conference on multimedia", "MM"),
    ("acm multimedia", "MM"),
    ("knowledge discovery and data mining", "KDD"),
    ("research and development in information retrieval", "SIGIR"),
    ("world wide web", "WWW"),
    ("the web conference", "WWW"),
    ("medical image computing", "MICCAI"),
    ("robotics and automation", "ICRA"),
    ("intelligent robots and systems", "IROS"),
    ("very large data bases", "VLDB"),
    ("international conference on 3d vision", "3DV"),
]

# 可直接按 token 识别的会议简称（够长够独特，避免 MM/SP 这类歧义短码误匹配）
_KNOWN_ABBRS = {
    "CVPR", "ICCV", "ECCV", "NEURIPS", "NIPS", "ICML", "ICLR", "AAAI", "IJCAI",
    "ACL", "EMNLP", "NAACL", "SIGGRAPH", "KDD", "SIGIR", "WWW", "MICCAI",
    "ICRA", "IROS", "VLDB", "SIGMOD", "3DV", "CCS", "OSDI", "SOSP", "USENIX",
}


def normalize_venue(raw: Optional[str]) -> dict:
    """venue 名归一化。输出 {canonical_key（大写简称，用于精确匹配）, canonical_name, year}。"""
    name = (raw or "").strip()
    year = None
    m = _YEAR_RE.search(name)
    if m:
        year = int(m.group(0))
    low = name.lower()

    key = None
    for pat, k in _NAME_TO_KEY:
        if pat in low:
            key = k
            break
    if not key:
        pm = _PAREN_ABBR_RE.search(name)
        if pm:
            cand = pm.group(1).strip().upper().replace(" ", "")
            if re.fullmatch(r"[A-Z][A-Z0-9]{1,15}", cand):
                key = cand
    if not key:
        for tok in re.split(r"[^A-Za-z0-9]+", name.upper()):
            if tok in _KNOWN_ABBRS:
                key = "NEURIPS" if tok == "NIPS" else tok
                break
    if not key:
        cleaned = _YEAR_RE.sub(" ", name)
        cleaned = re.sub(
            r"\b(proceedings of|the|ieee|acm|ieee/cvf|annual|international|conference on|"
            r"\d+st|\d+nd|\d+rd|\d+th)\b",
            " ", cleaned, flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"[^A-Za-z0-9 ]", " ", cleaned)
        cleaned = " ".join(cleaned.split())
        key = cleaned.upper() if cleaned else name.upper()
    return {"canonical_key": key, "canonical_name": name, "year": year}


# ---------- venue_tier 映射 ----------

_TIER_ORDER = {"unknown": 0, "weak": 1, "normal": 2, "strong": 3, "top": 4}


def _stronger(a: str, b: str) -> str:
    return a if _TIER_ORDER[a] >= _TIER_ORDER[b] else b


def _parse_if(v) -> Optional[float]:
    try:
        return float(str(v))
    except (TypeError, ValueError):
        return None


def _cas_zone(cas: Optional[str]) -> Optional[int]:
    """从中科院分区串里抽 1-4。'综合性期刊1区' / '医学2区' → 1 / 2。"""
    if not cas:
        return None
    m = re.search(r"([1-4一二三四])\s*区", cas)
    if not m:
        return None
    g = m.group(1)
    if g.isdigit():
        return int(g)
    return {"一": 1, "二": 2, "三": 3, "四": 4}.get(g)


def map_venue_tier(journal_rank: Optional[dict], venue_name: Optional[str],
                   local_table: Optional[dict] = None) -> dict:
    """综合 journalRank(本地分区表) + 本地 CCF/CORE 表 + 顶刊白名单 → venue_tier（取最强信号）。

    Returns: {tier, match_confidence, evidence[]}。
    """
    table = local_table or _load_local_table()
    tier = "unknown"
    conf = 0.0
    evidence: list[str] = []

    name_up = (venue_name or "").strip().upper()
    if name_up and name_up in {w.upper() for w in table.get("journal_top_whitelist", [])}:
        tier = _stronger(tier, "top"); conf = max(conf, 0.95); evidence.append("顶刊白名单")

    jr = journal_rank or {}
    jcr = (jr.get("jcrPartition") or "").upper()
    iff = _parse_if(jr.get("impactFactor"))
    cas = _cas_zone(jr.get("casPartition"))
    if jcr or iff is not None or cas is not None:
        conf = max(conf, 0.9)
        if cas == 1:
            tier = _stronger(tier, "top"); evidence.append("中科院1区")
        elif cas == 2:
            tier = _stronger(tier, "strong"); evidence.append("中科院2区")
        elif cas == 3:
            tier = _stronger(tier, "normal"); evidence.append("中科院3区")
        elif cas == 4:
            tier = _stronger(tier, "weak"); evidence.append("中科院4区")
        if jcr == "Q1":
            if iff is not None and iff >= 8:
                tier = _stronger(tier, "top"); evidence.append(f"JCR-Q1·IF{iff}")
            else:
                tier = _stronger(tier, "strong"); evidence.append("JCR-Q1")
        elif jcr == "Q2":
            if iff is not None and iff >= 5:
                tier = _stronger(tier, "strong"); evidence.append(f"JCR-Q2·IF{iff}")
            else:
                tier = _stronger(tier, "normal"); evidence.append("JCR-Q2")
        elif jcr == "Q3":
            tier = _stronger(tier, "normal"); evidence.append("JCR-Q3")
        elif jcr == "Q4":
            tier = _stronger(tier, "weak"); evidence.append("JCR-Q4")

    rec = table.get("conferences", {}).get(normalize_venue(venue_name)["canonical_key"])
    if rec:
        conf = max(conf, 0.9)
        ccf, core = rec.get("ccf"), rec.get("core")
        if ccf == "A" or core == "A*":
            tier = _stronger(tier, "top")
        elif ccf == "B" or core == "A":
            tier = _stronger(tier, "strong")
        elif ccf == "C" or core == "B":
            tier = _stronger(tier, "normal")
        elif core == "C":
            tier = _stronger(tier, "weak")
        evidence.append(f"CCF-{ccf or '-'}/CORE-{core or '-'}")

    return {"tier": tier, "match_confidence": conf, "evidence": evidence}


# ---------- 出版状态推断（Layer 4 轻量版） ----------

_PREPRINT_VENUE_MARKERS = (
    "arxiv", "ssrn", "biorxiv", "medrxiv", "chemrxiv", "preprint",
    "research square", "techrxiv", "authorea",
)
_CONF_VENUE_MARKERS = ("proceedings", "conference", "symposium", "congress", "meeting")


def infer_publication_status(record: dict) -> dict:
    """从 source / venue / doi 粗判出版状态（MVP，无 arXiv journal-ref 解析）。

    Returns: {status, confidence, venue_type}。
    """
    venue = (record.get("venue") or "").strip()
    venue_low = venue.lower()
    doi = (record.get("doi") or "").strip()
    src = (record.get("source") or "").split(":")[-1].lower()

    is_preprint_venue = any(m in venue_low for m in _PREPRINT_VENUE_MARKERS)

    if venue and not is_preprint_venue:
        if "workshop" in venue_low:
            return {"status": "published_workshop", "confidence": 0.8, "venue_type": "conference"}
        if any(m in venue_low for m in _CONF_VENUE_MARKERS):
            return {"status": "published_conference", "confidence": 0.82, "venue_type": "conference"}
        return {"status": "published_journal", "confidence": 0.85, "venue_type": "journal"}

    if doi:
        return {"status": "preprint_with_doi", "confidence": 0.7, "venue_type": "preprint"}
    if src == "arxiv" or is_preprint_venue:
        return {"status": "preprint_only", "confidence": 0.75, "venue_type": "preprint"}
    return {"status": "unknown", "confidence": 0.4, "venue_type": "unknown"}
