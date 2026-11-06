"""论文相关度评分算法（issue #93 F22）。

从 asci2/ASCI 的 scoring.py 移植，适配 ASCI-Alpha 的 PaperRecord 数据模型。
在 process_results_core() 中多源合并 + 去重 + 摘要补全之后、写入 JSONL 之前调用。

5 维加权评分，缺失维度按比例重分配权重，最终输出 0-100 整数。
"""

from __future__ import annotations

import math
import os
import re
from datetime import datetime, timezone
from typing import Optional


# 各维度默认权重，总和 = 1.0
# 调权（用户决策）：F22 原由 citations+recency 主导（各 0.25），对全量精确核心
# （标题均含对象词、对题度高度同质）几乎只按"高引 + 近期"排序，把真正方法对题但
# 引用少的新论文挤出 top_k。改为「对题度主导」：keyword_relevance 0.20→0.50，
# citations 0.25→0.10、recency 0.25→0.10；citation_velocity / venue_presence 维持 0.15。
DEFAULT_WEIGHTS: dict[str, float] = {
    "citations": 0.10,
    "recency": 0.10,
    "citation_velocity": 0.15,
    "venue_presence": 0.15,
    "keyword_relevance": 0.50,
}

# 用于从 query 中分词的分隔符
_QUERY_SPLIT_RE = re.compile(r"[,，;；\s]+")

# issue #442：缺摘要论文的置信度上限。摘要是判断"对题度"最关键的元数据，缺失时
# 用户无法充分判断相关性，因此这类论文的 F22 综合分（与下游 finalRelevance）一律
# 硬上限到此值，不得获得接近满分。同时写 metadataComplete=false 供 UI 标注原因。
MISSING_ABSTRACT_CAP = 60


def _current_year() -> int:
    return datetime.now(timezone.utc).year


def _score_citations(cc: Optional[int]) -> Optional[float]:
    """引用量：log 归一化到 [0, 1]，10000 引用 → 1.0"""
    if cc is None:
        return None
    return min(1.0, math.log1p(cc) / math.log1p(10000))


def _score_recency(year: Optional[int], current_year: int) -> Optional[float]:
    """近期度（P2-1 曲线调缓）：原 10 年线性衰减让任何当年论文 = 1.0、
    3 年前 = 0.7，把 2023-2024 经典论文（PI, YaRN, LongLoRA）压到 0.45-0.65
    与 LLM rerank 对抗。新曲线在 1-3y 范围衰减更缓，5y+ 维持原回落。"""
    if year is None:
        return None
    age = current_year - year
    if age <= 0:   return 1.00
    if age == 1:   return 0.95
    if age == 2:   return 0.85
    if age == 3:   return 0.70
    if age == 4:   return 0.50
    if age <= 6:   return 0.30
    if age <= 9:   return 0.15
    return 0.0


def _score_citation_velocity(
    cc: Optional[int], year: Optional[int], current_year: int,
) -> Optional[float]:
    """引用速度：年均引用量的 log 归一化"""
    if cc is None or year is None:
        return None
    span = max(1, current_year - year + 1)
    velocity = cc / span
    return math.log1p(velocity) / math.log1p(500)


def _score_venue_presence(venue: Optional[str]) -> Optional[float]:
    """期刊/会议存在性：有 → 0.5，无 → null"""
    if not venue:
        return None
    return 0.5


# 变体归一化（B）：连字符 / 下划线 / 各类破折号统一成空格，配合折叠空白 + 小写，
# 使 "depth-of-field"↔"depth of field"、"light-field"↔"light field"、
# "self-supervised"↔"self supervised" 可互相匹配。修复实测漏匹配：DeepDOF 标题
# "extended depth-of-field" 匹配不到 object 词 "extended depth of field"。
_MATCH_HYPHEN_RE = re.compile(r"[-_‐-―]")
_MATCH_WS_RE = re.compile(r"\s+")


def _norm_match(s: str) -> str:
    """归一化用于子串匹配的文本/词条（B）。"""
    return _MATCH_WS_RE.sub(" ", _MATCH_HYPHEN_RE.sub(" ", s.lower())).strip()


# 单轴饱和评分基准（A）：任一命中即给 base 分（确立"属于该轴"），命中更多词仅在
# (base, 1.0] 区间小幅加成。修复旧的"命中数 / 词表长度"线性比率——规划层给 6+8 个
# 词时，一篇精准聚焦论文只命中核心 1 个 → 1/6≈0.17，与完全不命中难区分，被严重稀释
# （实测 DeepDOF 命中 deep learning + light field 仍只有 0.17，沉到 #137）。
# base 越高越救聚焦论文。单词项轴（n=1）满命中 → base+(1-base)=1.0，与旧 {0,0.5,1.0}
# 语义一致（向后兼容现有双维测试）。
_KEYWORD_AXIS_BASE = 0.6


def _axis_saturating_score(hits: int, n: int) -> float:
    """单轴饱和分：0 命中→0；≥1 命中→ base + (1-base)×(hits/n)。"""
    if n <= 0 or hits <= 0:
        return 0.0
    return _KEYWORD_AXIS_BASE + (1.0 - _KEYWORD_AXIS_BASE) * (hits / n)


def _score_keyword_relevance(
    title: str,
    abstract: str,
    query_terms: list[str],
    method_terms: Optional[list[str]] = None,
    object_terms: Optional[list[str]] = None,
) -> Optional[float]:
    """关键词相关度（F21 #98 + A：饱和分修复长词表稀释 + B：变体归一化）。

    - method_terms / object_terms 至少一个非空 → 双维加成模式：
        每轴用 `_axis_saturating_score`（命中即 base 分 + 覆盖加成），而非线性比率，
        避免长词表把聚焦论文稀释到极低分。
        - 两侧都非空：返回 (method_axis + object_axis) / 2
        - 仅一侧非空：返回该侧 axis 分
    - 两侧都为空 → 回退到 query_terms 词袋命中比例（与 #93 现状一致）
    - 三者都为空 → 返回 None

    匹配前对文本与词条做 `_norm_match` 归一化（连字符→空格等），修复变体漏匹配。
    单词项轴（n=1）行为与旧 {0, 0.5, 1.0} 三档一致，向后兼容。
    """
    m_terms = [n for n in (_norm_match(t) for t in (method_terms or [])) if n]
    o_terms = [n for n in (_norm_match(t) for t in (object_terms or [])) if n]

    if not query_terms and not m_terms and not o_terms:
        return None

    text = _norm_match(title + " " + (abstract or ""))

    if m_terms or o_terms:
        m_hits = sum(1 for t in m_terms if t in text)
        o_hits = sum(1 for t in o_terms if t in text)
        m_score = _axis_saturating_score(m_hits, len(m_terms)) if m_terms else None
        o_score = _axis_saturating_score(o_hits, len(o_terms)) if o_terms else None
        if m_score is not None and o_score is not None:
            return (m_score + o_score) / 2.0
        if m_score is not None:
            return m_score
        return o_score  # type: ignore[return-value]

    # fallback：原 query 词袋逻辑（同样归一化匹配）
    matches = sum(1 for term in query_terms if _norm_match(term) in text)
    return matches / len(query_terms)


def _method_axis_score(
    title: str, abstract: str, method_terms: Optional[list[str]] = None
) -> Optional[float]:
    """method 轴单独的饱和命中分（0-1）；无 method_terms 返回 None。

    供「判分门槛」用：method 维强命中（方法高度对题）的论文，即便 object 维不命中、
    F22 综合分偏低（≤55），也应进 LLM 判分窗口——否则会像「Deep learning extended
    depth-of-field microscope（非光场）」那样，object=light field 不命中 → F22≤55 →
    进不了判分 → semantic 回退低 keywordRelevance → 沉底。算法与 keyword_relevance 的
    method 轴一致（同 `_norm_match` 归一化 + `_axis_saturating_score`）。
    """
    m_terms = [n for n in (_norm_match(t) for t in (method_terms or [])) if n]
    if not m_terms:
        return None
    text = _norm_match(title + " " + (abstract or ""))
    m_hits = sum(1 for t in m_terms if t in text)
    return _axis_saturating_score(m_hits, len(m_terms))


# ── off-domain penalty（issue #620）─────────────────────────────────────────
# 非 seed、且标题+摘要"完全缺少" method/object 信号的论文，F22 综合分乘惩罚系数，
# 防止「擦边 + 新近/高引」论文在排序上压过核心论文。两道护栏缺一不可：
#   1. seed 豁免：extra.seed=true（#614 链路标记）的论文永不惩罚，避免误伤核心论文；
#   2. broad query 守门：仅 method 信号足够明确时启用，探索型宽检索不惩罚。
OFF_DOMAIN_PENALTY_DEFAULT = 0.25


def _off_domain_penalty() -> float:
    """off-domain penalty 系数：env PAPER_SEARCH_OFF_DOMAIN_PENALTY 可调，默认 0.25。

    运行时读取——MCP 常驻进程内改 env 后下一次检索即生效，不重打包。非法值回退默认。
    """
    try:
        return float(
            os.getenv("PAPER_SEARCH_OFF_DOMAIN_PENALTY", str(OFF_DOMAIN_PENALTY_DEFAULT))
        )
    except (TypeError, ValueError):
        return OFF_DOMAIN_PENALTY_DEFAULT


def _should_apply_off_domain_penalty(
    method_terms: list[str], object_terms: list[str]
) -> bool:
    """broad query 守门：method 信号足够明确时才启用 off-domain penalty。

    条件：method_terms ≥ 2，或（method_terms ≥ 1 且 object_terms ≥ 1）。仅 1 个 method
    词且无 object 词（探索型宽检索）时整体不启用，避免误伤。
    """
    return len(method_terms) >= 2 or (len(method_terms) >= 1 and len(object_terms) >= 1)


def _has_domain_signal(
    title: str, abstract: str, method_terms: list[str], object_terms: list[str]
) -> bool:
    """标题+摘要是否含任一 method/object 信号（_norm_match 归一化后子串匹配）。

    全不命中 → False，即"完全缺少领域信号"，是 off-domain penalty 的打沉对象。
    匹配口径与 _score_keyword_relevance 一致（连字符/下划线/破折号归一化）。
    """
    text = _norm_match(title + " " + (abstract or ""))
    for term in (*method_terms, *object_terms):
        norm = _norm_match(term)
        if norm and norm in text:
            return True
    return False


def _extract_query_terms(query: Optional[str]) -> list[str]:
    """从搜索 query 中提取关键词列表（小写、去空、≥2 字符）"""
    if not query:
        return []
    return [
        t for t in _QUERY_SPLIT_RE.split(query.lower())
        if len(t) >= 2
    ]


def score_papers(
    records: list[dict],
    query: Optional[str] = None,
    method_terms: Optional[list[str]] = None,
    object_terms: Optional[list[str]] = None,
    weights: Optional[dict[str, float]] = None,
) -> None:
    """为每条 PaperRecord 计算相关度评分，原地写入 extra.relevance + extra.relevanceBreakdown。

    F21 (issue #98)：method_terms / object_terms 任一非空时，keyword_relevance 维度走
    method × object 双维加成；否则回退到 query 词袋逻辑。两个数组（归一化为小写后）
    同时写入 extra.methodTerms / extra.objectTerms，供前端展示与 agent 后续检视。
    若两者都未提供，extra 中不写这两个字段，保持与 #93 现状逐位一致。

    Args:
        records: PaperRecord 字典列表（process_results_core 的 all_records）
        query: 搜索关键词，用于 keyword_relevance 维度（双维 fallback 路径）
        method_terms: 研究方法关键词列表（F21）
        object_terms: 研究对象关键词列表（F21）
        weights: 自定义权重，默认使用 DEFAULT_WEIGHTS
    """
    if not records:
        return

    w = weights if weights is not None else DEFAULT_WEIGHTS
    current_year = _current_year()
    query_terms = _extract_query_terms(query)

    # 归一化（小写、去空白、过滤空串）— 与 _score_keyword_relevance 内部一致
    norm_method = [t.lower() for t in (method_terms or []) if t and t.strip()]
    norm_object = [t.lower() for t in (object_terms or []) if t and t.strip()]
    has_axes = bool(method_terms is not None or object_terms is not None)

    # issue #620 off-domain penalty：broad query 守门只依赖 method/object 词表，与
    # 单条记录无关，循环外定一次；启用时读 env 系数（默认 0.25），否则保持 1.0（无惩罚）。
    apply_off_domain_penalty = _should_apply_off_domain_penalty(norm_method, norm_object)
    off_domain_factor = _off_domain_penalty() if apply_off_domain_penalty else 1.0

    for record in records:
        extra = record.get("extra") or {}

        # 从 PaperRecord 格式读取字段
        title = record.get("title") or ""
        abstract = record.get("abstract") or ""
        year = record.get("year")
        cc = extra.get("citedBy")
        if not isinstance(cc, (int, float)):
            cc = None
        else:
            cc = int(cc)
        venue = record.get("venue")

        # 各维度评分（None = 数据缺失）
        raw: dict[str, Optional[float]] = {
            "citations": _score_citations(cc),
            "recency": _score_recency(year, current_year),
            "citation_velocity": _score_citation_velocity(cc, year, current_year),
            "venue_presence": _score_venue_presence(venue),
            "keyword_relevance": _score_keyword_relevance(
                title, abstract, query_terms,
                method_terms=norm_method,
                object_terms=norm_object,
            ),
        }

        # 按比例重分配缺失维度的权重
        available_weight = 0.0
        weighted_sum = 0.0
        dimensions_used: list[str] = []

        for metric, value in raw.items():
            metric_weight = w.get(metric, 0.0)
            if value is not None and metric_weight > 0:
                weighted_sum += value * metric_weight
                available_weight += metric_weight
                dimensions_used.append(metric)

        total_weight = sum(w.values())

        if available_weight > 0:
            if available_weight < total_weight:
                # 缺失维度：按比例放大已有维度的贡献
                score = weighted_sum * (total_weight / available_weight) * 100
            else:
                score = weighted_sum * 100
        else:
            score = 0.0

        score = max(0.0, min(100.0, score))

        # issue #620 off-domain penalty：守门通过 + 非 seed + 标题/摘要完全无 method/object
        # 信号 → F22 乘惩罚系数，打沉「擦边 + 新近/高引」论文。seed 永远豁免（extra.seed，
        # #614 链路标记）。在缺摘要 cap 之前作为 F22 综合分的领域调整；只动 relevance，不改
        # 下方独立计算的 keywordRelevance / methodRelevance。
        if (
            apply_off_domain_penalty
            and not extra.get("seed")
            and not _has_domain_signal(title, abstract, norm_method, norm_object)
        ):
            score = max(0.0, min(100.0, score * off_domain_factor))

        # issue #442：元数据完整度门控。缺摘要 → 无法充分判断相关性 → 置信度硬上限，
        # 不抬高低分论文（min 取小）。missingMetadata 列出缺失的关键字段供 UI 标注。
        missing_metadata: list[str] = []
        if not abstract.strip():
            missing_metadata.append("abstract")
        if missing_metadata:
            score = min(score, float(MISSING_ABSTRACT_CAP))

        # 写入 extra
        if not record.get("extra"):
            record["extra"] = {}
        record["extra"]["relevance"] = round(score)
        record["extra"]["relevanceBreakdown"] = dimensions_used
        # issue #442：元数据完整度标志，供 UI 标注「因缺摘要，置信度受限」
        record["extra"]["metadataComplete"] = not missing_metadata
        record["extra"]["missingMetadata"] = missing_metadata
        # keywordRelevance：纯"对题度"分(关键词命中维 ×100,0-100)。面板"相关度"
        # 在未经 LLM rerank 的论文上用它(精确命中→100);与 finalRelevance(LLM×100)
        # 同轴可比。relevance(F22 综合分)仍保留作质量信号。
        kr = raw.get("keyword_relevance")
        if kr is not None:
            record["extra"]["keywordRelevance"] = round(kr * 100)
        # methodRelevance：method 轴单独命中分（×100）。供判分门槛——method 强命中的
        # 论文即便 object 维不命中、F22 偏低，也放进 LLM 判分窗口（见 _method_axis_score）。
        ma = _method_axis_score(title, abstract, norm_method)
        if ma is not None:
            record["extra"]["methodRelevance"] = round(ma * 100)

        # F21：仅在显式传入了 method/object 参数时才写入两个字段
        # 这样旧调用（不传两参数）不会产生 schema 漂移
        if has_axes:
            record["extra"]["methodTerms"] = norm_method
            record["extra"]["objectTerms"] = norm_object
