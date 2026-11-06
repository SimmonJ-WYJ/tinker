# paper_search/connectors/pubmed.py
import logging
import os
import random
import time
from typing import List, Optional
from xml.etree import ElementTree as ET
from datetime import datetime
import requests
from ..models.paper import Paper
from ..utils import extract_doi
from .base import PaperConnector, ConnectorCapabilities
from .registry import register

logger = logging.getLogger(__name__)

# PubMed (NCBI eutils) 网络容错。
# 4 次实测有 1/4 概率 eutils.ncbi.nlm.nih.gov 在 TLS 握手层返 SSL EOF 错误,
# TCP 重连基本必恢复 — 这是真正"retry 有用"的场景, 跟 arxiv 上游长故障窗口
# 模式相反。仅对 RequestException (SSLError / ConnectionError) + 429 / 5xx
# 重试; 200 + 空 ID 是真实"无命中", 不重试。
PUBMED_TIMEOUT_SEC = float(os.getenv("PAPER_SEARCH_PUBMED_TIMEOUT_SEC", "10"))
PUBMED_MAX_RETRIES = int(os.getenv("PAPER_SEARCH_PUBMED_MAX_RETRIES", "1"))
PUBMED_BACKOFF_SEC = float(os.getenv("PAPER_SEARCH_PUBMED_BACKOFF_SEC", "0.5"))


def _jittered_backoff() -> float:
    """0.5–1.0s with default; ±50% jitter to avoid retry synchronization."""
    return PUBMED_BACKOFF_SEC * (1.0 + random.random())


def _get_with_retry(url: str, params: dict) -> Optional[requests.Response]:
    """Bounded retry on transient network errors.

    Retries on RequestException (SSLError / ConnectionError) + 429 / 5xx.
    Does NOT retry on 200 — empty results mean real-zero hits.
    Returns the last response (None if all attempts threw).
    """
    response: Optional[requests.Response] = None
    total_attempts = PUBMED_MAX_RETRIES + 1
    for attempt in range(total_attempts):
        try:
            response = requests.get(url, params=params, timeout=PUBMED_TIMEOUT_SEC)
        except requests.RequestException as exc:
            logger.warning("pubmed request error (attempt %d/%d): %s",
                           attempt + 1, total_attempts, exc)
            if attempt < total_attempts - 1:
                time.sleep(_jittered_backoff())
            continue
        if response.status_code == 200:
            return response
        if response.status_code in (429, 500, 502, 503, 504):
            logger.warning("pubmed transient %d (attempt %d/%d)",
                           response.status_code, attempt + 1, total_attempts)
            if attempt < total_attempts - 1:
                time.sleep(_jittered_backoff())
            continue
        break  # 4xx 非 429 不重试
    return response


@register("pubmed")
class PubMedConnector(PaperConnector):
    """Searcher for PubMed papers"""
    capabilities = ConnectorCapabilities(search=True, download=True, read=True)
    SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    FETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

    def search(self, query: str, max_results: int = 10, **kwargs) -> List[Paper]:
        search_params = {
            'db': 'pubmed',
            'term': query,
            'retmax': max_results,
            'retmode': 'xml'
        }
        search_response = _get_with_retry(self.SEARCH_URL, search_params)
        if search_response is None or search_response.status_code != 200:
            return []
        search_root = ET.fromstring(search_response.content)
        ids = [id.text for id in search_root.findall('.//Id') if id.text]
        if not ids:
            return []

        fetch_params = {
            'db': 'pubmed',
            'id': ','.join(ids),
            'retmode': 'xml'
        }
        fetch_response = _get_with_retry(self.FETCH_URL, fetch_params)
        if fetch_response is None or fetch_response.status_code != 200:
            return []
        fetch_root = ET.fromstring(fetch_response.content)

        papers = []
        for article in fetch_root.findall('.//PubmedArticle'):
            try:
                pmid_elem = article.find('.//PMID')
                pmid = pmid_elem.text.strip() if pmid_elem is not None and pmid_elem.text else ''
                if not pmid:
                    continue

                title_elem = article.find('.//ArticleTitle')
                title = ''.join(title_elem.itertext()).strip() if title_elem is not None else ''
                if not title:
                    continue

                authors = []
                for author in article.findall('.//Author'):
                    last_name = author.find('LastName')
                    initials = author.find('Initials')
                    if last_name is not None and last_name.text:
                        name = last_name.text.strip()
                        if initials is not None and initials.text:
                            name = f"{name} {initials.text.strip()}"
                        authors.append(name)

                abstract_parts = []
                for abstract_elem in article.findall('.//AbstractText'):
                    text = ''.join(abstract_elem.itertext()).strip()
                    if text:
                        abstract_parts.append(text)
                abstract = ' '.join(abstract_parts)

                year_elem = article.find('.//PubDate/Year')
                pub_date = year_elem.text if year_elem is not None else None
                published = datetime.strptime(pub_date, '%Y') if pub_date else None
                doi_elem = article.find('.//ELocationID[@EIdType="doi"]')
                doi = doi_elem.text if doi_elem is not None else ''

                if not doi and abstract:
                    doi = extract_doi(abstract)

                # 期刊名：完整刊名优先，回退缩写
                journal_elem = (
                    article.find('.//Journal/Title')
                    or article.find('.//Journal/ISOAbbreviation')
                )
                journal = journal_elem.text.strip() if journal_elem is not None and journal_elem.text else ''

                papers.append(Paper(
                    paper_id=pmid,
                    title=title,
                    authors=authors,
                    abstract=abstract,
                    url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                    pdf_url='',  # PubMed 无直接 PDF
                    published_date=published,
                    updated_date=published,
                    source='pubmed',
                    categories=[],
                    keywords=[],
                    doi=doi,
                    venue=journal,
                ))
            except Exception:
                continue
        return papers

    def download_pdf(self, paper_id: str, save_path: str) -> str:
        """Attempt to download a paper's PDF from PubMed.

        Args:
            paper_id: PubMed ID (PMID)
            save_path: Directory to save the PDF

        Returns:
            str: Error message indicating PDF download is not supported

        Raises:
            NotImplementedError: Always raises this error as PubMed doesn't provide direct PDF access
        """
        message = ("PubMed does not provide direct PDF downloads. "
                  "Please use the paper's DOI or URL to access the publisher's website.")
        raise NotImplementedError(message)

    def read_paper(self, paper_id: str, save_path: str = "./downloads") -> str:
        """Attempt to read and extract text from a PubMed paper.

        Args:
            paper_id: PubMed ID (PMID)
            save_path: Directory for potential PDF storage (unused)

        Returns:
            str: Error message indicating PDF reading is not supported
        """
        message = ("PubMed papers cannot be read directly through this tool. "
                  "Only metadata and abstracts are available through PubMed's API. "
                  "Please use the paper's DOI or URL to access the full text on the publisher's website.")
        return message
