"""证据驱动文献评分 v2（七维 + null 权重重分配 + data_confidence + 等级）。

设计母本：《ASCI_文献评分排序Agent方案_修订版v3》Layer 6 + spec `docs/specs/lit-scoring-agent-spec.md`。
与现有 F22(`scoring.py`)/finalRelevance 并行，结果写 `extra.score`，不替换 v1。

确定性维（venue_quality/publication_status/recency/paper_influence/reproducibility）在此计算；
语义相关性 / 方法匹配由 scorer 子 Agent（LLM）传入，缺失时回退/置 null。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .scoring import MISSING_ABSTRACT_CAP
from .venue_tier import infer_publication_status, map_venue_tier

# 相关性主导：排序主要由"是否回答了原问题"决定（semantic + method）。
# 质量降为二级：venue / 出版状态 / 时效 / 影响力 / 可复现只做 20% 的二级权重 + 单独标注，
# 不让"高质量但不对题"的论文挤到前面。
RELEVANCE_WEIGHTS: dict[str, float] = {
    "semantic_relevance": 0.35,
    "method_match": 0.20,
}
QUALITY_WEIGHTS: dict[str, float] = {
    "venue_quality": 0.15,
    "publication_status": 0.10,
    "recency": 0.10,
    "paper_influence": 0.05,
    "reproducibility": 0.05,
}
# finalScore = QUALITY_BLEND 之外全给相关性
QUALITY_BLEND = 0.20

# 兼容旧调用 / compute_final_score 默认权重（全维并集）
WEIGHTS: dict[str, float] = {**RELEVANCE_WEIGHTS, **QUALITY_WEIGHTS}

VENUE_TIER_SCORE: dict[str, Optional[float]] = {
    "top": 95.0, "strong": 80.0, "normal": 65.0, "weak": 45.0, "unknown": None,
}

PUB_STATUS_SCORE: dict[str, float] = {
    "published_journal": 85.0,
    "published_conference": 85.0,
    "accepted_pending_publication": 70.0,
    "published_workshop": 60.0,
    "preprint_with_doi": 55.0,
    "preprint_only": 45.0,
    "published_repository": 45.0,
    "unknown": 35.0,
}


def _clamp100(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(100.0, f))


# 未经 LLM 判分时 semantic 的回退折扣：keywordRelevance / relevance 是纯词频 / 综合
# 代理（词频命中高 ≠ 对题，如反卷积工具堆术语），打折避免这些「没被判」的论文虚高、
# 系统性盖过「被 LLM 判过」的论文（判过 = 更可信的对题信号，应优先）。finalRelevance
# 本身是 LLM rerank 的对题度，可信，不打折。
SEMANTIC_FALLBACK_DISCOUNT = 0.75


def _fallback_semantic(extra: dict) -> float:
    """scorer 未提供 semantic 时，回退现有对题度信号。

    finalRelevance（LLM rerank 写的对题度）可信，原值返回；keywordRelevance / relevance
    是非 LLM 的词频 / 综合代理，乘 SEMANTIC_FALLBACK_DISCOUNT 折扣（见上）。
    """
    v = extra.get("finalRelevance")
    if isinstance(v, (int, float)):
        return float(v)
    for k in ("keywordRelevance", "relevance"):
        v = extra.get(k)
        if isinstance(v, (int, float)):
            return float(v) * SEMANTIC_FALLBACK_DISCOUNT
    return 50.0


def _score_recency(year, now_year: int) -> Optional[float]:
    if not isinstance(year, int):
        return None
    age = now_year - year
    if age <= 1:
        return 95.0
    if age <= 3:
        return 85.0
    if age <= 5:
        return 70.0
    if age <= 10:
        return 50.0
    return 30.0


def _score_influence(cited_by, year, now_year: int) -> Optional[float]:
    if not isinstance(cited_by, (int, float)):
        return None  # 无引用数据 → unknown（不惩罚，尤其新论文）
    span = max(1, now_year - year + 1) if isinstance(year, int) else 1
    annual = cited_by / span
    if annual >= 50:
        return 95.0
    if annual >= 20:
        return 85.0
    if annual >= 10:
        return 75.0
    if annual >= 5:
        return 65.0
    if annual >= 1:
        return 55.0
    return 40.0


def _score_reproducibility(record: dict) -> Optional[float]:
    extra = record.get("extra") or {}
    text = ((record.get("title") or "") + " " + (record.get("abstract") or "")).lower()
    if ("github" in text or "open source" in text or "open-source" in text
            or ("code" in text and ("available" in text or "release" in text))):
        return 75.0
    if record.get("url") or extra.get("pdf_url"):
        return 50.0
    return None


def compute_final_score(scores: dict, weights: dict = WEIGHTS) -> float:
    """null 维度不计入，权重按比例重分配给有数据的维（缺数据 ≠ 差）。"""
    avail = {k: v for k, v in scores.items() if v is not None}
    if not avail:
        return 0.0
    total_w = sum(weights[k] for k in avail)
    if total_w <= 0:
        return 0.0
    return round(sum(scores[k] * weights[k] for k in avail) / total_w, 1)


def _compute_data_confidence(record: dict, tier_info: dict, pub: dict) -> float:
    """关键字段证据置信度加权（缺项同样按比例重分配）。不乘进 final_score。"""
    venue = (record.get("venue") or "").strip()
    confs = {
        "title": 0.95 if (record.get("title") or "").strip() else None,
        "venue": (max(tier_info["match_confidence"], 0.5) if venue else None),
        "publication_status": pub["confidence"],
        "year": 0.95 if isinstance(record.get("year"), int) else None,
        "authors": 0.9 if (record.get("authors") or []) else None,
    }
    w = {"title": 0.10, "venue": 0.30, "publication_status": 0.30, "year": 0.10, "authors": 0.20}
    avail = {k: v for k, v in confs.items() if v is not None}
    if not avail:
        return 0.0
    total_w = sum(w[k] for k in avail)
    return round(sum(confs[k] * w[k] for k in avail) / total_w, 3)


def _level(final: float) -> str:
    if final >= 90:
        return "S"
    if final >= 80:
        return "A"
    if final >= 65:
        return "B"
    if final >= 50:
        return "C"
    return "D"


def _build_reason(
    scores: dict, tier_info: dict, pub: dict, null_fields: list[str],
    abstract_missing: bool = False,
) -> str:
    bits: list[str] = []
    if abstract_missing:
        bits.append(f"缺摘要：综合分受限上限 {MISSING_ABSTRACT_CAP}")
    if scores.get("semantic_relevance") is not None and scores["semantic_relevance"] >= 80:
        bits.append("语义高度相关")
    if scores.get("method_match") is not None and scores["method_match"] >= 80:
        bits.append("方法匹配度高")
    if tier_info["tier"] != "unknown":
        bits.append(f"venue {tier_info['tier']}（{'/'.join(tier_info['evidence']) or '—'}）")
    bits.append({
        "published_journal": "已正式发表（期刊）",
        "published_conference": "已正式发表（会议）",
        "published_workshop": "发表于 workshop",
        "accepted_pending_publication": "已接收待出版",
        "preprint_with_doi": "预印本（有 DOI）",
        "preprint_only": "纯预印本",
        "unknown": "出版状态未知",
    }.get(pub["status"], pub["status"]))
    if null_fields:
        bits.append("缺数据项已重分配权重：" + "/".join(null_fields))
    return "；".join(bits)


def score_record(
    record: dict, semantic=None, method=None, now_year: Optional[int] = None,
    judged: Optional[bool] = None,
) -> dict:
    """对单条 record 计算 v2 评分。返回 ScoreBreakdown（写入 extra.score 的结构）。

    Args:
        record: session JSONL 的一行（含 extra.journalRank / citedBy / venue / year …）。
        semantic: scorer 子 Agent 给的语义相关性 0-100；None 则回退现有对题度信号。
        method: 方法匹配度 0-100；None 则该维记 null（权重重分配）。
        now_year: 当前年份（测试可注入）。
        judged: 显式覆盖「是否 LLM 判过」标记。None（默认）→ 按 semantic/method 是否传入推断
            （保持既有语义）；True/False → 强制。apply_scoring 命中的 handle 已经过 LLM 判分，
            即便模型给的维度值坏（都 None）也须传 judged=True，否则进度条把该篇当未判、X 到不了
            Y（#801）。判过 ≠ 判得好。
    """
    extra = record.get("extra") if isinstance(record.get("extra"), dict) else {}
    jr = extra.get("journalRank") if isinstance(extra.get("journalRank"), dict) else None
    now_year = now_year or datetime.now(timezone.utc).year

    tier_info = map_venue_tier(jr, record.get("venue"))
    pub = infer_publication_status(record)

    venue_quality = VENUE_TIER_SCORE.get(tier_info["tier"])
    if venue_quality is not None:
        venue_quality = round(venue_quality * max(tier_info["match_confidence"], 0.5), 1)

    pub_score = PUB_STATUS_SCORE.get(pub["status"], 35.0)
    publication_status = round(pub_score * (0.6 + 0.4 * pub["confidence"]), 1)

    year = record.get("year")
    # issue #685 之外的最后一道防线：摘要是判断对题度最关键的元数据，兜底链
    # （Semantic Scholar / OpenAlex / Crossref / Europe PMC + 出版社页面 meta）也补不到时，
    # 缺摘要论文不能凭质量分 / 标题在 score 下排到用户眼前（见下方 finalScore cap）。
    abstract_missing = not (record.get("abstract") or "").strip()
    scores = {
        "semantic_relevance": _clamp100(semantic) if semantic is not None else _fallback_semantic(extra),
        "method_match": _clamp100(method) if method is not None else None,
        "venue_quality": venue_quality,
        "publication_status": publication_status,
        "recency": _score_recency(year, now_year),
        "paper_influence": _score_influence(extra.get("citedBy"), year, now_year),
        "reproducibility": _score_reproducibility(record),
    }

    null_fields = [k for k, v in scores.items() if v is None]

    # 相关性分（主导排序）：semantic 为对题度地板，method_match 只加成不减分。
    #
    # 背景（反常激励 bug）：compute_final_score 对 null 维度"豁免重分配"，于是
    # method_match 缺失的论文 relevanceScore = 纯 semantic（虚高），而 method_match
    # 有值但偏低的论文被计入、拉低 —— "诚实拿到低方法分"系统性输给"方法分缺失"。
    # 实测 semantic=88/method=40 的高度对题论文 relevanceScore 仅 70.5（finalScore 72.4，
    # 排 #139），反输给一堆 semantic=83/method=null 的 83。
    #
    # 修复：以 semantic 为基线下限取 max。method 高于 semantic 才上拉对题度，低于或缺失
    # 都不拉低 —— 缺失与低分待遇一致（都不减分），消除反常激励；且与"对题度主导"设计一致
    # （method_match 数据本就大面积缺失/不可靠，不应让它把语义最相关的论文压下去）。
    relevance_blend = compute_final_score(
        {k: scores[k] for k in RELEVANCE_WEIGHTS}, RELEVANCE_WEIGHTS,
    )
    relevance_score = max(relevance_blend, scores["semantic_relevance"])
    # 质量分（二级 + 标注）：venue / 出版 / 时效 / 影响力 / 可复现；全缺则 None
    quality_dims = {k: scores[k] for k in QUALITY_WEIGHTS}
    quality_score = (
        None if all(v is None for v in quality_dims.values())
        else compute_final_score(quality_dims, QUALITY_WEIGHTS)
    )

    # finalScore = 相关性主导（80%）+ 质量二级（20%）；无质量数据则纯相关性
    if quality_score is None:
        final = round(relevance_score, 1)
    else:
        final = round((1 - QUALITY_BLEND) * relevance_score + QUALITY_BLEND * quality_score, 1)

    # 缺摘要硬上限（与 v1 finalRelevance / F22 的 MISSING_ABSTRACT_CAP 行为一致，复用同一常量）：
    # 缺摘要时无法充分判断对题度，高引 / 顶刊不得凭质量分把 finalScore 抬到用户眼前。作用在
    # finalScore（面板排序键，最防御），min 取小不抬高本就低分的论文；relevanceScore /
    # qualityScore 等解释性字段保留原值，如实反映各维信号。与 #685（尽力补摘要）解耦、互补。
    if abstract_missing:
        final = min(final, float(MISSING_ABSTRACT_CAP))

    data_confidence = _compute_data_confidence(record, tier_info, pub)

    return {
        "version": 3,
        # judged：LLM scorer 是否判过本篇。apply_scoring 命中即经 LLM 判分 → 显式传 judged=True
        # （哪怕模型返回的维度值坏、两维都 None，判过 ≠ 判得好，#801）；enrich 后台对本轮每篇都算
        # 七维 score 写回（未判篇 semantic 回退、method=None）→ 不传 judged，按维度推断为 False，
        # 故「score 存在」≠「LLM 判过」。进度条数已判篇数须靠此标记区分，不能只看 score 存在性
        # 或 method_match 维度值（scorer 可能只给 semantic 漏 method）——详见 #745 / #801。
        "judged": (semantic is not None or method is not None) if judged is None else bool(judged),
        "scores": scores,
        "relevanceScore": round(relevance_score, 1),
        "qualityScore": None if quality_score is None else round(quality_score, 1),
        "nullFields": null_fields,
        "finalScore": final,
        "level": _level(final),  # 仍计算，但前端不展示 S/A/B/C/D
        "dataConfidence": data_confidence,
        "venueTier": tier_info["tier"],
        "venueMatchConfidence": round(tier_info["match_confidence"], 2),
        "publicationStatus": pub["status"],
        "publicationStatusConfidence": round(pub["confidence"], 2),
        "venueType": pub["venue_type"],
        "reason": _build_reason(scores, tier_info, pub, null_fields, abstract_missing),
    }
