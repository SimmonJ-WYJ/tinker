"""Tests for process_service.process_results_core — turn_id 注入与隔离机制。

背景：lit-search 跨多轮检索时，session JSONL 跨 turn 累积；relevance-scorer
按 session_id 直接读整个 JSONL，导致评分用的池子是历史累积量，而 master
摘要的 display_count 只反映本轮。两者不对齐 → 用户看到的 panel 和被评分
的论文不是同一份。

解法：process_results_core 每次调用生成一个新的 turn_id（UUID），写到
每条新增 record 的 turn_id 字段，并在返回 dict 里包含 turn_id；scorer
加载 JSONL 后按"最新 turn_id 那一簇"过滤本轮 records。
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from .process_service import _is_crossref_noise, process_results_core


def _run(coro):
    """同步包装 async — 避免依赖 pytest-asyncio。"""
    return asyncio.run(coro)


def _fake_paper(title: str, doi: str, year: int = 2024) -> dict:
    """构造最小化的 paper dict，模拟 MCP 工具返回结构。"""
    return {
        "title": title,
        "doi": doi,
        "year": year,
        "authors": ["Test Author"],
        "abstract": "test abstract",
        "url": f"https://doi.org/{doi}",
    }


def _read_jsonl(path: Path) -> list[dict]:
    """读取 JSONL 为 record list。"""
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def test_turn_id_present_in_written_records(tmp_path: Path) -> None:
    """每条新写入的 record 必须包含非空 turn_id 字段。"""
    inputs = [{"source": "arxiv", "papers": [_fake_paper("Paper A", "10.1/a")]}]

    result = _run(
        process_results_core(
            query="test",
            inputs=inputs,
            enrich=False,
            session_id="sess-test-1",
            config_dir=str(tmp_path),
        )
    )

    assert "error" not in result, f"unexpected error: {result.get('error')}"
    assert result["new_records"] == 1

    out_path = Path(result["output_path"])
    records = _read_jsonl(out_path)
    assert len(records) == 1
    assert records[0].get("turn_id"), "每条 record 必须有非空 turn_id 字段"


def test_turn_id_returned_in_result(tmp_path: Path) -> None:
    """process_results_core 返回 dict 必须包含 turn_id 字段，供 caller 透传给 scorer。"""
    inputs = [{"source": "arxiv", "papers": [_fake_paper("Paper A", "10.1/a")]}]

    result = _run(
        process_results_core(
            query="test",
            inputs=inputs,
            enrich=False,
            session_id="sess-test-2",
            config_dir=str(tmp_path),
        )
    )

    turn_id = result.get("turn_id")
    assert isinstance(turn_id, str) and turn_id, (
        f"返回 dict 必须有非空 turn_id 字段，实际 {turn_id!r}"
    )

    # turn_id 与写入 JSONL 的一致
    out_path = Path(result["output_path"])
    records = _read_jsonl(out_path)
    assert all(r["turn_id"] == turn_id for r in records), (
        "JSONL 中 record 的 turn_id 必须与返回 dict 的 turn_id 一致"
    )


def test_different_calls_produce_different_turn_ids(tmp_path: Path) -> None:
    """同一 session 多次调用 process_results_core 产生不同 turn_id；
    后续 call 写入的 records 与之前 turn 的 records 在 turn_id 上区分开。"""
    session_id = "sess-test-3"

    # 第一次 turn
    r1 = _run(
        process_results_core(
            query="q1",
            inputs=[{"source": "arxiv", "papers": [_fake_paper("Paper A", "10.1/a")]}],
            enrich=False,
            session_id=session_id,
            config_dir=str(tmp_path),
        )
    )
    # 第二次 turn（同 session）
    r2 = _run(
        process_results_core(
            query="q2",
            inputs=[{"source": "arxiv", "papers": [_fake_paper("Paper B", "10.1/b")]}],
            enrich=False,
            session_id=session_id,
            config_dir=str(tmp_path),
        )
    )

    assert r1["turn_id"] != r2["turn_id"], (
        "两次独立调用必须产生不同 turn_id 以便 scorer 区分本轮 vs 历史"
    )

    # JSONL 累积，记录数 = 2，各 record 的 turn_id 对应各自的 turn
    out_path = Path(r1["output_path"])
    records = _read_jsonl(out_path)
    assert len(records) == 2
    tids = {r["turn_id"] for r in records}
    assert tids == {r1["turn_id"], r2["turn_id"]}


def test_turn_id_reused_when_provided(tmp_path: Path) -> None:
    """caller 传入 turn_id 时，process_results_core 复用而不是生成新的。

    场景：searcher 在一次 lit-search 流程内调多次 process_search_results
    （round 1 + round 2 + ...）。每次都生成新 turn_id 会让 scorer 只看到
    最后一轮 records，丢失前几轮的高质量召回（PR #380 实测：PI/YaRN/LongRoPE
    在 round 1 进 jsonl，round 2 主要是 attention sink 类，scorer 只评 round 2
    的 39 篇，前 71 篇全失踪）。复用 turn_id 让所有 round 的 records
    属于同一簇，scorer 一次拿全。
    """
    fixed_turn_id = "reuse_me_abc123"
    inputs = [{"source": "arxiv", "papers": [_fake_paper("Paper A", "10.1/a")]}]

    result = _run(
        process_results_core(
            query="round1",
            inputs=inputs,
            enrich=False,
            session_id="sess-reuse",
            config_dir=str(tmp_path),
            turn_id=fixed_turn_id,
        )
    )

    assert result["turn_id"] == fixed_turn_id, "caller 传入的 turn_id 必须被原样返回"
    records = _read_jsonl(Path(result["output_path"]))
    assert all(r["turn_id"] == fixed_turn_id for r in records), (
        "传入的 turn_id 必须写入每条 record"
    )


def test_multi_round_with_shared_turn_id_unifies_records(tmp_path: Path) -> None:
    """跨 round 复用同一 turn_id → scorer 按 turn_id 过滤能拿到所有 round 的 records。

    模拟 searcher round 1 + round 2 的真实流程，验证修复后 scorer 不再丢前轮论文。"""
    session_id = "sess-multi-round"
    shared_turn_id = "lit_search_run_001"

    # Round 1: 找到经典论文
    _run(
        process_results_core(
            query="round1",
            inputs=[{"source": "openalex", "papers": [
                _fake_paper("PI by Chen", "10.1/pi-chen", year=2023),
                _fake_paper("YaRN", "10.1/yarn", year=2023),
            ]}],
            enrich=False,
            session_id=session_id,
            config_dir=str(tmp_path),
            turn_id=shared_turn_id,
        )
    )

    # Round 2: 找到 attention sink 类
    r2 = _run(
        process_results_core(
            query="round2",
            inputs=[{"source": "arxiv", "papers": [
                _fake_paper("StreamingLLM", "10.1/streaming", year=2023),
            ]}],
            enrich=False,
            session_id=session_id,
            config_dir=str(tmp_path),
            turn_id=shared_turn_id,
        )
    )
    assert r2["turn_id"] == shared_turn_id

    out_path = Path(r2["output_path"])
    records = _read_jsonl(out_path)
    assert len(records) == 3

    # scorer 模拟：按 turn_id 过滤拿全 3 篇（PI / YaRN / StreamingLLM）
    latest_records = [r for r in records if r["turn_id"] == shared_turn_id]
    assert len(latest_records) == 3
    titles = {r["title"] for r in latest_records}
    assert titles == {"PI by Chen", "YaRN", "StreamingLLM"}


def test_turn_id_isolates_latest_turn_from_history(tmp_path: Path) -> None:
    """模拟 scorer 的过滤逻辑：跨 turn 累积后，按 turn_id 取"最新 turn"
    那一簇 records，能正确拿到本轮新增 = 1，而不是历史累积 = 2。"""
    session_id = "sess-test-4"

    # 历史 turn
    r_hist = _run(
        process_results_core(
            query="q_hist",
            inputs=[{"source": "arxiv", "papers": [_fake_paper("Old Paper", "10.1/old", year=2022)]}],
            enrich=False,
            session_id=session_id,
            config_dir=str(tmp_path),
        )
    )
    # 当前 turn
    r_cur = _run(
        process_results_core(
            query="q_cur",
            inputs=[{"source": "arxiv", "papers": [_fake_paper("New Paper", "10.1/new", year=2024)]}],
            enrich=False,
            session_id=session_id,
            config_dir=str(tmp_path),
        )
    )

    out_path = Path(r_cur["output_path"])
    records = _read_jsonl(out_path)
    assert len(records) == 2

    # scorer 期望的过滤：仅保留 turn_id == 最新 turn 的 records
    latest_records = [r for r in records if r["turn_id"] == r_cur["turn_id"]]
    assert len(latest_records) == 1
    assert latest_records[0]["title"] == "New Paper"


# ============================================================
# P1-1 fuzzy dedup: 同篇论文不同载体（不同 DOI / openalex work id）合并
# ============================================================
#
# 背景：OpenAlex 把同一篇论文的期刊版与会议版当作两个 work，arxiv preprint
# 与 ACL 正式收录版也算两个 DOI。第一层 record_key 按 DOI / openalexId 精确
# 匹配，看到的是两条不同 key 的 record，不会合并 — 上次测试 RotateKV / HiRoPE
# / Long Range Arena 都各占了 Top 50 两个名额。
# 第二层 fuzzy dedup：归一化 title 严格相等 / prefix subset 视为同篇，合并
# 时保留 citedBy 多 / venue 非空 / year 新的那一条。但若差异部分仅是后缀
# 白名单（v2 / Revisited / Extended / ...），保留两条 — 它们多半是真续作。


def _fake_paper_with(title: str, doi: str, *, year: int = 2024,
                    venue: str = "", citations: int = 0) -> dict:
    return {
        "title": title,
        "doi": doi,
        "year": year,
        "authors": ["Author"],
        "abstract": "abs",
        "url": f"https://doi.org/{doi}",
        "venue": venue or None,
        "citations": citations,
    }


def test_fuzzy_dedupe_collapses_identical_titles(tmp_path: Path) -> None:
    """RotateKV 双载体：两个 OpenAlex work id，title 完全相同 → 合并为 1 条。"""
    inputs = [{"source": "openalex", "papers": [
        _fake_paper_with(
            "RotateKV: Accurate and Robust 2-Bit KV Cache Quantization for LLMs via Outlier-Aware Adaptive Rotations",
            "10.1/rotatekv-a", year=2024,
        ),
        _fake_paper_with(
            "RotateKV: Accurate and Robust 2-Bit KV Cache Quantization for LLMs via Outlier-Aware Adaptive Rotations",
            "10.1/rotatekv-b", year=2025,
        ),
    ]}]

    result = _run(
        process_results_core(
            query="rotate kv",
            inputs=inputs,
            enrich=False,
            session_id="sess-rotatekv",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 1, f"两个相同 title 应合并，实际 {result['new_records']}"


def test_fuzzy_dedupe_collapses_punctuation_variant(tmp_path: Path) -> None:
    """Long Range Arena 双载体：仅冒号前空格差异 → 归一化后相等 → 合并。"""
    inputs = [{"source": "openalex", "papers": [
        _fake_paper_with("Long Range Arena: A Benchmark for Efficient Transformers", "10.1/lra-a"),
        _fake_paper_with("Long Range Arena : A Benchmark for Efficient Transformers", "10.1/lra-b"),
    ]}]

    result = _run(
        process_results_core(
            query="long range arena",
            inputs=inputs,
            enrich=False,
            session_id="sess-lra",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 1


def test_fuzzy_dedupe_collapses_prefix_subset(tmp_path: Path) -> None:
    """HiRoPE 双载体：arxiv 简标题是 ACL 全标题的前缀 → subset 合并。"""
    inputs = [{"source": "semantic", "papers": [
        _fake_paper_with(
            "HiRoPE: Length Extrapolation for Code Models Using Hierarchical Position",
            "10.1/hirope-acl",
        ),
        _fake_paper_with(
            "HiRoPE: Length Extrapolation for Code Models",
            "10.1/hirope-arxiv",
        ),
    ]}]

    result = _run(
        process_results_core(
            query="hirope",
            inputs=inputs,
            enrich=False,
            session_id="sess-hirope",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 1


def test_fuzzy_dedupe_keeps_revisited_suffix(tmp_path: Path) -> None:
    """白名单后缀 `Revisited` 视为真续作，保留两条。"""
    inputs = [{"source": "arxiv", "papers": [
        _fake_paper_with("Long-Context LLM Evaluation", "10.1/eval-v1"),
        _fake_paper_with("Long-Context LLM Evaluation Revisited", "10.1/eval-v2"),
    ]}]

    result = _run(
        process_results_core(
            query="eval",
            inputs=inputs,
            enrich=False,
            session_id="sess-revisited",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 2, "Revisited 后缀是续作信号，应保留两条"


def test_fuzzy_dedupe_keeps_v2_suffix(tmp_path: Path) -> None:
    """白名单后缀 `v2` 视为续作，保留两条。"""
    inputs = [{"source": "arxiv", "papers": [
        _fake_paper_with("LongRoPE", "10.1/longrope"),
        _fake_paper_with("LongRoPE v2", "10.1/longrope-v2"),
    ]}]

    result = _run(
        process_results_core(
            query="longrope",
            inputs=inputs,
            enrich=False,
            session_id="sess-v2",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 2


def test_fuzzy_dedupe_keeps_clearly_distinct(tmp_path: Path) -> None:
    """完全不同的 title 不应误合并。"""
    inputs = [{"source": "arxiv", "papers": [
        _fake_paper_with("YaRN: Efficient Context Window Extension of Large Language Models", "10.1/yarn"),
        _fake_paper_with("LongRoPE: Extending LLM Context Window Beyond 2 Million Tokens", "10.1/longrope"),
    ]}]

    result = _run(
        process_results_core(
            query="context",
            inputs=inputs,
            enrich=False,
            session_id="sess-distinct",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 2


def test_fuzzy_dedupe_collapses_ocr_typo_variant(tmp_path: Path) -> None:
    """源端 OCR 错字双载体：OpenAlex 把 "Interference" 误录成 "lnterference"
    （首字母小写 L 冒充 I）。两标题既不相等也无 prefix 关系，仅一字之差 →
    应判为同篇合并。复刻线上 dump 中 rank 14/15 同篇未合并的缺口。"""
    inputs = [{"source": "openalex", "papers": [
        _fake_paper_with(
            "Unable to forget: Proactive lnterference Reveals Working Memory "
            "Limits in LLMs Beyond Context Length",
            "10.1/pi-openalex",
        ),
        _fake_paper_with(
            "Unable to Forget: Proactive Interference Reveals Working Memory "
            "Limits in LLMs Beyond Context Length",
            "10.1/pi-arxiv",
        ),
    ]}]

    result = _run(
        process_results_core(
            query="proactive interference",
            inputs=inputs,
            enrich=False,
            session_id="sess-ocr-typo",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 1, (
        f"一字之差（OCR 错字）的同篇应合并，实际 {result['new_records']}"
    )


def test_fuzzy_dedupe_keeps_opposite_keyword_near_titles(tmp_path: Path) -> None:
    """语义相反的近似标题（Long ↔ Short）长度相近但非同篇 → 必须保留两条。
    守门近似合并不能过松：单个词的语义翻转编辑距离 > 阈值，不得误并。"""
    inputs = [{"source": "arxiv", "papers": [
        _fake_paper_with("Efficient Attention for Long Context Modeling in LLMs", "10.1/long-ctx"),
        _fake_paper_with("Efficient Attention for Short Context Modeling in LLMs", "10.1/short-ctx"),
    ]}]

    result = _run(
        process_results_core(
            query="efficient attention context",
            inputs=inputs,
            enrich=False,
            session_id="sess-long-short",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 2, "Long vs Short 是相反主题，不应误合并"


def test_fuzzy_dedupe_keeps_higher_citedby(tmp_path: Path) -> None:
    """合并时保留 citedBy 多的那一条（信号强）。"""
    inputs = [{"source": "openalex", "papers": [
        _fake_paper_with("Same Title Paper", "10.1/low", citations=10),
        _fake_paper_with("Same Title Paper", "10.1/high", citations=500),
    ]}]

    result = _run(
        process_results_core(
            query="same",
            inputs=inputs,
            enrich=False,
            session_id="sess-citedby",
            config_dir=str(tmp_path),
        )
    )
    assert result["new_records"] == 1
    records = _read_jsonl(Path(result["output_path"]))
    extra = records[0].get("extra") or {}
    assert extra.get("citedBy") == 500, "应保留 citedBy=500 的那条"


# ============================================================
# P2-2 duplicates_removed 字段不变量
# ============================================================
#
# 背景：searcher 通常对每个 source 调用多次 search_*（关键词 × 源矩阵），
# 然后把所有 handles 一次性传给 process_search_results。inputs 列表
# 会有同一个 source_name 重复多次（例如 3 次 arxiv handles）。
# 旧实现 source_counts[name] = len(papers) 是**覆盖赋值** ——
# 多次同源调用只留最后一次的数字，total_from_sources 严重低估。
# 实测 step [18] 3 source × ~10 papers/handle × ~3 handles/source = 80~
# raw papers，但 total_from_sources 报 30，导致 duplicates_removed =
# 30 - 71 = -41（负数！）。
# 修复：source_counts 用累加而非覆盖。


def test_duplicates_removed_non_negative_single_source_multi_calls(tmp_path: Path) -> None:
    """同一 source 多次 inputs 调用：source_counts 必须累加，duplicates_removed ≥ 0。"""
    # 模拟 arxiv 三次 search 返回不同 DOI 的论文，总共 6 篇全部独立
    inputs = [
        {"source": "arxiv", "papers": [
            _fake_paper("Paper A1", "10.1/a1"),
            _fake_paper("Paper A2", "10.1/a2"),
        ]},
        {"source": "arxiv", "papers": [
            _fake_paper("Paper B1", "10.1/b1"),
            _fake_paper("Paper B2", "10.1/b2"),
        ]},
        {"source": "arxiv", "papers": [
            _fake_paper("Paper C1", "10.1/c1"),
            _fake_paper("Paper C2", "10.1/c2"),
        ]},
    ]

    result = _run(
        process_results_core(
            query="test",
            inputs=inputs,
            enrich=False,
            session_id="sess-multi-arxiv",
            config_dir=str(tmp_path),
        )
    )

    assert result["total_from_sources"] == 6, (
        f"3 次 arxiv 调用各 2 篇应累加为 6，实际 {result['total_from_sources']} "
        "（旧 bug：覆盖赋值只留最后一次 = 2）"
    )
    assert result["new_records"] == 6
    assert result["duplicates_removed"] == 0
    assert result["duplicates_removed"] >= 0


def test_duplicates_removed_invariant_holds(tmp_path: Path) -> None:
    """断言 total_from_sources == new_records + duplicates_removed 恒等式。"""
    inputs = [
        # arxiv 返回 3 篇，其中 2 篇与 openalex 重复
        {"source": "arxiv", "papers": [
            _fake_paper("Paper Shared 1", "10.1/s1"),
            _fake_paper("Paper Shared 2", "10.1/s2"),
            _fake_paper("Paper Unique A", "10.1/ua"),
        ]},
        # openalex 返回相同 DOI 的 2 篇 + 1 个新的
        {"source": "openalex", "papers": [
            _fake_paper("Paper Shared 1", "10.1/s1"),
            _fake_paper("Paper Shared 2", "10.1/s2"),
            _fake_paper("Paper Unique O", "10.1/uo"),
        ]},
    ]

    result = _run(
        process_results_core(
            query="test",
            inputs=inputs,
            enrich=False,
            session_id="sess-invariant",
            config_dir=str(tmp_path),
        )
    )

    total = result["total_from_sources"]
    new = result["new_records"]
    dup = result["duplicates_removed"]

    assert dup >= 0, f"duplicates_removed 不能为负，实际 {dup}"
    assert total == new + dup, (
        f"恒等式破坏：total ({total}) ≠ new ({new}) + dup ({dup})"
    )
    # 6 raw（arxiv 3 + openalex 3）→ 4 unique (s1, s2, ua, uo) → 2 duplicates (s1/s2 各重复一次)
    assert total == 6
    assert new == 4
    assert dup == 2


def test_source_new_counts_accumulate_per_source(tmp_path: Path) -> None:
    """同源多次输入时，source_new_counts 也应累加。"""
    inputs = [
        {"source": "arxiv", "papers": [_fake_paper("A1", "10.1/a1")]},
        {"source": "arxiv", "papers": [_fake_paper("A2", "10.1/a2")]},
        {"source": "semantic", "papers": [_fake_paper("S1", "10.1/s1")]},
    ]

    result = _run(
        process_results_core(
            query="test",
            inputs=inputs,
            enrich=False,
            session_id="sess-source-new",
            config_dir=str(tmp_path),
        )
    )

    snc = result["source_new_counts"]
    assert snc.get("arxiv") == 2, f"arxiv 两次各 1 篇应累加为 2，实际 {snc.get('arxiv')}"
    assert snc.get("semantic") == 1
    assert sum(snc.values()) == result["new_records"]


# ============================================================
# #622 Crossref 非论文噪声过滤（Figure/Table/Supplementary，seed 豁免）
# ============================================================
#
# 背景：Crossref 把论文的 Figure / Table / 补充材料也分配独立 DOI 作为独立条目
# 返回（标题形如 "Figure 3 from ..." / "Supplementary material for ..."），是
# Crossref 召回的主要噪声形态。process 阶段滤掉它们，仅作用于 crossref 来源，
# seed 永远豁免。

_XREF = "tool:MCP:paper-search:crossref"


def test_is_crossref_noise_matches_all_noise_forms() -> None:
    """六种噪声词形都应命中（含 "Fig." 缩写，守门参考实现尾部 \\b 的匹配 bug）。"""
    for title in (
        "Figure 3 from a study on dual-RNA-guided endonuclease",
        "Fig. 2: experimental setup",
        "Table 1 summary of results",
        "Supplementary material for the main article",
        "Supplement to the genome editing paper",
        "Appendix A: derivations",
    ):
        assert _is_crossref_noise({"source": _XREF, "title": title}) is True, title


def test_is_crossref_noise_word_boundary_no_false_positive() -> None:
    """词边界守门：含正文词（tabletop / stable / configuration）的真实论文标题不被误杀。"""
    for title in (
        "A tabletop experiment for quantum optics",   # tabletop ⊃ table，无词边界
        "Stable diffusion models for image synthesis",  # stable ⊃ table，无词边界
        "Configuration of neural network layers",       # config ⊃ fig，但无句点
        "Deep learning for natural language processing",  # 无任一噪声词
    ):
        assert _is_crossref_noise({"source": _XREF, "title": title}) is False, title


def test_is_crossref_noise_source_scoped() -> None:
    """仅 crossref 生效：同一噪声样式标题，非 crossref 源不过滤。"""
    noise_title = "Figure 3 from A programmable dual-RNA-guided DNA endonuclease"
    assert _is_crossref_noise({"source": _XREF, "title": noise_title}) is True
    for src in (
        "tool:MCP:paper-search:openalex",
        "tool:MCP:paper-search:arxiv",
        "tool:MCP:paper-search:semantic",
    ):
        assert _is_crossref_noise({"source": src, "title": noise_title}) is False, src


def test_is_crossref_noise_seed_exempt() -> None:
    """seed 豁免：extra.seed=true 的 crossref 噪声样式记录不被过滤。"""
    rec = {
        "source": _XREF,
        "title": "Figure of merit optimization in photovoltaic cells",
        "extra": {"seed": True},
    }
    assert _is_crossref_noise(rec) is False


def test_crossref_noise_filtered_non_crossref_kept(tmp_path: Path) -> None:
    """AC1：crossref 的 Figure/Supplementary 条目被滤；crossref 真实论文与
    非 crossref 源记录保留。"""
    inputs = [
        {"source": "crossref", "papers": [
            _fake_paper("Figure 3 from A programmable dual-RNA-guided DNA endonuclease", "10.1/xref-fig"),
            _fake_paper("Supplementary material for CRISPR genome editing", "10.1/xref-supp"),
            _fake_paper("A programmable dual-RNA-guided DNA endonuclease in adaptive immunity", "10.1/xref-real"),
        ]},
        {"source": "openalex", "papers": [
            # 命中噪声词形但来自 openalex → 不在过滤范围，保留
            _fake_paper("Figure-ground organization in visual perception", "10.1/oa-fig"),
        ]},
    ]

    result = _run(
        process_results_core(
            query="crispr",
            inputs=inputs,
            enrich=False,
            session_id="sess-xref-noise",
            config_dir=str(tmp_path),
        )
    )

    titles = {r["title"] for r in _read_jsonl(Path(result["output_path"]))}
    assert "Figure 3 from A programmable dual-RNA-guided DNA endonuclease" not in titles
    assert "Supplementary material for CRISPR genome editing" not in titles
    assert "A programmable dual-RNA-guided DNA endonuclease in adaptive immunity" in titles
    assert "Figure-ground organization in visual perception" in titles
    assert result["new_records"] == 2


def test_crossref_noise_word_boundary_kept_end_to_end(tmp_path: Path) -> None:
    """AC2：crossref 源中含 "tabletop" / "stable" 正文词的记录不被误删。"""
    inputs = [{"source": "crossref", "papers": [
        _fake_paper("A tabletop experiment for quantum optics", "10.1/tabletop"),
        _fake_paper("Stable diffusion models for image synthesis", "10.1/stable"),
        _fake_paper("Table 2 from an unrelated chemistry study", "10.1/realnoise"),
    ]}]

    result = _run(
        process_results_core(
            query="physics",
            inputs=inputs,
            enrich=False,
            session_id="sess-xref-boundary",
            config_dir=str(tmp_path),
        )
    )

    titles = {r["title"] for r in _read_jsonl(Path(result["output_path"]))}
    assert "A tabletop experiment for quantum optics" in titles
    assert "Stable diffusion models for image synthesis" in titles
    assert "Table 2 from an unrelated chemistry study" not in titles
    assert result["new_records"] == 2


def test_crossref_seed_noise_style_kept(tmp_path: Path) -> None:
    """AC3：extra.seed=true 的 crossref 噪声样式记录被保留（seed 豁免）。"""
    seed_doi = "10.1/seed-fig"
    inputs = [{"source": "crossref", "papers": [
        _fake_paper("Figure of merit optimization in photovoltaic cells", seed_doi),
        _fake_paper("Supplementary material for an unrelated study", "10.1/xref-supp2"),
    ]}]

    result = _run(
        process_results_core(
            query="photovoltaic",
            inputs=inputs,
            enrich=False,
            session_id="sess-xref-seed",
            config_dir=str(tmp_path),
            seed_keys={seed_doi.lower()},
        )
    )

    records = _read_jsonl(Path(result["output_path"]))
    titles = {r["title"] for r in records}
    assert "Figure of merit optimization in photovoltaic cells" in titles, (
        "seed 豁免：crossref 噪声样式但 extra.seed=true 必须保留"
    )
    assert "Supplementary material for an unrelated study" not in titles
    seed_rec = next(r for r in records if r["doi"] == seed_doi)
    assert (seed_rec.get("extra") or {}).get("seed") is True
    assert result["new_records"] == 1
