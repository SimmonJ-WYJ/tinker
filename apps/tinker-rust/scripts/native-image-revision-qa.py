"""Exercise editing/regenerating a managed-image question in the isolated packaged macOS workbench."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
from runpy import run_path
import tempfile
import uuid

from native_image_file_checks import ATTACH, CHIP, SENT, fixture_png, image_bytes, pick, same_pixels

HERE = Path(__file__).resolve().parent
rev = run_path(str(HERE / "native-conversation-revision-qa.py"))
nav = run_path(str(HERE / "native-history-image-source-qa.py"))
portable, routes, tasks, large = (rev[k] for k in ("portable", "routes", "tasks", "large"))
GEN = "Generate a blue landscape."
DECOY = "Edit the blue image. [qa:revision-stripes]"
TARGET = "Edit the orchard. [qa:revision-orchard]"
EDITED = "Add a winding path. [qa:revision-orchard]"
GENERATED = "Tint the generated landscape. [qa:revision-stripes]"
FAIL = "Fail this edit. [qa:revision-orchard]"
HOLD = "Stop this edit. [qa:revision-orchard]"
EDITOR = rev["EDITOR"]
SUGGEST = "[data-revision-image]"
ATTACH_PREVIOUS = "[data-revision-image-attach]"
REMOVE = "[data-revision-image-remove]"


def close_model_menu(w):
    # The anchored model selector can regain focus and reopen while WebKit restores the composer.
    w.js("""const menu=document.querySelector('[role=menu][data-state=open]');
        if(menu)menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
        return true;""")
    w.wait("return !document.querySelector('[role=menu][data-state=open]')", "model selection complete")


def read_draft(w, prompt, attached=False):
    selector = REMOVE if attached else ATTACH_PREVIOUS
    w.wait(f"""const edit=document.querySelector('{EDITOR}');
        return edit?.textContent==={json.dumps(prompt)} && !!document.querySelector('{selector}')
            && !document.querySelector('[role=menu][data-state=open]');""", "visible unsent image question and attachment decision")


def preview(w, expected):
    routes["choose"](w, "[data-revision-image-preview]", "inspect the exact earlier input")
    w.wait("""const i=document.querySelector('[role=dialog][data-state=open] img');
        return i?.complete && i.naturalWidth && i.src.startsWith('blob:');""", "full managed original")
    digest = routes["async_read"](w, """const i=document.querySelector('[role=dialog][data-state=open] img');
        const buf=await (await fetch(i.src)).arrayBuffer(), hash=await crypto.subtle.digest('SHA-256',buf);
        return Array.from(new Uint8Array(hash), byte=>byte.toString(16).padStart(2,'0')).join('');""")
    assert digest == sha256(expected).hexdigest()
    w.close_dialog()


def choose_previous(w, prompt):
    routes["choose"](w, ATTACH_PREVIOUS, "attach only the inspected image")
    read_draft(w, prompt, True)


def image_row(w, name):
    return w.wait(f"""const i=[...document.querySelectorAll('[data-generated-image] img')]
        .find(i=>i.alt==={json.dumps(name)});return i?.closest('[data-message-id]')?.dataset.messageId;""",
        "exact reply that owns this result")


def reference_row(w, prompt):
    return w.wait(f"""const rows=[...document.querySelectorAll('[data-message-role=user]')]
        .filter(e=>e.innerText.includes({json.dumps(prompt)}) && e.querySelector('[data-image-edit-reference]'));
        return rows.length===1 && rows[0].dataset.messageId;""", "unique sent reference for selected question")


def open_source(w, source):
    # SDK tool-result rows are grouped inside the visible assistant turn.
    visible = [m for m in source["messages"] if m["role"] == "assistant"]
    rev["open_source"](w, {**source, "messages": visible})


def branch(w, source, reply_id, action, prompt):
    open_source(w, source)
    rev["menu"](w, reply_id)
    rev["activate"](w, action, double=True)
    read_draft(w, prompt)
    return w.wait("return document.querySelector('[data-revision-image]')?.dataset.imageId",
                  "child-owned suggestion identity")


def replace(w, old, new):
    w.wait(f"""const e=document.querySelector('{EDITOR}');if(e?.textContent!=={json.dumps(old)})return false;
        e.focus();const r=document.createRange();r.selectNodeContents(e);
        const s=window.getSelection();s.removeAllRanges();s.addRange(r);
        document.execCommand('insertText',false,{json.dumps(new)});return true;""", "edit the question before sending")
    read_draft(w, new)


def pick_png(w, contents, prompt):
    path = w.directory / "qa-orchard.png"
    path.write_bytes(contents)
    pick(w, "fixture", ATTACH)
    assert same_pixels(image_bytes(w, CHIP), contents)
    w.send(prompt)
    return path


def run(bundle):
    if not __debug__:
        raise ValueError("Python assertions are required")
    binary = run_path(str(HERE / "native-macos-release-gate.py"))["check_bundle"](bundle, "qa")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-image-revision-", dir="/private/tmp"))
    root = Path("/private/tmp") / ("tinker-tauri-channels-preview-image-revision-" + uuid.uuid4().hex)
    pids = []
    print("Evidence:", evidence, flush=True)
    window, sessions, count = portable["window"], rev["sessions"], rev["expect_counts"]
    orchard = fixture_png()
    with window(binary, root, evidence, "same-name-decoy", pids) as w:
        routes["open_settings"](w)
        for slot, (name, prefix) in enumerate(((routes["A"], ""), (routes["B"], "secondary-")), 1):
            routes["add_provider"](w, name, routes["endpoint"](root, prefix), slot)
        channels = {c["name"]: c["id"] for c in routes["catalog"](w)}
        first, second = channels[routes["A"]], channels[routes["B"]]
        routes["common"]["close_settings"](w)
        tasks["create_project"](w, rev["PROJECT"])
        tasks["select_project"](w, rev["PROJECT"], new=True)
        routes["select_model"](w, first, routes["IMAGE"])
        w.send(GEN)
        original, = large["names"](w, 1)
        stripes = large["stored"](root, original).read_bytes()
        decoy_path = pick_png(w, stripes, DECOY)
        large["names"](w, 2)
        decoy_path.unlink()
        count(root, 2)
    with window(binary, root, evidence, "same-name-orchard", pids) as w:
        large["names"](w, 2)
        path = pick_png(w, orchard, TARGET)
        assert path != decoy_path and path.name == decoy_path.name and stripes != orchard
        results = large["names"](w, 3)
        path.unlink()
        target_reply = image_row(w, results[-1])
        w.edit(original, GENERATED)
        results = large["names"](w, 4)
        linked_reply = image_row(w, results[-1])
        source, = sessions(w)
        for prompt, expected in ((TARGET, orchard), (DECOY, stripes)):
            reference = nav["locator"](reference_row(w, prompt)) + " " + SENT
            assert same_pixels(image_bytes(w, reference), expected)
            assert w.js(f"return document.querySelector({json.dumps(reference)}).alt") == path.name
        digests = {name: large["digest"](large["stored"](root, name)) for name in results}
        count(root, 4)
        suggestion = branch(w, source, target_reply, rev["EDIT"], TARGET)
        preview(w, orchard)
        assert len(sessions(w)) == 2
        choose_previous(w, TARGET)
        routes["select_model"](w, second, routes["IMAGE"])
        w.wait("return !!document.querySelector('[data-revision-image-route-unavailable]')",
               "different channel cannot take the parked source image")
        assert not w.js(f"return !!document.querySelector('{REMOVE}')")
        routes["select_model"](w, first, routes["TEXT"])
        w.wait("return !!document.querySelector('[data-revision-image-route-unavailable]')",
               "different model cannot take the parked source image")
        routes["select_model"](w, first, routes["IMAGE"])
        close_model_menu(w)
        read_draft(w, TARGET)
        replace(w, TARGET, EDITED)
        choose_previous(w, EDITED)
        count(root, 4)

    with window(binary, root, evidence, "parked", pids) as w:
        read_draft(w, EDITED)
        assert w.js(f"return document.querySelector('{SUGGEST}').dataset.imageId") == suggestion
        count(root, 4)
        preview(w, orchard)
        portable["docs"]["foreground"](w)
        screenshot = w.command("snapshot")["png"]
        choose_previous(w, EDITED)
        rev["send_draft"](w, EDITED)
        large["names"](w, 3)
        edited, = [s for s in sessions(w) if s["id"] != source["id"]]
        assert source in sessions(w)
        edit_card = nav["locator"](reference_row(w, EDITED)) + " [data-image-edit-reference]"
        assert not w.js(f"return !!document.querySelector({json.dumps(edit_card + ' [data-reference-source-link]:not(:disabled)')})")
        nav["lightbox"](w, edit_card)
        count(root, 5)
        branch(w, source, target_reply, rev["REGENERATE"], TARGET)
        choose_previous(w, TARGET)
        routes["choose"](w, REMOVE, "remove the previous image before generating")
        read_draft(w, TARGET)
        rev["send_draft"](w, TARGET)
        large["names"](w, 3)
        assert not w.js(f"""return [...document.querySelectorAll('[data-message-role=user]')].some(
            e=>e.innerText.includes({json.dumps(TARGET)}) && e.querySelector('[data-image-edit-reference]'));""")
        count(root, 6)
        branch(w, source, linked_reply, rev["REGENERATE"], GENERATED)
        preview(w, stripes)
        choose_previous(w, GENERATED)
        rev["send_draft"](w, GENERATED)
        generated_child = large["names"](w, 4)
        count(root, 7)
        branch_state = sessions(w)
        assert len(branch_state) == 4 and source in branch_state and edited in branch_state

    with window(binary, root, evidence, "sent-reference", pids) as w:
        assert large["names"](w, 4) == generated_child
        assert sessions(w) == branch_state
        target = image_row(w, generated_child[0])
        assert target != image_row(w, generated_child[-1]) and source["id"] not in target
        link_row = nav["locator"](reference_row(w, GENERATED))
        assert same_pixels(image_bytes(w, link_row + " " + SENT), stripes)
        jump = nav["jump_and_return"](w, link_row, target, minimum_scroll=12)
        count(root, 7)
        for prompt, status, total in ((FAIL, "failed", 8), (HOLD, "cancelled", 9)):
            branch(w, source, target_reply, rev["EDIT"], TARGET)
            replace(w, TARGET, prompt)
            choose_previous(w, prompt)
            rev["send_draft"](w, prompt)
            if status == "cancelled":
                large["wait_for"](lambda: routes["counts"](root)[0][1] == total, "listener accepted the slow edit")
                routes["choose"](w, tasks["STOP"], "stop the accepted image edit")
            routes["images"]["outcome"](w, status)
            assert len(large["names"](w, 2)) == 2
            assert all(s in sessions(w) for s in branch_state)
            count(root, total)
        final = sessions(w)
        assert len(final) == 6
    with window(binary, root, evidence, "restored", pids) as w:
        routes["images"]["outcome"](w, "cancelled")
        large["names"](w, 2)
        assert final == sessions(w)
        open_source(w, source)
        assert results == large["names"](w, 4)
        assert digests == {n: large["digest"](large["stored"](root, n)) for n in results}
        count(root, 9)
    observations = routes["observations"](root)
    phases = [e["phase"] for e in observations[0]["events"] if e["method"] == "POST" and e["phase"] != "accepted"]
    assert phases[:-1] == ["image-generated", "image-edited", "image-edited", "image-edited",
                           "image-edited", "image-generated", "image-edited", "image-edit-failed"], phases
    assert len(phases) == 9 and phases[-1] in ("image-edited", "cancelled")
    assert len(set(pids)) == 5
    report = {"result": "passed", "pids": pids, "binarySha256": large["digest"](binary),
              "sameNameInputs": {path.name: [sha256(stripes).hexdigest(), sha256(orchard).hexdigest()]},
              "originalOutputHashes": digests, "counts": routes["counts"](root), "postPhases": phases,
              "sessionsAfterRecovery": len(final), "sourceNavigation": jump, "draftScreenshot": screenshot,
              "picker": "scoped synthetic selections in separate folders in the packaged QA app"}
    (evidence / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qa_bundle", type=Path)
    run(parser.parse_args().qa_bundle)
