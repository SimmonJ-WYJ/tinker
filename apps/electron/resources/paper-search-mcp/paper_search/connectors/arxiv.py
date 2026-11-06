# paper_search/connectors/arxiv.py
from typing import List
from datetime import datetime
import requests
import feedparser
import random
import time
import threading
from ..models.paper import Paper
from ..utils import extract_doi
from .base import PaperConnector, ConnectorCapabilities
from .registry import register
from PyPDF2 import PdfReader
import os


# arxiv search 的 retry / timeout 控制
# 历史：原实现 3 次 retry + 单 timeout=30s + 1.5x linear backoff，理论最坏 99s。
# 现状（默认 max_retries=0 即不重试）：arxiv 上游故障窗口期通常持续几十分钟，
# 重试基本救不回；与其每次 18s 兜满 P0 wait_for，不如单次 ~11s 立即返空，让
# lit-search 通过其它 healthy 源（openalex/crossref）补足。需要重试的场景
# （如调试或刻意测试）通过 PAPER_SEARCH_ARXIV_MAX_RETRIES env 显式开启。
ARXIV_CONNECT_TIMEOUT_SEC = float(os.getenv("PAPER_SEARCH_ARXIV_CONNECT_TIMEOUT_SEC", "3"))
ARXIV_READ_TIMEOUT_SEC = float(os.getenv("PAPER_SEARCH_ARXIV_READ_TIMEOUT_SEC", "8"))
ARXIV_MAX_RETRIES = int(os.getenv("PAPER_SEARCH_ARXIV_MAX_RETRIES", "0"))
ARXIV_BACKOFF_SEC = float(os.getenv("PAPER_SEARCH_ARXIV_BACKOFF_SEC", "1.0"))

# 排序策略：arxiv API 支持 relevance / lastUpdatedDate / submittedDate。
# 历史 bug：默认 submittedDate+descending 会让 arxiv 先做关键词全文匹配、再按提交时间倒排，
# 结果导致最新论文（即使相关度低）总是排在前面 —— 在 2025 年后 arxiv 日增 ~500+ 篇时几乎
# 把任何 query 的 top-20 都污染成「当天提交的、含查询词但与意图无关的论文」。
# 默认改为 relevance；调试或专门拉时间排序时通过 env 覆盖。
ARXIV_SORT_BY = os.getenv("PAPER_SEARCH_ARXIV_SORT_BY", "relevance")
ARXIV_SORT_ORDER = os.getenv("PAPER_SEARCH_ARXIV_SORT_ORDER", "descending")

# Polite throttle：arxiv 官方政策建议 3s/request；searcher H4 fan-out 一次性
# 6 个并发 arxiv 请求会触发 429 持续 ban（实测 PR #380 端到端 6 次 arxiv 调用
# 全 0）。这里加 per-process 模块级节流，让并发 thread 在 connector 入口排队，
# arxiv 看到的是 3s/req 而非 N s/req。锁是 threading.Lock（同步 requests，
# mcp_server 用 asyncio.to_thread 包装，并发 worker 是 OS thread）。
ARXIV_MIN_INTERVAL_SEC = float(os.getenv("PAPER_SEARCH_ARXIV_MIN_INTERVAL_SEC", "3.0"))
_arxiv_lock = threading.Lock()
_arxiv_last_request_ts = 0.0


def _arxiv_throttle() -> float:
    """阻塞直到距离上次 arxiv 请求 ≥ ARXIV_MIN_INTERVAL_SEC。返回实际 sleep 秒数。

    并发安全：多个 thread 进入时按 lock 顺序排队；每个 thread 计算自己应等
    的时间，sleep，然后更新 last_request_ts。最坏情况 N 个并发 thread 串行等
    (N-1) × interval。
    """
    global _arxiv_last_request_ts
    with _arxiv_lock:
        elapsed = time.monotonic() - _arxiv_last_request_ts
        wait = max(0.0, ARXIV_MIN_INTERVAL_SEC - elapsed)
        if wait > 0:
            time.sleep(wait)
        _arxiv_last_request_ts = time.monotonic()
    return wait


def _jittered_backoff() -> float:
    """Linear backoff with ±50% jitter to avoid two retry attempts landing in
    the same upstream rate-limit window.

    With default ARXIV_BACKOFF_SEC=1.0 → returns 1.0–2.0s.
    """
    return ARXIV_BACKOFF_SEC * (1.0 + random.random())


@register("arxiv")
class ArxivConnector(PaperConnector):
    """Searcher for arXiv papers"""
    capabilities = ConnectorCapabilities(search=True, download=True, read=True)
    BASE_URL = "https://export.arxiv.org/api/query"

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'paper-search-mcp/1.0 (mailto:asci@opensci.io)',
            'Accept': 'application/atom+xml, application/xml;q=0.9, */*;q=0.8',
        })

    def search(self, query: str, max_results: int = 10, **kwargs) -> List[Paper]:
        # P0 polite throttle：跨 thread 节流到 3s/req，避免 fan-out 触发 429 ban。
        # 必须在 HTTP GET 之前调用；retry 循环内不再额外节流，因为 retry 已经
        # 暗含了 BACKOFF_SEC sleep。
        _arxiv_throttle()

        # categories: 可选 arxiv 分类白名单（如 ["cs.CL", "cs.LG"]）；
        # 全文检索 "rope" 会同时命中 RoPE 与纤维绳/磁绳，分类过滤把噪声卡掉。
        # 调用方按 domains 决定是否传，不传 / 空 list = 不加约束（向后兼容）。
        categories = kwargs.get('categories') or []
        if categories:
            cats = [f'cat:{c}' for c in categories]
            cat_expr = cats[0] if len(cats) == 1 else f"({' OR '.join(cats)})"
            search_query = f'{cat_expr} AND all:{query}'
        else:
            search_query = f'all:{query}'
        params = {
            'search_query': search_query,
            'max_results': max_results,
            'sortBy': ARXIV_SORT_BY,
            'sortOrder': ARXIV_SORT_ORDER,
        }
        response = None
        total_attempts = ARXIV_MAX_RETRIES + 1  # max_retries=1 → 共 2 次尝试
        for attempt in range(total_attempts):
            try:
                response = self.session.get(
                    self.BASE_URL,
                    params=params,
                    timeout=(ARXIV_CONNECT_TIMEOUT_SEC, ARXIV_READ_TIMEOUT_SEC),
                )
            except requests.RequestException:
                # fencepost 修复：最后一次失败不再 sleep
                if attempt < total_attempts - 1:
                    time.sleep(_jittered_backoff())
                continue
            if response.status_code == 200:
                break
            if response.status_code in (429, 500, 502, 503, 504):
                if attempt < total_attempts - 1:
                    time.sleep(_jittered_backoff())
                continue
            break  # 其他状态码（4xx 非 429）不重试

        if response is None or response.status_code != 200:
            return []

        feed = feedparser.parse(response.content)
        papers = []
        for entry in feed.entries:
            try:
                authors = [author.name for author in entry.authors]
                published = datetime.strptime(entry.published, '%Y-%m-%dT%H:%M:%SZ')
                updated = datetime.strptime(entry.updated, '%Y-%m-%dT%H:%M:%SZ')
                pdf_url = next((link.href for link in entry.links if link.type == 'application/pdf'), '')

                # Try to extract DOI from entry.doi or links or summary
                doi = entry.get('doi', '') or extract_doi(entry.summary) or extract_doi(entry.id)
                for link in entry.links:
                    if link.get('title') == 'doi':
                        doi = doi or extract_doi(link.href)

                # Synthesize arxiv DOI when no publisher DOI is available.
                # DataCite assigns 10.48550/arXiv.<id> to every arxiv submission.
                if not doi:
                    arxiv_id = entry.id.split('/abs/')[-1].replace('v', 'v')  # e.g. 2604.15313v1
                    # Strip version suffix for the canonical DOI
                    base_id = arxiv_id.split('v')[0] if 'v' in arxiv_id else arxiv_id
                    doi = f"10.48550/arXiv.{base_id}"

                # venue：已正式发表的 arxiv 条目带 journal_ref（刊名/会议），
                # 否则统一标 "arXiv"（与 OpenAlex 对 preprint 的 venue 命名对齐）。
                journal_ref = (getattr(entry, 'arxiv_journal_ref', '') or '').strip()
                venue = journal_ref or 'arXiv'

                papers.append(Paper(
                    paper_id=entry.id.split('/')[-1],
                    title=entry.title,
                    authors=authors,
                    abstract=entry.summary,
                    url=entry.id,
                    pdf_url=pdf_url,
                    published_date=published,
                    updated_date=updated,
                    source='arxiv',
                    categories=[tag.term for tag in entry.tags],
                    keywords=[],
                    doi=doi,
                    venue=venue,
                ))
            except Exception as e:
                print(f"Error parsing arXiv entry: {e}")
        return papers

    def download_pdf(self, paper_id: str, save_path: str) -> str:
        pdf_url = f"https://arxiv.org/pdf/{paper_id}.pdf"
        response = requests.get(pdf_url)
        os.makedirs(save_path, exist_ok=True)
        output_file = f"{save_path}/{paper_id}.pdf"
        with open(output_file, 'wb') as f:
            f.write(response.content)
        return output_file

    def read_paper(self, paper_id: str, save_path: str = "./downloads") -> str:
        """Read a paper and convert it to text format.

        Args:
            paper_id: arXiv paper ID
            save_path: Directory where the PDF is/will be saved

        Returns:
            str: The extracted text content of the paper
        """
        # First ensure we have the PDF
        pdf_path = f"{save_path}/{paper_id}.pdf"
        if not os.path.exists(pdf_path):
            pdf_path = self.download_pdf(paper_id, save_path)

        # Read the PDF
        try:
            reader = PdfReader(pdf_path)
            text = ""

            # Extract text from each page
            for page in reader.pages:
                text += page.extract_text() + "\n"

            return text.strip()
        except Exception as e:
            print(f"Error reading PDF for paper {paper_id}: {e}")
            return ""
