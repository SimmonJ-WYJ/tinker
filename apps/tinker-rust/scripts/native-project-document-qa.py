"""Exercise project document selection, scoped transmission and offline source recovery in a native QA window."""
import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import plistlib
from runpy import run_path
import tempfile
import time
from typing import Optional
import uuid

HERE = Path(__file__).resolve().parent
routes = run_path(str(HERE / "native-channel-model-qa.py"))
tasks = run_path(str(HERE / "native-project-task-qa.py"))
choose = routes["choose"]
Window = routes["ChannelWindow"]
NORTH = "Cedar document project"
SOUTH = "Birch document project"
LINES = ["QA_UNSELECTED_TOP_87", "QA_SELECTED_CEDAR_42", "QA_UNSELECTED_BOTTOM_76"]
OTHER = "QA_OTHER_PROJECT_65"
QUESTION = "Explain the selected line. [qa:document-selection]"
FOLLOWUP = "Now answer without a source. [qa:document-followup]"
ROWS = "[data-document-list-ready] [data-document-id]"


@dataclass(frozen=True)
class Scenario:
    filename: str
    choice: str
    lines: list[str]
    question: str
    followup: str
    answer: str
    followup_answer: str
    page: Optional[int] = None


PDF = run_path(str(HERE / "native-project-pdf-fixtures.py"))
MARKDOWN = Scenario("qa-project-note.md", "fixture", LINES, QUESTION, FOLLOWUP,
                    "Selected project lines verified.", "No document excerpt replayed.")
PDF_PAGES = Scenario(PDF["PDF_NAME"], "pdf-pages", PDF["PAGES"][1],
                     "Explain the highlighted PDF line. [qa:pdf-selection]",
                     "Now answer without the PDF. [qa:pdf-followup]",
                     "Selected PDF page and line verified.", "No PDF excerpt replayed.", page=2)


def scanned_pdf():
    # 生成仅含一像素灰阶图片、没有文字层的有效 PDF。
    draw = b"q 8 0 0 8 0 0 cm /Im1 Do Q"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 8 8] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n\x80\nendstream",
        b"<< /Length %d >>\nstream\n" % len(draw) + draw + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(b"%d 0 obj\n" % index + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(b"xref\n0 6\n0000000000 65535 f \n")
    for offset in offsets:
        pdf.extend(b"%010d 00000 n \n" % offset)
    pdf.extend(b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % xref)
    return bytes(pdf)


def fixtures(directory, scenario):
    files = {
        "qa-project-note.md": "\n".join(LINES).encode(),
        "qa-project-other.txt": OTHER.encode(),
        "qa-project-invalid.txt": b"\xff\xfe\xfd",
        "qa-project-oversized.txt": (b"x" * 255 + b"\n") * 1024 + b"x",
        "qa-project-scan.pdf": scanned_pdf(),
    }
    for name, content in files.items():
        (directory / name).write_bytes(content)
    if scenario.page:
        PDF["fixtures"](directory)
    return {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
            for file in sorted(directory.glob("qa-project-*")) if file.is_file()}


def open_documents(w, mode):
    choose(w, f'[data-project-documents="{mode}"]', "open project documents")
    w.wait("return !!document.querySelector('[data-document-list-ready]')", "native document catalog loaded")


def documents(w):
    return w.js(f"""return [...document.querySelectorAll({json.dumps(ROWS)})].map(b=>b.dataset.documentId);""")


def pick(w, choice):
    assert w.command("arm-document-picker", choice=choice) is True
    choose(w, "[data-document-import]", "choose a synthetic project document")
    w.wait("return !!document.querySelector('[data-document-import]:not(:disabled)')", "document picker resolved")


def import_document(w, choice, filename):
    pick(w, choice)
    return w.wait(f"""const b=[...document.querySelectorAll({json.dumps(ROWS)})]
        .find(b=>b.innerText.includes({json.dumps(filename)}));return b?.dataset.documentId;""",
        "catalog entry for the selected file")


def open_document(w, document_id):
    choose(w, f'[data-document-id="{document_id}"]', "open stored document preview")


def select_pdf_page(w, page):
    w.wait(f"""const field=document.querySelector('select[data-document-page]');
        if(!field || field.disabled || field.options.length!==3)return false;
        field.value={json.dumps(str(page))};field.dispatchEvent(new Event('change',{{bubbles:true}}));
        return true;""", f"select stored PDF page {page}")
    w.wait(f"""const field=document.querySelector('select[data-document-page]');
        const text=document.querySelector('[data-document-text]')?.textContent;
        return field?.value==={json.dumps(str(page))} && {json.dumps(PDF['PAGES'][page - 1])}.every(line=>text?.includes(line));""",
        f"complete text of page {page}")


def assert_excerpt(w, scenario):
    line = w.wait("""const box=document.querySelector('[data-document-text]');
        const rows=box?.querySelectorAll('[data-document-line]');
        if(rows?.length!==1)return false;
        const row=rows[0];
        return {line:row.dataset.documentLine,number:row.querySelector('[data-document-line-number]')?.textContent,
            text:row.querySelector('[data-document-line-text]')?.textContent};""", "numbered source line")
    assert line == {"line": "2", "number": "2", "text": scenario.lines[1]}, line


def switch_language(w, language):
    current, target = ("English", "中文") if language == "zh" else ("中文", "English")
    choose(w, ".sidebar-account-trigger", "open Settings to change language")
    routes["named"](w, "[role=dialog] button", ["General", "通用"])
    w.wait(f"""const b=[...document.querySelectorAll('[role=dialog] button[role=combobox]')]
        .find(el=>el.textContent.trim()==={json.dumps(current)});
        if(!b||b.disabled)return false;
        b.focus();b.dispatchEvent(new KeyboardEvent('keydown',{{key:'ArrowDown',bubbles:true}}));return true;""",
        "open the visible language selector")
    w.wait(f"""const opt=[...document.querySelectorAll('[role=option]')]
        .find(el=>el.textContent.trim()==={json.dumps(target)});if(!opt)return false;
        opt.focus();opt.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true}}));return true;""",
        "select " + target)
    w.wait(f"""return !document.querySelector('[role=listbox]') &&
        [...document.querySelectorAll('[role=dialog] button[role=combobox]')]
        .some(el=>el.textContent.trim()==={json.dumps(target)});""", "language selector changed")
    routes["common"]["close_settings"](w)
    assert routes["async_read"](w, "return (await window.electronAPI.getSettings()).language;") == language


def preview_in_composer(w, document_id, language, scenario):
    open_documents(w, "composer")
    assert documents(w) == [document_id]
    open_document(w, document_id)
    if scenario.page:
        select_pdf_page(w, scenario.page)
    for selector in ("[data-document-start]", "[data-document-end]"):
        routes["input_value"](w, selector, "2")
    choose(w, "[data-document-preview]", "preview selected line range")
    assert_excerpt(w, scenario)
    rendered = w.js("""const scope=document.querySelector('[role=dialog][data-state=open]');
        return [scope.querySelector('h2').innerText,
            ...['[data-document-import]','[data-document-preview]','[data-document-cite]']
            .map(selector=>scope.querySelector(selector).innerText.trim())];""")
    expected = (["项目资料", "导入资料", "预览所选行", "引用这些行"] if language == "zh" else
                ["Project documents", "Import document", "Preview lines", "Attach these lines"])
    assert rendered == expected, rendered
    return rendered


def is_foreground(state):
    return all(state[key] is True for key in ("active", "key", "visible"))


def foreground(w):
    deadline = time.monotonic() + 12
    requested = False
    while True:
        state = w.command("foreground-state")
        if is_foreground(state):
            break
        if time.monotonic() >= deadline:
            raise AssertionError(f"Owned AppKit window did not become foreground: {state}")
        # Tauri/TAO 的 set_focus 对本窗口 makeKeyAndOrderFront，再请求 NSApp 激活。
        # 每次让 AppKit 完成一轮事件后重新读取状态，实际未获焦点时不会操作来源。
        w.command("focus" if requested else "activate-owned-window")
        requested = True
        time.sleep(.45)
    w.wait("return document.visibilityState==='visible'", "foreground WKWebView")
    return state


def locate_source(w, row, language, scenario):
    assert source_row(w) == row
    foreground(w)
    page = ""
    if scenario.page:
        page = (f"第 {scenario.page} 页" if language == "zh" else f"page {scenario.page}") + " · "
    expected = scenario.filename + " · " + page + ("第 2–2 行" if language == "zh" else "lines 2–2")
    label = w.wait(f"""const b=document.querySelector('[data-document-source]');
        if(!b || b.getAttribute('aria-label')!=={json.dumps(expected)})return false;
        b.scrollIntoView({{block:'nearest'}});
        const box=b.getBoundingClientRect();
        const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
        return document.visibilityState==='visible' && b.contains(hit) && b.innerText.trim();""",
        "visible and unobscured message source button")
    assert label == expected, label
    choose(w, "[data-document-source]", "open the visible source on the restored user message")
    assert_excerpt(w, scenario)
    if scenario.page:
        w.wait(f"""return document.querySelector('[role=dialog] [data-document-location]')?.innerText.trim()==={json.dumps(expected)};""",
               "restored PDF page and line label")
    visible = """const d=document.querySelector('[role=dialog][data-state=open]');
        if(!d)return false;
        const line=d.querySelector('[data-document-line-text]');
        if(!line || line.textContent!==WANTED_LINE || d.querySelector('h2')?.textContent!==WANTED_FILE ||
            document.visibilityState!=='visible')return false;
        const r=line.getBoundingClientRect(), style=getComputedStyle(d);
        const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        if(!line.contains(hit) || style.visibility!=='visible' || Number(style.opacity)<.99 ||
            d.getAnimations().some(a=>a.playState==='running'))return false;
        return {visibility:document.visibilityState,opacity:Number(style.opacity),lineHit:true};""".replace("WANTED_LINE", json.dumps(scenario.lines[1])).replace("WANTED_FILE", json.dumps(scenario.filename))
    for attempt in range(1, 4):
        foreground(w)
        try:
            w.wait(visible, "visible, unobscured source text in the settled foreground dialog")
        except AssertionError:
            if is_foreground(w.command("foreground-state")):
                raise
            continue
        # 只截本窗口；抓图前后均核对真实焦点和同一弹窗的可见正文。
        time.sleep(.5)
        if not is_foreground(w.command("foreground-state")) or not w.js(visible):
            continue
        screenshot = w.command("snapshot")["png"]
        settled = w.js(visible)
        native = w.command("foreground-state")
        if settled and is_foreground(native):
            w.close_dialog()
            return {"label": label, "screenshot": screenshot, "appKit": native,
                    "webView": settled, "captureAttempts": attempt}
    raise AssertionError("Owned source dialog could not remain in the foreground throughout capture")


def source_row(w):
    return w.wait("""const buttons=document.querySelectorAll('[data-document-source]');
        const row=buttons[0]?.closest('[data-message-id]');
        return buttons.length===1 && row?.dataset.messageRole==='user' && row.dataset.messageId;""",
        "one persisted citation attached to its original user message")


def require_answer(w, text):
    w.wait(f"""return [...document.querySelectorAll('[data-message-role=assistant]')].some(e=>
        e.textContent.includes({json.dumps(text)}));""", "owned provider verified the expected request content")


def acceptance(binary, scenario):
    if not __debug__ or binary.name != "tinker-channels-native-qa" or not binary.is_file():
        raise ValueError("Use the dedicated channels native QA executable with Python assertions enabled")
    plist = plistlib.loads((binary.parent.parent / "Info.plist").read_bytes())
    assert plist["CFBundleIdentifier"] == "com.tinker.channels-native-qa"
    label = "pdf" if scenario.page else "documents"
    evidence = Path(tempfile.mkdtemp(prefix=f"tinker-tauri-checks-project-{label}-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-channels-preview-documents-" + uuid.uuid4().hex)
    print("Evidence:", evidence, flush=True)
    one = Window(binary, profile, evidence, "import-and-ask")
    try:
        source_hashes = fixtures(one.directory, scenario)
        one.wait("return !!document.querySelector('.sidebar-account-trigger')", "new isolated QA workbench")
        assert routes["counts"](profile) == [[0, 0], [0, 0]]
        routes["open_settings"](one)
        routes["add_provider"](one, routes["A"], routes["endpoint"](profile, ""), 1)
        channel, = routes["catalog"](one)
        routes["common"]["close_settings"](one)
        routes["select_model"](one, channel["id"], routes["TEXT"])
        baseline = routes["counts"](profile)
        assert baseline == [[2, 0], [0, 0]], baseline

        tasks["create_project"](one, NORTH)
        open_documents(one, "library")
        assert documents(one) == []
        pick(one, "cancel")
        assert documents(one) == [] and not one.js("return !!document.querySelector('[data-document-error]')")

        rejected = {}
        invalid = ("pdf", "pdf-damaged", "pdf-encrypted", "pdf-limit") if scenario.page else ("invalid", "oversized", "pdf")
        for choice in invalid:
            pick(one, choice)
            rejected[choice] = one.wait("return document.querySelector('[data-document-error]')?.innerText.trim()",
                                        "visible rejection of " + choice)
            assert documents(one) == []
            # 关闭重新打开，下一次拒绝必须产生新的反馈。
            one.close_dialog()
            open_documents(one, "library")
        expected_errors = {
            "invalid": "Choose a readable UTF-8 document with text content.",
            "oversized": "This document exceeds the import limit. Choose a smaller file.",
            "pdf": "This PDF has no extractable text. Choose a PDF with a text layer.",
            "pdf-damaged": "This PDF could not be parsed. Choose a readable copy.",
            "pdf-encrypted": "This PDF is encrypted. Choose an unencrypted copy.",
            "pdf-limit": "This document exceeds the import limit. Choose a smaller file.",
        }
        assert rejected == {choice: expected_errors[choice] for choice in invalid}, rejected
        doc_a = import_document(one, scenario.choice, scenario.filename)
        assert documents(one) == [doc_a]
        open_document(one, doc_a)
        if scenario.page:
            select_pdf_page(one, 1)
            select_pdf_page(one, 3)
            select_pdf_page(one, scenario.page)
        else:
            one.wait(f"""const text=document.querySelector('[data-document-text]')?.textContent;
                return {json.dumps(scenario.lines)}.every(line=>text?.includes(line));""", "three imported Markdown lines")
        one.close_dialog()

        tasks["create_project"](one, SOUTH)
        open_documents(one, "library")
        assert documents(one) == []
        doc_b = import_document(one, "fixture-two", "qa-project-other.txt")
        assert doc_b != doc_a and documents(one) == [doc_b]
        open_document(one, doc_b)
        one.wait(f"return document.querySelector('[data-document-text]')?.textContent.includes({json.dumps(OTHER)})",
                 "second project's plain text")
        one.close_dialog()
        selection = {"documentId": doc_a, "startLine": 2, "endLine": 2}
        if scenario.page:
            selection["page"] = scenario.page
        denial = routes["async_read"](one, f"""
            const projects=await window.electronAPI.listAgentWorkspaces();
            const project=projects.find(p=>p.name==={json.dumps(SOUTH)});
            if(!project)throw Error('Missing synthetic project');
            try{{await window.__TAURI_FORMAL__.projectDocuments.read(project.id,
              {json.dumps(selection)});return 'allowed';}}
            catch(e){{return String(e?.code??e?.message??e);}}
        """)
        assert "documentNotFound" in denial, denial

        tasks["select_project"](one, NORTH, new=True)
        labels = {"en": preview_in_composer(one, doc_a, "en", scenario)}
        choose(one, "[data-document-cite]", "explicitly attach only the previewed range")
        one.wait("return !!document.querySelector('[data-document-draft]')", "selected draft citation")
        assert routes["counts"](profile) == baseline
        one.send(scenario.question)
        require_answer(one, scenario.answer)
        routes["check_posts"](profile, [[("completed", 1)], []])
        row = source_row(one)
        one.wait("return !document.querySelector('[data-document-draft]')", "draft selection cleared after Send")
        one.send(scenario.followup)
        require_answer(one, scenario.followup_answer)
        routes["check_posts"](profile, [[("completed", 1)] * 2, []])
        assert source_row(one) == row
        before = routes["counts"](profile)
        assert before == [[2, 2], [0, 0]]
        one.quit()
    finally:
        one.stop_if_running()

    # 仅移动本脚本生成的文件，证明此次恢复不能依赖选择器原路径。
    removed_sources = evidence / "retained-synthetic-inputs"
    removed_sources.mkdir(mode=0o700)
    for name, expected in source_hashes.items():
        source = one.directory / name
        assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
        source.rename(removed_sources / name)
        assert not source.exists()

    two = Window(binary, profile, evidence, "reopen-without-inputs")
    try:
        assert two.proc.pid != one.proc.pid
        foreground(two)
        two.ready()
        tasks["select_project"](two, NORTH)
        tasks["enter_session"](two)
        require_answer(two, scenario.answer)
        require_answer(two, scenario.followup_answer)
        localized_sources = {"en": locate_source(two, row, "en", scenario)}
        assert routes["counts"](profile) == before
        switch_language(two, "zh")
        labels["zh"] = preview_in_composer(two, doc_a, "zh", scenario)
        two.close_dialog()
        localized_sources["zh"] = locate_source(two, row, "zh", scenario)
        assert routes["counts"](profile) == before
        switch_language(two, "en")
        assert locate_source(two, row, "en", scenario)["label"] == localized_sources["en"]["label"]
        assert routes["counts"](profile) == before
        tasks["select_project"](two, SOUTH)
        open_documents(two, "library")
        assert documents(two) == [doc_b]
        two.close_dialog()
        two.quit()
    finally:
        two.stop_if_running()
    assert routes["counts"](profile) == before
    report = {
        "binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "pids": [one.proc.pid, two.proc.pid],
        "picker": "fixed synthetic selections and cancellation in the dedicated native QA host",
        "sourceSha256": source_hashes,
        "rejectedInputs": rejected,
        "crossProjectRead": denial,
        "citedMessageId": row,
        "documentId": doc_a,
        "page": scenario.page,
        "lineRange": [2, 2],
        "explicitInferenceRequests": 2,
        "inferenceRequestsDuringImportAndBrowse": 0,
        "requestsDuringRecoveryAndBrowse": 0,
        "mockObservations": routes["observations"](profile),
        "mockScope": "HTTP requests accepted by the two owned loopback listeners",
        "sourcePreviewAfterRestart": localized_sources["en"]["screenshot"],
        "languageRoundTrip": ["en", "zh", "en"],
        "composerDocumentLabels": labels,
        "localizedSources": localized_sources,
    }
    (evidence / "summary.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--pdf", action="store_true", help="exercise page-scoped PDF ingestion and recovery")
    args = parser.parse_args()
    acceptance(args.binary.resolve(strict=True), PDF_PAGES if args.pdf else MARKDOWN)
