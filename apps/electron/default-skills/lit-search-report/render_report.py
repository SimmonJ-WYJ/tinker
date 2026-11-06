#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
检索报告确定性渲染引擎（lit-search-report skill）

把"读数据 + 拼 HTML"这件确定性的活从 LLM 手里拿回来：LLM 只产判断字段
（主题归类 / 推荐理由 / 趋势 / 空白），所有结构化字段（标题 / 作者 / 年份 /
DOI / 统计 / References）由本脚本从已落盘的候选集直接填表——既快（LLM 不再
逐 token 誊写数据库已有字段），又准（消除 DOI / 长标题的誊写幻觉）。

两个模式：
  prepare  读 agent-sessions-papers JSONL → 全局去重 → 算 stats/rounds/recurring
           → 按相关度分（score.finalScore，旧字段兜底）排序并分配稳定编号 N（1..total）→ 落盘 data.json
           → 同时 print 精简候选（带 N + abstract）供 LLM 做主题归类与理由
  render   读 data.json + LLM 产出的 judgments.json → 按 N join → 拼完整 HTML
           fragment（固定文案按 judgments.lang 选 zh/en）→ 写 searches/{ts}-{slug}.html
           → print 最终相对路径

编号契约（由本脚本统一生成）：
  正文不出现任何 [N] 引用角标（检索报告不做综述式引用）。FULL 报告：每篇论文只归首个出现的
  主题（跨主题去重），§3 推荐表按出现先后连续编号 C（1..K），文末 References 收录且仅收录 §3
  列出的这些论文、与表格首列「序号」逐条同号（§4 代表作只展示标题、不计入 References）。
  MINIMAL 报告：References 收 §2 top 列表的论文。LLM 产出的 judgments 仍用候选集相关性
  rank N 指认论文（内部 join 键），展示编号 C 与 N 解耦。

依赖：仅 Python 3 标准库。
"""

import argparse
import datetime
import html
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

# ── 固定文案（i18n）──────────────────────────────────────────────────────────
# 所有结构性词汇（§标题 / 表头 / 单位 / 兜底语）按 judgments.lang 选 zh/en 单语言渲染
# —— 遵循 #549：报告单语言、不做「中文 / English」双语并排。论文标题 / 作者 / DOI 等
# 标识符保持原文。
LABELS = {
    "zh": {
        "default_title": "文献检索报告",
        "theme_heading": "主题 {i}：{name}",
        "round_srcs_tail": "（{bysrc}）。",
        "topic": "检索主题", "rounds_row": "检索轮次", "sources": "数据源",
        "time_range": "时间范围", "total": "总检索量", "with_abstract": "含摘要",
        "papers_unit": "篇", "rounds_unit": "轮", "per_round": "各轮统计",
        "round": "Round", "round_raw": "条原始结果，去重后新增", "dedup_suffix": "篇（去重后）",
        "th_no": "序号",
        "th_title": "标题", "th_author": "第一作者", "th_year": "年份",
        "th_doi": "DOI", "th_reason": "推荐理由",
        "th_group_author": "作者", "th_group_hits": "本次命中", "th_group_rep": "代表作",
        "th_group_contrib": "核心贡献",
        "no_abstract": "（无摘要，相关性上限 60）", "trends": "5.1 当前趋势",
        "gaps": "5.2 潜在研究空白",
        "gaps_framing": "以下空白是基于本次候选集的推断（即「本次检索范围内未见」，不等于领域内不存在）：",
        "next_steps": [
            "对 §3 推荐的核心文献优先精读",
            "使用 Zotero 批量导入将核心文献导入个人文献库",
            "如需基于核心文献生成文献综述初稿，@ 此报告文件并告知",
        ],
        "min_overview_fallback": "本轮命中的高分论文概览如下。",
        "coverage_fallback": "各数据源覆盖情况见 §1；未见明显失败源。",
        "relevance": "相关性",
        "sections": {
            "s1": "§1 检索概况", "s2_full": "§2 核心主题分布",
            "s3_full": "§3 论文推荐（按主题）", "s4_full": "§4 关键研究团队",
            "s5_full": "§5 研究趋势与空白", "s6_full": "§6 下一步建议",
            "s2_min": "§2 关键发现与高分论文", "s3_min": "§3 覆盖与局限",
            "refs": "参考",
        },
    },
    "en": {
        "default_title": "Literature Search Report",
        "theme_heading": "Theme {i}: {name}",
        "round_srcs_tail": " ({bysrc}).",
        "topic": "Research question", "rounds_row": "Rounds", "sources": "Sources",
        "time_range": "Time range", "total": "Total retrieved", "with_abstract": "With abstract",
        "papers_unit": "papers", "rounds_unit": "round(s)", "per_round": "Per-round stats",
        "round": "Round", "round_raw": "raw results, newly added after dedup", "dedup_suffix": "papers (deduplicated)",
        "th_no": "No.",
        "th_title": "Title", "th_author": "First author", "th_year": "Year",
        "th_doi": "DOI", "th_reason": "Why relevant",
        "th_group_author": "Author", "th_group_hits": "Hits", "th_group_rep": "Representative work",
        "th_group_contrib": "Key contribution",
        "no_abstract": "(no abstract; relevance capped at 60)", "trends": "5.1 Current trends",
        "gaps": "5.2 Potential research gaps",
        "gaps_framing": "The gaps below are inferences scoped to this candidate set (i.e. \"not seen in this search\"), not claims about the field at large:",
        "next_steps": [
            "Prioritise deep reading of the core papers recommended in §3",
            "Use Zotero batch import to add the core papers to your library",
            "To draft a literature review from the core papers, @-mention this report and let the Agent know",
        ],
        "min_overview_fallback": "Overview of the top-scored papers from this search.",
        "coverage_fallback": "Per-source coverage is in §1; no obviously failed source.",
        "relevance": "relevance",
        "sections": {
            "s1": "§1 Search overview", "s2_full": "§2 Theme distribution",
            "s3_full": "§3 Recommended papers by theme", "s4_full": "§4 Key research groups",
            "s5_full": "§5 Trends & gaps", "s6_full": "§6 Next steps",
            "s2_min": "§2 Key findings & top papers", "s3_min": "§3 Coverage & limitations",
            "refs": "References",
        },
    },
}


def esc(value) -> str:
    """HTML 转义任意值（数据来自候选集，可能含 < & " 等，必须显式转义）。"""
    if value is None:
        return ""
    return html.escape(str(value), quote=True)


def slugify(text: str, fallback: str = "report") -> str:
    """把 LLM 给的 slug / 标题清洗成安全文件名片段（ASCII，连字符分隔）。"""
    s = (text or "").strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.ASCII)  # 丢弃非 ASCII（中文等）与符号
    s = re.sub(r"[\s_]+", "-", s).strip("-")
    s = re.sub(r"-{2,}", "-", s)
    return (s[:60] or fallback)


# ── prepare 模式：移植自原 SKILL.md Step 1（dedup/score/key 逻辑保持一致）─────
def _ex(r):
    return r.get("extra") or {}


def _score(r):
    """相关度分，与右栏面板排序同口径（#581）：
    score.finalScore（camelCase，paper_scoring.py 落盘名）→ finalRelevance → relevance → 0。
    旧字段兜底是为兼容旧会话 JSONL 与 v1 fallback 场景。"""
    e = _ex(r)
    # 旧会话 JSONL 评分键名为 scoreV2，读取时兜底回退
    sc = e.get("score") or e.get("scoreV2")
    if isinstance(sc, dict):
        v = sc.get("finalScore")
        if isinstance(v, (int, float)):
            return v
    if e.get("finalRelevance") is not None:
        return e["finalRelevance"]
    return e.get("relevance", 0) or 0


def _src(r):
    s = r.get("source") or ""
    return s.rsplit(":", 1)[-1] if s else ""


def _key(r):
    d = r.get("doi") or _ex(r).get("doi")
    if d:
        return ("doi", d.lower())
    return ("title", "".join((r.get("title") or "").lower().split()))


def _dump_empty(out_data: Path, reason: str) -> None:
    """无候选时也落盘最小 data.json，让 render 统一产出「未找到候选」报告
    （不让 LLM 回退去手写 HTML）。"""
    data = {"tier": "MINIMAL", "note": reason,
            "meta": {"total_unique": 0, "with_abstract": 0, "years": None,
                     "by_source": {}, "rounds": [], "recurring_authors": []},
            "papers": []}
    out_data.parent.mkdir(parents=True, exist_ok=True)
    out_data.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _write_reporting_live(papers_dir: Path, session_id: str, candidate_count: int, tier: str) -> None:
    """#775：报告生成阶段确定性预告（live phase=reporting）。

    judgments 是主 Agent 一个 ~62s 的黑盒 LLM turn、内部进度拆不出，故只用 prepare 已算的
    确定性数据（候选数 / 档位 / 章节数）做「将得到什么」预告，不做假进度条。续写 retrieve 用过
    的同一 live 文件，复用主进程 watcher + IPC 链路。best-effort：失败静默，绝不影响报告生成。
    """
    if not session_id:
        return
    try:
        import os
        import time
        section_count = 6 if tier == "FULL" else 3
        path = papers_dir / f"{session_id}.live.json"
        state = {
            "schema_version": 1, "session_id": session_id, "turn_id": "",
            "phase": "reporting", "updated_at": time.time(),
            "sources": {}, "records": [], "raw_total": 0,
            "report_candidate_count": candidate_count,
            "report_tier": tier, "report_section_count": section_count,
        }
        papers_dir.mkdir(parents=True, exist_ok=True)
        tmp = papers_dir / f"{session_id}.live.json.{os.getpid()}.tmp"
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        pass  # 进度是增强，不影响报告


def _clear_live(papers_dir: Path, session_id: str) -> None:
    """报告 HTML 写出后删除 live 文件，结束进度展示（#775）；不存在 / 失败均静默。"""
    if not session_id:
        return
    try:
        (papers_dir / f"{session_id}.live.json").unlink()
    except FileNotFoundError:
        pass
    except Exception:
        pass


def prepare(jsonl_path: Path, out_data: Path) -> int:
    if not jsonl_path.exists():
        _dump_empty(out_data, "NO_CANDIDATES (file missing)")
        print(f"NO_CANDIDATES at {jsonl_path}")
        print(f"DATA_FILE {out_data}")
        return 0
    rows = [json.loads(l) for l in jsonl_path.open(encoding="utf-8") if l.strip()]
    if not rows:
        _dump_empty(out_data, "NO_CANDIDATES (empty file)")
        print("NO_CANDIDATES (empty file)")
        print(f"DATA_FILE {out_data}")
        return 0

    groups = defaultdict(list)
    for r in rows:
        groups[r.get("turn_id") or "_legacy"].append(r)
    turns = sorted((k for k in groups if k != "_legacy"),
                   key=lambda k: min((p.get("ts") or "") for p in groups[k]))
    if "_legacy" in groups:
        turns.append("_legacy")

    seen = {}
    round_stats = []
    for i, t in enumerate(turns, 1):
        rs = groups[t]
        new = 0
        by_src = Counter(_src(r) for r in rs)
        for r in rs:
            k = _key(r)
            if k not in seen:
                seen[k] = r
                new += 1
            elif _score(r) > _score(seen[k]):
                seen[k] = r
        round_stats.append({"round": i, "turn_id": t, "rows": len(rs),
                            "new_unique": new, "by_source": dict(by_src)})

    papers_sorted = sorted(seen.values(), key=_score, reverse=True)
    total = len(papers_sorted)
    tier = "FULL" if total >= 50 else "MINIMAL"
    with_abstract = sum(1 for r in papers_sorted if (r.get("abstract") or "").strip())
    years = sorted(y for y in (r.get("year") for r in papers_sorted) if y)
    by_source = Counter(_src(r) for r in papers_sorted)
    au = Counter(a for r in papers_sorted for a in (r.get("authors") or [])[:2] if a)
    recurring = [[a, c] for a, c in au.most_common(12) if c >= 2]

    top_n = 40 if tier == "FULL" else 10
    papers = []
    for n, r in enumerate(papers_sorted[:top_n], 1):
        e = _ex(r)
        papers.append({
            "n": n,
            "title": r.get("title") or "",
            "authors": (r.get("authors") or [])[:4],
            "year": r.get("year"),
            "venue": r.get("venue") or "",
            "source": _src(r),
            "doi": r.get("doi") or e.get("doi"),
            "arxiv": e.get("pdf_url"),
            "zoteroKey": r.get("zoteroKey") or e.get("zoteroKey"),
            "citedBy": e.get("citedBy"),
            # 键名沿用 finalRelevance（内部 join 契约），值为 _score() 链式解析的相关度分
            # —— 排序与展示同源（MINIMAL §2 展示的就是这个键）。
            "finalRelevance": _score(r),
            "abstract": (r.get("abstract") or "")[:500],
        })

    data = {
        "tier": tier,
        "meta": {
            "total_unique": total,
            "with_abstract": with_abstract,
            "years": [years[0], years[-1]] if years else None,
            "by_source": dict(by_source),
            "rounds": round_stats,
            "recurring_authors": recurring,
        },
        "papers": papers,
    }
    out_data.parent.mkdir(parents=True, exist_ok=True)
    out_data.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # print 精简候选给 LLM（带 N，供 themes.paper_ns / recommendations 引用）
    m = data["meta"]
    yr = m["years"]
    print(f"tier={tier} total_unique={total} with_abstract={with_abstract} "
          f"years={yr[0] if yr else '?'}-{yr[1] if yr else '?'} by_source={json.dumps(dict(by_source), ensure_ascii=False)}")
    for s in round_stats:
        print("ROUND", json.dumps(s, ensure_ascii=False))
    print("RECURRING_AUTHORS", json.dumps(recurring, ensure_ascii=False))
    print(f"DATA_FILE {out_data}")
    for p in papers:
        print(json.dumps({
            "n": p["n"], "title": p["title"], "authors": p["authors"],
            "year": p["year"], "doi": p["doi"], "finalRelevance": p["finalRelevance"],
            "abstract": p["abstract"],
        }, ensure_ascii=False))
    # #775：写报告确定性预告（candidate_count + tier + 章节数），覆盖 scorer 阶段的 live，
    # 让接下来 ~62s 的 judgments 黑盒生成期间面板显示「正在为 N 篇生成 M 节报告」。
    if total > 0:
        _write_reporting_live(jsonl_path.parent, jsonl_path.stem, total, tier)
    return total


# ── render 模式：data.json + judgments.json → HTML ───────────────────────────
def _fmt_authors(authors) -> str:
    authors = [a for a in (authors or []) if a]
    if not authors:
        return "—"
    if len(authors) > 3:
        return ", ".join(authors[:3]) + " et al."
    return ", ".join(authors)


def _doi_cell(p) -> str:
    doi = p.get("doi")
    if doi:
        return esc(doi)
    arxiv = p.get("arxiv")
    if arxiv:
        return esc(arxiv)
    return "—"


def _ref_line(p) -> str:
    """References 单条：Authors. <i>Title</i>. Venue, Year."""
    authors = esc(_fmt_authors(p.get("authors")))
    title = f"<i>{esc(p.get('title'))}</i>"
    yr = p.get("year")
    venue_year = ", ".join(x for x in [p.get("venue") or "", str(yr) if yr else ""] if x)
    return f"{authors}. {title}. {esc(venue_year)}."


def render(data_path: Path, judg_path: Path, out_dir: Path) -> str:
    data = json.loads(data_path.read_text(encoding="utf-8"))
    judg = json.loads(judg_path.read_text(encoding="utf-8"))

    lang = judg.get("lang") if judg.get("lang") in LABELS else "zh"
    L = LABELS[lang]
    tier = data.get("tier", "MINIMAL")
    meta = data.get("meta") or {}
    papers = {p["n"]: p for p in data.get("papers", [])}

    # 正文不再生成 [N] 角标（检索报告不做综述式引用）；只按"论文在报告里首次出现的先后"登记，
    # 驱动文末 References 的顺序与连续编号 C。
    appearance = []  # n 的首次出现序

    def register(n):
        """登记论文按首次出现顺序进 References（幂等），返回其连续编号 C（1..K）；
        n 不在候选集时返回 None。§3 推荐表用回传的 C 作首列序号，与文末 References 一一对应。"""
        if n not in papers:
            return None
        if n not in appearance:
            appearance.append(n)
        return appearance.index(n) + 1

    out = []
    out.append('<article class="asci-search-report" data-version="1">')
    title = judg.get("title") or L["default_title"]
    out.append(f"  <header><h1>{esc(title)}</h1></header>")

    if tier == "FULL":
        out.append(_render_s1(L, meta, judg))
        out.append(_render_s2_full(L, judg))
        out.append(_render_s3_full(L, judg, papers, register))
        out.append(_render_s4_full(L, meta, judg, papers))
        out.append(_render_s5_full(L, judg))
        out.append(_render_s6_full(L))
    else:
        out.append(_render_s1(L, meta, judg))
        out.append(_render_s2_min(L, judg, papers, register))
        out.append(_render_s3_min(L, judg))

    out.append(_render_refs(L, papers, appearance))
    out.append("</article>")
    fragment = "\n".join(out)

    ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M")
    slug = slugify(judg.get("slug") or judg.get("research_question") or title)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{ts}-{slug}.html"
    out_file.write_text(fragment, encoding="utf-8")
    # #775：报告 HTML 已写出，删除 reporting 预告 live 文件，结束进度展示。
    # session_id / papers_dir 走 cwd 推导（与 main() 的 prepare 分支、prepare() 写 live 完全同源）：
    # cwd = <config>/agent-workspaces/<ws>/<session>，cwd.name = session id，cwd 上三级 = <config>。
    # 不能从 out_dir 反推——SKILL.md 传的是相对路径 `searches`，反推得到空 session id 会让 clear no-op。
    try:
        cwd = Path.cwd().resolve()
        _clear_live(cwd.parent.parent.parent / "agent-sessions-papers", cwd.name)
    except Exception:
        pass
    return str(out_file)


def _render_s1(L, meta, judg) -> str:
    yr = meta.get("years")
    yr_txt = f"{yr[0]}–{yr[1]}" if yr else "—"
    rounds = meta.get("rounds") or []
    by_source = meta.get("by_source") or {}
    rows = [
        (L["topic"], judg.get("research_question") or judg.get("title") or "—"),
        (L["rounds_row"], f"{len(rounds)} {L['rounds_unit']}"),
        (L["sources"], ", ".join(by_source.keys()) or "—"),
        (L["time_range"], yr_txt),
        (L["total"], f"{meta.get('total_unique', 0)} {L['dedup_suffix']}"),
        (L["with_abstract"], f"{meta.get('with_abstract', 0)} {L['papers_unit']}"),
    ]
    s = [f'  <section id="s1"><h2>{esc(L["sections"]["s1"])}</h2>', "    <table><tbody>"]
    for k, v in rows:
        s.append(f"      <tr><th>{esc(k)}</th><td>{esc(v)}</td></tr>")
    s.append("    </tbody></table>")
    if rounds:
        s.append(f"    <h3>{esc(L['per_round'])}</h3><ul>")
        for r in rounds:
            bysrc = ", ".join(f"{k}:{v}" for k, v in (r.get("by_source") or {}).items())
            s.append(f"      <li><b>{L['round']} {r.get('round')}</b> — "
                     f"{r.get('rows')} {L['round_raw']} {r.get('new_unique')} {L['papers_unit']}"
                     f"{L['round_srcs_tail'].format(bysrc=esc(bysrc))}</li>")
        s.append("    </ul>")
    s.append("  </section>")
    return "\n".join(s)


def _render_s2_full(L, judg) -> str:
    # 主题分布只讲"这一簇是什么/集中在哪"，不点名代表论文（检索阶段不做综述式引用）。
    # 具体论文在 §3 按主题成表列出。
    themes = judg.get("themes") or []
    s = [f'  <section id="s2"><h2>{esc(L["sections"]["s2_full"])}</h2>']
    for i, th in enumerate(themes, 1):
        name = esc(th.get("name") or "")
        desc = esc(th.get("desc") or "")
        s.append(f"    <h3>{L['theme_heading'].format(i=i, name=name)}</h3><p>{desc}</p>")
    s.append("  </section>")
    return "\n".join(s)


def _first_sentence(text: str, limit: int = 140) -> str:
    """取首句作为兜底推荐理由：按中英句末标点切分，再硬截断到 limit 字。
    英文 `.` 仅当后跟空格+大写（或位于行尾）才算句末，避免截在 Fig. 1 / 3.5 mg 等缩写、小数处。"""
    t = " ".join(text.split())
    m = re.search(r"[。！？!?]|\.(?=\s+[A-Z])|\.$", t)
    s = t[: m.end()] if m and m.end() <= limit else t[:limit]
    return s.strip()


def _render_s3_full(L, judg, papers, register) -> str:
    # 论文按主题成表：序号｜标题｜第一作者｜年份｜DOI｜推荐理由。首列序号 = 该论文在文末
    # References 的编号 C（register 回传）。每篇论文只归首个出现的主题（跨主题去重），故序号
    # 自上而下连续 1..K，与「参考」逐条同号。某主题论文若全被前序主题吸收，跳过整个空表。
    themes = judg.get("themes") or []
    recs = judg.get("recommendations") or {}
    seen_n = set()  # §3 内跨主题去重：一篇论文只在首个出现的主题列一次
    s = [f'  <section id="s3"><h2>{esc(L["sections"]["s3_full"])}</h2>']
    th_head = (f"<thead><tr><th>{L['th_no']}</th><th>{L['th_title']}</th>"
               f"<th>{L['th_author']}</th><th>{L['th_year']}</th>"
               f"<th>{L['th_doi']}</th><th>{L['th_reason']}</th></tr></thead>")
    for i, th in enumerate(themes, 1):
        rows = []
        for n in (th.get("paper_ns") or []):
            p = papers.get(n)
            if not p or n in seen_n:
                continue
            seen_n.add(n)
            c = register(n)  # 参考编号 C，作首列序号
            reason = recs.get(str(n)) or recs.get(n) or ""
            if not reason:
                # LLM 漏给理由时不留空 <td>：有摘要→取摘要首句兜底，无摘要→标注相关性上限。
                abstract = (p.get("abstract") or "").strip()
                reason = _first_sentence(abstract) if abstract else L["no_abstract"]
            rows.append(f"      <tr><td>{c}</td><td><b>{esc(p.get('title'))}</b></td>"
                        f"<td>{esc((p.get('authors') or ['—'])[0])}</td><td>{esc(p.get('year') or '—')}</td>"
                        f"<td>{_doi_cell(p)}</td><td>{esc(reason)}</td></tr>")
        if not rows:
            continue  # 该主题论文全被前序主题列过 → 不输出空表（主题编号保持原序，可能跳号）
        s.append(f"    <h3>{i}. {esc(th.get('name') or '')}</h3>")
        s.append(f"    <table>{th_head}<tbody>")
        s.extend(rows)
        s.append("    </tbody></table>")
    s.append("  </section>")
    return "\n".join(s)


def _render_s4_full(L, meta, judg, papers) -> str:
    recurring = meta.get("recurring_authors") or []
    groups = judg.get("groups") or {}
    # 作者 → 代表作 N（该作者命中的最高分论文）
    author_rep = {}
    for n in sorted(papers):
        for a in (papers[n].get("authors") or [])[:2]:
            author_rep.setdefault(a, n)
    s = [f'  <section id="s4"><h2>{esc(L["sections"]["s4_full"])}</h2>',
         f"    <table><thead><tr><th>{L['th_group_author']}</th><th>{L['th_group_hits']}</th>"
         f"<th>{L['th_group_rep']}</th><th>{L['th_group_contrib']}</th></tr></thead><tbody>"]
    for author, count in recurring:
        rep_n = author_rep.get(author)
        # recurring_authors 按全候选集算，代表作只能在 top 集里解析；该作者论文全在 top 集外
        # → 代表作给不出，整行无信息量，跳过（消除空白幽灵行）。
        if rep_n is None or rep_n not in papers:
            continue
        # 代表作只展示标题、不登记进 References（References 仅收 §3 推荐表列出的论文）。
        rep = f"<i>{esc(papers[rep_n].get('title'))}</i>"  # 标题纯文本，不做 [N] 角标
        contrib = esc(groups.get(author) or "") or "—"  # LLM 漏填贡献时占位，不留空 <td>
        s.append(f"      <tr><td><b>{esc(author)}</b></td><td>{count} {L['papers_unit']}</td>"
                 f"<td>{rep}</td><td>{contrib}</td></tr>")
    s.append("    </tbody></table></section>")
    return "\n".join(s)


def _render_s5_full(L, judg) -> str:
    trends = judg.get("trends") or []
    gaps = judg.get("gaps") or []
    s = [f'  <section id="s5"><h2>{esc(L["sections"]["s5_full"])}</h2>',
         f"    <h3>{esc(L['trends'])}</h3><ol>"]
    for tr in trends:
        # trends 现为字符串数组；兼容旧的 {text, refs} 形态（忽略 refs，不再做 [N] 角标）
        text = tr if isinstance(tr, str) else (tr.get("text") or "")
        s.append(f"      <li>{esc(text)}</li>")
    s.append("    </ol>")
    s.append(f"    <h3>{esc(L['gaps'])}</h3><p>{esc(L['gaps_framing'])}</p><ol>")
    for g in gaps:
        s.append(f"      <li>{esc(g)}</li>")
    s.append("    </ol></section>")
    return "\n".join(s)


def _render_s6_full(L) -> str:
    items = "".join(f"<li>{esc(x)}</li>" for x in L["next_steps"])
    return f'  <section id="s6"><h2>{esc(L["sections"]["s6_full"])}</h2><ol>{items}</ol></section>'


def _render_s2_min(L, judg, papers, register) -> str:
    overview = esc(judg.get("overview") or L["min_overview_fallback"])
    findings = judg.get("top_findings") or {}
    s = [f'  <section id="s2"><h2>{esc(L["sections"]["s2_min"])}</h2><p>{overview}</p><ol>']
    for n in sorted(papers):  # 相关性 rank 升序 = 高分榜顺序，即此处的"出现顺序"
        p = papers[n]
        why = findings.get(str(n)) or findings.get(n) or ""
        register(n)
        why_txt = f" {esc(why)}" if why else ""
        s.append(f'      <li>{esc(p.get("title"))} — '
                 f'{L["relevance"]} {esc(p.get("finalRelevance"))}.{why_txt}</li>')
    s.append("    </ol></section>")
    return "\n".join(s)


def _render_s3_min(L, judg) -> str:
    coverage = esc(judg.get("coverage") or L["coverage_fallback"])
    return f'  <section id="s3"><h2>{esc(L["sections"]["s3_min"])}</h2><p>{coverage}</p></section>'


def _render_refs(L, papers, appearance) -> str:
    # 按论文在报告里首次出现的先后连续编号 C（1..K），只收 appearance 里出现过的论文。
    s = [f'  <section id="refs" class="references"><h2>{esc(L["sections"]["refs"])}</h2>',
         '    <ol class="refs">']
    for c, n in enumerate(appearance, 1):
        p = papers.get(n)
        if not p:
            continue
        attrs = f' id="ref-{c}" data-ref="{c}"'
        if p.get("doi"):
            attrs += f' data-doi="{esc(p["doi"])}"'
        if p.get("zoteroKey"):
            attrs += f' data-zotero-key="{esc(p["zoteroKey"])}"'
        s.append(f"      <li{attrs}>{_ref_line(p)}</li>")
    s.append("    </ol></section>")
    return "\n".join(s)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="lit-search-report 渲染引擎")
    sub = ap.add_subparsers(dest="mode", required=True)
    p_prep = sub.add_parser("prepare", help="读 JSONL → 落盘 data.json + print 候选")
    p_prep.add_argument("--jsonl", required=False,
                        help="候选 JSONL 路径；缺省时按 cwd 推导（agent workspace 约定）")
    p_prep.add_argument("--out", required=True, help="data.json 输出路径")
    p_rend = sub.add_parser("render", help="data.json + judgments.json → HTML")
    p_rend.add_argument("--data", required=True)
    p_rend.add_argument("--judgments", required=True)
    p_rend.add_argument("--out-dir", required=True, help="searches/ 目录")
    args = ap.parse_args(argv)

    try:
        if args.mode == "prepare":
            if args.jsonl:
                jsonl = Path(args.jsonl)
            else:
                # agent workspace 约定：cwd 第三父 = config dir，basename = session id
                cwd = Path.cwd().resolve()
                jsonl = cwd.parent.parent.parent / "agent-sessions-papers" / f"{cwd.name}.jsonl"
            prepare(jsonl, Path(args.out))
            return 0
        if args.mode == "render":
            out = render(Path(args.data), Path(args.judgments), Path(args.out_dir))
            print(out)
            return 0
    except Exception as e:  # noqa: BLE001 — skill 脚本：把错误显式抛给 agent，不静默
        print(f"RENDER_ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
