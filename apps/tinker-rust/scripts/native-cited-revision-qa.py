"""Exercise optional PDF reattachment in independent question revisions through a packaged window."""
import argparse
import json
from pathlib import Path
from runpy import run_path
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
revision = run_path(str(HERE / "native-conversation-revision-qa.py"))
portable, routes, tasks = (revision[k] for k in ("portable", "routes", "tasks"))
docs = portable["docs"]
PDF = docs["PDF_PAGES"]
TARGET = "[qa:cited-revision] Describe the orchard note."
EDITED = "[qa:cited-revision] Compare the revised orchard note."
FAIL = "[qa:cited-revision] Simulate an outage. [qa:failure]"
HOLD = "[qa:cited-revision] Stop the slow comparison. [qa:hold]"
ATTACHED = "Explicit PDF revision verified."
OMITTED = "Unattached revision verified."
FIRST, LATER, PROJECT = (revision[k] for k in ("FIRST", "LATER", "PROJECT"))
OTHER = "Harbor project"
SUGGESTION = "[data-revision-document] [data-document-source]"
ATTACHMENT = "[data-document-draft]"


def attachment(w, present):
    w.wait(f"return !!document.querySelector('{ATTACHMENT}') === {json.dumps(present)}",
           "excerpt visibly attached" if present else "no active excerpt")


def preview(w):
    routes["choose"](w, SUGGESTION, "inspect the prior citation in the child")
    docs["assert_excerpt"](w, PDF)
    w.wait(f"""const d=document.querySelector('[role=dialog][data-state=open]');
        return d?.innerText.includes({json.dumps(PDF.filename)}) && d.innerText.includes('page 2')
            && d.innerText.includes('lines 2–2') && !!d.querySelector('[data-document-cite]');""",
        "file, page, line and explicit attachment control")


def attach(w):
    preview(w)
    routes["choose"](w, "[data-document-cite]", "attach the inspected passage")
    attachment(w, True)


def draft(w, text):
    revision["wait_draft"](w, text)
    w.wait(f"return !!document.querySelector('{SUGGESTION}')", "optional prior passage")
    attachment(w, False)


def replace(w, text):
    editor = revision["EDITOR"]
    w.wait(f"""const e=document.querySelector('{editor}');
        if(e?.textContent!=={json.dumps(TARGET)})return false;e.focus();
        const r=document.createRange();r.selectNodeContents(e);
        const s=window.getSelection();s.removeAllRanges();s.addRange(r);
        document.execCommand('insertText',false,{json.dumps(text)});return true;""", "edit the question")
    revision["wait_draft"](w, text)


def branch(w, source, action):
    revision["open_source"](w, source)
    revision["menu"](w, source["messages"][3]["id"])
    revision["activate"](w, action, double=True)
    draft(w, TARGET)


def check_sessions(w, source, count):
    sessions = revision["sessions"](w)
    assert source in sessions and len(sessions) == count
    return sessions


def run(bundle):
    if not __debug__:
        raise ValueError("Python assertions are required")
    binary = run_path(str(HERE / "native-macos-release-gate.py"))["check_bundle"](bundle, "qa")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-cited-revision-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-channels-preview-cited-revision-" + uuid.uuid4().hex)
    pids = []
    window, counts = portable["window"], revision["expect_counts"]
    print("Evidence:", evidence, flush=True)
    with window(binary, profile, evidence, "original", pids) as w:
        routes["open_settings"](w)
        for i, (name, prefix) in enumerate(((routes["A"], ""), (routes["B"], "secondary-")), 1):
            routes["add_provider"](w, name, routes["endpoint"](profile, prefix), i)
        channels = {c["name"]: c["id"] for c in routes["catalog"](w)}
        routes["common"]["close_settings"](w)
        initial = w.directory / PDF.filename
        initial.write_bytes(docs["PDF"]["text_pdf"]())
        tasks["create_project"](w, PROJECT)
        docs["open_documents"](w, "library")
        doc = docs["import_document"](w, PDF.choice, PDF.filename)
        w.close_dialog()
        initial.rename(evidence / "retained-synthetic-source.pdf")
        initial.write_bytes(docs["PDF"]["text_pdf"]([["QA_OTHER_PROJECT_65"]]))
        tasks["create_project"](w, OTHER)
        docs["open_documents"](w, "library")
        other_doc = docs["import_document"](w, PDF.choice, PDF.filename)
        assert other_doc != doc and docs["documents"](w) == [other_doc]
        w.close_dialog()
        initial.rename(evidence / "retained-other-project.pdf")
        assert not initial.exists()
        tasks["select_project"](w, PROJECT, new=True)
        routes["select_model"](w, channels[routes["A"]], routes["TEXT"])
        w.send(FIRST)
        revision["expect_turn"](w, FIRST, "Owned QA streamed text completed.")
        docs["preview_in_composer"](w, doc, "en", PDF)
        routes["choose"](w, "[data-document-cite]", "attach line two for the original question")
        attachment(w, True)
        w.send(TARGET)
        revision["expect_turn"](w, TARGET, ATTACHED)
        row = docs["source_row"](w)
        w.send(LATER)
        revision["expect_turn"](w, LATER, "Owned QA streamed text completed.")
        source, = revision["sessions"](w)
        assert row == source["messages"][2]["id"]
        routes["select_model"](w, channels[routes["B"]], routes["TEXT"])
        counts(profile, 3)
        branch(w, source, revision["EDIT"])
        preview(w)
        docs["foreground"](w)
        w.wait("""const d=document.querySelector('[role=dialog][data-state=open]');
            const b=d?.querySelector('[data-document-cite]');
            if(!b || b.disabled || d.getAnimations().some(a=>a.playState==='running'))return false;
            const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(
                r.x+r.width/2,r.y+r.height/2));""", "visible actionable preview before capturing this QA window")
        preview_png = w.command("snapshot")["png"]
        w.close_dialog()
        attachment(w, False)
        attach(w)
        routes["choose"](w, "[data-document-draft] [data-document-remove]", "remove the active excerpt")
        attachment(w, False)
        replace(w, EDITED)
        attach(w)
        check_sessions(w, source, 2)
        counts(profile, 3)

    with window(binary, profile, evidence, "reopened-draft", pids) as w:
        draft(w, EDITED)
        counts(profile, 3)
        attach(w)
        revision["send_draft"](w, EDITED)
        revision["expect_turn"](w, EDITED, ATTACHED)
        edited_row = docs["source_row"](w)
        counts(profile, 4)
        w.send(PDF.followup)
        revision["expect_turn"](w, PDF.followup, PDF.followup_answer)
        assert docs["source_row"](w) == edited_row
        edited, = [s for s in check_sessions(w, source, 2) if s != source]
        assert revision["prompts"](edited) == [FIRST, EDITED, PDF.followup]
        counts(profile, 5)
    with window(binary, profile, evidence, "regenerate", pids) as w:
        revision["expect_turn"](w, PDF.followup, PDF.followup_answer)
        docs["locate_source"](w, edited_row, "en", PDF)
        counts(profile, 5)
        branch(w, source, revision["REGENERATE"])
        attach(w)
        routes["choose"](w, "[data-document-draft] [data-document-remove]", "omit the excerpt on regeneration")
        attachment(w, False)
        counts(profile, 5)
        revision["send_draft"](w, TARGET)
        revision["expect_turn"](w, TARGET, OMITTED)
        assert not w.js("return !!document.querySelector('[data-document-source]')")
        trio = check_sessions(w, source, 3)
        regenerated, = [s for s in trio if s not in [source, edited]]
        assert revision["prompts"](regenerated) == [FIRST, TARGET] and edited in trio
        counts(profile, 6)
        for question, status, post_count in ((FAIL, "failed", 7), (HOLD, "cancelled", 8)):
            branch(w, source, revision["EDIT"])
            replace(w, question)
            attach(w)
            counts(profile, post_count - 1)
            revision["send_draft"](w, question)
            if question == HOLD:
                w.wait(f"return document.querySelector('.conversation-column__messages')?.innerText.includes({json.dumps(ATTACHED)})",
                       "first verified streaming event before Stop")
                routes["choose"](w, tasks["STOP"], "cancel the held request")
            tasks["terminal"](w, status)
            assert all(s in revision["sessions"](w) for s in trio)
            counts(profile, post_count)
        state = check_sessions(w, source, 5)
    with window(binary, profile, evidence, "restored", pids) as w:
        tasks["terminal"](w, "cancelled")
        assert revision["sessions"](w) == state
        revision["open_source"](w, source)
        assert docs["source_row"](w) == row
        routes["choose"](w, "[data-document-source]", "open the unchanged original citation")
        docs["assert_excerpt"](w, PDF)
        w.close_dialog()
        tasks["select_project"](w, OTHER)
        docs["open_documents"](w, "library")
        assert docs["documents"](w) == [other_doc]
        docs["open_document"](w, other_doc)
        w.wait("return document.querySelector('[data-document-text]')?.textContent.includes('QA_OTHER_PROJECT_65')",
               "same-name document retains the other project's own text")
        assert not w.js("return document.querySelector('[data-document-text]').textContent.includes('QA_PDF_SELECTED_CEDAR_42')")
        w.close_dialog()
        projects = portable["snapshot"](w)
        selection = {"documentId": doc, "page": 2, "startLine": 2, "endLine": 2}
        denial = routes["async_read"](w, f"""
            try {{
                await window.__TAURI_FORMAL__.projectDocuments.read({json.dumps(projects[OTHER]["id"])},
                    {json.dumps(selection)});
                return 'allowed';
            }} catch (e) {{ return String(e?.code ?? e?.message ?? e); }}
        """)
        assert "documentNotFound" in denial, denial
        counts(profile, 8)
    assert len(set(pids)) == 4
    observed, other = routes["observations"](profile)
    phases = [e["phase"] for e in observed["events"] if e["method"] == "POST" and e["phase"] != "accepted"]
    assert phases == ["completed"] * 7 + ["cancelled"], phases
    assert all(e["method"] == "GET" for e in other["events"])
    report = {"pids": pids, "counts": routes["counts"](profile), "postPhases": phases,
              "binarySha256": portable["large"]["digest"](binary), "previewScreenshot": preview_png,
              "crossProjectRead": denial, "projectSessions": len(state), "source": source["id"], "edited": edited["id"],
              "regenerated": regenerated["id"], "picker": "fixed synthetic PDF selection in dedicated QA host"}
    (evidence / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qa_bundle", type=Path)
    run(parser.parse_args().qa_bundle)
