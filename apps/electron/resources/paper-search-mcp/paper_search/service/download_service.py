"""Download service with OA fallback chain."""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import List, Optional

import httpx

from ..connectors.registry import ConnectorRegistry
from ..connectors.unpaywall import UnpaywallResolver
from ..connectors.sci_hub import SciHubFetcher
from .oa_resolver import OAResolverChain

logger = logging.getLogger(__name__)


class DownloadService:
    """Orchestrates PDF downloads with a multi-stage fallback chain.

    Fallback order:
      0. Direct ``pdf_url`` download (if provided).
      1. Source-native ``download_pdf`` via the connector registry.
      2. DOI multi-source OA resolution (OAResolverChain).
      3. OA repository search (openaire -> core -> europepmc -> pmc).
      4. HTML extraction from DOI landing pages (meta tag + body links).
      5. Sci-Hub (optional, last resort).
    """

    REPOSITORY_FALLBACK_SOURCES = ("openaire", "core", "europepmc", "pmc")
    RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
    MAX_DOWNLOAD_RETRIES = 3

    def __init__(self, registry: ConnectorRegistry):
        self.registry = registry
        self._unpaywall = UnpaywallResolver()
        self._oa_resolver = OAResolverChain(unpaywall_resolver=self._unpaywall)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def download(
        self,
        source: str,
        paper_id: str,
        doi: str = "",
        title: str = "",
        pdf_url: str = "",
        save_path: str = "./downloads",
        use_scihub: bool = True,
        scihub_base_url: str = "auto",
    ) -> str:
        """Try pdf_url, source-native, OA resolver, repositories, HTML meta, then Sci-Hub.

        Fallback order:
          0. Direct ``pdf_url`` download (if provided).
          1. Source-native ``download_pdf`` via the connector registry.
          2. DOI multi-source OA resolution (OAResolverChain).
          3. OA repository search (openaire -> core -> europepmc -> pmc).
          4. HTML extraction from DOI landing pages (meta tag + body links).
          5. Sci-Hub (optional, last resort).

        Args:
            source: Source name (e.g. ``arxiv``, ``semantic``, ``crossref``).
            paper_id: Source-native paper identifier.
            doi: Optional DOI used for repository/Unpaywall/Sci-Hub fallback.
            title: Optional title used for repository/Sci-Hub fallback when DOI is unavailable.
            pdf_url: Optional direct PDF URL — tried first if provided.
            save_path: Directory to save downloaded files.
            use_scihub: Whether to fallback to Sci-Hub after OA attempts fail.
            scihub_base_url: Sci-Hub mirror URL for fallback.

        Returns:
            Download path on success or explanatory error message.
        """
        source_name = source.strip().lower()
        attempt_errors: List[str] = []

        # --- Stage 0: direct PDF URL (highest priority) ---
        normalized_pdf_url = (pdf_url or "").strip()
        if normalized_pdf_url:
            direct_result = await self._download_from_url(
                normalized_pdf_url, save_path,
                f"direct_{source_name}_{self._safe_filename(paper_id)}"
            )
            if direct_result:
                return direct_result
            attempt_errors.append(f"pdf_url: download from {normalized_pdf_url} failed")

        # --- Stage 1: primary source connector ---
        primary_error = ""
        connector = self.registry.get(source_name)
        if connector is not None:
            try:
                primary_result = await asyncio.to_thread(
                    connector.download_pdf, paper_id, save_path
                )
                if isinstance(primary_result, str) and os.path.exists(primary_result):
                    if self._is_valid_pdf(primary_result):
                        return primary_result
                    # Downloaded file is not a valid PDF — remove and continue
                    logger.warning(
                        "Primary download for %s/%s produced non-PDF file, removing",
                        source_name, paper_id,
                    )
                    os.remove(primary_result)
                    primary_error = "downloaded file is not a valid PDF"
                if isinstance(primary_result, str) and primary_result:
                    primary_error = primary_result
            except Exception as exc:
                primary_error = str(exc)
                logger.warning(
                    "Primary download failed for %s/%s: %s",
                    source_name,
                    paper_id,
                    exc,
                )
        else:
            primary_error = f"Unsupported source '{source_name}' for primary download."

        if primary_error:
            attempt_errors.append(f"primary: {primary_error}")

        # --- Stage 2: DOI multi-source OA resolution ---
        normalized_doi = (doi or "").strip()
        if normalized_doi:
            oa_result, oa_error = await self._try_oa_resolution(
                normalized_doi, save_path
            )
            if oa_result:
                return oa_result
            if oa_error:
                attempt_errors.append(f"oa_resolver: {oa_error}")
        else:
            attempt_errors.append("oa_resolver: DOI not provided")

        # --- Stage 3: OA repository fallback ---
        repository_result, repository_error = await self._try_repository_fallback(
            doi, title, save_path
        )
        if repository_result:
            return repository_result
        if repository_error:
            attempt_errors.append(f"repositories: {repository_error}")

        # --- Stage 4: HTML meta tag extraction ---
        if normalized_doi:
            html_meta_result = await self._try_html_meta_extraction(
                normalized_doi, save_path
            )
            if html_meta_result:
                return html_meta_result

        # --- Stage 5: Sci-Hub (optional) ---
        if not use_scihub:
            return (
                "Download failed after OA fallback chain. Details: "
                + " | ".join(attempt_errors)
            )

        fallback_identifier = (
            (doi or "").strip() or (title or "").strip() or paper_id
        )
        fetcher = SciHubFetcher(base_url=scihub_base_url, output_dir=save_path)
        fallback_result = await asyncio.to_thread(
            fetcher.download_pdf, fallback_identifier
        )
        if fallback_result:
            return fallback_result

        return (
            "Download failed after OA fallback chain and Sci-Hub fallback. Details: "
            + " | ".join(attempt_errors)
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _try_oa_resolution(
        self, doi: str, save_path: str
    ) -> tuple[str | None, str]:
        """Try resolving OA PDF URLs via multi-source DOI lookup."""
        try:
            resolved = await asyncio.to_thread(self._oa_resolver.resolve_by_doi, doi)
        except Exception as exc:
            return None, str(exc)

        for candidate in resolved:
            downloaded = await self._download_from_url(
                candidate.url, save_path, f"oa_{candidate.source}_{doi}"
            )
            if downloaded:
                return downloaded, ""

        if resolved:
            return None, f"resolved {len(resolved)} URLs but all downloads failed"
        return None, "no OA URLs found"

    async def _try_html_meta_extraction(
        self, doi: str, save_path: str
    ) -> str | None:
        """Fetch DOI landing page and extract citation_pdf_url meta tag."""
        doi_url = f"https://doi.org/{doi}"
        try:
            async with httpx.AsyncClient(
                follow_redirects=True, timeout=20
            ) as client:
                resp = await client.get(doi_url, headers={
                    "Accept": "text/html",
                    "User-Agent": "Mozilla/5.0 (compatible; paper-search-mcp/1.0)",
                })
            if resp.status_code >= 400:
                return None

            content_type = (resp.headers.get("content-type") or "").lower()
            if "pdf" in content_type or resp.content.startswith(b"%PDF"):
                os.makedirs(save_path, exist_ok=True)
                safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", doi).strip("._")[:120]
                path = os.path.join(save_path, f"doi_direct_{safe}.pdf")
                with open(path, "wb") as f:
                    f.write(resp.content)
                return path

            # 4a: citation_pdf_url meta tag
            pdf_url = self._extract_citation_pdf_url(resp.text)
            if pdf_url:
                result = await self._download_from_url(pdf_url, save_path, f"meta_{doi}")
                if result:
                    return result

            # 4b: scan <a href="*.pdf"> links in HTML body
            landing_url = str(resp.url)  # final URL after redirects
            pdf_links = self._extract_pdf_links_from_html(resp.text, landing_url)
            for link in pdf_links[:5]:  # try top 5 candidates
                result = await self._download_from_url(
                    link, save_path, f"html_link_{doi}"
                )
                if result:
                    return result
        except Exception as exc:
            logger.debug("HTML meta extraction failed for %s: %s", doi, exc)
        return None

    @staticmethod
    def _extract_citation_pdf_url(html: str) -> str | None:
        """Extract citation_pdf_url from HTML meta tags."""
        if not html:
            return None
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "lxml")
        meta = soup.find("meta", attrs={"name": "citation_pdf_url"})
        if meta and meta.get("content"):
            return meta["content"]
        return None

    @staticmethod
    def _extract_pdf_links_from_html(html: str, base_url: str = "") -> list[str]:
        """Extract candidate PDF URLs from <a> tags in HTML body.

        Looks for links whose href ends with ``.pdf`` (ignoring query/fragment),
        or whose link text / nearby context suggests a PDF download.  Returns a
        deduplicated list ordered by relevance (exact ``.pdf`` suffix first).
        """
        if not html:
            return []
        from urllib.parse import urljoin
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        seen: set[str] = set()
        exact: list[str] = []  # href ends with .pdf
        fuzzy: list[str] = []  # link text hints at PDF

        for tag in soup.find_all("a", href=True):
            href: str = tag["href"].strip()
            if not href or href.startswith(("javascript:", "mailto:", "#")):
                continue

            # Resolve relative URLs
            full_url = urljoin(base_url, href) if base_url else href

            # Normalise: strip query/fragment for suffix check
            path_part = full_url.split("?")[0].split("#")[0]

            if full_url in seen:
                continue
            seen.add(full_url)

            if path_part.lower().endswith(".pdf"):
                exact.append(full_url)
            else:
                # Check link text / title for PDF hints
                text = (tag.get_text(" ", strip=True) or "").lower()
                title_attr = (tag.get("title") or "").lower()
                if "pdf" in text or "download" in text or "pdf" in title_attr:
                    fuzzy.append(full_url)

        return exact + fuzzy

    TITLE_SIMILARITY_THRESHOLD = 0.6

    async def _try_repository_fallback(
        self, doi: str, title: str, save_path: str
    ) -> tuple[Optional[str], str]:
        """Try OA repositories: openaire -> core -> europepmc -> pmc.

        Validates each candidate paper against the original DOI/title before
        downloading, to avoid fetching a different paper with a similar title.

        Returns:
            ``(path, "")`` on success, ``(None, error_summary)`` on failure.
        """
        query_candidates = [(doi or "").strip(), (title or "").strip()]
        query_candidates = [c for c in query_candidates if c]
        if not query_candidates:
            return None, "no DOI/title provided for repository fallback"

        normalized_doi = (doi or "").strip().lower()
        normalized_title = (title or "").strip().lower()
        repository_errors: List[str] = []

        for repo_name in self.REPOSITORY_FALLBACK_SOURCES:
            searcher = self.registry.get(repo_name)
            if searcher is None:
                continue

            for query in query_candidates:
                try:
                    papers = await asyncio.to_thread(
                        searcher.search, query, max_results=3
                    )
                except Exception as exc:
                    repository_errors.append(f"{repo_name}:{exc}")
                    continue

                if not papers:
                    continue

                for paper in papers:
                    pdf_url = (getattr(paper, "pdf_url", "") or "").strip()
                    if not pdf_url:
                        continue

                    # --- 身份校验：DOI 匹配或标题相似度 ---
                    if not self._is_matching_paper(
                        paper, normalized_doi, normalized_title
                    ):
                        paper_title = (
                            getattr(paper, "title", "") or ""
                        )[:60]
                        logger.debug(
                            "Stage 3 skipping non-matching paper from %s: %s",
                            repo_name, paper_title,
                        )
                        continue

                    paper_id = str(
                        getattr(paper, "paper_id", "") or query
                    ).strip()
                    downloaded = await self._download_from_url(
                        pdf_url, save_path, f"{repo_name}_{paper_id}"
                    )
                    if downloaded:
                        return downloaded, ""

        return None, "; ".join(repository_errors)

    @staticmethod
    def _is_matching_paper(paper, expected_doi: str, expected_title: str) -> bool:
        """Check if a candidate paper matches the expected DOI or title.

        Returns True if:
          - DOIs match (case-insensitive), OR
          - Title similarity (Jaccard on word tokens) >= TITLE_SIMILARITY_THRESHOLD
        """
        # DOI match (strongest signal)
        if expected_doi:
            candidate_doi = (getattr(paper, "doi", "") or "").strip().lower()
            if candidate_doi and candidate_doi == expected_doi:
                return True

        # Title similarity
        if expected_title:
            candidate_title = (getattr(paper, "title", "") or "").strip().lower()
            if candidate_title:
                similarity = DownloadService._title_similarity(
                    expected_title, candidate_title
                )
                return similarity >= DownloadService.TITLE_SIMILARITY_THRESHOLD

        # If we have neither DOI nor title to compare, allow the download
        return True

    @staticmethod
    def _title_similarity(a: str, b: str) -> float:
        """Jaccard similarity on word-level tokens."""
        tokens_a = set(re.sub(r"[^\w\s]", "", a).split())
        tokens_b = set(re.sub(r"[^\w\s]", "", b).split())
        if not tokens_a or not tokens_b:
            return 0.0
        intersection = tokens_a & tokens_b
        union = tokens_a | tokens_b
        return len(intersection) / len(union)

    @staticmethod
    async def _download_from_url(
        pdf_url: str, save_path: str, filename_hint: str = "paper"
    ) -> Optional[str]:
        """Download PDF from a direct URL using httpx with retry on transient errors.

        Retries up to ``MAX_DOWNLOAD_RETRIES`` times on ``RETRYABLE_STATUS_CODES``
        using exponential backoff (capped at 8 seconds).

        Returns:
            Path to the saved file on success, ``None`` on failure.
        """
        if not pdf_url:
            return None

        os.makedirs(save_path, exist_ok=True)
        output_name = f"{DownloadService._safe_filename(filename_hint)}.pdf"
        output_path = os.path.join(save_path, output_name)

        for attempt in range(DownloadService.MAX_DOWNLOAD_RETRIES):
            try:
                async with httpx.AsyncClient(
                    follow_redirects=True, timeout=30
                ) as client:
                    response = await client.get(pdf_url)

                if response.status_code in DownloadService.RETRYABLE_STATUS_CODES:
                    if attempt < DownloadService.MAX_DOWNLOAD_RETRIES - 1:
                        wait = min(8, 2 ** attempt)
                        logger.warning(
                            "Transient HTTP %s for %s — retrying in %ds (attempt %d/%d)",
                            response.status_code,
                            pdf_url,
                            wait,
                            attempt + 1,
                            DownloadService.MAX_DOWNLOAD_RETRIES,
                        )
                        await asyncio.sleep(wait)
                        continue
                    return None

                if response.status_code >= 400 or not response.content:
                    return None

                content_type = (response.headers.get("content-type") or "").lower()
                is_pdf = (
                    response.content.startswith(b"%PDF")
                    or "pdf" in content_type
                )
                if not is_pdf:
                    logger.warning(
                        "Resolved URL is not a PDF candidate: %s (content-type=%s)",
                        pdf_url,
                        content_type,
                    )
                    return None

                with open(output_path, "wb") as file_obj:
                    file_obj.write(response.content)

                return output_path
            except Exception as exc:
                logger.warning("Direct URL download failed for %s: %s", pdf_url, exc)
                return None

        return None

    @staticmethod
    def _is_valid_pdf(path: str) -> bool:
        """Check if a file starts with the PDF magic bytes."""
        try:
            with open(path, "rb") as f:
                return f.read(5) == b"%PDF-"
        except OSError:
            return False

    @staticmethod
    def _safe_filename(filename_hint: str, default: str = "paper") -> str:
        """Sanitise a hint string into a filesystem-safe filename (without extension)."""
        safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename_hint).strip("._")
        if not safe:
            return default
        return safe[:120]
