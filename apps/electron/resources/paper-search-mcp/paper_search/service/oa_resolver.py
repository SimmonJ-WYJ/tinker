"""DOI-based Open Access PDF URL resolution from multiple sources."""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import requests

from ..connectors.unpaywall import UnpaywallResolver

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResolvedPDF:
    """An OA PDF URL resolved from a specific source."""

    url: str
    source: str


class OAResolverChain:
    """Resolve OA PDF URLs for a DOI from multiple sources.

    Sources tried (order = reliability):
      1. Unpaywall (best_oa_location + all oa_locations)
      2. OpenAlex (best_oa_location.pdf_url)
      3. Semantic Scholar (openAccessPdf.url)
      4. CrossRef TDM links (link[] with content-type pdf)
    """

    OPENALEX_API = "https://api.openalex.org/works/doi:{doi}"
    SEMANTIC_API = "https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}"
    CROSSREF_API = "https://api.crossref.org/works/{doi}"

    def __init__(
        self,
        unpaywall_resolver: UnpaywallResolver | None = None,
        timeout: int = 15,
        session: requests.Session | None = None,
    ) -> None:
        self._unpaywall = unpaywall_resolver or UnpaywallResolver()
        self._timeout = timeout
        self._session = session or requests.Session()
        self._session.headers.update(
            {
                "User-Agent": "paper-search-mcp/1.0 (mailto:asci@opensci.io)",
                "Accept": "application/json",
            }
        )

    def resolve_by_doi(self, doi: str) -> list[ResolvedPDF]:
        """Return all resolvable OA PDF URLs for a DOI, best first."""
        normalized = (doi or "").strip()
        if not normalized:
            return []

        resolvers = [
            ("unpaywall", self._resolve_unpaywall),
            ("openalex", self._resolve_openalex),
            ("semantic_scholar", self._resolve_semantic_scholar),
            ("crossref_tdm", self._resolve_crossref_tdm),
        ]

        results: list[ResolvedPDF] = []
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(fn, normalized): name
                for name, fn in resolvers
            }
            for future in as_completed(futures):
                try:
                    results.extend(future.result())
                except Exception as exc:
                    logger.debug("Resolver %s failed: %s", futures[future], exc)

        return results

    def _resolve_unpaywall(self, doi: str) -> list[ResolvedPDF]:
        if not self._unpaywall.has_api_access():
            return []
        try:
            url = self._unpaywall.resolve_best_pdf_url(doi)
            if url:
                return [ResolvedPDF(url=url, source="unpaywall")]
        except requests.exceptions.RequestException as exc:
            logger.debug("Unpaywall network error for %s: %s", doi, exc)
        except (ValueError, KeyError) as exc:
            logger.warning("Unpaywall unexpected response for %s: %s", doi, exc)
        return []

    def _resolve_openalex(self, doi: str) -> list[ResolvedPDF]:
        try:
            resp = self._session.get(
                self.OPENALEX_API.format(doi=doi), timeout=self._timeout
            )
            if resp.status_code != 200:
                return []
            data = resp.json()

            best_loc = data.get("best_oa_location") or {}
            pdf_url = best_loc.get("pdf_url")

            if not pdf_url:
                oa = data.get("open_access") or {}
                pdf_url = oa.get("oa_url")

            if pdf_url:
                return [ResolvedPDF(url=pdf_url, source="openalex")]
        except requests.exceptions.RequestException as exc:
            logger.debug("OpenAlex network error for %s: %s", doi, exc)
        except (ValueError, KeyError) as exc:
            logger.warning("OpenAlex unexpected response for %s: %s", doi, exc)
        return []

    def _resolve_semantic_scholar(self, doi: str) -> list[ResolvedPDF]:
        try:
            resp = self._session.get(
                self.SEMANTIC_API.format(doi=doi),
                params={"fields": "openAccessPdf"},
                timeout=self._timeout,
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            oa_pdf = data.get("openAccessPdf") or {}
            url = oa_pdf.get("url")
            if url:
                return [ResolvedPDF(url=url, source="semantic_scholar")]
        except requests.exceptions.RequestException as exc:
            logger.debug(
                "Semantic Scholar network error for %s: %s", doi, exc
            )
        except (ValueError, KeyError) as exc:
            logger.warning(
                "Semantic Scholar unexpected response for %s: %s", doi, exc
            )
        return []

    def _resolve_crossref_tdm(self, doi: str) -> list[ResolvedPDF]:
        try:
            resp = self._session.get(
                self.CROSSREF_API.format(doi=doi), timeout=self._timeout
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            message = data.get("message") or {}

            for link in message.get("link") or []:
                if not isinstance(link, dict):
                    continue
                content_type = (link.get("content-type") or "").lower()
                url = link.get("URL", "")
                if "pdf" in content_type and url:
                    return [ResolvedPDF(url=url, source="crossref_tdm")]
        except requests.exceptions.RequestException as exc:
            logger.debug(
                "CrossRef TDM network error for %s: %s", doi, exc
            )
        except (ValueError, KeyError) as exc:
            logger.warning(
                "CrossRef TDM unexpected response for %s: %s", doi, exc
            )
        return []
