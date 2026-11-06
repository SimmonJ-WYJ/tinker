"""paper-search MCP 日志落盘（issue #743 · 补完 AC #5 可观测性）。

背景：paper-search MCP 由 claude 子进程（甚至 sub-agent 的孙进程）经 `.mcp.json`
拉起，它的 Python stderr **不会**逐级转发到 ASCI 的 agent-sessions-diagnostics；
且进程默认无任何 logging 配置时阈值为 WARNING —— enrich 选路（`route=direct/proxy`）
这类 INFO 日志会被直接丢弃。结果就是 enrich「大面积补 0」时真机里黑盒一片、无从排查。

这里给 `paper_search` 顶层 logger 挂一个**文件** handler（默认 INFO），把 enrich
选路 / 失败告警等写到 `<配置目录>/paper-search-logs/paper-search-<pid>.log`，
事后可查。按 pid 分文件，避免多个 MCP 子进程并发写同一文件互相踩 / 滚动竞争。

best-effort：任何配置失败都静默跳过，绝不影响 MCP server 启动 / 工具调用；也绝不
写 stdout（stdio transport 的 JSON-RPC 走 stdout，污染即协议损坏）。
"""
from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

# 日志保留天数：按 pid 分文件会累积，启动时顺手清掉过期的，避免无限增长。
_LOG_RETENTION_DAYS = 7

_CONFIGURED = False


def _resolve_log_dir() -> Path:
    """与 process_service._detect_config_dir 同源：优先 Electron 注入的 ASCI_CONFIG_DIR，
    其次 ~/.asci（打包），再次 ~/.asci-dev（dev）。"""
    from_env = os.environ.get("ASCI_CONFIG_DIR")
    if from_env:
        base = Path(from_env)
    else:
        asci = Path.home() / ".asci"
        dev = Path.home() / ".asci-dev"
        base = asci if asci.is_dir() else (dev if dev.is_dir() else asci)
    return base / "paper-search-logs"


def _prune_old_logs(log_dir: Path) -> None:
    """删掉超过保留期的旧日志（best-effort）。"""
    cutoff = time.time() - _LOG_RETENTION_DAYS * 86400
    for old in log_dir.glob("paper-search-*.log"):
        try:
            if old.stat().st_mtime < cutoff:
                old.unlink()
        except OSError:
            continue


def setup_logging() -> None:
    """配置 paper_search 日志（幂等）。在 MCP server 启动早期调用一次。"""
    global _CONFIGURED
    if _CONFIGURED:
        return
    _CONFIGURED = True
    try:
        level_name = os.environ.get("PAPER_SEARCH_LOG_LEVEL", "INFO").strip().upper()
        level = getattr(logging, level_name, logging.INFO)

        pkg_logger = logging.getLogger("paper_search")
        pkg_logger.setLevel(level)

        fmt = logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s [pid=%(process)d] %(message)s"
        )

        log_dir = _resolve_log_dir()
        log_dir.mkdir(parents=True, exist_ok=True)
        _prune_old_logs(log_dir)

        # 按 pid 分文件：每个 MCP 子进程一份，无跨进程写竞争、按 run 可分离。
        log_path = log_dir / f"paper-search-{os.getpid()}.log"
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(fmt)
        file_handler.setLevel(level)
        file_handler._paper_search_file = True  # type: ignore[attr-defined]

        # stderr 兜底（standalone 运行 / 万一 CLI 转发 stderr 时可见；stdio MCP 下
        # stderr 与 stdout 协议通道隔离，写它安全，绝不碰 stdout）。
        stream_handler = logging.StreamHandler(sys.stderr)
        stream_handler.setFormatter(fmt)
        stream_handler.setLevel(level)
        stream_handler._paper_search_stderr = True  # type: ignore[attr-defined]

        existing = pkg_logger.handlers
        if not any(getattr(h, "_paper_search_file", False) for h in existing):
            pkg_logger.addHandler(file_handler)
        if not any(getattr(h, "_paper_search_stderr", False) for h in existing):
            pkg_logger.addHandler(stream_handler)

        pkg_logger.info(
            "paper-search 日志已初始化 → %s (level=%s)", log_path, level_name
        )
    except Exception:
        # 诊断日志初始化失败绝不拖垮 MCP；保持默认行为。
        pass
