"""MCP transport layer — thin adapter over service layer."""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from collections import OrderedDict
from threading import Lock
from typing import Any, Dict, List, Optional

from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from ..logging_setup import setup_logging
from ..service.search_service import PaperSearchService, TOPK_CAP
from ..service.download_service import DownloadService
from ..service.export_service import ExportService
from ..service.process_service import process_results_core, apply_rerank as _apply_rerank_core
from ..connectors.sci_hub import SciHubFetcher

# #743：尽早配置日志，让 enrich 选路 / 失败告警落盘到 <配置目录>/paper-search-logs/，
# 否则 MCP 的 Python 日志在 stdio 下既不转发、INFO 又被默认阈值丢弃 → 真机黑盒。
setup_logging()

logger = logging.getLogger(__name__)

mcp = FastMCP("paper_search_server")
search_service = PaperSearchService()
download_service = DownloadService(registry=search_service.registry)
export_service = ExportService()


# 检索结果 slim 化：search_* 工具默认只返回身份字段，丢弃 abstract / references / extra 等大体积字段
# 目的：单工具返回 < 25KB，避免触发 Agent SDK 单工具响应阈值的兜底落盘
# 完整 abstract 由下游 process_search_results 的 enrich 路径自动补回到 JSONL
_SLIM_KEEP_FIELDS = ("title", "authors", "year", "doi", "url", "venue", "source")


def _slim_paper(p: Dict[str, Any]) -> Dict[str, Any]:
    return {k: p[k] for k in _SLIM_KEEP_FIELDS if p.get(k) is not None}


# 论文 handle 缓存：search_* 把完整 paper dict 存这里，返回 handle 给 agent
# agent 调 process_search_results 时只传 handles 列表，避免重新 emit 几十 KB JSON
# 进程级内存 dict；FIFO 驱逐 + TTL 过期；MCP server 单进程下安全
_HANDLE_TTL_SECONDS = 600  # 10 分钟（一轮 litreview 充裕）
_HANDLE_MAX_ENTRIES = 200
_PAPER_HANDLE_CACHE: "OrderedDict[str, tuple[float, str, List[Dict[str, Any]]]]" = OrderedDict()
_HANDLE_LOCK = Lock()


def _evict_expired_handles_locked(now: float) -> None:
    """在持锁状态下清理过期 handle。"""
    cutoff = now - _HANDLE_TTL_SECONDS
    for k in list(_PAPER_HANDLE_CACHE.keys()):
        ts, _, _ = _PAPER_HANDLE_CACHE[k]
        if ts < cutoff:
            _PAPER_HANDLE_CACHE.pop(k, None)
        else:
            break  # OrderedDict 有序，第一个不过期则后续都不过期


def _store_papers(papers: List[Dict[str, Any]], source: str) -> str:
    """把完整 paper dict 列表存入内存，返回 handle。"""
    handle = f"ps_{uuid.uuid4().hex[:12]}"
    now = time.time()
    with _HANDLE_LOCK:
        _evict_expired_handles_locked(now)
        while len(_PAPER_HANDLE_CACHE) >= _HANDLE_MAX_ENTRIES:
            _PAPER_HANDLE_CACHE.popitem(last=False)  # FIFO
        _PAPER_HANDLE_CACHE[handle] = (now, source, papers)
    return handle


def _resolve_handles(handles: List[str]) -> List[Dict[str, Any]]:
    """根据 handle 列表取回 [{source, papers}, ...]，过期/未找到的 handle 跳过。"""
    out: List[Dict[str, Any]] = []
    now = time.time()
    cutoff = now - _HANDLE_TTL_SECONDS
    with _HANDLE_LOCK:
        for h in handles:
            entry = _PAPER_HANDLE_CACHE.get(h)
            if entry is None:
                continue
            ts, source, papers = entry
            if ts < cutoff:
                _PAPER_HANDLE_CACHE.pop(h, None)
                continue
            out.append({"source": source, "papers": papers})
    return out


# ============================================================
# Per-session search budget — MCP-layer hard cap (#fix)
# ============================================================
# 背景：lit-search searcher 子代理在 prompt 层有 H1/H3 早停+预算规则，但 Haiku 偶尔会
# 忽略（已在 LLM context window 检索回归里观察到 45 次调用、严重超 ≤20 上限）。
# 这里在 MCP 服务端兜底：同一 ASCI_SESSION_ID 内累计 search_* 调用 > 上限时，
# 后续 search_* 直接拒收并返回 budget_exceeded 信号，agent 必须停手并 process_search_results。
#
# 边界设计：
# - 计数器以 session_id 为 key，session_id 缺失时回退到 "__default__"；
# - process_search_results 成功（无 error 字段）时重置该 session 计数器 —— 一轮检索结束；
# - 上限可通过 env 调（默认 20，与 searcher.md H3 一致）。

PER_SESSION_SEARCH_BUDGET = int(os.getenv("PAPER_SEARCH_PER_SESSION_BUDGET", "20"))
_SESSION_SEARCH_COUNTERS: Dict[str, int] = {}
_SESSION_COUNTER_LOCK = Lock()


def _current_session_id() -> str:
    """读当前 session id；空字符串走 __default__ 兜底键。"""
    return os.environ.get("ASCI_SESSION_ID", "") or "__default__"


def _check_and_increment_search_budget() -> Dict[str, Any]:
    """每次 search_* 调用前调用。

    返回:
        {"ok": True, "count": N} 仍在预算内（已 +1）
        {"ok": False, "count": N, "limit": ...} 超预算（已 +1 但应返回 budget_exceeded）
    """
    sid = _current_session_id()
    with _SESSION_COUNTER_LOCK:
        count = _SESSION_SEARCH_COUNTERS.get(sid, 0) + 1
        _SESSION_SEARCH_COUNTERS[sid] = count
    if count > PER_SESSION_SEARCH_BUDGET:
        return {"ok": False, "count": count, "limit": PER_SESSION_SEARCH_BUDGET}
    return {"ok": True, "count": count, "limit": PER_SESSION_SEARCH_BUDGET}


def _reset_search_budget() -> None:
    """process_search_results 成功后调，标志本轮结束、下一轮重新计数。"""
    sid = _current_session_id()
    with _SESSION_COUNTER_LOCK:
        _SESSION_SEARCH_COUNTERS.pop(sid, None)


def _budget_exceeded_response(budget_state: Dict[str, Any]) -> Dict[str, Any]:
    """构造统一的 budget_exceeded 返回值。所有 search_* 共用同一形状。"""
    return {
        "_handle": "",
        "count": 0,
        "papers": [],
        "budget_exceeded": True,
        "message": (
            f"Per-session search budget exceeded "
            f"({budget_state['count']} > {budget_state['limit']} calls). "
            f"Stop calling search_* tools now. Call process_search_results with the "
            f"handles you already have; the counter resets on successful persist."
        ),
    }


def _reset_search_budget_for_test(session_id: Optional[str] = None) -> None:
    """测试钩子：清空指定 session（None 则清全部）的 search 计数器。"""
    with _SESSION_COUNTER_LOCK:
        if session_id is None:
            _SESSION_SEARCH_COUNTERS.clear()
        else:
            _SESSION_SEARCH_COUNTERS.pop(session_id, None)


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    return JSONResponse({"status": "ok"})


# ========== Static top-level tools ==========

# NOTE: search_papers is intentionally NOT registered as an MCP tool (@mcp.tool
# removed). ASCI's litreview skill calls individual per-source tools
# (search_arxiv, search_semantic, etc.) so the frontend can show per-source
# progress. The function is kept for internal/test use.
async def search_papers(
    query: str,
    max_results_per_source: int = 5,
    sources: str = "all",
    year: Optional[str] = None,
) -> Dict[str, Any]:
    """Search academic papers across multiple platforms in parallel and return a deduplicated list.

    Triggers when the user asks to find / search / look up papers by keyword,
    topic, author, or title without naming a specific source. Results are
    merged across platforms and deduplicated by DOI/title.

    Args:
        query: Natural-language keywords or title fragment. Required, non-empty.
               Supports multi-word phrases; no special syntax required.
        max_results_per_source: 1..50, default 5. Total results ≈ this × number
               of sources, so keep small when `sources="all"` (22+ sources).
        sources: Either "all" (default), or comma-separated connector names.
               Source names with domain coverage:
                 arxiv         — STEM preprints (physics, math, CS, quant-bio)
                 semantic      — cross-domain, abstract/citation/embedding metadata
                 openalex      — cross-domain OA index, rich affiliations
                 crossref      — authoritative DOI registry, publisher metadata
                 dblp          — computer science bibliography
                 pubmed / pmc / europepmc — biomedical / life sciences
                 biorxiv / medrxiv — preprints per life-science field
                 iacr          — cryptology preprints
                 core / hal / doaj / zenodo / openaire / citeseerx /
                 oaipmh / google_scholar / acm / ieee — general OA or
                 publisher-specific indexes.
        year: Optional year filter (e.g. "2019", "2016-2020", "2010-", "-2015").
               Only honored by Semantic Scholar; other sources ignore it.

    Returns:
        dict with keys: query, sources_requested, sources_used (list[str]),
        source_results (dict[source, count]), errors (dict[source, msg]),
        papers (list[dict]) — each paper has title, authors, year, venue, doi,
        abstract, url, pdf_url, citations, source. Duplicates across sources
        are merged by DOI/title.

    Side effects:
        Makes parallel outbound HTTP requests to multiple academic APIs. No
        DB writes, no file downloads.

    Do NOT use for:
        - Downloading PDFs → use `download_paper`.
        - Getting references/citations of a known paper → use `snowball_search`.
        - Finding papers similar to a known paper → use `recommend_papers`.
        - Looking up a paper when you already have its DOI → use
          `get_crossref_paper_by_doi` or `enrich_paper`.
    """
    t0 = time.monotonic()
    result = await search_service.search(query, sources, max_results_per_source, year)
    total_elapsed_ms = int((time.monotonic() - t0) * 1000)
    data = result.model_dump()
    data["papers"] = [p.to_api_dict() for p in result.papers]
    data["total_elapsed_ms"] = total_elapsed_ms
    return data


@mcp.tool()
async def download_paper(
    source: str,
    paper_id: str,
    doi: str = "",
    title: str = "",
    pdf_url: str = "",
    save_path: str = "./downloads",
    use_scihub: bool = True,
    scihub_base_url: str = "auto",
) -> str:
    """Download a paper's PDF to disk using a 6-stage fallback chain.

    Triggers when the user asks to download / get / save the PDF of a paper.
    The tool attempts multiple sources before giving up. Fallback order:
    (1) direct pdf_url if provided → (2) source's native connector →
    (3) OA resolver (Unpaywall) → (4) OA repositories (PMC/arXiv/etc.) →
    (5) DOI landing page HTML PDF extraction → (6) Sci-Hub (if enabled).

    Args:
        source: Source name from search result (e.g. "arxiv", "semantic",
               "crossref", "openalex"). Required. Drives stage 2 (native
               download). Use the `source` field from a search result.
        paper_id: The source's native identifier. Required. For arxiv it's
               the arxiv ID (e.g. "2103.00020"); for semantic it's the S2
               paper ID; for crossref/openalex it's typically the DOI.
        doi: Paper DOI (e.g. "10.1038/nature14539"). Optional but strongly
               recommended — needed by stages 3/4/5/6 when stages 1-2 fail.
        title: Paper title. Optional. Only used by stage 4 for repository
               fallback lookup.
        pdf_url: Direct PDF URL if already known (e.g. arxiv.org/pdf/...).
               Tried FIRST (stage 1) — fastest path when provided.
        save_path: Output directory; created if missing. Default "./downloads".
               Filename is auto-derived from paper metadata.
        use_scihub: Set False to skip stage 6 (Sci-Hub). Default True. Honor
               institutional policy when calling.
        scihub_base_url: "auto" (default, probes known mirrors) or an explicit
               URL like "https://sci-hub.se". Only used if use_scihub=True.

    Returns:
        String: either the absolute local path of the saved PDF on success,
        or an error message describing which stages were attempted and why
        they failed.

    Side effects:
        Writes a PDF file to `save_path`. Makes outbound HTTP requests to
        multiple academic sites and (if enabled) Sci-Hub mirrors.

    Do NOT use for:
        - Just getting metadata without downloading → use `enrich_paper` or
          `get_crossref_paper_by_doi`.
        - Forcing Sci-Hub only → use `download_scihub`.
        - Reading extracted text (not PDF bytes) → use per-source
          `read_<name>_paper` tools.
    """
    return await download_service.download(
        source, paper_id, doi, title, pdf_url, save_path, use_scihub, scihub_base_url
    )


@mcp.tool()
async def snowball_search(
    paper_id: str,
    direction: str = "both",
    max_results_per_direction: int = 20,
    depth: int = 1,
    slim: bool = True,
) -> Dict[str, Any]:
    """Traverse the citation graph of a seed paper to discover related work.

    Use this when the user has ONE paper and wants to find:
    - what it cites (backward snowball — the paper's references), or
    - papers that cite it (forward snowball — papers citing this one), or
    - both, recursively to a small depth.

    Distinct from `recommend_papers`: snowball walks the citation graph
    (explicit cites-relationships); recommend uses content embeddings
    (similarity in abstract/topic space).

    Args:
        paper_id: Required. One of:
            - Semantic Scholar paper ID (40-char hash), OR
            - "DOI:<doi>" (e.g. "DOI:10.1038/nature14539"), OR
            - "ARXIV:<id>" (e.g. "ARXIV:2103.00020"), OR
            - other Semantic Scholar-supported prefix (MAG:, PMID:, URL:).
        direction: "backward" (references only), "forward" (citing papers
            only), or "both" (default). Backward usually has bounded size
            (the paper's bibliography); forward can explode for famous
            papers — cap with `max_results_per_direction`.
        max_results_per_direction: 1..100, default 20. Limit per direction
            per recursion layer. Keep ≤20 for depth>1 to avoid huge graphs.
        depth: 1..3, default 1. depth=1 is the paper's direct references
            /citations; depth=2 recurses to those papers' references; etc.
            Total paper count grows roughly as max^depth — use depth=1
            unless explicitly building a multi-hop graph.
        slim: If True (default), `papers` in response is slimmed (identity
            fields only); full untouched papers stay in MCP memory under
            `_handle` for `process_search_results(handles=[...])`. Same
            contract as search_* tools.

    Returns:
        dict with keys: seed_paper_id, direction, depth, _handle, count,
        papers (list[dict]). With slim=True papers contain identity fields
        only; with slim=False each paper includes title, authors, year, doi,
        abstract, citations, plus a `relation` field indicating "reference"
        or "citation" and (for depth>1) the hop distance from the seed.

    Side effects:
        Calls Semantic Scholar's /references and /citations endpoints. Can
        be slow for depth>1 or famous papers (many citations). No DB writes.

    Do NOT use for:
        - Keyword search → `search_papers`.
        - Content-similarity discovery → `recommend_papers`.
        - When you don't have a specific seed paper yet.
    """
    t0 = time.monotonic()
    result = await search_service.snowball(
        paper_id, direction, max_results_per_direction, depth
    )
    total_elapsed_ms = int((time.monotonic() - t0) * 1000)
    data = result.model_dump()
    full = [p.to_api_dict() for p in result.papers]
    handle = _store_papers(full, "snowball") if full else ""
    data["_handle"] = handle
    data["count"] = len(full)
    data["papers"] = [_slim_paper(p) for p in full] if slim else full
    data["total_elapsed_ms"] = total_elapsed_ms
    return data


@mcp.tool()
async def recommend_papers(
    paper_id: str,
    max_results: int = 10,
) -> Dict[str, Any]:
    """Find papers with similar content to a seed paper via Semantic Scholar embeddings.

    Use this when the user has ONE paper and asks for "similar / related /
    like this one" — recommendation is based on content embeddings, not
    citation relationships, so it surfaces topically-related work even
    when there is no direct cite link.

    Distinct from `snowball_search`: recommend uses content similarity
    (abstract/topic embeddings); snowball uses the citation graph.

    Args:
        paper_id: Required. Semantic Scholar paper ID, or "DOI:<doi>",
            "ARXIV:<id>", "MAG:<id>", "PMID:<id>", "URL:<url>".
        max_results: 1..100, default 10. Number of recommendations to
            return, ranked by S2's similarity score.

    Returns:
        dict with keys: seed_paper_id, papers (list[dict]). Each paper
        has title, authors, year, doi, abstract, citations, and the S2
        `source` field set to "semantic".

    Side effects:
        Calls Semantic Scholar /recommendations endpoint. No DB writes.

    Do NOT use for:
        - Keyword/topic search without a seed paper → `search_papers`.
        - Citation-graph traversal → `snowball_search`.
        - When the seed paper is not indexed by Semantic Scholar (fails
          silently with empty result).
    """
    t0 = time.monotonic()
    result = await search_service.recommend(paper_id, max_results)
    total_elapsed_ms = int((time.monotonic() - t0) * 1000)
    data = result.model_dump()
    data["papers"] = [p.to_api_dict() for p in result.papers]
    data["total_elapsed_ms"] = total_elapsed_ms
    return data


@mcp.tool()
async def export_papers(
    papers: List[Dict[str, Any]],
    format: str = "csv",
    save_path: str = "./exports",
    filename: str = "papers",
) -> str:
    """Write a list of paper metadata dicts to a CSV, RIS, or BibTeX file.

    Use this when the user wants to export / save / dump search results
    to a file for later use in reference managers (Zotero, Mendeley) or
    spreadsheet review.

    Args:
        papers: Required. List of paper dicts as returned by `search_papers`,
            `snowball_search`, `recommend_papers` (the objects inside the
            `papers` field). Each dict needs at least title; DOI and authors
            strongly improve output quality.
        format: "csv" (default, spreadsheet-friendly), "ris" (EndNote /
            Zotero import), or "bibtex" (LaTeX). Case-insensitive.
        save_path: Output directory; created if missing. Default "./exports".
        filename: Filename without extension. Default "papers". Extension is
            added based on `format` (.csv / .ris / .bib).

    Returns:
        String: absolute path of the written file, or an error message.

    Side effects:
        Writes a file to disk at `save_path/filename.<ext>`. Overwrites if
        the file already exists.

    Do NOT use for:
        - Saving to the literature library database → use `lit_add_paper` /
          `lit_add_papers_batch` from literature-service.
        - Exporting a single paper's full text → use `download_paper`.
    """
    return export_service.export_from_dicts(papers, format, save_path, filename)


@mcp.tool()
async def enrich_paper(
    doi: str = "",
    title: str = "",
) -> Dict:
    """Fill in missing metadata for one paper by looking it up in Semantic Scholar, OpenAlex, and CrossRef.

    Use this when you already have a paper (typically from a source like DBLP
    or arXiv) but key fields are empty — abstract, authors, citation count,
    venue, etc. The tool queries S2 → OpenAlex → CrossRef in order and merges
    the first successful result.

    Args:
        doi: Paper DOI (e.g. "10.1038/nature14539"). Preferred — gives an
            exact match. At least one of `doi` / `title` must be non-empty.
        title: Paper title. Used as fallback when no DOI is available; matching
            is fuzzy so results may be imprecise for short/common titles.

    Returns:
        dict: a single paper dict with title, authors, year, venue, doi,
        abstract, citations, pdf_url, url, source, fields_of_study. Empty
        dict {} if the paper is not found in any source.

    Side effects:
        Makes outbound HTTP requests to S2, OpenAlex, CrossRef (stops at
        first hit). No DB writes.

    Do NOT use for:
        - Finding papers by keyword → `search_papers`.
        - Looking up by DOI only in CrossRef → `get_crossref_paper_by_doi`
          (use this only when you specifically need CrossRef's data shape).
        - Bulk metadata fill for many papers — call once per paper; no
          batch variant exists.
    """
    paper = await search_service.enrich_paper(doi=doi, title=title)
    return paper.to_api_dict() if paper else {}


def _detect_identifier_source(raw: str) -> str:
    """Heuristic for `source='auto'` in `get_paper_meta`. Order matters."""
    s = raw.strip()
    if not s:
        return "doi"  # caller will short-circuit on empty input
    # DOI: 含 "/" 或以 "10." 开头（CrossRef registrant prefix 总是 10.xxxx/）
    if "/" in s or s.lower().startswith("10."):
        return "doi"
    # arXiv: "1706.03762" / "2306.15595v1" / "math.AG/0309136"（后者已被 / 拦走）
    if "." in s and s[0].isdigit():
        return "arxiv"
    # PMID: 纯数字（PubMed id 永远是整数）
    if s.isdigit():
        return "pmid"
    # 兜底当 DOI 试（最常见，且 semantic API 在不匹配时返回 None 不抛错）
    return "doi"


@mcp.tool()
async def get_paper_meta(identifier: str, source: str = "auto") -> Dict:
    """Fetch a single paper's metadata by precise identifier (DOI / arXiv id / PMID).

    Use this when you already know the exact identifier and want one paper back —
    not for keyword search. The two driving scenarios (spec §5.6):
      - lit-search `direct_lookup` intent: user supplied a single PMID / DOI / arXiv id.
      - lit-review synthesizer cross-pack gap-fill: a paragraph cites a paper whose
        metadata is missing; synthesizer requests an exact lookup (cap=3 per turn,
        enforced upstream by `paper-meta-cap-hook`).

    Primary path: Semantic Scholar `get_paper_details(<prefix>:<id>)` which natively
    supports DOI / ARXIV / PMID prefixes in a single API. On a genuine miss the DOI
    path additionally falls back to multi-source enrich (semantic → openalex →
    crossref); ARXIV / PMID paths have no fallback.

    Failure vs empty (spec §5.6, #589): a provider error (network / rate-limit /
    exception) is NOT the same as "no such paper". When every attempted source
    fails due to an error and none returns a paper, this raises — the MCP layer
    then surfaces `isError: true`, so callers (and `paper-meta-cap-hook` fail≥2
    early-stop) can tell "provider down, retry/switch source" apart from "really
    not found". An empty `{}` is reserved for the latter.

    Args:
        identifier: Required. Bare identifier without prefix.
            DOI:   e.g. "10.1038/nature14539"
            arXiv: e.g. "2306.15595" (with or without "v1" suffix)
            PMID:  e.g. "19872477"
        source: One of "doi" | "pmid" | "arxiv" | "auto" (default "auto").
            "auto" 按形态推断（含 "/" 或前缀 "10." → DOI；纯数字 → PMID；
            数字+点 → arXiv）。显式传值可绕过启发式。

    Returns:
        dict: Single paper dict (paper_id / title / authors / year / venue / doi /
        abstract / pdf_url / url / source / citations / fields_of_study). Empty
        dict `{}` only if every attempted source ran cleanly but the identifier
        resolves to no paper (a genuine miss).

    Raises:
        RuntimeError: when every attempted source failed with an error (network /
        rate-limit / exception) and none returned a paper — distinguishing
        provider failure from a genuine miss.

    Do NOT use for:
        - Keyword / topic search → `search_papers` or per-source `search_*`.
        - Filling missing fields when you only have title (no identifier)
          → `enrich_paper(title=...)`.
        - Bulk metadata fill — call once per identifier.
    """
    raw = (identifier or "").strip()
    if not raw:
        return {}

    src = (source or "auto").strip().lower()
    if src == "auto":
        src = _detect_identifier_source(raw)

    prefix_map = {"doi": "DOI:", "pmid": "PMID:", "arxiv": "ARXIV:"}
    prefix = prefix_map.get(src)
    if prefix is None:
        return {}

    # #589：区分"provider 故障"与"确实查不到"。任一路径抛错置 provider_errored；
    # 仅当所有尝试过的源都干净跑完却没拿到论文，才是真·未命中（返回 {}）；
    # 否则（有源因网络/限流/异常失败且无人命中）抛错 → MCP 包装为 isError:true。
    provider_errored = False

    # 主路径：Semantic Scholar 单 API 覆盖三种前缀
    semantic = search_service.registry.get("semantic")
    if semantic is not None:
        try:
            paper = await asyncio.to_thread(semantic.get_paper_details, f"{prefix}{raw}")
            if paper:
                return paper.to_api_dict()
            # paper 为 None = semantic 干净返回的真·未命中，不算 provider 故障
        except Exception as exc:
            provider_errored = True
            logger.warning(
                "get_paper_meta semantic path failed: src=%s id=%s err=%s",
                src, raw, exc,
            )

    # DOI 降级：多源 enrich（semantic→openalex→crossref）
    if src == "doi":
        try:
            paper = await search_service.enrich_paper(doi=raw)
            if paper:
                return paper.to_api_dict()
        except Exception as exc:
            provider_errored = True
            logger.warning(
                "get_paper_meta enrich fallback failed: doi=%s err=%s", raw, exc,
            )

    # 走到这里：所有尝试过的源都没拿到论文。
    if provider_errored:
        # provider 故障 ≠ 真查不到：抛错让 MCP 标记 isError，护栏 / caller 才能区分。
        raise RuntimeError(
            f"get_paper_meta failed for {src}:{raw} — all attempted sources errored "
            f"(network / rate-limit / provider failure), not a genuine miss"
        )
    return {}


@mcp.tool()
async def get_crossref_paper_by_doi(doi: str) -> Dict:
    """Fetch a single paper's metadata directly from CrossRef by DOI.

    Triggers when the user names CrossRef as the source, or when you need
    CrossRef-specific fields (authoritative publisher / journal record,
    ISSN, publication date). Returns only what CrossRef has — abstracts
    are often empty. `enrich_paper` covers the cross-source merge case.

    Args:
        doi: Required. Paper DOI, with or without the "doi:" prefix
            (e.g. "10.1038/nature14539").

    Returns:
        dict: paper metadata with title, authors, year, venue, doi, abstract,
        url, citations (as provided by CrossRef), source="crossref". Empty
        dict {} if the DOI is not in CrossRef.

    Side effects:
        One outbound HTTP request to CrossRef. No DB writes.

    Do NOT use for:
        - Keyword search → `search_papers` or `search_crossref`.
        - When you don't know the DOI — use `search_papers` first.
        - Cross-source metadata merge → `enrich_paper`.
    """
    connector = search_service.registry.get("crossref")
    if connector is None:
        return {}
    paper = await asyncio.to_thread(connector.get_paper_by_doi, doi)
    return paper.to_api_dict() if paper else {}


@mcp.tool()
async def download_scihub(
    identifier: str,
    save_path: str = "./downloads",
    base_url: str = "https://sci-hub.se",
) -> str:
    """Download a paper PDF directly from Sci-Hub (skips all other sources).

    Use this ONLY when the user explicitly requests Sci-Hub, or when
    `download_paper` has failed and Sci-Hub is the last resort. Prefer
    `download_paper` for normal use — it attempts legitimate sources first
    and only falls back to Sci-Hub as stage 6.

    Args:
        identifier: Required. DOI (e.g. "10.1038/nature14539") or direct
            paper URL that Sci-Hub can resolve.
        save_path: Output directory; created if missing. Default "./downloads".
        base_url: Sci-Hub mirror URL. Default "https://sci-hub.se". If the
            default is unreachable, try "https://sci-hub.st" or
            "https://sci-hub.ru".

    Returns:
        String: absolute path of saved PDF, or "Sci-Hub download failed."
        on any failure (mirror down, paper not indexed, CAPTCHA, etc.).

    Side effects:
        Writes a PDF file to `save_path`. Makes HTTP request to a Sci-Hub
        mirror. Respect local laws and institutional policy before using.

    Do NOT use for:
        - Normal downloads → `download_paper` (tries legitimate sources first).
        - Metadata-only lookup → `enrich_paper` / `get_crossref_paper_by_doi`.
    """
    fetcher = SciHubFetcher(base_url=base_url, output_dir=save_path)
    result = await asyncio.to_thread(fetcher.download_pdf, identifier)
    return result or "Sci-Hub download failed."


# ========== 搜索结果处理工具 ==========

@mcp.tool()
async def process_search_results(
    query: str,
    handles: str = "",
    inputs: str = "",
    enrich: bool = True,
    session_id: str = "",
    method_terms: str = "",
    object_terms: str = "",
    turn_id: str = "",
) -> dict:
    """去重 + 摘要补全 + 写入 session 论文 JSONL。

    在调用多个 search_* 工具后，使用此工具将结果合并去重、补全摘要，
    并写入当前会话的论文 JSONL 文件。

    **强烈推荐使用 `handles` 路径**（R3，推荐）：每次 search_* 返回值的
    `_handle` 字段是一个 token，指向 MCP server 进程内存里缓存的完整
    论文数据。直接把这些 handle 拼成 JSON 数组传入即可，agent 不需要
    把完整论文 JSON 重新 emit 一遍——典型场景能省 7 分钟以上等待。

    旧的 `inputs` 路径只在 handles 全部过期（TTL 10 min）或在不支持
    handle 的极端场景下使用，**不推荐**。

    **重要：向用户报告论文数量时，必须使用本工具返回的统计字段，
    不要自行对各 search_* 结果求和——那是去重前的数字，会与用户
    在右侧面板看到的实际数量不一致。**

    推荐话术示例：
      "从 N 个数据源共检索到 {total_from_sources} 篇论文，
       去重后新增 {new_records} 篇，面板展示 {display_count} 篇。"
    若 papers_without_url > 0，可补充说明：
      "其中 {papers_without_url} 篇因缺少链接未在列表中展示。"

    **F21 双维评分**：method_terms / object_terms 任一非空时，keyword_relevance
    维度切换为 method × object 双维加成模式（0/0.5/1.0），「双维命中」论文的
    相关度严格高于「单维命中」与「都不命中」。两参数都为空时回退到原 query 词袋
    算法（#93 现状），向后兼容。

    Args:
        query: 搜索关键词（与调用 search_* 时使用的 query 相同）。
        handles: ✅ 推荐路径。JSON 数组字符串，包含若干 search_* 返回的
            `_handle` 值。示例: '["ps_abc123", "ps_def456"]'。MCP 内部从
            进程内存取出完整论文 dict 列表，避免 agent 重新 emit JSON。
            handle 在 search_* 调用后 10 分钟内有效；过期/不存在时本
            工具返回 error，agent 应重新调 search_* 拿新 handle 重试。
        inputs: 旧路径，向后兼容。JSON 字符串，格式为 list[dict]，每个
            dict 包含 source (str) 和 papers (list[dict])。**仅在 handles
            为空时使用**。同时提供 handles 和 inputs 时 handles 优先。
        enrich: 是否对无摘要论文调用 enrich_paper 补全（默认 True）。
            补全会额外请求 Semantic Scholar / OpenAlex / CrossRef。
        session_id: ASCI 会话 ID。为空字符串时自动从环境变量
            ASCI_SESSION_ID 读取。
        method_terms: F21 (#98) — JSON 数组字符串，研究方法关键词列表。
            示例: '["transformer", "attention mechanism"]'。**这是评分参数，
            不是检索参数** — 不要把它们再拼到 search_* 的 query 中。
            为空字符串 / 空数组 / 缺失时，keyword_relevance 维度回退到现有
            query 词袋逻辑。
        object_terms: F21 (#98) — JSON 数组字符串，研究对象关键词列表。
            示例: '["mouse model", "alzheimer disease"]'。语义与 method_terms
            对称，覆盖疾病 / 材料 / 人群 / 物种 / 数据集等。
        turn_id: 可选。一次 lit-search 流程的唯一标识。当 searcher 在同一次
            检索内多次调用 process_search_results（例如 round 1 + round 2）
            时，必须传入第一轮返回的 turn_id 让所有轮次的 records 共享同一
            簇，否则 scorer 只会评分最后一轮（按 "最大 ts 那簇
            turn_id" 过滤），丢失前几轮的高质量召回。**首轮调用不传**
            （服务自动生成新 UUID）；**后续调用传上一轮返回的 turn_id**。

    Returns:
        dict: 统计信息，包含以下字段：
            - total_from_sources: 各数据源论文总数（去重前）
            - duplicates_removed: 去重数量
            - new_records: 去重后新增记录数
            - papers_without_url: 无 URL 的记录数（前端面板会隐藏）
            - display_count: 前端面板实际展示数（= new_records - papers_without_url）
            - enriched_abstracts: 补全摘要数
            - source_counts: 各数据源原始论文数
            - source_new_counts: 各数据源去重后新增数
            - output_path: JSONL 输出路径
            - turn_id: 本次调用的 turn 标识（UUID4 hex）。每条新写入的 record
              的 turn_id 字段会等于这个值；scorer 在加载 JSONL
              后按"最新 turn_id 那一簇"过滤本轮 records，避免跨轮历史
              污染评分池（P0-3：保证 master 摘要的 display_count 与
              scorer 评分池子一致）。
            - error: 错误信息（仅在出错时存在）

    Side effects:
        追加写入 {config_dir}/agent-sessions-papers/{session_id}.jsonl。
        若 enrich=True，会发起额外的外部 HTTP 请求补全摘要。

    Do NOT use for:
        - 搜索论文 → 使用 search_* 系列工具。
        - 导出为 CSV/RIS/BibTeX → 使用 export_papers。
    """
    import json as _json

    parsed_inputs: List[Dict[str, Any]]

    if handles:
        try:
            handle_list = _json.loads(handles)
        except (_json.JSONDecodeError, TypeError) as e:
            return {"error": f"handles JSON 解析失败: {e}"}
        if not isinstance(handle_list, list):
            return {"error": "handles 必须是 JSON 字符串数组"}
        # 过滤空字符串 handle（search_* 在无结果时会返回 _handle=""）
        handle_list = [h for h in handle_list if isinstance(h, str) and h]
        if not handle_list:
            return {"error": "handles 数组为空或全为无效值"}
        parsed_inputs = _resolve_handles(handle_list)
        if not parsed_inputs:
            return {
                "error": (
                    "all handles expired or not found (TTL 10 min); "
                    "re-run search_* tools to refresh handles and retry"
                )
            }
    elif inputs:
        try:
            parsed_inputs = _json.loads(inputs)
        except (_json.JSONDecodeError, TypeError) as e:
            return {"error": f"inputs JSON 解析失败: {e}"}
        if not isinstance(parsed_inputs, list):
            return {"error": "inputs 必须是 JSON 数组"}
    else:
        return {"error": "必须提供 handles 或 inputs 其中之一"}

    # F21 (#98): 解析 method_terms / object_terms 的 JSON-encoded 数组字符串
    parsed_method: Optional[List[str]] = None
    parsed_object: Optional[List[str]] = None
    if method_terms:
        try:
            mt = _json.loads(method_terms)
        except (_json.JSONDecodeError, TypeError) as e:
            return {"error": f"method_terms JSON 解析失败: {e}"}
        if not isinstance(mt, list) or not all(isinstance(x, str) for x in mt):
            return {"error": "method_terms 必须是 JSON 字符串数组"}
        parsed_method = mt
    if object_terms:
        try:
            ot = _json.loads(object_terms)
        except (_json.JSONDecodeError, TypeError) as e:
            return {"error": f"object_terms JSON 解析失败: {e}"}
        if not isinstance(ot, list) or not all(isinstance(x, str) for x in ot):
            return {"error": "object_terms 必须是 JSON 字符串数组"}
        parsed_object = ot

    result = await process_results_core(
        query=query,
        inputs=parsed_inputs,
        enrich=enrich,
        session_id=session_id or None,
        method_terms=parsed_method,
        object_terms=parsed_object,
        turn_id=turn_id or None,
    )
    # 一轮检索结束（成功落盘）→ 重置 per-session search budget
    if isinstance(result, dict) and "error" not in result:
        _reset_search_budget()
    return result


def _parse_required_seeds(
    required_seeds: str,
) -> tuple[List[Dict[str, str]], Optional[str]]:
    """解析 required_seeds (#614)：JSON 数组字符串 → [{id,title,origin}]。

    空串 → ([], None)；非法 JSON / 非数组 → ([], 错误信息)，由调用方返回 {"error": ...}，
    不静默继续。每项可为 {"id","title","origin"} 对象，或纯字符串（含 ":" 视为 id，否则视为 title）。

    `origin`（#646）区分两类 seed：
      - "user"（默认，含缺省 / 纯字符串项）= 用户显式点名：exact + fuzzy 匹配、miss 计入 missing。
      - "model" = planner 主动回忆的奠基论文：服务端强制 title-only + exact-only、miss 静默。
    非 "model" 的取值一律归一为 "user"，避免脏值放宽匹配策略。
    """
    import json as _json

    if not required_seeds:
        return [], None

    try:
        raw = _json.loads(required_seeds)
    except (_json.JSONDecodeError, TypeError) as e:
        return [], f"required_seeds JSON 解析失败: {e}"

    if not isinstance(raw, list):
        return [], 'required_seeds 必须是 JSON 数组，每项 {"id","title","origin"}'

    seeds: List[Dict[str, str]] = []
    for item in raw:
        if isinstance(item, dict):
            seed_id = str(item.get("id") or "").strip()
            title = str(item.get("title") or "").strip()
            origin = "model" if str(item.get("origin") or "").strip().lower() == "model" else "user"
            if seed_id or title:
                seeds.append({"id": seed_id, "title": title, "origin": origin})
        elif isinstance(item, str) and item.strip():
            token = item.strip()
            base = {"id": token, "title": ""} if ":" in token else {"id": "", "title": token}
            seeds.append({**base, "origin": "user"})

    return seeds, None


@mcp.tool()
async def retrieve(
    research_question: str,
    keywords: str,
    sources: str = "",
    method_terms: str = "",
    object_terms: str = "",
    arxiv_categories: str = "",
    domains: str = "",
    required_seeds: str = "",
    top_k: int = TOPK_CAP,
    enrich: bool = True,
    session_id: str = "",
    turn_id: str = "",
) -> dict:
    """一次性确定性检索（Stage 3）：塑形查询矩阵 → 并发 fan-out → 去重 + 摘要补全
    + F22 相关度打分 → 落 session JSONL，返回统计 + top-K 排序列表。

    **这是检索的推荐入口**，取代"手动调多次 search_* 再 process_search_results"
    的流程：服务端按源塑形查询（arxiv 发少量宽查询 + categories；openalex/crossref
    加对象锚 `<object> <keyword>`），不盲发笛卡尔积、不靠 prompt 自律早停。无需
    LLM 决定发哪些查询，可复现、可缓存。

    用法：把规划阶段产出的关键词/术语作为 JSON 数组字符串传入，一次调用即可；
    随后由 scorer 从 session JSONL 读候选（含完整 abstract），按 research_question
    做两维 LLM 评分（semantic relevance + method match），经 apply_scoring 回写，
    服务端组装 extra.score。

    Args:
        research_question: 研究问题原文（用于评分的 query 维度）。
        keywords: ✅ 必填。JSON 数组字符串，检索关键词。示例:
            '["context window", "KV cache", "sparse attention"]'。
        sources: JSON 数组字符串，数据源。默认 '["openalex","crossref","arxiv"]'。
        method_terms / object_terms: JSON 数组字符串，F21 双维评分用。method_terms
            另有限并入主召回 query 池（与 keywords 去重合并、最多额外 4 个，#617）；
            object_terms 同时用于 openalex/crossref 的对象锚。
        arxiv_categories: JSON 数组字符串，arxiv 分类白名单。示例:
            '["cs.CL","cs.LG","cs.AI","stat.ML"]'。
        domains: JSON 数组字符串，研究领域（如 '["NLP","CV"]'）。用于「失败触发扩源」
            的领域感知备用源选择（生物医学→europepmc/pmc/pubmed，密码→iacr）；缺省
            只用通用备用源（doaj/openaire，+ semantic 若配 key）。
        required_seeds: 可选 JSON 数组字符串，已知必须出现的核心论文（#614）。每项
            '{"id","title","origin"}'，id 支持 arxiv: / doi: / pmid: 前缀（也接受纯 title 字符串项）。
            `origin`（#646）："user"（默认）= 用户点名，exact + fuzzy、miss 计入 seed_recall；
            "model" = planner 主动回忆的奠基论文，服务端强制 title-only + exact-only、miss 静默
            不计入 missing / incomplete_retrieval（防幻觉）。命中后两类同样 force-include + 标 extra.seed=true。
            示例: '[{"id":"arxiv:2106.09685","title":"LoRA: Low-Rank Adaptation...","origin":"user"}]'。
            传入时服务端逐个 exact lookup 并强制并入候选池，返回中附 seed_recall / incomplete_retrieval；
            **不传时行为与返回结构与改动前完全一致**。
        top_k: 进入 LLM rerank 判分窗口的论文上限（默认 120）。实际进窗口的是
            F22 relevance > 阈值（默认 55）的动态集合，top_k 仅作防爆上限：
            超出按 F22 降序截断。绝对阈值取代固定排名截断，对题论文不被挤出。
        enrich: 是否对 top-K 无摘要论文补全（默认 True）。
        session_id: 为空则读环境变量 ASCI_SESSION_ID。
        turn_id: 多轮检索共享 turn 时传上一轮返回值；首轮不传。

    Returns:
        dict：含 process_search_results 的全部统计字段（total_from_sources /
        new_records / display_count / source_counts / turn_id 等）+
        `top_k`（[{handle,title,year,venue,relevance}, ...]，relevance 降序；
        **不含 abstract** —— 完整摘要在 session JSONL，避免返回过大触发落盘）+
        `query_matrix_size` / `source_health` / `failed_sources`。出错时含 `error`。
    """
    import json as _json

    def _parse_arr(s: str, field: str):
        if not s:
            return None, None
        try:
            v = _json.loads(s)
        except (_json.JSONDecodeError, TypeError) as e:
            return None, f"{field} JSON 解析失败: {e}"
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            return None, f"{field} 必须是 JSON 字符串数组"
        return v, None

    kws, err = _parse_arr(keywords, "keywords")
    if err:
        return {"error": err}
    if not kws:
        return {"error": "keywords 不能为空（需 JSON 字符串数组）"}
    src, err = _parse_arr(sources, "sources")
    if err:
        return {"error": err}
    mt, err = _parse_arr(method_terms, "method_terms")
    if err:
        return {"error": err}
    ot, err = _parse_arr(object_terms, "object_terms")
    if err:
        return {"error": err}
    cats, err = _parse_arr(arxiv_categories, "arxiv_categories")
    if err:
        return {"error": err}
    doms, err = _parse_arr(domains, "domains")
    if err:
        return {"error": err}
    seeds, err = _parse_required_seeds(required_seeds)
    if err:
        return {"error": err}

    result = await search_service.retrieve(
        research_question=research_question,
        keywords=kws,
        sources=src,
        method_terms=mt,
        object_terms=ot,
        arxiv_categories=cats,
        domains=doms,
        top_k=top_k,
        enrich=enrich,
        session_id=session_id or None,
        turn_id=turn_id or None,
        required_seeds=seeds or None,
    )
    # 一轮检索结束 → 重置 per-session search budget（与 process_search_results 一致）
    if isinstance(result, dict) and "error" not in result:
        _reset_search_budget()
    return result


@mcp.tool()
async def apply_rerank(
    scores: str,
    session_id: str = "",
    turn_id: str = "",
) -> dict:
    """把 LLM rerank 分数回写 session JSONL（Stage 3 / P1-1）。

    取代"把整套排序集以结构化文本吐回 context"的做法：rerank 阶段只需对
    `retrieve` 返回的 `top_k` 产出 `{handle: llm_relevance}`（小 JSON），调用
    本工具即可。服务端按 `final = 0.6·F22 + 0.4·(llm×100)` 就地更新每条 record
    的 `extra.finalRelevance`（并记 `extra.llmRelevance`），保留 F22 基分
    `extra.relevance` 不变；面板按 finalRelevance 重排。

    **不要再把论文标题/摘要/整张表复述回来** —— 只输出分数映射、调本工具。

    Args:
        scores: ✅ 必填。JSON 对象字符串 `{handle: llm_relevance}`。handle 用
            `retrieve` 返回的 top_k[].handle；llm_relevance ∈ [0,1]，越界自动
            clamp。示例: '{"2402.13753v1": 0.95, "W4414197699": 0.4}'。
        session_id: 为空读环境变量 ASCI_SESSION_ID。
        turn_id: 本轮 retrieve 返回的 turn_id；只更新该 turn 的 records。

    Returns:
        {updated, missing, total_in_turn, output_path, turn_id} 或 {error}。
    """
    import json as _json

    try:
        parsed = _json.loads(scores)
    except (_json.JSONDecodeError, TypeError) as e:
        return {"error": f"scores JSON 解析失败: {e}"}
    if not isinstance(parsed, dict) or not parsed:
        return {"error": "scores 必须是非空 JSON 对象 {handle: 分数}"}

    return await _apply_rerank_core(
        scores=parsed,
        session_id=session_id or None,
        turn_id=turn_id or None,
    )


@mcp.tool()
async def apply_scoring(
    scores: str,
    session_id: str = "",
    turn_id: str = "",
) -> dict:
    """把 scorer 子 Agent 的语义/方法分算成 v2 七维评分，写回 session JSONL 的 extra.score。

    与 apply_rerank（v1 finalRelevance）**并行**：本工具产出证据驱动的多维分
    （venue_quality/publication_status/recency/influence/reproducibility 由服务端从
    record 现有字段就地算，含 extra.journalRank），加 null 权重重分配 + 等级 S/A/B/C/D
    + data_confidence。不改 v1 任何字段。**不要把论文表/摘要复述回来** —— 只输出分数映射。

    Args:
        scores: ✅ 必填。JSON 对象字符串 `{handle: {"semantic": 0-100, "method": 0-100}}`，
            handle 用 retrieve 返回的 top_k[].handle。
            示例: '{"2402.13753v1": {"semantic": 95, "method": 90}}'。
        session_id: 为空读环境变量 ASCI_SESSION_ID。
        turn_id: 本轮 retrieve 返回的 turn_id；只评分该 turn 的 records。

    Returns:
        {scored, missing, total_in_turn, output_path, turn_id} 或 {error}。
    """
    import json as _json

    try:
        parsed = _json.loads(scores)
    except (_json.JSONDecodeError, TypeError) as e:
        return {"error": f"scores JSON 解析失败: {e}"}
    if not isinstance(parsed, dict) or not parsed:
        return {"error": "scores 必须是非空 JSON 对象 {handle:{semantic,method}}"}

    from ..service.process_service import apply_scoring as _apply_scoring_core
    return await _apply_scoring_core(
        scores=parsed,
        session_id=session_id or None,
        turn_id=turn_id or None,
    )


@mcp.tool()
async def get_scoring_shard(
    shard_index: int,
    shard_count: int = 3,
    session_id: str = "",
    turn_id: str = "",
) -> dict:
    """返回本轮 V2 判分窗口的第 shard_index 个分片（共 shard_count 片），供 scorer shard 并行判分。

    服务端确定**判分窗口**（本轮 turn 内 F22 相关度 > 阈值 或 方法轴命中 的候选，含 forced
    seeds，带 floor / cap）与**分片规则**（round-robin，不相交、合并即完整窗口）。scorer shard
    只读自己分片内的候选并判 semantic/method，再用 apply_scoring 回写——**不要**自己读整份
    JSONL 切片。单 scorer fallback：shard_count=1 / shard_index=0 → 返回整窗。

    Args:
        shard_index: ✅ 必填。0..shard_count-1。
        shard_count: 分片总数，默认 3。
        session_id: 为空读环境变量 ASCI_SESSION_ID。
        turn_id: 指定只取该 turn；为空自动取最新 turn。

    Returns:
        {turn_id, shard_index, shard_count, window_total, shard_size, candidates,[note]}
        或 {error}（shard_count<1 / shard_index 越界）。空窗口 / 空 shard 返回 candidates:[] + note，不报错。
    """
    from ..service.process_service import get_scoring_shard as _get_scoring_shard_core
    return await _get_scoring_shard_core(
        shard_index=shard_index,
        shard_count=shard_count,
        session_id=session_id or None,
        turn_id=turn_id or None,
    )


@mcp.tool()
async def score_window(
    research_question: str,
    method_terms: list | None = None,
    object_terms: list | None = None,
    shard_count: int = 3,
    session_id: str = "",
    turn_id: str = "",
) -> dict:
    """整轮判分（#745）：服务端选判分窗口 → round-robin 切批 → 并发调模型判 semantic/method
    （barrier，某批失败不阻断其余）→ 算 score 七维写回 session JSONL。一次调用完成整轮打分。

    取代「派多个 scorer 子 Agent 并行判分」——派发在服务端确定性代码里，不依赖主编排 Agent
    的指令遵循（修复 parallel 分片退化为串行派发，#745）。模型渠道由主进程经 env 注入
    （ASCI_SCORING_MODEL / ASCI_SCORING_BASE_URL / ASCI_SCORING_API_KEY）。

    Args:
        research_question: ✅ 必填。用户研究问题原文（判分锚点，scorer 据此判相关度）。
        method_terms: 可选字符串数组，方法术语（次要提示）。示例: ["positional interpolation"]。
        object_terms: 可选字符串数组，对象术语（次要提示）。
        shard_count: 内部并发批数，默认 3。空窗口 / 小窗口均正常工作。
        session_id: 为空读环境变量 ASCI_SESSION_ID。
        turn_id: 只评分该 turn；为空自动取最新 turn。

    Returns:
        {scored, missing, window_total, shard_count, failed_shards, turn_id,[note]} 或 {error}。
    """
    from ..service.process_service import score_window as _score_window_core
    return await _score_window_core(
        research_question=research_question,
        method_terms=method_terms or [],
        object_terms=object_terms or [],
        shard_count=shard_count,
        session_id=session_id or None,
        turn_id=turn_id or None,
    )


# ========== Static special-parameter tools ==========

@mcp.tool()
async def search_arxiv(
    query: str,
    max_results: int = 10,
    categories: Optional[List[str]] = None,
    slim: bool = True,
) -> Dict[str, Any]:
    """Search arXiv preprints, with optional category filter to cut cross-domain noise.

    Triggers when the user names arXiv as the source, or when the topic is
    physics / math / CS / quant-bio preprints. `search_papers(sources="arxiv")`
    does not expose `categories`; this tool does.

    arXiv full-text search matches keywords across ALL categories — querying
    "rope" returns RoPE position-embedding papers AND fiber-rope damage
    detection AND solar flux ropes in roughly equal measure. Set `categories`
    to scope the search and remove the cross-domain noise.

    Args:
        query: Required. Keywords or title fragment.
        max_results: 1..50, default 10.
        categories: Optional arXiv category whitelist. Common values:
            - NLP / LLM topics:  ["cs.CL", "cs.LG", "cs.AI", "stat.ML"]
            - CV:                ["cs.CV"]
            - Systems / DB:      ["cs.DC", "cs.DB"]
            - Bio:               ["q-bio.GN", "q-bio.QM", ...]
            Single category → `cat:X AND all:<q>`; multiple →
            `(cat:A OR cat:B) AND all:<q>`. Empty / None → no filter
            (backward-compatible with the previous arxiv search behaviour).
        slim: If True (default), the `papers` array in the response is
            slimmed (identity fields only — title/authors/year/doi/url/
            venue/source — no abstract). Full untouched papers stay in
            MCP server memory under `_handle`; pass `_handle` to
            `process_search_results(handles=[...])` to consume them.
            See search_semantic docstring for the full handle protocol.

    Returns:
        dict with keys `_handle`, `count`, `papers`. See search_semantic
        return docstring for shape details.

    Side effects:
        One HTTP request to arxiv.org/api. No DB writes.

    Do NOT use for:
        - Multi-source search → `search_papers`.
        - Topics outside arXiv's domain coverage (e.g. clinical medicine,
          social sciences) → `search_papers` or domain-specific tools.
    """
    budget = _check_and_increment_search_budget()
    if not budget["ok"]:
        return _budget_exceeded_response(budget)
    connector = search_service.registry.get("arxiv")
    if connector is None:
        return {"_handle": "", "count": 0, "papers": []}
    kwargs: Dict[str, Any] = {}
    if categories:
        kwargs["categories"] = categories
    papers = await search_service._async_search(connector, query, max_results, **kwargs)
    full = [p.to_api_dict() for p in papers]
    handle = _store_papers(full, "arxiv") if full else ""
    return {
        "_handle": handle,
        "count": len(full),
        "papers": [_slim_paper(p) for p in full] if slim else full,
    }


@mcp.tool()
async def search_semantic(
    query: str, year: Optional[str] = None, max_results: int = 10, slim: bool = True
) -> Dict[str, Any]:
    """Search Semantic Scholar only, with native year-range filter support.

    Triggers when the user names Semantic Scholar as the source, or when
    the year filter syntax below is needed. `search_papers` only passes
    `year` to Semantic Scholar; this tool exposes the full range syntax
    and returns raw per-source results without cross-source dedup.

    Semantic Scholar is a cross-domain index (covers CS, general science,
    some biomedical/social sciences) with abstracts, citation counts, and
    paper embeddings in its metadata.

    Args:
        query: Required. Keywords or title fragment.
        year: Optional year filter. Supports:
            - single year: "2019"
            - closed range: "2016-2020"
            - open upper: "2010-"   (2010 onward)
            - open lower: "-2015"   (through 2015)
        max_results: 1..100, default 10. Semantic Scholar's bulk search cap
            is 100.
        slim: If True (default), the `papers` array in the response is
            slimmed (identity fields only — title/authors/year/doi/url/venue/
            source — no abstract). The full untouched papers are still stored
            in MCP server memory under `_handle`; downstream
            `process_search_results` MUST be called with `handles=[_handle]`
            to consume them — that path bypasses re-emitting JSON through
            the agent and skips redundant enrich for papers whose source
            already returned an abstract. Use slim=False only when the
            agent genuinely needs to inspect full content in-context.

    Returns:
        dict with keys:
            - _handle (str): opaque token referencing the full papers list
              in MCP server memory (TTL 10 min). Pass to
              `process_search_results(handles=[...])`.
            - count (int): number of papers stored.
            - papers (list[dict]): slim or full papers depending on `slim`.
              In slim mode: title/authors/year/doi/url/venue/source only.
              Empty list when count=0.

    Side effects:
        One HTTP request to S2 /paper/search. Rate-limited (~1 req/s).
        No DB writes.

    Do NOT use for:
        - Multi-source search → `search_papers`.
        - Citation-graph traversal → `snowball_search`.
        - When no year filter is needed and broader coverage wanted →
          `search_papers(sources="all")`.
    """
    budget = _check_and_increment_search_budget()
    if not budget["ok"]:
        return _budget_exceeded_response(budget)
    connector = search_service.registry.get("semantic")
    if connector is None:
        return {"_handle": "", "count": 0, "papers": []}
    kwargs = {"year": year} if year else {}
    papers = await search_service._async_search(connector, query, max_results, **kwargs)
    full = [p.to_api_dict() for p in papers]
    handle = _store_papers(full, "semantic") if full else ""
    return {
        "_handle": handle,
        "count": len(full),
        "papers": [_slim_paper(p) for p in full] if slim else full,
    }


@mcp.tool()
async def search_crossref(
    query: str,
    max_results: int = 10,
    filter: Optional[str] = None,
    sort: Optional[str] = None,
    order: Optional[str] = None,
    slim: bool = True,
) -> Dict[str, Any]:
    """Search CrossRef only, exposing CrossRef's native filter/sort controls.

    Triggers when the user names CrossRef as the source, or when
    CrossRef-specific filtering is needed (e.g. open-access-only, date
    ranges, type=journal-article). `search_papers(sources="crossref")`
    does not expose these filters; this tool does.

    CrossRef is the authoritative DOI registry — cross-domain coverage of
    publisher/journal metadata (venue, publisher, ISSN, publication date).
    Abstracts are often missing from CrossRef records; `enrich_paper` can
    fill them from other sources.

    Args:
        query: Required. Keywords or title fragment. CrossRef matches on
            title/author/bibliography text.
        max_results: 1..1000, default 10. CrossRef pagination cap is 1000.
        filter: Optional CrossRef filter string, comma-separated key:value.
            Examples:
                "has-full-text:true"
                "from-pub-date:2020,until-pub-date:2023"
                "type:journal-article"
            Full list: https://api.crossref.org/swagger-ui
        sort: Optional. One of "relevance" (default), "published",
            "indexed", "is-referenced-by-count", "score", "updated".
        order: Optional. "asc" or "desc". Only meaningful with `sort`.
        slim: If True (default), the `papers` array is slimmed; full records
            stay in MCP memory under `_handle` for `process_search_results`.
            See search_semantic docstring for the full handle protocol.

    Returns:
        dict with keys `_handle`, `count`, `papers`. See search_semantic
        return docstring for shape details. Abstract field is often empty
        on CrossRef — `process_search_results(enrich=True)` will fill it.

    Side effects:
        One HTTP request to CrossRef /works. No DB writes.

    Do NOT use for:
        - Lookup by known DOI → `get_crossref_paper_by_doi`.
        - Multi-source search → `search_papers`.
        - When abstracts are essential → `search_semantic` or
          `search_papers(sources="semantic,openalex")`.
    """
    budget = _check_and_increment_search_budget()
    if not budget["ok"]:
        return _budget_exceeded_response(budget)
    connector = search_service.registry.get("crossref")
    if connector is None:
        return {"_handle": "", "count": 0, "papers": []}
    kwargs = {k: v for k, v in {"filter": filter, "sort": sort, "order": order}.items() if v is not None}
    papers = await search_service._async_search(connector, query, max_results, **kwargs)
    full = [p.to_api_dict() for p in papers]
    handle = _store_papers(full, "crossref") if full else ""
    return {
        "_handle": handle,
        "count": len(full),
        "papers": [_slim_paper(p) for p in full] if slim else full,
    }


@mcp.tool()
async def search_iacr(
    query: str, max_results: int = 10, fetch_details: bool = True, slim: bool = True
) -> Dict[str, Any]:
    """Search the IACR ePrint Archive (cryptology preprints).

    Triggers when the topic is cryptography, zero-knowledge proofs, MPC,
    post-quantum crypto, blockchain protocols, etc., or when the user names
    IACR as the source. IACR ePrint is the primary crypto preprint server
    and is not indexed well by general search engines.

    Exposes `fetch_details` which is NOT available on `search_papers(sources="iacr")`.

    Args:
        query: Required. Keywords, author name, or paper title fragment.
        max_results: 1..50, default 10.
        fetch_details: If True (default), fetches abstract and full metadata
            per result (slower, N+1 HTTP requests). Set False to get just
            title/authors/id quickly from the listing page.
        slim: If True (default), the `papers` array is slimmed; full records
            stay in MCP memory under `_handle` for `process_search_results`.
            See search_semantic docstring for the full handle protocol.

    Returns:
        dict with keys `_handle`, `count`, `papers`. See search_semantic
        for shape details. With slim=False the `papers` entries include
        abstract (empty if fetch_details=False) and pdf_url pointing to
        eprint.iacr.org.

    Side effects:
        HTTP requests to eprint.iacr.org (1 + N if fetch_details=True).
        No DB writes.

    Do NOT use for:
        - Non-cryptography topics → `search_papers`.
        - Cross-source search → `search_papers`.
    """
    budget = _check_and_increment_search_budget()
    if not budget["ok"]:
        return _budget_exceeded_response(budget)
    connector = search_service.registry.get("iacr")
    if connector is None:
        return {"_handle": "", "count": 0, "papers": []}
    papers = await asyncio.to_thread(connector.search, query, max_results, fetch_details=fetch_details)
    full = [p.to_api_dict() for p in (papers or [])]
    handle = _store_papers(full, "iacr") if full else ""
    return {
        "_handle": handle,
        "count": len(full),
        "papers": [_slim_paper(p) for p in full] if slim else full,
    }


# ========== Dynamic tool registration ==========

_STATIC_SEARCH_TOOLS = {"arxiv", "semantic", "crossref", "iacr"}


def _register_search_tool(name: str) -> None:
    _name = name

    async def tool_fn(query: str, max_results: int = 10, slim: bool = True) -> Dict[str, Any]:
        budget = _check_and_increment_search_budget()
        if not budget["ok"]:
            return _budget_exceeded_response(budget)
        connector = search_service.registry.get(_name)
        if connector is None:
            return {"_handle": "", "count": 0, "papers": []}
        papers = await search_service._async_search(connector, query, max_results)
        full = [p.to_api_dict() for p in papers]
        handle = _store_papers(full, _name) if full else ""
        return {
            "_handle": handle,
            "count": len(full),
            "papers": [_slim_paper(p) for p in full] if slim else full,
        }

    tool_fn.__name__ = f"search_{name}"
    tool_fn.__doc__ = (
        f"Search papers from the {name} source only (single-source, no cross-source dedup).\n"
        f"\n"
        f"Triggers when the user names \"{name}\" as the source, or when the\n"
        f"topic matches {name}'s domain specifically. Returns raw {name} hits\n"
        f"without merging against other sources.\n"
        f"\n"
        f"Args:\n"
        f"    query: Required. Keywords or title fragment.\n"
        f"    max_results: 1..50, default 10. Source-side cap may be lower.\n"
        f"    slim: If True (default), the `papers` array in the response is\n"
        f"        slimmed (identity fields only — title/authors/year/doi/url/\n"
        f"        venue/source — no abstract). Full untouched papers stay in\n"
        f"        MCP server memory under `_handle`; pass `_handle` to\n"
        f"        `process_search_results(handles=[...])` to consume them —\n"
        f"        that bypasses re-emitting JSON through agent context and\n"
        f"        skips redundant enrich for sources that already return\n"
        f"        an abstract. Use slim=False only when agent must inspect\n"
        f"        full content in-context.\n"
        f"\n"
        f"Returns:\n"
        f"    dict with keys:\n"
        f"        - _handle (str): opaque token referencing the full papers\n"
        f"          list in MCP server memory (TTL 10 min). Pass to\n"
        f"          process_search_results(handles=[...]).\n"
        f"        - count (int): number of papers stored.\n"
        f"        - papers (list[dict]): slim or full papers depending on\n"
        f"          `slim`. In slim mode: title/authors/year/doi/url/venue/\n"
        f"          source only. Empty list when count=0.\n"
        f"\n"
        f"Side effects:\n"
        f"    One HTTP request to the {name} API. No DB writes.\n"
        f"\n"
        f"Do NOT use for:\n"
        f"    - Searching across multiple sources at once → `search_papers`.\n"
        f"    - Topics clearly outside {name}'s domain coverage.\n"
    )
    tool_fn.__qualname__ = f"search_{name}"
    mcp.tool()(tool_fn)


def _register_read_tool(name: str) -> None:
    _name = name

    async def tool_fn(paper_id: str, save_path: str = "./downloads") -> str:
        connector = search_service.registry.get(_name)
        if connector is None:
            return f"Connector {_name} not available."
        return await asyncio.to_thread(connector.read_paper, paper_id, save_path)

    tool_fn.__name__ = f"read_{name}_paper"
    tool_fn.__doc__ = (
        f"Download and extract plain-text content of a {name} paper.\n"
        f"\n"
        f"Use this when the user wants to READ / SUMMARIZE / QUERY the full\n"
        f"text of a paper and you already know its {name} identifier. Unlike\n"
        f"`download_paper` (which saves the PDF bytes), this returns the\n"
        f"extracted text ready for LLM consumption.\n"
        f"\n"
        f"Args:\n"
        f"    paper_id: Required. The {name}-native paper ID (format depends\n"
        f"        on source — arXiv ID, DOI, S2 hash, etc.).\n"
        f"    save_path: Directory for intermediate PDF cache. Default\n"
        f"        \"./downloads\". Created if missing.\n"
        f"\n"
        f"Returns:\n"
        f"    String: extracted plain text on success, or an error message\n"
        f"    (e.g. \"Connector {name} not available.\", PDF parse failure).\n"
        f"\n"
        f"Side effects:\n"
        f"    Downloads the PDF to `save_path` (cached), then runs text\n"
        f"    extraction. HTTP requests to the {name} server.\n"
        f"\n"
        f"Do NOT use for:\n"
        f"    - Just saving the PDF file → `download_paper`.\n"
        f"    - Papers not hosted on {name} — wrong source will 404.\n"
    )
    tool_fn.__qualname__ = f"read_{name}_paper"
    mcp.tool()(tool_fn)


def _register_platform_tools() -> None:
    for name in search_service.available_sources():
        connector = search_service.registry.get(name)
        if connector is None:
            continue
        caps = connector.capabilities

        if name not in _STATIC_SEARCH_TOOLS:
            _register_search_tool(name)

        if caps.read:
            _register_read_tool(name)


_register_platform_tools()


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Paper Search MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default="stdio",
        help="Transport protocol (default: stdio)",
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Host to bind for SSE/HTTP (default: 0.0.0.0)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port for SSE/HTTP (default: 8000)",
    )
    args = parser.parse_args()

    if args.transport in ("sse", "streamable-http"):
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        # Allow LAN access by disabling DNS rebinding protection
        mcp.settings.transport_security.enable_dns_rebinding_protection = False
        # Stateless mode: no session affinity required, works behind LB/CDN
        mcp.settings.stateless_http = True

    mcp.run(transport=args.transport)


if __name__ == "__main__":
    main()
