from typing import List, Optional
from datetime import datetime
import os
import requests
import logging
from ..models.paper import Paper
from .base import PaperConnector, ConnectorCapabilities
from .http_proxy import ProxyFallbackSession
from .registry import register
from ..utils import extract_doi

logger = logging.getLogger(__name__)


def _is_dead_repository_url(url: str) -> bool:
    """识别打不开的数据仓库聚合页 url。

    figshare collection（DOI 形如 ``10.6084/m9.figshare.c.<id>``，URL 含 ``figshare.c.``）
    是把多个文件聚在一起的集合页，不是论文正文，常返回 403。OpenAlex 时常把论文的
    primary_location 选成作者上传的 figshare 副本，导致 landing url 指向这种打不开的页面。
    """
    return "figshare.c." in (url or "").lower()


@register("openalex")
class OpenAlexConnector(PaperConnector):
    """OpenAlex paper search implementation"""
    capabilities = ConnectorCapabilities(search=True, download=True, read=True)
    # 解析出的 Paper.source 取此类属性，子类（如 JournalConnector）覆盖即可复用全部解析逻辑。
    SOURCE_NAME = "openalex"

    BASE_URL = "https://api.openalex.org/works"

    def __init__(self):
        # #743：enrich 上下文内走「直连优先 + 失败回退代理」，召回路径行为不变。
        self.session = ProxyFallbackSession()
        # OpenAlex encourages providing an email in User-Agent for the "polite pool"
        self.session.headers.update(
            {"User-Agent": "paper-search-mcp/1.0 (mailto:asci@opensci.io)"}
        )

    def _reconstruct_abstract(self, inverted_index: dict) -> str:
        """
        OpenAlex provides abstracts as an inverted index to save space.
        This function reconstructs the original abstract text.
        """
        if not inverted_index:
            return ""
        try:
            word_positions = []
            for word, positions in inverted_index.items():
                for pos in positions:
                    word_positions.append((pos, word))
            # Sort by position
            word_positions.sort(key=lambda x: x[0])
            return " ".join([word for _, word in word_positions])
        except Exception as e:
            logger.warning(f"Error reconstructing OpenAlex abstract: {e}")
            return ""

    def search(self, query: str, max_results: int = 10, **kwargs) -> List[Paper]:
        """
        Search OpenAlex works. Two-stage strategy:
          1. title-first via ``filter=title.search:<query>`` for precision
          2. fallback to broad ``search=<query>`` to fill remaining slots

        Set env ``PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST=1`` to skip
        stage 1 and only run broad search (kept for A/B regression).

        ``mode="title_exhaust"`` (kwargs) switches to精确核心词全量召回：先读
        ``title.search`` 的 ``meta.count``，超过 ``core_threshold``（默认 1000，
        kwargs 可覆盖）视为泛词，返回已拉到的第 1 页前 ``generic_fallback``
        （默认 10）篇兜底——exhaust cell 在矩阵里顶替了同 query 的裸 cell，若
        泛词返回 [] 该 query 的 OpenAlex 贡献会直接归零（召回回退）；第 1 页
        本来就已请求回来，取头部零额外成本，与裸 cell 的 title-first @10 等价。
        核心词则 cursor 翻页拉全量到 ``min(count, max_results)``。详见 spec
        ``docs/specs/lit-search-precise-core-exhaustion-spec.md``。

        Args:
            query: Search query string
            max_results: Maximum results to return (natively max 200 per page)

        Returns:
            List[Paper]: List of found papers with metadata.
        """
        if kwargs.get("mode") == "title_exhaust":
            core_threshold = int(kwargs.get("core_threshold", 1000))
            generic_fallback = int(kwargs.get("generic_fallback", 10))
            return self._fetch_title_exhaust(
                query,
                core_threshold=core_threshold,
                limit=max_results,
                generic_fallback=generic_fallback,
            )

        if os.getenv("PAPER_SEARCH_MCP_OPENALEX_DISABLE_TITLE_FIRST"):
            return self._fetch_works(
                {"search": query, "per_page": min(max_results, 200)},
                limit=max_results,
            )

        # Stage 1: title.search (high precision)
        title_papers = self._fetch_works(
            {"filter": f"title.search:{query}", "per_page": min(max_results, 200)},
            limit=max_results,
        )
        if len(title_papers) >= max_results:
            return title_papers[:max_results]

        # Stage 2: broad search to fill the rest (dedup by paper_id)
        seen = {p.paper_id for p in title_papers if p.paper_id}
        remaining = max_results - len(title_papers)
        broad = self._fetch_works(
            {"search": query, "per_page": min(remaining * 2, 200)},
            limit=remaining * 2,
        )
        for p in broad:
            if p.paper_id and p.paper_id not in seen:
                title_papers.append(p)
                seen.add(p.paper_id)
                if len(title_papers) >= max_results:
                    break
        return title_papers

    def _fetch_works(self, params: dict, limit: int) -> List[Paper]:
        """
        Single OpenAlex ``/works`` GET + parse loop. Returns up to *limit* papers.

        Per-item defensive None handling: OpenAlex returns ``{"doi": null}`` /
        ``{"id": null}`` for items missing those fields, and ``dict.get(key, "")``
        returns ``None`` (not "") when the key exists with a null value. Each
        ``.get(key, "")`` that fed a strict ``str`` field has been switched to
        ``.get(key) or ""`` to prevent Pydantic ValidationError from silently
        early-exiting the loop.
        """
        papers: List[Paper] = []
        try:
            response = self.session.get(self.BASE_URL, params=params, timeout=30)
            # 非 200（429 限速 / 5xx 等）→ 抛 HTTPError，让上层 _timed_search 标 ok=False；
            # 不再静默吞成空列表（否则失败会被误判成「204 真空」，自动重试 / 失败上报都失灵）。
            response.raise_for_status()

            data = response.json()
            results = data.get("results", [])

            for item in results:
                if len(papers) >= limit:
                    break
                paper = self._parse_item(item)
                if paper is not None:
                    papers.append(paper)

        except requests.exceptions.RequestException:
            # 网络 / HTTP 失败：向上抛，由 _timed_search 标记为失败（ok=False），
            # 不并入「真空」。解析类异常仍在下方吞掉以保持原有容错。
            raise
        except Exception as e:
            logger.error(f"OpenAlex search error: {e}")

        return papers

    def _parse_item(self, item: dict) -> Optional[Paper]:
        """把单条 OpenAlex work 解析成 Paper；标题缺失或解析失败返回 None。

        逐条防御性 None 处理：OpenAlex 对缺失字段返回 ``null``，``dict.get(k, "")``
        在 key 存在且值为 null 时返回 None（非 ""），故每个喂给严格 str 字段的取值
        都用 ``.get(k) or ""``，避免 Pydantic ValidationError 静默中断整批。
        """
        # ID usually looks like 'https://openalex.org/W2741809807'
        paper_id = (item.get("id") or "").replace("https://openalex.org/", "")
        title = item.get("title")
        if not title:
            return None  # Skip items without a title

        authors = [
            author.get("author", {}).get("display_name", "")
            for author in item.get("authorships", [])
            if author.get("author", {}).get("display_name")
        ]

        abstract = self._reconstruct_abstract(item.get("abstract_inverted_index"))

        # DOI: OpenAlex returns null when missing — coerce to ""
        doi = item.get("doi") or ""
        if doi:
            doi = doi.replace("https://doi.org/", "")
        if not doi and abstract:
            doi = extract_doi(abstract)

        # URLs: every .get() may resolve to None
        url = ""
        pdf_url = ""
        venue = ""
        primary_location = item.get("primary_location")
        if primary_location:
            url = primary_location.get("landing_page_url") or ""
            pdf_url = primary_location.get("pdf_url") or ""
            # venue（期刊 / 会议名）：source.display_name 优先（已链接到 OpenAlex
            # source 实体的规范名），为空时兜底 raw_source_name（会议论文常只有原始
            # 串，source 未被链接）。source 子对象本身可能为 null。
            source_obj = primary_location.get("source") or {}
            venue = (source_obj.get("display_name") or "").strip() \
                or (primary_location.get("raw_source_name") or "").strip()
        # landing url 是 figshare collection 等打不开的聚合页时（OpenAlex 常把论文的
        # primary_location 选成作者上传的数据仓库副本，collection 页 403），依次回退：
        # best_oa_location（若是可用正式来源）→ OpenAlex 详情页（item.id 必可点开，展示
        # 元数据 + 各版本链接）。避免 top 论文给用户一个点不开的链接。
        if _is_dead_repository_url(url):
            boa = (item.get("best_oa_location") or {}).get("landing_page_url") or ""
            url = boa if (boa and not _is_dead_repository_url(boa)) else (item.get("id") or url)
        if not url:
            url = item.get("id") or ""

        open_access = item.get("open_access") or {}
        if not pdf_url and open_access.get("is_oa"):
            pdf_url = open_access.get("oa_url") or ""

        pub_date_str = item.get("publication_date")
        published_date = None
        if pub_date_str:
            try:
                published_date = datetime.strptime(pub_date_str, "%Y-%m-%d")
            except ValueError:
                pass

        concepts = [
            concept.get("display_name")
            for concept in item.get("concepts", [])
            if concept.get("display_name")
        ]

        # Per-item try/except: one malformed record cannot abort the batch.
        try:
            return Paper(
                paper_id=paper_id,
                title=title,
                authors=authors,
                abstract=abstract,
                url=url,
                pdf_url=pdf_url,
                published_date=published_date,
                source=self.SOURCE_NAME,
                categories=concepts[:5],
                doi=doi,
                venue=venue,
                citations=item.get("cited_by_count", 0),
            )
        except Exception as e:
            logger.warning(f"OpenAlex: skipping malformed item {paper_id!r}: {e}")
            return None

    def _fetch_title_exhaust(
        self,
        query: str,
        *,
        core_threshold: int,
        limit: int,
        generic_fallback: int = 10,
    ) -> List[Paper]:
        """精确核心词全量召回（mode="title_exhaust"）。

        先拉第 1 页（per_page=200, cursor='*'）读 ``meta.count``：
          · count > core_threshold → 泛词，返回第 1 页前 generic_fallback 篇兜底
            （不翻页）。不能返回 []：exhaust cell 顶替了同 query 的裸 cell，泛词
            归零等于该 query 的 OpenAlex 召回回退；第 1 页已在手，取头部零成本，
            ordering 与裸 cell 的 title-first stage 相同；
          · count ≤ threshold      → cursor 翻页累计全量到 min(count, limit)。

        翻页用 OpenAlex cursor 分页（稳定、无 deep-paging 限制）。任一页 HTTP 失败
        向上抛由 _timed_search 标记失败；解析异常逐条吞掉（_parse_item 内）。
        """
        # select 只取 _parse_item 需要的字段，削掉每页 payload（实测 4.4MB→2.4MB/页，
        # 翻多页时显著降低传输/解析耗时）。
        select = (
            "id,title,authorships,abstract_inverted_index,doi,"
            "primary_location,best_oa_location,open_access,publication_date,concepts,cited_by_count"
        )
        papers: List[Paper] = []
        cursor = "*"
        first = True
        while cursor:
            response = self.session.get(
                self.BASE_URL,
                params={
                    "filter": f"title.search:{query}",
                    "per_page": 200,
                    "cursor": cursor,
                    "select": select,
                },
                # 单页须明显小于 cell 级 PRECISE_CORE_TIMEOUT_SEC(25s)：实测每页
                # <1~3s，10s 足够；挂页 fail-fast，否则一页烧光 cell 预算且
                # asyncio.wait_for 超时后已翻完的页整体丢弃。
                timeout=10,
            )
            response.raise_for_status()
            data = response.json()

            if first:
                count = int((data.get("meta") or {}).get("count") or 0)
                if count > core_threshold:
                    # 泛词：不翻页，返回第 1 页头部兜底（顶替裸 cell 后的召回保底，
                    # 详见 docstring）。
                    logger.info(
                        "[%s] title_exhaust generic term %r: count=%d > %d, "
                        "fallback to first-page head @%d",
                        self.SOURCE_NAME, query, count, core_threshold, generic_fallback,
                    )
                    head: List[Paper] = []
                    for item in data.get("results", []):
                        if len(head) >= max(0, generic_fallback):
                            break
                        paper = self._parse_item(item)
                        if paper is not None:
                            head.append(paper)
                    return head
                first = False

            for item in data.get("results", []):
                if len(papers) >= limit:
                    return papers
                paper = self._parse_item(item)
                if paper is not None:
                    papers.append(paper)

            cursor = (data.get("meta") or {}).get("next_cursor")
            if not data.get("results"):
                break  # 防御：空页即停，避免 cursor 不前进时死循环

        return papers

    def download_pdf(self, paper_id: str, save_path: str) -> str:
        """
        OpenAlex does not host PDFs natively, it only links to open access versions.
        """
        raise NotImplementedError(
            "OpenAlex does not provide direct PDF downloads natively. "
            "Please use the extracted 'pdf_url' if available, or DOI for fallback."
        )

    def read_paper(self, paper_id: str, save_path: str = "./downloads") -> str:
        """
        Not implemented for OpenAlex.
        """
        return (
            "OpenAlex papers cannot be read directly through this aggregator. "
            "Please use the paper's DOI or pdf_url to access the full text."
        )
