"""Revise a middle turn through a packaged Tauri window and verify the owned HTTP boundary."""
import argparse
import json
from pathlib import Path
from runpy import run_path
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
portable = run_path(str(HERE / "native-portable-project-qa.py"))
routes, tasks, large = (portable[k] for k in ("routes", "tasks", "large"))
PROJECT = "Orchard field notebook"
FIRST = "We counted six apple trees."
TARGET = "[qa:revision] How many trees will need a stake?"
EDITED = "[qa:revision] How many pairs of stakes should we order?"
LATER = "Keep the fence measurements in the original conversation."
FAIL = "[qa:revision] Test an unavailable upstream. [qa:failure]"
HOLD = "[qa:revision] Stop this slow reply. [qa:hold]"
ORIGINAL_ANSWER = "Original question verified. streamed text completed."
EDITED_ANSWER = "Edited question verified. streamed text completed."
EDITOR = ".ProseMirror[contenteditable=true]"
EDIT = "Edit question in new branch"
REGENERATE = "Regenerate in new branch"


def sessions(w):
    return portable["snapshot"](w)[PROJECT]["sessions"]


def prompts(session):
    return [m["text"] for m in session["messages"] if m["role"] == "user"]


def expect_counts(root, posts):
    actual = routes["counts"](root)
    assert actual == [[2, posts], [2, 0]], (posts, actual)


def open_source(w, source):
    tasks["select_project"](w, PROJECT)
    w.wait(f"""const rows=[...document.querySelectorAll('.project-overview__sessions button')];
        const matches=rows.filter(b=>b.querySelector('span')?.textContent==={json.dumps(source['title'])});
        if(matches.length!==1)return false;matches[0].click();return true;""", "open original by exact title")
    w.wait(f"return !!document.querySelector('[data-message-id={json.dumps(source['messages'][-1]['id'])}]')",
           "last original reply on screen")


def menu(w, row_id, language="en"):
    label, actions = (("更多消息操作", ["在新分支编辑提问", "在新分支重新生成"]) if language == "zh"
                      else ("More message actions", [EDIT, REGENERATE]))
    w.wait(f"""const b=document.querySelector('[data-message-id={json.dumps(row_id)}] button[aria-label={json.dumps(label)}]');
        if(!b)return false;b.scrollIntoView({{block:'center'}});b.focus();
        b.dispatchEvent(new KeyboardEvent('keydown',{{key:'ArrowDown',bubbles:true}}));return true;""",
        "open actions of the exact middle reply")
    w.wait(f"""const labels=[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim());
        return {json.dumps(actions)}.every(x=>labels.includes(x));""", "native revision actions")


def activate(w, label, double=False):
    w.wait(f"""const item=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==={json.dumps(label)});
        if(!item)return false;item.click();{('item.click();' if double else '')}return true;""", label)


def wait_draft(w, text=TARGET):
    w.wait(f"""const e=document.querySelector('{EDITOR}');return e?.textContent==={json.dumps(text)}
        && !document.querySelector('[role=menu]');""", "prefilled original question in branch")
    w.wait(f"""return !document.querySelector('.conversation-column__messages')?.innerText.includes({json.dumps(LATER)})
        && document.querySelector('.conversation-column__messages')?.innerText.includes({json.dumps(FIRST)});""",
        "branch prefix visible")


def replace_draft(w, text):
    w.wait(f"""const e=document.querySelector('{EDITOR}');
        if(e?.textContent!=={json.dumps(TARGET)})return false;e.focus();
        const range=document.createRange();range.selectNodeContents(e);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        document.execCommand('insertText',false,{json.dumps(text)});return true;""", "replace prefilled question")


def send_draft(w, text):
    w.wait(f"""const e=document.querySelector('{EDITOR}'), b=document.querySelector({json.dumps(tasks['SEND'])});
        if(e?.textContent!=={json.dumps(text)} || !b || b.disabled)return false;b.click();return true;""",
        "explicitly send edited question")


def expect_turn(w, question, answer):
    w.wait(f"""const rows=document.querySelectorAll('[data-message-role]');
        return rows.length>=2 && rows[rows.length-2].innerText.includes({json.dumps(question)})
            && rows[rows.length-1].innerText.includes({json.dumps(answer)});""", "exact visible question and reply")
    tasks["terminal"](w, "completed")


def run(bundle):
    if not __debug__:
        raise ValueError("Python assertions are required")
    binary = run_path(str(HERE / "native-macos-release-gate.py"))["check_bundle"](bundle, "qa")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-revision-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-channels-preview-revision-" + uuid.uuid4().hex)
    pids = []
    print("Evidence:", evidence, flush=True)
    with portable["window"](binary, profile, evidence, "original", pids) as w:
        routes["open_settings"](w)
        routes["add_provider"](w, routes["A"], routes["endpoint"](profile, ""), 1)
        routes["add_provider"](w, routes["B"], routes["endpoint"](profile, "secondary-"), 2)
        channels = {c["name"]: c["id"] for c in routes["catalog"](w)}
        routes["common"]["close_settings"](w)
        tasks["create_project"](w, PROJECT)
        tasks["select_project"](w, PROJECT, new=True)
        routes["select_model"](w, channels[routes["A"]], routes["TEXT"])
        for text in (FIRST, TARGET, LATER):
            w.send(text)
            expect_turn(w, text, ORIGINAL_ANSWER if text == TARGET else "Owned QA streamed text completed.")
        source, = sessions(w)
        assert prompts(source) == [FIRST, TARGET, LATER]
        routes["select_model"](w, channels[routes["B"]], routes["TEXT"])
        expect_counts(profile, 3)
    selected = source["messages"][3]["id"]
    with portable["window"](binary, profile, evidence, "edit", pids) as w:
        open_source(w, source)
        menu(w, selected)
        menu_png = w.command("snapshot")["png"]
        activate(w, EDIT)
        wait_draft(w)
        pair = sessions(w)
        draft, = [s for s in pair if s["id"] != source["id"]]
        assert source in pair and prompts(draft) == [FIRST]
        expect_counts(profile, 3)
        draft_png = w.command("snapshot")["png"]
        replace_draft(w, EDITED)
        wait_draft(w, EDITED)
    with portable["window"](binary, profile, evidence, "unsent-draft", pids) as w:
        wait_draft(w, EDITED)
        assert sessions(w) == pair
        expect_counts(profile, 3)
        send_draft(w, EDITED)
        expect_turn(w, EDITED, EDITED_ANSWER)
        edited, = [s for s in sessions(w) if s["id"] == draft["id"]]
        assert prompts(edited) == [FIRST, EDITED]
        expect_counts(profile, 4)

    with portable["window"](binary, profile, evidence, "regenerate", pids) as w:
        expect_turn(w, EDITED, EDITED_ANSWER)
        assert source in sessions(w) and edited in sessions(w)
        expect_counts(profile, 4)
        open_source(w, source)
        routes["select_model"](w, channels[routes["B"]], routes["TEXT"])
        menu(w, selected)
        activate(w, REGENERATE, double=True)
        expect_turn(w, TARGET, ORIGINAL_ANSWER)
        trio = sessions(w)
        regenerated, = [s for s in trio if s["id"] not in (source["id"], edited["id"])]
        assert source in trio and edited in trio and prompts(regenerated) == [FIRST, TARGET]
        expect_counts(profile, 5)
        for text, status, count in [(FAIL, "failed", 6), (HOLD, "cancelled", 7)]:
            open_source(w, source)
            menu(w, selected)
            activate(w, EDIT)
            wait_draft(w)
            expect_counts(profile, count - 1)
            replace_draft(w, text)
            send_draft(w, text)
            if text == HOLD:
                w.wait("return document.querySelector('.conversation-column__messages')?.innerText.includes('Owned QA visible streaming segment.')",
                       "partial response arrived from the owned listener")
                routes["choose"](w, tasks["STOP"], "stop this reply")
            tasks["terminal"](w, status)
            assert all(s in sessions(w) for s in trio)
            expect_counts(profile, count)
        state = sessions(w)
        assert len(state) == 5 and all([FIRST, text] in [prompts(s) for s in state] for text in (FAIL, HOLD))
    with portable["window"](binary, profile, evidence, "restored", pids) as w:
        tasks["terminal"](w, "cancelled")
        assert sessions(w) == state
        labels = {s["title"] for s in state if s["id"] != source["id"]}
        assert labels == {f"{TARGET} (fork)", *(f"{TARGET} (fork {i})" for i in (2, 3, 4))}, labels
        open_source(w, source)
        expect_turn(w, LATER, "Owned QA streamed text completed.")
        portable["docs"]["switch_language"](w, "zh")
        menu(w, selected, "zh")
        zh_png = w.command("snapshot")["png"]
        expect_counts(profile, 7)
    observed, other = routes["observations"](profile)
    phases = [e["phase"] for e in observed["events"] if e["method"] == "POST" and e["phase"] != "accepted"]
    # 503 也是已完成的 HTTP 响应；载荷被哨兵拒绝则会单独记录 text-invalid。
    assert phases == ["completed"] * 6 + ["cancelled"], phases
    assert all(event["method"] == "GET" for event in other["events"])
    assert len(set(pids)) == 5
    report = {"pids": pids, "counts": routes["counts"](profile), "postPhases": phases, "projectSessions": len(state),
              "binarySha256": large["digest"](binary), "menuScreenshot": menu_png, "draftScreenshot": draft_png,
              "chineseMenuScreenshot": zh_png, "original": source["id"], "edited": edited["id"],
              "regenerated": regenerated["id"]}
    (evidence / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qa_bundle", type=Path)
    run(parser.parse_args().qa_bundle)
