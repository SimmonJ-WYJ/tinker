"""Core search orchestration service."""
from __future__ import annotations

import asyncio
import html
import logging
import os
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

import requests

from ..connectors.registry import ConnectorRegistry
from ..connectors.base import PaperConnector
from ..connectors.http_proxy import enrich_proxy_context
from ..models.paper import Paper, SearchResult, SnowballResult
from ..utils import normalize_doi
from .live_progress import LiveProgress
from .publisher_abstract import fetch_abstract_from_landing_page

logger = logging.getLogger(__name__)

# 进入 LLM scorer 判分窗口的门槛：F22 relevance 高于此值的论文才送 LLM 判 semantic/method。
# 绝对分数阈值取代旧的"固定 top_k=50 按排名截断"——对题论文多时不被挤出窗口（曾有 65 篇
# 三维全中被 top_k=50 截掉），少时也不硬凑数量把噪声拉进 LLM 判分。注：只决定"送谁判"，
# 与 score 七维本地评分（对每篇全算）无关。
TOPK_F22_THRESHOLD = float(os.getenv("PAPER_SEARCH_TOPK_F22_THRESHOLD", "50"))
# 防爆上限：F22>阈值随召回波动可达 200+ 篇，LLM 判分是检索最贵的环节，最多送 TOPK_CAP 篇
# （超出按 F22 降序截断）。retrieve 的 top_k 参数即此上限。
TOPK_CAP = int(os.getenv("PAPER_SEARCH_TOPK_CAP", "120"))

# required_seeds (#614)：verified/total 低于此比例时 retrieve 返回 incomplete_retrieval=true。
# 纯观测信号，供上层 / 用户判断检索是否完整，不阻断下游（附件 §4.5 / §8.4）。
SEED_RECALL_THRESHOLD = float(os.getenv("PAPER_SEARCH_SEED_RECALL_THRESHOLD", "0.8"))

# fan-out 单 cell 完成回调：(source, papers, ok)。供 retrieve 把每源进度
# 流式写到 live 文件（见 live_progress.py），面板边检索边渲染。
OnSourceDone = Callable[[str, List[Paper], bool], None]

# 单源搜索硬超时（秒）。连接器内部可能会自带 3 次重试 × 30s（arxiv）
# 或指数退避（semantic 5/2s base + 2^attempt），失败场景下能跑 100s+
# 不返回。wait_for 在外层封顶，使调用方能尽快拿到「408 timeout」状态，
# 而不是被空 papers=[] 误判为 204 no-content。
# 注意：asyncio.wait_for 不会取消 to_thread 的底层线程；但连接器内的
# requests session 自带 timeout=30s，工作线程在 ≤30s 内自终止，
# 不会无限堆积。
PER_SOURCE_TIMEOUT_SEC = float(os.getenv("PAPER_SEARCH_PER_SOURCE_TIMEOUT_SEC", "20"))

# 分级超时（P2-2）：fast-path 源（openalex/crossref 实测 100% ok-rate、典型
# <2s）用更短的硬超时，避免单个 fast 源偶发卡住时把整轮 fan-out 拖到 20s 尾部；
# flaky/慢源（arxiv/semantic/pubmed 等）保留较长的默认值。
# 可用 PAPER_SEARCH_SOURCE_TIMEOUTS="openalex=8,crossref=8,doaj=10" 覆盖/扩展。
_DEFAULT_FAST_SOURCE_TIMEOUTS: Dict[str, float] = {
    "openalex": 8.0,
    "crossref": 8.0,
    "doaj": 10.0,
}


def _parse_source_timeout_overrides() -> Dict[str, float]:
    raw = os.getenv("PAPER_SEARCH_SOURCE_TIMEOUTS", "").strip()
    if not raw:
        return {}
    out: Dict[str, float] = {}
    for item in raw.split(","):
        item = item.strip()
        if not item or "=" not in item:
            continue
        name, _, val = item.partition("=")
        try:
            out[name.strip()] = float(val.strip())
        except ValueError:
            continue
    return out


SOURCE_TIMEOUT_OVERRIDES: Dict[str, float] = {
    **_DEFAULT_FAST_SOURCE_TIMEOUTS,
    **_parse_source_timeout_overrides(),
}


def source_timeout(name: str) -> float:
    """单源硬超时（秒）：有分级覆盖则用之，否则回退到全局 PER_SOURCE_TIMEOUT_SEC。"""
    return SOURCE_TIMEOUT_OVERRIDES.get(name, PER_SOURCE_TIMEOUT_SEC)

# 单次 enrich 调用（按源）的硬超时（秒）。enrich_paper 并发起
# semantic / openalex / crossref / europepmc 四个源任务（P1-2 + #685），每源各封顶；
# 单篇 enrich 四源全失败最坏 ≈ 此值而非串行的 4×。四源**完全平等并发**：谁先返回
# 非空摘要就用、立即取消其余（first-wins，#685 不再做源优先级 tiebreaker）。
# 默认 8s→5s（#685）：实测 Crossref/OpenAlex 正常响应 4-5s，5s 接得住正常响应、
# 又比 8s 更早放弃真挂起的源（缺摘要论文本就快源常没有，慢源 timeout 代价小）。
ENRICH_PER_SOURCE_TIMEOUT_SEC = float(
    os.getenv("PAPER_SEARCH_ENRICH_TIMEOUT_SEC", "5")
)

# 出版社页面摘要末位兜底（#685）：结构化四源全空且有 DOI 时，从 doi.org 跳转的
# 出版社页面只抽高置信 meta/JSON-LD 摘要。单次、无重试、硬超时。
# kill switch（默认开）：出问题可经 env 一键关掉抓取层。
PUBLISHER_HTML_ENABLED = os.getenv("PAPER_SEARCH_ENABLE_PUBLISHER_HTML", "1") != "0"
# 末位兜底硬超时（秒）：HTML 页面抖动大（实测 3-12s），best-effort，5s 接住常态、
# 不让兜底层主导延迟；丢了就回落"摘要不可获取"。
PUBLISHER_HTML_TIMEOUT_SEC = float(
    os.getenv("PAPER_SEARCH_PUBLISHER_HTML_TIMEOUT_SEC", "5")
)

# Snowball（引文追溯）深度硬上限（P0-4）。citation-explorer prompt 已约定
# depth=1，但服务端此前只硬限到 3，depth≥2 时 layer-1 的 30–40 个 id × 串行
# sleep 会让端到端冲到分钟级。这里默认硬限到 1，确需多跳时用
# PAPER_SEARCH_SNOWBALL_MAX_DEPTH 显式放开。
SNOWBALL_MAX_DEPTH = int(os.getenv("PAPER_SEARCH_SNOWBALL_MAX_DEPTH", "1"))

# Snowball 多 pid 之间的节流间隔（秒）。原实现对每个 pid 之间、以及同一 pid
# 的 backward/forward 之间各硬 sleep 1.5s；改为：同一 pid 的双向并发（不互等），
# 仅在「pid 与 pid 之间」保留一个可调间隔以尊重 Semantic Scholar 限速。
SNOWBALL_INTER_PID_SLEEP_SEC = float(
    os.getenv("PAPER_SEARCH_SNOWBALL_INTER_PID_SLEEP_SEC", "1.0")
)


# ──────────────────────────────────────────────────────────────
# 查询矩阵构建（Stage 3 / P0-3）—— "第 3 步:用关键词调 API" 的确定性内核
# ──────────────────────────────────────────────────────────────
# 把原 searcher 子 Agent 凭 prompt 自律拼的 keyword×source 矩阵下沉为代码，
# 编码线上 dump 的实测教训(详见 test_query_matrix.py)：
#   · arxiv 全文检索对多词短语命中差且有 3s/req 节流 → 只发少量宽查询(headline
#     关键词 + categories)，不盲发全部关键词；
#   · openalex/crossref 需要对象锚定 `<anchor> <term>` 才有命中 → 统一加对象锚；
#   · 不再对三源盲发笛卡尔积(run2 实测 18 查询里 9 个返回 0)。

# 默认每个 fast 源(openalex/crossref)最多发多少个关键词查询。
QUERY_MATRIX_PER_SOURCE_CAP = int(os.getenv("PAPER_SEARCH_QUERY_MATRIX_PER_SOURCE_CAP", "5"))
# arxiv 单独、更紧的上限(节流 + 多词短语低命中)。
QUERY_MATRIX_ARXIV_CAP = int(os.getenv("PAPER_SEARCH_QUERY_MATRIX_ARXIV_CAP", "2"))
# 多锚召回(spec B 选项):openalex/crossref 每个关键词对前 N 个最具体 object_term
# 各发一份锚版,降低"锚选谁"的单点敏感性。N 越大越稳但 cell 越多(每关键词 +N 条),
# 取 3 平衡稳定性与请求量(典型 object_terms ≤5,覆盖最具体的 3 个)。arxiv 不受此约束(单锚)。
QUERY_MATRIX_ANCHOR_CAP = int(os.getenv("PAPER_SEARCH_QUERY_MATRIX_ANCHOR_CAP", "3"))

# method_terms 有限并入召回 query 池(#617)：method_terms 原只参与 F22 打分与判分门槛,
# 不进召回。这里去重并入 keywords 池供召回(jackie A1 实验：扩 query 能补召回核心论文,
# 见 #612 §3.3/§5),但**最多额外并入 N 个**——全量并入会撑大 query matrix 拖慢检索。
QUERY_MATRIX_METHOD_TERMS_MAX_EXTRA = int(
    os.getenv("PAPER_SEARCH_QUERY_MATRIX_METHOD_TERMS_MAX_EXTRA", "4")
)
# 并入 method_terms 时把 per_source / arxiv cap 小幅上调(各 +2 / +1,见 build_query_matrix),
# 容纳新增关键词不被立刻截断；但封在以下**硬上限**内,防 query matrix 膨胀拖慢检索。
QUERY_MATRIX_PER_SOURCE_CAP_HARD = int(
    os.getenv("PAPER_SEARCH_QUERY_MATRIX_PER_SOURCE_CAP_HARD", "10")
)
QUERY_MATRIX_ARXIV_CAP_HARD = int(
    os.getenv("PAPER_SEARCH_QUERY_MATRIX_ARXIV_CAP_HARD", "5")
)

# 每条查询(关键词×源)向各源最多取回多少篇。映射到 OpenAlex per_page 等（≤200）；
# 调大只增大单次请求返回量、不增加请求次数（详见各连接器）。默认 10
# （调到 50 时候选池暴涨到数百篇、数百 venue，撑垮后台富化且稀释 LLM 判分窗口，故回退）。
RETRIEVE_MAX_RESULTS_PER_QUERY = int(os.getenv("PAPER_SEARCH_MAX_RESULTS_PER_QUERY", "10"))

# 自适应补源阈值（retrieve）：requested 源去重后不足此数且 sources 未含 arxiv 时，
# 追加一轮 arxiv 宽查询补召回——把旧 searcher H1「openalex+crossref 不足则补 arxiv」
# 的意图搬进代码（crossref 偶发空返回 / 覆盖不足时尤其重要）。
RETRIEVE_TOPUP_THRESHOLD = int(os.getenv("PAPER_SEARCH_RETRIEVE_TOPUP_THRESHOLD", "20"))

# 精确核心词全量召回（spec: lit-search-precise-core-exhaustion）：
# 对每个 object_term 额外加一条 OpenAlex title_exhaust cell——连接器先读 title.search
# 的 meta.count，≤ THRESHOLD 视为「精确核心词」拉全量（cursor 翻页，封顶 HARD_CAP），
# > THRESHOLD 视为泛词直接不抓。泛/核心由连接器运行时判定，矩阵保持纯函数/确定性。
# 广义 search= 与方法关键词仍维持 cap=10（不在此放量）。默认开启，可整体回退。
PRECISE_CORE_ENABLED = os.getenv("PAPER_SEARCH_PRECISE_CORE", "1") == "1"
PRECISE_CORE_COUNT_THRESHOLD = int(os.getenv("PAPER_SEARCH_PRECISE_CORE_THRESHOLD", "1000"))
PRECISE_CORE_HARD_CAP = int(os.getenv("PAPER_SEARCH_PRECISE_CORE_HARD_CAP", "1000"))
# exhaust cell 数量上限：规划层 LLM 给 6–8 个 object_terms 时，无上限会塞进同样多条
# 「25s 超时 × 最多 5 页」的 cell，检索尾延迟显著拉长。复用 _rank_object_anchors 的
# 具体度排序取前 N 个最具体的（与锚版 ANCHOR_CAP 同思路）；典型 object_terms ≤5，
# 默认 4 不伤常规场景、封住 LLM 发散的长尾。
PRECISE_CORE_TERM_CAP = int(os.getenv("PAPER_SEARCH_PRECISE_CORE_TERM_CAP", "4"))
# 全量召回需 cursor 翻多页（≤1000 篇 = 5 页 × ~3s/页），故单独放宽超时——不沿用
# openalex fast-path 的 8s（会把全量召回截断成空）。仅 title_exhaust cell 用此超时。
PRECISE_CORE_TIMEOUT_SEC = float(os.getenv("PAPER_SEARCH_PRECISE_CORE_TIMEOUT_SEC", "25"))

# 失败触发扩源（spec: lit-search-failure-source-expansion）：主力源失败后补打的备用源池。
# 死源 / 已请求源在 _pick_backup_sources 内过滤；semantic 仅在配了 API key 时纳入。
BACKUP_SOURCES_CAP = int(os.getenv("PAPER_SEARCH_BACKUP_SOURCES_CAP", "3"))
_GENERAL_BACKUP_SOURCES: tuple[str, ...] = ("doaj", "openaire")
# (领域关键词子串集合, 该领域优先备用源)；命中即排在通用源之前。
_DOMAIN_BACKUP_SOURCES: tuple[tuple[frozenset, tuple[str, ...]], ...] = (
    (frozenset({"bio", "medic", "clinical", "health", "life scien", "genom", "pharma"}),
     ("europepmc", "pmc", "pubmed")),
    (frozenset({"crypto", "security", "zero-knowledge", "mpc", "lattice"}),
     ("iacr",)),
)


def _failure_expansion_enabled() -> bool:
    """失败触发扩源默认 **关闭**（opt-in）。

    实测：自动扩源慢（多数备用源回落到 20s 默认超时 + 额外串行阶段）且备用源
    对通用查询质量差（见 spec §6/§9）。失败场景已由"失败重试 1 次 + 收尾如实上报
    + 用户触发重试主力源"体面覆盖，无需默认扩源。
    仅当 `PAPER_SEARCH_FAILURE_EXPANSION=1` 时开启（建议配了 semantic key 再开）。
    """
    return os.getenv("PAPER_SEARCH_FAILURE_EXPANSION", "0") == "1"


def _arxiv_topup_allowed(
    sources: list[str] | None,
    source_health: dict[str, dict],
) -> bool:
    """arxiv top-up 允许条件（#619）：
    - arxiv 不在 requested sources（原始路径）；或
    - arxiv 在 sources 但 verdict 为 failed/empty（扩展：arxiv 弱时也补抓）。
    distinct 阈值与 registry 可用性由调用方负责。
    """
    if "arxiv" not in (sources or []):
        return True
    arxiv_verdict = (source_health.get("arxiv") or {}).get("verdict")
    return arxiv_verdict in ("failed", "empty")


def _normalize_keywords(keywords: List[str]) -> List[str]:
    """去空白、丢空串、按出现顺序对大小写不敏感去重。"""
    seen: set[str] = set()
    out: List[str] = []
    for kw in keywords or []:
        k = (kw or "").strip()
        if not k:
            continue
        low = k.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(k)
    return out


def _merge_retrieval_terms(
    keywords: List[str],
    method_terms: Optional[List[str]],
    *,
    max_extra: int = QUERY_MATRIX_METHOD_TERMS_MAX_EXTRA,
) -> List[str]:
    """把 method_terms 有限并入召回关键词池(#617),返回去重保序的合并列表。

    与 keywords 大小写不敏感去重,最多额外并入 `max_extra` 个 method_term;keywords 里
    已有的 method_term 不重复并入(不占额度)。method_terms 原只用于 F22 打分,这里让它
    参与召回 query 补召回核心论文,但全量并入会撑大 query matrix 拖慢检索,故设额度上限。"""
    base = _normalize_keywords(keywords)
    methods = _normalize_keywords(method_terms or [])
    merged = list(base)
    seen = {kw.lower() for kw in merged}
    limit = len(base) + max(0, max_extra)
    for term in methods:
        if len(merged) >= limit:
            break
        low = term.lower()
        if low in seen:
            continue
        merged.append(term)
        seen.add(low)
    return merged


def _rank_object_anchors(object_terms: Optional[List[str]]) -> List[str]:
    """把 object_terms 按【具体度】降序排列(token 多者优先;并列保留规划层原序,
    主对象通常排第一),去空白 / 去重(大小写不敏感)。多锚召回用。

    旧设计只挑单个最具体锚,锚由规划层 LLM 现生成,两次采样(尤其中英文)给出的
    最长项不同 → 锚一换,【全部】锚版查询集体平移(乘数效应,见 spec)。改为多锚:
    每个关键词对前 N 个 object_term 各发一份锚版,锚的单点抖动只影响其中一份,
    且两次运行的锚集合重叠更多 → top_k 更稳。排序保证 cap 截断时优先保留最具体的。"""
    terms = _normalize_keywords(object_terms or [])  # 去空 + 大小写不敏感去重，保序
    # 稳定排序:token 多者优先;Python sort 稳定 → 同 token 数保留规划层原序
    return sorted(terms, key=lambda t: len(t.split()), reverse=True)


def _pick_object_anchor(object_terms: Optional[List[str]]) -> str:
    """单个对象锚(最具体)。arxiv 节流严格、只发少量宽查询,仍用单锚。
    其余源(openalex/crossref)走多锚 `_rank_object_anchors`。"""
    anchors = _rank_object_anchors(object_terms)
    return anchors[0] if anchors else ""


def build_query_matrix(
    keywords: List[str],
    *,
    sources: List[str],
    method_terms: Optional[List[str]] = None,
    object_terms: Optional[List[str]] = None,
    arxiv_categories: Optional[List[str]] = None,
    per_source_cap: int = QUERY_MATRIX_PER_SOURCE_CAP,
    arxiv_cap: int = QUERY_MATRIX_ARXIV_CAP,
    max_results: int = 10,
) -> List[Dict[str, Any]]:
    """把 (关键词, 源) 塑形成确定性的查询矩阵。

    返回 [{"source", "query", "max_results", "kwargs"}, ...]，已按源塑形 + 去重 +
    限量，可直接喂给 _async_search 并发 fan-out。规则见本节顶部注释 / 测试。
    """
    kws = _normalize_keywords(keywords)
    # method_terms 有限并入召回 query 池(#617)：去重合并(最多 +MAX_EXTRA 个)补召回,
    # 并把 per_source / arxiv cap 各小幅上调(封在 _HARD 硬上限内)容纳新增关键词。
    # method_terms 为空 / 未传时整段跳过 → query matrix 与现状逐 cell 一致(既有测试不回归)。
    if method_terms:
        kws = _merge_retrieval_terms(kws, method_terms)
        per_source_cap = min(per_source_cap + 2, QUERY_MATRIX_PER_SOURCE_CAP_HARD)
        arxiv_cap = min(arxiv_cap + 1, QUERY_MATRIX_ARXIV_CAP_HARD)
    if not kws:
        return []
    # 多锚(spec B):openalex/crossref 用前 N 个最具体 object_term 各发一份锚版;
    # arxiv 节流严格,仍用单个最具体锚(= anchors 的第一个)。
    anchors = _rank_object_anchors(object_terms)
    arxiv_anchor = anchors[0] if anchors else ""
    entries: List[Dict[str, Any]] = []
    seen_cells: set[tuple[str, str]] = set()

    def _add(
        source: str, query: str, kwargs: Dict[str, Any],
        *, max_results_override: Optional[int] = None,
    ) -> None:
        q = query.strip()
        if not q:
            return
        cell = (source, q.lower())
        if cell in seen_cells:
            return
        seen_cells.add(cell)
        entries.append({
            "source": source,
            "query": q,
            "max_results": max_results if max_results_override is None else max_results_override,
            "kwargs": kwargs,
        })

    for source in sources or []:
        if source == "arxiv":
            # 锚版优先(2b):arxiv 全文宽匹配,裸泛关键词(如 "deep learning")会撞大量
            # 跨域论文(ReLU 理论 / NeRF 等)。有对象锚且 kw 未含锚时发锚版 `<anchor> <kw>`
            # 收紧到对题域;无锚或 kw 已含锚则退回裸版。数量受 arxiv_cap 限,带 categories。
            kwargs: Dict[str, Any] = {}
            if arxiv_categories:
                kwargs["categories"] = list(arxiv_categories)
            for kw in kws[:max(0, arxiv_cap)]:
                if arxiv_anchor and arxiv_anchor.lower() not in kw.lower():
                    _add("arxiv", f"{arxiv_anchor} {kw}", dict(kwargs))
                else:
                    _add("arxiv", kw, dict(kwargs))
        else:
            # openalex / crossref / 其它:每个关键词发「裸关键词」+【多锚版】。
            # 裸版保召回(弱锚时兜底);锚版 `<anchor> <kw>` 保精度(命中 method+object
            # 共现,F22 更高)。多锚(spec B):对前 ANCHOR_CAP 个最具体 object_term 各发
            # 一份,降低"锚选谁"的单点敏感性——锚的单点抖动只影响其中一份锚版,而非全部。
            # 防冗余:关键词已含某锚词(如 "differential privacy" 含 "privacy")则跳过该锚版,
            # 避免 "privacy privacy-preserving" / "LLM LLM context" 这类重复。
            for kw in kws[:max(0, per_source_cap)]:
                _add(source, kw, {})
                for anc in anchors[:max(0, QUERY_MATRIX_ANCHOR_CAP)]:
                    if anc.lower() not in kw.lower():
                        _add(source, f"{anc} {kw}", {})

    # 精确核心词全量召回：给每个 object_term 追加一条 OpenAlex title_exhaust cell。
    # 泛/核心由连接器按 meta.count 运行时判定（见 OpenAlexConnector._fetch_title_exhaust）；
    # 矩阵这里只负责"加 cell"，保持纯函数。同 query 的既有 openalex 裸 cell 被顶替
    # （exhaust 更全；泛词时连接器返回第 1 页前 generic_fallback 篇兜底，与裸 cell 的
    # title-first @cap 等价，不会召回归零）。数量受 TERM_CAP 封顶（最具体优先），
    # 防 LLM 给出过多 object_terms 时尾延迟失控。
    if PRECISE_CORE_ENABLED and "openalex" in (sources or []):
        core_terms = _rank_object_anchors(object_terms)[:max(0, PRECISE_CORE_TERM_CAP)]
        for term in core_terms:
            low = term.lower()
            # 顶替同 query 的既有 openalex 裸 cell
            entries[:] = [
                e for e in entries
                if not (e["source"] == "openalex" and e["query"].lower() == low)
            ]
            seen_cells.discard(("openalex", low))
            _add(
                "openalex",
                term,
                {
                    "mode": "title_exhaust",
                    "core_threshold": PRECISE_CORE_COUNT_THRESHOLD,
                    "generic_fallback": max_results,
                },
                max_results_override=PRECISE_CORE_HARD_CAP,
            )
    return entries


class SourceStatus:
    """HTTP-level outcome for a single source search."""

    __slots__ = ("http_status", "ok", "error")

    def __init__(self, http_status: int = 200, ok: bool = True, error: str = ""):
        self.http_status = http_status
        self.ok = ok
        self.error = error

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"http_status": self.http_status, "ok": self.ok}
        if self.error:
            d["error"] = self.error
        return d


class PaperSearchService:
    def __init__(self, registry: Optional[ConnectorRegistry] = None):
        self.registry = registry or ConnectorRegistry()

    def available_sources(self) -> List[str]:
        return self.registry.all_names()

    async def search(
        self,
        query: str,
        sources: str = "all",
        max_results_per_source: int = 5,
        year: Optional[str] = None,
    ) -> SearchResult:
        if not query or not query.strip():
            return SearchResult(
                query=query or "",
                sources_requested=sources,
                errors={"query": "Query string is empty."},
            )

        selected = self._parse_sources(sources)
        if not selected:
            return SearchResult(
                query=query,
                sources_requested=sources,
                errors={"sources": "No valid sources selected."},
            )

        task_map: Dict[str, asyncio.Task] = {}
        for name in selected:
            connector = self.registry.get(name)
            if connector is None:
                continue
            kwargs: Dict[str, Any] = {}
            if year and name == "semantic":
                kwargs["year"] = year
            task_map[name] = asyncio.ensure_future(
                self._timed_search(
                    name, connector, query, max_results_per_source,
                    timeout=source_timeout(name), **kwargs,
                )
            )

        source_names = list(task_map.keys())
        outputs = await asyncio.gather(*task_map.values(), return_exceptions=True)

        source_results: Dict[str, int] = {}
        source_timings: Dict[str, int] = {}
        source_status: Dict[str, Dict[str, Any]] = {}
        errors: Dict[str, str] = {}
        merged: List[Paper] = []

        for name, output in zip(source_names, outputs):
            if isinstance(output, Exception):
                errors[name] = str(output)
                source_results[name] = 0
                source_status[name] = SourceStatus(
                    http_status=0, ok=False, error=str(output),
                ).to_dict()
                continue
            papers, elapsed_ms, status = output
            source_results[name] = len(papers)
            source_timings[name] = elapsed_ms
            source_status[name] = {**status.to_dict(), "elapsed_ms": elapsed_ms}
            if not status.ok:
                errors[name] = status.error
            for paper in papers:
                if not paper.source:
                    paper.source = name
                merged.append(paper)

        deduped = self._dedupe_papers(merged)

        # Log per-source timing breakdown
        total_wall_ms = sum(source_timings.values())
        slowest = max(source_timings.items(), key=lambda x: x[1]) if source_timings else ("n/a", 0)
        logger.info(
            "[perf] search completed: query=%r sources=%d papers=%d "
            "slowest=%s(%dms) total_wall=%dms timings=%s",
            query, len(source_names), len(deduped),
            slowest[0], slowest[1], total_wall_ms,
            {k: f"{v}ms" for k, v in sorted(source_timings.items(), key=lambda x: -x[1])},
        )

        return SearchResult(
            query=query,
            sources_requested=sources,
            sources_used=source_names,
            source_results=source_results,
            errors=errors,
            papers=deduped,
            total=len(deduped),
            raw_total=len(merged),
            source_timings=source_timings,
            source_status=source_status,
        )

    async def _fanout_cells(
        self,
        cells: List[Dict[str, Any]],
        on_source_done: Optional[OnSourceDone] = None,
    ) -> tuple[Dict[str, List[Paper]], Dict[str, Dict[str, Any]]]:
        """并发跑一批 query-matrix cells，返回 (by_source, source_health)。

        source_health[name] = {"verdict": "ok"|"empty"|"failed",
                                "http_status": int, "error": str}：
        - ok     ：该源至少返回 1 篇；
        - failed ：0 篇且至少一个 cell ok=False（超时 / 非 200 / 错误）；
        - empty  ：0 篇且所有 cell ok=True（204 真空，确无匹配）。
        单格连接器缺失 / 异常 → 跳过（不抛）。供首轮 fan-out、失败源重试、
        arxiv 补源三处共用同一执行路径。

        on_source_done：可选的单 cell 完成回调（live 进度流式上报）。回调
        在 gather 等待全部 cell 期间逐个触发；自身异常被吞掉只 warn，
        不影响检索主流程。默认 None 时行为与历史完全一致。
        """
        async def _one(cell: Dict[str, Any]) -> tuple[str, List[Paper], SourceStatus]:
            name = cell["source"]
            connector = self.registry.get(name)
            if connector is None:
                return name, [], SourceStatus(http_status=0, ok=False, error="connector_missing")
            # 精确核心词全量召回（title_exhaust）需翻多页，用更长超时；其余沿用分级超时。
            cell_timeout = (
                PRECISE_CORE_TIMEOUT_SEC
                if cell["kwargs"].get("mode") == "title_exhaust"
                else source_timeout(name)
            )
            papers, _elapsed, status = await self._timed_search(
                name, connector, cell["query"], cell["max_results"],
                timeout=cell_timeout, **cell["kwargs"],
            )
            if on_source_done is not None:
                try:
                    on_source_done(name, papers, status.ok)
                except Exception as e:
                    logger.warning("[fan-out] on_source_done 回调失败（忽略）: %s", e)
            return name, papers, status

        results = await asyncio.gather(
            *[_one(c) for c in cells], return_exceptions=True
        )
        by_source: Dict[str, List[Paper]] = {}
        agg: Dict[str, Dict[str, Any]] = {}  # 每源是否有 cell 失败 + 代表性错误
        for r in results:
            if isinstance(r, Exception):
                continue
            name, papers, status = r
            by_source.setdefault(name, []).extend(papers)
            a = agg.setdefault(name, {"failed": False, "http_status": 0, "error": ""})
            if not status.ok and not a["failed"]:
                a["failed"] = True
                a["http_status"] = status.http_status
                a["error"] = status.error
        source_health: Dict[str, Dict[str, Any]] = {}
        for name, a in agg.items():
            if by_source.get(name):
                verdict = "ok"
            elif a["failed"]:
                verdict = "failed"
            else:
                verdict = "empty"
            source_health[name] = {
                "verdict": verdict,
                "http_status": a["http_status"],
                "error": a["error"],
            }
        return by_source, source_health

    async def _fanout_with_single_retry(
        self,
        matrix: List[Dict[str, Any]],
        sources: List[str],
        on_source_done: Optional[OnSourceDone] = None,
    ) -> tuple[Dict[str, List[Paper]], Dict[str, Dict[str, Any]], List[str]]:
        """首轮 fan-out + 对「失败」(verdict=failed) 的源做 **恰好一次** 重试。

        返回 `(by_source, source_health, failed_sources)`。重试边界（硬约束）：
        - 只重「首轮 verdict=failed」的源（超时 / 非 200 / 错误）；
          **真空（204, verdict=empty）不重 —— 0 数据不重试**。
        - 每个失败源 **恰好重 1 次**，绝不二次重试 —— 无循环、调用次数有上界。
        - failed_sources = 重试后仍 verdict=failed 的请求源，供上层上报 + 用户触发补救。
        """
        by_source, health = await self._fanout_cells(matrix, on_source_done)
        failed_first = [s for s in sources if health.get(s, {}).get("verdict") == "failed"]
        if failed_first:
            retry_cells = [c for c in matrix if c["source"] in failed_first]
            if retry_cells:
                retry_by_source, retry_health = await self._fanout_cells(retry_cells, on_source_done)
                for name, papers in retry_by_source.items():
                    by_source.setdefault(name, []).extend(papers)
                for name in failed_first:  # 重试结果覆盖这些源的最终判定
                    if name in retry_health:
                        health[name] = retry_health[name]
        failed_sources = [
            s for s in sources if health.get(s, {}).get("verdict") == "failed"
        ]
        return by_source, health, failed_sources

    def _pick_backup_sources(
        self,
        requested: Optional[List[str]],
        domains: Optional[List[str]],
        cap: int = BACKUP_SOURCES_CAP,
    ) -> List[str]:
        """失败触发扩源的备用源选择（无网络 IO，易测）。

        优先级：领域专用源（按 domains 子串命中）→ semantic（仅当配了 API key）→
        通用 doaj/openaire。过滤：已在 requested 里的源、registry 不可用 / 死源
        （registry.get 返回 None）。去重后按优先级取前 cap 个。
        """
        requested_set = {s.lower() for s in (requested or [])}
        doms_blob = " ".join(d.lower() for d in (domains or []))
        ordered: List[str] = []
        for keys, srcs in _DOMAIN_BACKUP_SOURCES:
            if any(k in doms_blob for k in keys):
                ordered.extend(srcs)
        if os.getenv("PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY"):
            ordered.append("semantic")
        ordered.extend(_GENERAL_BACKUP_SOURCES)

        picked: List[str] = []
        seen: set = set()
        for s in ordered:
            if s in seen or s in requested_set:
                continue
            seen.add(s)
            if self.registry.get(s) is None:  # 死源 / 未注册 → 跳过
                continue
            picked.append(s)
            if len(picked) >= cap:
                break
        return picked

    async def retrieve(
        self,
        research_question: str,
        keywords: List[str],
        *,
        sources: Optional[List[str]] = None,
        method_terms: Optional[List[str]] = None,
        object_terms: Optional[List[str]] = None,
        arxiv_categories: Optional[List[str]] = None,
        domains: Optional[List[str]] = None,
        max_results_per_query: int = RETRIEVE_MAX_RESULTS_PER_QUERY,
        top_k: int = TOPK_CAP,
        enrich: bool = True,
        session_id: Optional[str] = None,
        config_dir: Optional[str] = None,
        turn_id: Optional[str] = None,
        required_seeds: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """Stage 3 确定性检索:塑形查询矩阵 → 并发 fan-out → 去重/enrich/F22 → 返回 top-K。

        取代原 searcher 子 Agent:整条"第 3+4+5a 步"无 LLM 决策、无长报告回吐,
        可复现 / 可测 / 可缓存。返回 process_search_results 的全部统计字段(计数语义
        保持兼容)+ `top_k`(按 F22 relevance 降序的 slim 列表,供下游 LLM rerank)。
        """
        sources = sources or ["openalex", "crossref", "arxiv"]
        # 机构自有 journal 语料：连接器已注册（=已登录、token 已注入）时，无论上游 planner
        # 传入哪些 sources 都自动并入，确保登录态下每次检索都覆盖 journal（spec §2.6）；
        # 未登录则未注册、自然缺席。去重避免重复。
        if self.registry.get("journal") is not None and "journal" not in sources:
            sources = [*sources, "journal"]
        # method_terms 有限并入主召回矩阵(#617)。失败扩源 / arxiv top-up 两条**条件**
        # 兜底矩阵仍只用 base keywords：它们是低召回 / 失败场景的补召回,保持原塑形语义,
        # 不在本 issue 扩展范围内(避免在低召回场景再叠加 method_terms 复杂化)。
        matrix = build_query_matrix(
            keywords,
            sources=sources,
            method_terms=method_terms,
            object_terms=object_terms,
            arxiv_categories=arxiv_categories,
            max_results=max_results_per_query,
        )
        if not matrix:
            return {"error": "empty query matrix (no usable keywords)"}

        # turn_id 前移到 fan-out 之前生成（原在 process_results_core 内部）：
        # live 进度文件需要在检索期间就带上本轮 turn_id，前端才能判断
        # "canonical 是否已覆盖本轮"。process_results_core 收到非空 turn_id 时复用。
        if not turn_id:
            turn_id = uuid.uuid4().hex
        # session_id 提前解析（与 process_results_core 同语义）；为空时 LiveProgress
        # 自动 no-op，且 process_results_core 会照常返回 error，行为不变。
        if not session_id:
            session_id = os.environ.get("ASCI_SESSION_ID", "")

        # live 进度：每个 cell 一返回就原子写 {session_id}.live.json，
        # Electron 监听后推给右侧面板流式渲染。增强路径，失败不影响检索。
        live = LiveProgress(
            session_id=session_id,
            turn_id=turn_id,
            requested_sources=sources,
            config_dir=config_dir,
        )
        try:
            return await self._retrieve_inner(
                research_question=research_question,
                keywords=keywords,
                sources=sources,
                method_terms=method_terms,
                object_terms=object_terms,
                arxiv_categories=arxiv_categories,
                domains=domains,
                max_results_per_query=max_results_per_query,
                top_k=top_k,
                enrich=enrich,
                session_id=session_id,
                config_dir=config_dir,
                turn_id=turn_id,
                matrix=matrix,
                live=live,
                required_seeds=required_seeds,
            )
        finally:
            # 成功或异常都清理 live 文件，canonical JSONL（若已写）接管展示
            live.finalize()

    async def _retrieve_inner(
        self,
        *,
        research_question: str,
        keywords: List[str],
        sources: List[str],
        method_terms: Optional[List[str]],
        object_terms: Optional[List[str]],
        arxiv_categories: Optional[List[str]],
        domains: Optional[List[str]],
        max_results_per_query: int,
        top_k: int,
        enrich: bool,
        session_id: Optional[str],
        config_dir: Optional[str],
        turn_id: str,
        matrix: List[Dict[str, Any]],
        live: LiveProgress,
        required_seeds: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """retrieve 主体（由 retrieve() 包 try/finally 保证 live 清理）"""
        # 过滤未注册的连接器（如 journal 在未登录时未实例化）：
        # 与 search() ~:440 和 _pick_backup_sources() ~:635 的同款 idiom 一致。
        # 未注册源在矩阵 / fan-out 中会产生 connector_missing 伪失败，违反 spec §2.6。
        # 在进 fan-out 前一次过滤即可：同时覆盖主矩阵、失败重试、arxiv top-up 三条路径
        # （重试和 top-up 都从这两个变量派生 cells，不需要再单独过滤）。
        registered_sources = [s for s in sources if self.registry.get(s) is not None]
        if len(registered_sources) < len(sources):
            skipped = [s for s in sources if self.registry.get(s) is None]
            logger.debug("[retrieve] 未注册连接器（静默跳过，不计为失败）: %s", skipped)
        registered_matrix = [c for c in matrix if c["source"] in registered_sources]

        # 首轮并发 fan-out（openalex/crossref 秒回不被 arxiv 节流拖累）
        # + 失败源单次重试（边界见 _fanout_with_single_retry 文档；真空不重）
        by_source, source_health, failed_sources = await self._fanout_with_single_retry(
            registered_matrix, registered_sources, on_source_done=live.on_source_done
        )
        if failed_sources:
            logger.warning(
                "[retrieve] 源最终失败（已自动重试 1 次仍失败）: %s", failed_sources,
            )

        # 失败触发扩源（spec: lit-search-failure-source-expansion）：主力源重试后仍
        # 失败 → 打一轮备用源补缺。**默认关闭**（opt-in，见 _failure_expansion_enabled：
        # 慢 + 备用源质量差）。开启时：仅 failed_sources 非空触发（真空 / 0 数据不扩）、
        # 一轮、不递归、备用源不再单独重试；放在 arxiv_top_up 之前使 distinct 反映扩源后量。
        failure_expansion: Dict[str, Any] = {"triggered": False, "sources": [], "added": 0}
        if failed_sources and _failure_expansion_enabled():
            backups = self._pick_backup_sources(sources, domains)
            if backups:
                backup_matrix = build_query_matrix(
                    keywords, sources=backups, object_terms=object_terms,
                    arxiv_categories=arxiv_categories, max_results=max_results_per_query,
                )
                if backup_matrix:
                    backup_by_source, _bh = await self._fanout_cells(
                        backup_matrix, live.on_source_done
                    )
                    added = sum(len(v) for v in backup_by_source.values())
                    for name, papers in backup_by_source.items():
                        by_source.setdefault(name, []).extend(papers)
                    failure_expansion = {
                        "triggered": True, "sources": backups, "added": added,
                    }
                    logger.warning(
                        "[retrieve] 失败触发扩源: failed=%s → backups=%s, +%d papers",
                        failed_sources, backups, added,
                    )

        # 自适应补源（H1 top-up 的代码化）：去重后不足阈值、arxiv 连接器可用，且满足
        # _arxiv_topup_allowed（arxiv 不在 sources，或在 sources 但 verdict=failed/empty）
        # 时，追加一轮 arxiv 宽查询补召回。一次性并入同一 process_results_core，避免二次
        # enrich/score。扩展动机见 #619：OpenAlex 429 叠加 arxiv 自身失败/空时，避免检索
        # 退化成 Crossref-heavy。
        arxiv_topped_up = False
        topup_matrix: List[Dict[str, Any]] = []
        flat = [p for ps in by_source.values() for p in ps]
        distinct = len(self._dedupe_papers(flat))
        if (
            distinct < RETRIEVE_TOPUP_THRESHOLD
            and _arxiv_topup_allowed(sources, source_health)
            and self.registry.get("arxiv") is not None
        ):
            topup_matrix = build_query_matrix(
                keywords,
                sources=["arxiv"],
                object_terms=object_terms,
                arxiv_categories=arxiv_categories,
                max_results=max_results_per_query,
            )
            if topup_matrix:
                topup_by_source, _topup_health = await self._fanout_cells(
                    topup_matrix, live.on_source_done
                )
                for name, papers in topup_by_source.items():
                    by_source.setdefault(name, []).extend(papers)
                arxiv_topped_up = True
                reason = (
                    "arxiv-weak"
                    if "arxiv" in (sources or [])
                    else "arxiv-not-requested"
                )
                logger.info(
                    "[retrieve] arxiv top-up fired (%s): distinct=%d < %d, "
                    "added %d arxiv queries",
                    reason, distinct, RETRIEVE_TOPUP_THRESHOLD, len(topup_matrix),
                )

        # required_seeds (#614)：把 planner / 用户指定的核心论文精确查回并 force include
        # 进候选池。串行逐 seed 解析（seed 通常 1-5 个），单源异常隔离在 _resolve_seed 内部。
        # 仅在传了 required_seeds 时触发；不传时 seed_recall 保持 None、行为与改动前一致。
        seed_recall: Optional[Dict[str, Any]] = None
        seed_keys: set[str] = set()
        if required_seeds:
            seed_recall, seed_keys = await self._force_include_seeds(
                required_seeds, by_source
            )

        inputs = [
            {"source": name, "papers": [p.to_api_dict() for p in papers]}
            for name, papers in by_source.items()
        ]

        # fan-out 结束，进入去重 / enrich / 打分阶段（面板显示"正在去重与补全摘要"）
        live.set_phase("processing")

        from .process_service import process_results_core  # 延迟导入避免循环
        stats = await process_results_core(
            query=research_question,
            inputs=inputs,
            enrich=enrich,
            session_id=session_id,
            config_dir=config_dir,
            method_terms=method_terms,
            object_terms=object_terms,
            turn_id=turn_id,
            return_records=True,
            seed_keys=seed_keys or None,
        )
        records = stats.pop("records", []) if isinstance(stats, dict) else []

        def _rel(rec: Dict[str, Any]) -> float:
            v = (rec.get("extra") or {}).get("relevance")
            return float(v) if isinstance(v, (int, float)) else 0.0

        # required_seeds (#615)：forced seed = 已 verified 的核心论文。判定优先看
        # process_results_core 打的 extra.seed=true；再用本轮 seed_keys 兜底（按 #614 同款
        # normalize_doi / html.unescape 归一，多救一类 doi.org 前缀等形态差异的漏标）。
        # 不传 required_seeds 时 seed_keys 为空 → 恒 False，门控行为与改动前完全一致。
        def _is_forced_seed(rec: Dict[str, Any]) -> bool:
            if (rec.get("extra") or {}).get("seed"):
                return True
            if not seed_keys:
                return False
            doi = normalize_doi(rec.get("doi") or "")
            title = html.unescape((rec.get("title") or "").strip()).strip().lower()
            return bool((doi and doi in seed_keys) or (title and title in seed_keys))

        # 进入 LLM scorer 判分窗口的论文 = F22 relevance 高于阈值（默认 >50）的动态集合，
        # 而非固定前 top_k。绝对分数阈值避免"对题论文多时被排名截断挤出 / 少时硬凑数量
        # 把噪声拉进判分"。top_k 退化为防爆上限（默认 TOPK_CAP=120）：F22>50 可能随召回
        # 波动到 200+ 篇，超出按 F22 降序截断并 log 告知，防 LLM 成本失控。
        # forced seed（#615）绕过 F22 门：核心论文"进了大池但 F22 低被截断"等价于没检索到。
        qualified = [
            r for r in sorted(records, key=_rel, reverse=True)
            if _rel(r) > TOPK_F22_THRESHOLD or _is_forced_seed(r)
        ]
        cap = max(0, top_k)
        if len(qualified) > cap:
            # 超 cap 截断时 seed 优先保留（#615 AC）：先放全部 seed（保持 F22 降序），
            # 剩余配额按 F22 降序填非 seed。被截断的只会是非 seed 低分论文。
            seeds_q = [r for r in qualified if _is_forced_seed(r)]
            rest_q = [r for r in qualified if not _is_forced_seed(r)]
            ranked = (seeds_q + rest_q)[:cap]
            logger.info(
                "[retrieve] F22>%.0f 或 seed 命中 %d 篇（含 seed %d），超 cap=%d 截断 %d 篇非 seed",
                TOPK_F22_THRESHOLD, len(qualified), len(seeds_q), cap, len(qualified) - len(ranked),
            )
        else:
            ranked = qualified
        # top_k 不含 abstract：返回值只用于 (a) bench 算 recall（靠 handle/relevance）、
        # (b) searcher 读计数。完整摘要在 session JSONL 里（scorer 从那读，
        # 不读本返回值）。内联 50 篇摘要会把返回撑到 ~66KB、触发 SDK「输出过大→落盘」，
        # 逼 searcher 多发 4-5 次 Bash 去解析自己的输出。去掉 abstract → ~7KB、不落盘。
        stats["top_k"] = [
            {
                "handle": (rec.get("extra") or {}).get("paper_id")
                or rec.get("doi") or rec.get("url") or "",
                "title": rec.get("title") or "",
                "year": rec.get("year"),
                "venue": rec.get("venue") or "",
                "relevance": _rel(rec),
            }
            for rec in ranked
        ]
        stats["query_matrix_size"] = len(matrix) + len(topup_matrix)
        stats["arxiv_top_up"] = arxiv_topped_up
        # 每源最终健康度（ok/empty/failed）+ 自动重试后仍失败的请求源。
        # 供 searcher / master 在搜索阶段结束后向用户上报失败平台并提供再检索补救。
        # 注：真空(empty/0 数据)不计入 failed_sources —— 0 数据不提示重试。
        stats["source_health"] = source_health
        stats["failed_sources"] = failed_sources
        # 失败触发扩源结果（triggered / 用了哪些备用源 / 补了多少篇），供上报。
        stats["failure_expansion"] = failure_expansion

        # required_seeds (#614)：seed 召回元数据。verified/total < 阈值（默认 0.8）→
        # incomplete_retrieval=true，仅观测、不阻断下游（附件 §4.5 / §8.4）。仅在传了
        # required_seeds 时附加，不传时返回结构与改动前完全一致（向后兼容）。
        # #646：total/verified 只统计 user-named 队列，proactive(origin=model) 不计入，
        # 故纯 proactive 检索 total=0 → incomplete_retrieval=false，幻觉不误报不完整。
        if seed_recall is not None:
            total = seed_recall["total"]
            verified = seed_recall["verified"]
            stats["seed_recall"] = seed_recall
            stats["incomplete_retrieval"] = (
                total > 0 and (verified / total) < SEED_RECALL_THRESHOLD
            )

        # 后台异步富化（venue 反查正刊 + 本地分区/IF）：不阻塞返回，结果秒出；
        # 任务回写 JSONL 后，面板 5s 轮询自动反映。MCP 进程常驻，任务能跑完。
        from .process_service import spawn_session_enrich
        spawn_session_enrich(stats.get("output_path"), stats.get("turn_id"))

        return stats

    # ===== required_seeds (#614)：核心论文精确查回 + force include =====

    async def _force_include_seeds(
        self,
        seeds: List[Dict[str, str]],
        by_source: Dict[str, List[Paper]],
    ) -> tuple[Dict[str, Any], set[str]]:
        """逐个解析 seed 并 force include 进候选池，返回 (seed_recall, seed_keys)。

        按 seed 的 origin（#646）分两类处理：

        user-named（origin="user"，默认）—— 用户显式点名：
        - high-confidence 命中（doi / exact_title / arxiv_id）→ verified++，并把该篇的
          归一 DOI 与 title 加入 seed_keys，供 process_results_core 标 extra.seed=true。
        - fuzzy_title 命中 → 只并入池、计 fuzzy，不进 seed_keys、不标 seed（附件 §4.2）。
        - 全源查不到 → 计入 missing。

        planner-proactive（origin="model"）—— planner 主动回忆的奠基论文（防线 1/2/3）：
        - 服务端强制 title-only（忽略 id，幻觉 id 零危害）+ exact-only（不接 fuzzy）。
        - 命中 → proactive_verified++，同样进 seed_keys / 标 seed，享 force-include 全套保护。
        - 查不到 → 静默跳过，不进 missing、不影响 incomplete_retrieval（防线 3）。

        seed_recall 的 verified/fuzzy/total/missing 只统计 user 队列，使 incomplete_retrieval
        语义不变；proactive_verified/proactive_total 仅供观测（不进用户可见路径）。

        串行逐 seed（seed 通常 1-10 个）；单源异常隔离在 _resolve_seed 内部完成。
        """
        import html

        verified = 0
        fuzzy = 0
        missing: List[str] = []
        seed_keys: set[str] = set()
        proactive_verified = 0
        proactive_total = 0

        def _mark(paper: Paper) -> None:
            doi = normalize_doi(paper.doi or "")
            # title 与 to_paper_record 一致地 html.unescape + lower，确保标记阶段比得中
            title = html.unescape((paper.title or "").strip()).strip().lower()
            if doi:
                seed_keys.add(doi)
            if title:
                seed_keys.add(title)

        for seed in seeds:
            is_model = (seed.get("origin") or "user").lower() == "model"
            if is_model:
                proactive_total += 1
                title = (seed.get("title") or "").strip()
                # 防线 1/2 兜底：model seed 一律 title-only + exact-only，幻觉 id 不采纳
                resolved = (
                    await self._resolve_seed({"id": "", "title": title}, exact_only=True)
                    if title
                    else None
                )
            else:
                resolved = await self._resolve_seed(seed)

            if resolved is None:
                if not is_model:  # 防线 3：proactive miss 静默，不计入 missing
                    missing.append(seed.get("id") or seed.get("title") or "")
                continue

            paper, strategy = resolved
            # force include：按 paper 的来源源分组并入；process_results_core 会按
            # record_key 与正常 fan-out 结果统一去重。
            by_source.setdefault(paper.source or "seed", []).append(paper)
            if strategy == "fuzzy_title":
                # exact_only 保证 model 不会走到这；只有 user 队列会 fuzzy 命中
                fuzzy += 1
                continue
            # 两类 verified 都进 seed_keys → extra.seed=true + F22 绕过 + scorer 窗口
            _mark(paper)
            if is_model:
                proactive_verified += 1
            else:
                verified += 1

        seed_recall = {
            "verified": verified,
            "fuzzy": fuzzy,
            "total": len(seeds) - proactive_total,  # 仅 user 队列，驱动 incomplete_retrieval
            "missing": missing,
            "proactive_verified": proactive_verified,
            "proactive_total": proactive_total,
        }
        return seed_recall, seed_keys

    async def _resolve_seed(
        self, seed: Dict[str, str], *, exact_only: bool = False
    ) -> Optional[tuple[Paper, str]]:
        """把一个 {id,title} seed 精确查回成 (Paper, strategy)，查不到返回 None。

        三阶段（附件 §4.2.1）：
          1. 身份级 DOI 查回（openalex → crossref search → Crossref /works/{doi} 直连）→ "doi"
          2. exact / near-exact title（openalex + crossref）→ "exact_title" / "fuzzy_title"
          3. arXiv 兜底（按 arxiv id 查）→ "arxiv_id"

        exact_only（#646 防线 2）：True 时阶段 2 只接受 exact_title，跳过 fuzzy 回退。
        供 planner 主动回忆的 seed（origin="model"）使用——幻觉标题宁可查不到也不近似命中错论文。

        关键：每个源调用各自隔离（_try_search / _try_crossref_by_doi 内部吞错），
        一源 429 / 超时只跳过该源，不连累其余源与后续阶段。外层 try/except 仅兜
        _normalize_title 等非预期异常，正常单源异常都在 helper 内部隔离。
        """
        from .process_service import _normalize_title, _titles_likely_same

        async def _try_search(src: str, q: str, n: int) -> List[Paper]:
            """单源 search，bounded + 逐源独立吞错。一源失败 / 429 / 超时不连累其余源。"""
            conn = self.registry.get(src)
            if conn is None or not q:
                return []
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(conn.search, q, max_results=n),
                    timeout=source_timeout(src),
                )
                return result or []
            except Exception as exc:
                logger.debug("seed resolve %s search failed for %r: %s", src, q, exc)
                return []

        async def _try_crossref_by_doi(d: str) -> Optional[Paper]:
            """Crossref /works/{doi} 直连按 DOI 精确查回；OpenAlex 限流时 DOI seed 的主力 fallback。"""
            conn = self.registry.get("crossref")
            getter = getattr(conn, "get_paper_by_doi", None) if conn is not None else None
            if getter is None:
                return None
            try:
                return await asyncio.wait_for(
                    asyncio.to_thread(getter, d),
                    timeout=source_timeout("crossref"),
                )
            except Exception as exc:
                logger.debug("seed resolve crossref get_by_doi failed for %r: %s", d, exc)
                return None

        seed_id = (seed.get("id") or "").strip()
        title = (seed.get("title") or "").strip()
        lid = seed_id.lower()

        # seed.id 解析：arxiv: / pmid: 前缀，或 doi:/裸 DOI。pmid 身份级查回不在 #614
        # 范围（AC 三阶段只列 DOI/title/arXiv），靠 title/doi 兜底。
        candidate_dois: List[str] = []
        arxiv_id = ""
        if lid.startswith("arxiv:"):
            arxiv_id = seed_id.split(":", 1)[1].strip()
        elif lid.startswith("pmid:"):
            pass
        else:
            nd = normalize_doi(seed_id)  # 剥 doi: / https://doi.org/ 前缀
            if nd.startswith("10."):
                candidate_dois.append(nd)

        try:
            # 阶段 1：身份级 DOI 查回（high confidence）
            for d in candidate_dois:
                for src in ("openalex", "crossref"):
                    papers = await _try_search(src, d, 1)
                    if papers and normalize_doi(papers[0].doi or "") == d:
                        return papers[0], "doi"
                cr = await _try_crossref_by_doi(d)
                if cr is not None and normalize_doi(cr.doi or "") == d:
                    return cr, "doi"

            # 阶段 2：exact / near-exact title
            if title:
                want_norm = _normalize_title(title)
                fuzzy_hit: Optional[Paper] = None
                for src in ("openalex", "crossref"):
                    papers = await _try_search(src, title, 3)
                    for p in papers:
                        cand_norm = _normalize_title(p.title)
                        if want_norm and cand_norm == want_norm:
                            return p, "exact_title"
                        if (
                            not exact_only
                            and fuzzy_hit is None
                            and _titles_likely_same(want_norm, cand_norm)
                        ):
                            fuzzy_hit = p
                if fuzzy_hit is not None:
                    return fuzzy_hit, "fuzzy_title"

            # 阶段 3：arXiv 兜底
            if arxiv_id:
                papers = await _try_search("arxiv", arxiv_id, 1)
                if papers:
                    return papers[0], "arxiv_id"
        except Exception as exc:
            logger.debug("seed resolve unexpected error for %r: %s", seed, exc)

        return None

    async def snowball(
        self,
        paper_id: str,
        direction: str = "both",
        max_results_per_direction: int = 20,
        depth: int = 1,
    ) -> SnowballResult:
        depth = min(max(depth, 1), SNOWBALL_MAX_DEPTH)
        semantic = self.registry.get("semantic")
        if semantic is None:
            return SnowballResult(
                seed_paper_id=paper_id,
                direction=direction,
                depth=depth,
                errors=["Semantic Scholar connector not available"],
            )

        all_papers: List[Paper] = []
        visited: set[str] = set()
        current_ids = [paper_id]
        layer_errors: List[str] = []

        async def _fetch_pid(layer: int, pid: str) -> tuple[List[Paper], List[Paper]]:
            """对单个 pid 并发拉取 backward(references) 与 forward(citations)。

            两个方向打不同 endpoint、互不限速，并发即可（原实现在两者之间硬
            sleep 1.5s 是不必要的串行）。"""
            jobs: List[tuple[str, Any]] = []
            if direction in ("backward", "both"):
                jobs.append(("refs", asyncio.to_thread(
                    semantic.get_references, pid, max_results_per_direction)))
            if direction in ("forward", "both"):
                jobs.append(("cites", asyncio.to_thread(
                    semantic.get_citations, pid, max_results_per_direction)))
            results = await asyncio.gather(
                *(job for _, job in jobs), return_exceptions=True
            )
            refs: List[Paper] = []
            cites: List[Paper] = []
            for (kind, _), res in zip(jobs, results):
                if isinstance(res, Exception):
                    layer_errors.append(f"layer{layer}:{kind}:{pid}:{res}")
                    continue
                if kind == "refs":
                    refs = res or []
                else:
                    cites = res or []
            return refs, cites

        for layer in range(depth):
            next_ids: List[str] = []
            for idx, pid in enumerate(current_ids):
                if pid in visited:
                    continue
                visited.add(pid)

                # pid 与 pid 之间保留可调节流以尊重 Semantic Scholar 限速；
                # 同一 pid 内的双向请求已并发，不再额外等待。
                if layer > 0 or idx > 0:
                    await asyncio.sleep(SNOWBALL_INTER_PID_SLEEP_SEC)

                refs, cites = await _fetch_pid(layer, pid)

                for p in refs + cites:
                    all_papers.append(p)
                    if p.paper_id and p.paper_id not in visited:
                        next_ids.append(p.paper_id)

            current_ids = next_ids
            if not current_ids:
                break

        deduped = self._dedupe_papers(all_papers)
        return SnowballResult(
            seed_paper_id=paper_id,
            direction=direction,
            depth=depth,
            total=len(deduped),
            raw_total=len(all_papers),
            papers=deduped,
            errors=layer_errors,
        )

    async def recommend(
        self,
        paper_id: str,
        max_results: int = 10,
    ) -> SearchResult:
        """Find similar papers using Semantic Scholar embedding-based recommendations.

        Args:
            paper_id: Semantic Scholar paper ID, or DOI:<doi>, ARXIV:<id>, etc.
            max_results: Maximum number of recommendations.
        """
        semantic = self.registry.get("semantic")
        if semantic is None:
            return SearchResult(
                query=f"recommend:{paper_id}",
                sources_requested="semantic",
                errors={"semantic": "Semantic Scholar connector not available"},
            )

        try:
            papers = await asyncio.to_thread(
                semantic.get_recommendations, paper_id, max_results
            )
        except Exception as exc:
            return SearchResult(
                query=f"recommend:{paper_id}",
                sources_requested="semantic",
                errors={"semantic": str(exc)},
            )

        deduped = self._dedupe_papers(papers)
        return SearchResult(
            query=f"recommend:{paper_id}",
            sources_requested="semantic",
            sources_used=["semantic"],
            source_results={"semantic": len(deduped)},
            papers=deduped,
            total=len(deduped),
            raw_total=len(papers),
        )

    @staticmethod
    async def _timed_search(
        name: str,
        connector: PaperConnector,
        query: str,
        max_results: int,
        timeout: Optional[float] = None,
        **kwargs: Any,
    ) -> tuple[List[Paper], int, SourceStatus]:
        """Run a single-source search and return (papers, elapsed_ms, status).

        ``timeout`` 为该源的硬超时；省略时回退到该源的分级超时（P2-2）。
        """
        effective_timeout = timeout if timeout is not None else source_timeout(name)
        t0 = time.monotonic()
        status = SourceStatus()
        try:
            papers = await asyncio.wait_for(
                asyncio.to_thread(
                    connector.search, query, max_results=max_results, **kwargs
                ),
                timeout=effective_timeout,
            )
            papers = papers or []
            if not papers:
                # Connector returned empty — may be a silent HTTP error.
                # Mark as 204 (no content) so the caller can distinguish
                # "worked but found nothing" from "failed silently".
                status = SourceStatus(http_status=204, ok=True, error="")
        except asyncio.TimeoutError:
            # 外层硬超时触发：连接器内部重试栈跑太久。底层 to_thread 线程
            # 仍在跑，但 requests session 自带 timeout=30s 会让其在 30s
            # 内自终止；调用方收到的 http_status=408 与上游真实 408 区分
            # 不开（都是「请求超时」语义），通过 error 字段区分来源。
            status = SourceStatus(
                http_status=408,
                ok=False,
                error=f"per-source timeout {effective_timeout}s",
            )
            papers = []
        except requests.exceptions.HTTPError as exc:
            code = exc.response.status_code if exc.response is not None else 0
            status = SourceStatus(http_status=code, ok=False, error=str(exc))
            papers = []
        except requests.exceptions.ConnectionError as exc:
            status = SourceStatus(http_status=0, ok=False, error=f"connection_error: {exc}")
            papers = []
        except requests.exceptions.Timeout as exc:
            status = SourceStatus(http_status=408, ok=False, error=f"timeout: {exc}")
            papers = []
        except Exception as exc:
            status = SourceStatus(http_status=0, ok=False, error=str(exc))
            papers = []

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "[perf] source=%s http=%d ok=%s elapsed=%dms results=%d%s",
            name, status.http_status, status.ok, elapsed_ms, len(papers),
            f" error={status.error}" if status.error else "",
        )
        return papers, elapsed_ms, status

    @staticmethod
    async def _async_search(
        connector: PaperConnector,
        query: str,
        max_results: int,
        **kwargs: Any,
    ) -> List[Paper]:
        """单源 search 异步包装，per-source MCP 工具的实际入口。

        与 ``_timed_search`` 的区别：
        - 返回值是 ``List[Paper]``（无 SourceStatus / elapsed_ms），保持与
          per-source MCP tool 的现有接口契约一致；
        - 仍套同一份 ``PER_SOURCE_TIMEOUT_SEC`` 硬封顶，超时回退到 ``[]``
          （与 connector 内部失败时的返回语义一致，不引入新的错误形态）；
        - caveat：``asyncio.wait_for`` 不取消 ``to_thread`` 底层线程；
          连接器内 requests session 自带的 timeout 是兜底（arxiv 已收紧到
          11s 单请求；其他源仍可能留下后台线程，但不阻塞调用方）。
        """
        try:
            papers = await asyncio.wait_for(
                asyncio.to_thread(
                    connector.search, query, max_results=max_results, **kwargs
                ),
                timeout=PER_SOURCE_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            logger.info(
                "[perf] per-source timeout %.1fs hit in _async_search (no source name)",
                PER_SOURCE_TIMEOUT_SEC,
            )
            return []
        return papers or []

    def _parse_sources(self, sources: str) -> List[str]:
        if not sources or sources.strip().lower() == "all":
            return self.available_sources()
        normalized = [s.strip().lower() for s in sources.split(",") if s.strip()]
        return [s for s in normalized if s in self.registry]

    @staticmethod
    def _dedupe_papers(papers: List[Paper]) -> List[Paper]:
        deduped: List[Paper] = []
        seen: set[str] = set()
        for p in papers:
            key = PaperSearchService._paper_key(p)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(p)
        return deduped

    @staticmethod
    def _paper_key(paper: Paper) -> str:
        doi = (paper.doi or "").strip().lower()
        if doi:
            return f"doi:{doi}"
        title = (paper.title or "").strip().lower()
        authors = "; ".join(paper.authors).strip().lower() if paper.authors else ""
        if title:
            return f"title:{title}|authors:{authors}"
        return f"id:{(paper.paper_id or '').strip().lower()}"

    # ------------------------------------------------------------------
    # Paper enrichment
    # ------------------------------------------------------------------

    # #685：把 europepmc 接进 enrichment fan-out，与其余三源**完全平等并发**
    # （first-wins：谁先返回非空摘要就用）。Europe PMC 生物医学文献覆盖广、提供
    # 结构化 abstractText，比抓 HTML 可靠，是缺摘要论文的主力补全源之一。
    _ENRICH_SOURCES = ("semantic", "openalex", "crossref", "europepmc")

    async def enrich_paper(
        self,
        doi: str = "",
        title: str = "",
    ) -> Optional[Paper]:
        """Enrich paper metadata by fetching from the structured sources in parallel.

        Concurrent fan-out: launches all of `_ENRICH_SOURCES`（semantic / openalex /
        crossref / europepmc）at once and returns the FIRST source that comes back
        with a non-empty abstract, cancelling the rest（#685：4 源平等、谁先拿到摘要
        就用，不再为等更高优先源而空耗延迟）。Each task is bounded by
        `ENRICH_PER_SOURCE_TIMEOUT_SEC`. When all structured sources come back empty
        and a DOI is available, falls back to publisher landing-page meta extraction.

        Args:
            doi: Paper DOI (preferred — enables precise lookup).
            title: Paper title (fallback — uses search, less precise).

        Returns:
            Enriched Paper object, or None if no source could provide data.
        """
        doi = (doi or "").strip()
        title = (title or "").strip()
        if not doi and not title:
            return None

        # 为每个可用 source 启动一个并发任务；每个任务自带 per-source timeout。
        # #743：每源在独立的 enrich 代理上下文内执行（直连优先 + 失败回退代理），
        # 上下文经 asyncio.to_thread 复制到连接器工作线程；每源各自一份 info dict
        # 承载选路结果（route / fallback_reason），互不干扰、可记日志。
        async def _one_source(source_name: str) -> Optional[Paper]:
            connector = self.registry.get(source_name)
            if connector is None:
                return None
            with enrich_proxy_context() as proxy_info:
                try:
                    paper = await asyncio.wait_for(
                        self._enrich_from_source(connector, source_name, doi, title),
                        timeout=ENRICH_PER_SOURCE_TIMEOUT_SEC,
                    )
                except asyncio.TimeoutError:
                    logger.debug(
                        "enrich from %s timed out after %.1fs (route=%s)",
                        source_name, ENRICH_PER_SOURCE_TIMEOUT_SEC,
                        proxy_info.get("route"),
                    )
                    return None
                except Exception as exc:
                    logger.debug(
                        "enrich from %s failed: %s (route=%s)",
                        source_name, exc, proxy_info.get("route"),
                    )
                    return None
            if paper and (paper.abstract or "").strip():
                # AC #5：每篇补全成功记录命中源 + 走的网络路径（直连 / 代理）。
                logger.info(
                    "enrich ok: doi=%s source=%s route=%s mode=%s",
                    doi or title, source_name,
                    proxy_info.get("route"), proxy_info.get("mode"),
                )
                return paper
            return None

        # 4 源并发 fan-out；谁先返回非空摘要就用、立即取消其余（first-wins，源间平等）。
        pending: set[asyncio.Task[Optional[Paper]]] = {
            asyncio.create_task(_one_source(name)) for name in self._ENRICH_SOURCES
        }
        try:
            while pending:
                done, pending = await asyncio.wait(
                    pending, return_when=asyncio.FIRST_COMPLETED
                )
                for t in done:
                    paper = t.result()
                    if paper:
                        return paper  # 首个拿到非空摘要的源胜出，其余 pending 在 finally 取消
            # 结构化源全空：#685 末位兜底 → 出版社页面 meta/JSON-LD 抽取（仅 DOI 在手时）
            return await self._enrich_from_publisher_html(doi, title)
        finally:
            for t in pending:
                t.cancel()

    @staticmethod
    async def _enrich_from_publisher_html(doi: str, title: str) -> Optional[Paper]:
        """末位兜底（#685）：从出版社 landing page 的 meta/JSON-LD 抽摘要。

        单次尝试、硬超时、无重试；任何失败优雅返回 None。仅在有 DOI 时触发，
        受 PUBLISHER_HTML_ENABLED kill switch 门控。返回的最小 Paper 只保证带
        非空 abstract，供上游 enrich_missing_abstracts 合并进 record。
        """
        if not PUBLISHER_HTML_ENABLED or not doi:
            return None
        try:
            # #743：出版社 landing page 抓取同样是 enrich 网络调用，纳入代理自适应
            # 上下文（直连优先 + 失败回退代理），避免「四源全空 → 兜底抓 HTML」这条
            # 最后路径仍被系统代理打挂。
            with enrich_proxy_context():
                abstract = await asyncio.wait_for(
                    asyncio.to_thread(
                        fetch_abstract_from_landing_page, doi, PUBLISHER_HTML_TIMEOUT_SEC
                    ),
                    timeout=PUBLISHER_HTML_TIMEOUT_SEC,
                )
        except asyncio.TimeoutError:
            logger.debug("publisher-html enrich %s 超时（%.1fs）", doi, PUBLISHER_HTML_TIMEOUT_SEC)
            return None
        except Exception as exc:  # 抓取/解析任何异常都优雅跳过
            logger.debug("publisher-html enrich %s 失败: %s", doi, exc)
            return None
        if abstract and abstract.strip():
            return Paper(
                paper_id=doi,
                title=title,
                abstract=abstract.strip(),
                doi=doi,
                source="publisher_html",
            )
        return None

    @staticmethod
    async def _enrich_from_source(
        connector: PaperConnector,
        source_name: str,
        doi: str,
        title: str,
    ) -> Optional[Paper]:
        """Try to get paper details from a single source."""
        # #685 Europe PMC：DOI 精确单次查（DOI:<doi> 语法实测精确命中），
        # 不走 title fallback —— 保持 fail-fast、避免二次网络调用与跨题误配。
        if source_name == "europepmc":
            if not doi:
                return None
            papers = await asyncio.to_thread(
                connector.search, f"DOI:{doi}", max_results=1
            )
            if papers and (papers[0].doi or "").strip().lower() == doi.lower():
                return papers[0]
            return None
        # DOI-based precise lookup (Semantic Scholar supports DOI:<doi> syntax)
        if doi:
            if source_name == "semantic":
                paper = await asyncio.to_thread(
                    connector.get_paper_details, f"DOI:{doi}"
                )
                if paper:
                    return paper

            # OpenAlex and CrossRef: use DOI as search query
            papers = await asyncio.to_thread(
                connector.search, doi, max_results=1
            )
            if papers:
                candidate = papers[0]
                # Verify DOI matches
                if (candidate.doi or "").strip().lower() == doi.lower():
                    return candidate

        # Title-based fallback search
        if title:
            papers = await asyncio.to_thread(
                connector.search, title, max_results=3
            )
            if papers:
                for p in papers:
                    # 当输入提供了 DOI 时，title fallback 必须做 identity 校验：
                    # 候选 DOI 必须与请求 DOI 严格匹配才能返回，否则视为 miss。
                    # 否则在 SSRN / preprints 等场景下，真主 abstract 在上游为空
                    # 会被 "abstract 非空" 筛掉，第二名 title 关键词相近但完全
                    # 无关的高引论文 abstract 充足会被误认为是匹配结果（GH-186）。
                    if doi:
                        if (p.doi or "").strip().lower() == doi.lower():
                            return p
                        continue
                    # 无 DOI 时仅靠 title 模糊匹配，仍以 abstract 非空作为弱启发
                    if (p.abstract or "").strip():
                        return p

        return None
