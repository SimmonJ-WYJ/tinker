"""Connector registry — auto-discovers and manages platform connectors."""

from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import TYPE_CHECKING, Dict, List, Optional, Type

from ..config import get_env
from .base import PaperConnector

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Global mapping: name -> connector class
_REGISTRY: Dict[str, Type[PaperConnector]] = {}

# Connectors that are registered but should not be instantiated.
#
# Static disabled (connector-level dead — upstream APIs migrated off or
# block scrapers permanently; flipping env will not bring them back):
#   chemrxiv — migrated off CrossRef
#   ssrn     — Cloudflare 403
_STATIC_DISABLED: frozenset[str] = frozenset({"chemrxiv", "ssrn"})

# Network-level dead sources — 0% ok-rate across the 4-run / 10-trial offline
# benchmark (see /tmp/source_classification.json). Default-disabled here so
# the registry stops handing out connectors that always return 0 hits.
# Override via PAPER_SEARCH_MCP_DISABLED_SOURCES env (set to "" to re-enable
# all, or to a custom comma-separated list to replace this default).
_DEFAULT_DEAD: frozenset[str] = frozenset(
    {"zenodo", "base", "citeseerx", "google_scholar"}
)


def _resolve_disabled() -> frozenset[str]:
    """Compute the final disabled set on every registry construction.

    Resolution rules:
      * `_STATIC_DISABLED` is always included (non-functional connectors).
      * `PAPER_SEARCH_MCP_DISABLED_SOURCES`, when set (even to empty string),
        replaces `_DEFAULT_DEAD`. An empty string means "no extra defaults"
        and is the way to opt into all network-tier dead sources for tests.
      * When the env var is unset, `_DEFAULT_DEAD` applies.

    Uses ``os.environ`` directly (not ``get_env``) because the helper collapses
    a ``None`` default to ``""``, which would lose the unset-vs-empty signal we
    need here.
    """
    import os

    for env_key in ("PAPER_SEARCH_MCP_DISABLED_SOURCES", "DISABLED_SOURCES"):
        if env_key in os.environ:
            env_raw = os.environ[env_key]
            env_set = frozenset(
                s.strip().lower() for s in env_raw.split(",") if s.strip()
            )
            return _STATIC_DISABLED | env_set
    return _STATIC_DISABLED | _DEFAULT_DEAD


def register(name: str):
    """Class decorator to register a connector under *name*.

    Usage::

        @register("arxiv")
        class ArxivConnector(PaperConnector):
            ...
    """

    def decorator(cls: Type[PaperConnector]):
        _REGISTRY[name] = cls
        return cls

    return decorator


class ConnectorRegistry:
    """Instantiates and holds live connector instances based on config."""

    def __init__(self, *, extra_connectors: Optional[Dict[str, Type[PaperConnector]]] = None):
        self._instances: Dict[str, PaperConnector] = {}

        # Auto-import all modules in the connectors package so that
        # @register decorators execute.
        self._auto_import()

        if extra_connectors:
            _REGISTRY.update(extra_connectors)

        self._instantiate_all()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, name: str) -> Optional[PaperConnector]:
        return self._instances.get(name)

    def all_names(self) -> List[str]:
        return list(self._instances.keys())

    def all_connectors(self) -> Dict[str, PaperConnector]:
        return dict(self._instances)

    def __contains__(self, name: str) -> bool:
        return name in self._instances

    def __len__(self) -> int:
        return len(self._instances)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    @staticmethod
    def _auto_import() -> None:
        """Import every .py module in the connectors package."""
        import paper_search.connectors as pkg

        for importer, modname, ispkg in pkgutil.iter_modules(pkg.__path__):
            if modname.startswith("_") or modname in ("base", "registry"):
                continue
            try:
                importlib.import_module(f"paper_search.connectors.{modname}")
            except Exception as exc:
                logger.warning("Failed to import connector module %s: %s", modname, exc)

    def _instantiate_all(self) -> None:
        disabled = _resolve_disabled()
        if disabled:
            logger.info(
                "Connector registry: %d disabled source(s) — %s",
                len(disabled),
                ", ".join(sorted(disabled)),
            )
        for name, cls in _REGISTRY.items():
            if name in disabled:
                logger.debug("Connector %s is disabled — skipping.", name)
                continue
            caps = getattr(cls, "capabilities", None)
            if caps and caps.requires_key:
                key_value = get_env(caps.requires_key, "")
                if not key_value:
                    logger.debug(
                        "Skipping connector %s — required key %s not set.",
                        name,
                        caps.requires_key,
                    )
                    continue
            try:
                self._instances[name] = cls()
            except Exception as exc:
                logger.warning("Failed to instantiate connector %s: %s", name, exc)
