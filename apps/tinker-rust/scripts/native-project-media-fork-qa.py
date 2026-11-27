"""Fork a native project conversation containing PDF and image history using the packaged workbench."""
import argparse
import json
from pathlib import Path
from runpy import run_path
import tempfile
import uuid

from native_image_file_checks import ATTACH, CHIP, SENT, fixture_png, image_bytes, pick, same_pixels

HERE = Path(__file__).resolve().parent
portable = run_path(str(HERE / "native-portable-project-qa.py"))
docs, tasks, routes, large = (portable[key] for key in ("docs", "tasks", "routes", "large"))
pdf = docs["PDF_PAGES"]
PROJECT = "Media field notes"
ANCHOR = "Bookmark this project checkpoint."
LATER = "Only the source should see this later message."
FOLLOW = "[qa:media-fork] Continue the project in text."


def sessions(w):
    return portable["snapshot"](w)[PROJECT]["sessions"]


def send_text(w, prompt, expected):
    w.send(prompt)
    def completed():
        for session in sessions(w):
            rows = session["messages"]
            if len(rows) >= 2 and rows[-2]["text"] == prompt and rows[-1]["text"].startswith(expected):
                return rows[-1]["id"]
        return None
    return large["wait_for"](completed, "persisted answer for this exact turn", timeout=16)


def cite(w, document_id):
    docs["preview_in_composer"](w, document_id, "en", pdf)
    routes["choose"](w, "[data-document-cite]", "attach selected PDF line")
    w.wait("return !!document.querySelector('[data-document-draft]')", "explicit citation")
    send_text(w, pdf.question, pdf.answer)


def fork(w, reply_id):
    w.wait(f"""const row=[...document.querySelectorAll('[data-message-id]')]
        .find(r=>r.dataset.messageId==={json.dumps(reply_id)});
        const b=row?.querySelector('button[aria-label="More message actions"]');
        if(!b)return false;b.scrollIntoView({{block:'center'}});b.focus();
        b.dispatchEvent(new KeyboardEvent('keydown',{{key:'ArrowDown',bubbles:true}}));return true;""",
        "open selected reply menu")
    routes["named"](w, "[role=menuitem]", ["Fork from here"])
    w.wait("return document.body.innerText.includes('(fork)')", "new branch opened")


def run(bundle):
    if not __debug__:
        raise ValueError("Python assertions are required")
    binary = run_path(str(HERE / "native-macos-release-gate.py"))["check_bundle"](bundle, "qa")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-media-fork-", dir="/private/tmp"))
    root = Path("/private/tmp") / ("tinker-tauri-channels-preview-media-fork-" + uuid.uuid4().hex)
    pids = []
    print("Evidence:", evidence, flush=True)
    with portable["window"](binary, root, evidence, "source", pids) as w:
        docs["fixtures"](w.directory, pdf)
        image = w.directory / "qa-orchard.png"
        original = fixture_png()
        image.write_bytes(original)
        large["setup_channel"](w, root)
        channel, = routes["catalog"](w)
        tasks["create_project"](w, PROJECT)
        docs["open_documents"](w, "library")
        document_id = docs["import_document"](w, pdf.choice, pdf.filename)
        w.close_dialog()
        tasks["select_project"](w, PROJECT, new=True)
        routes["select_model"](w, channel["id"], routes["TEXT"])
        cite(w, document_id)
        routes["select_model"](w, channel["id"], routes["IMAGE"])
        pick(w, "fixture", ATTACH)
        assert same_pixels(image_bytes(w, CHIP), original)
        w.send("Edit this image to add a sun. [qa:fork-reference]")
        source_image, = large["names"](w, 1)
        assert same_pixels(image_bytes(w, SENT), original)
        routes["select_model"](w, channel["id"], routes["TEXT"])
        anchor = send_text(w, ANCHOR, "Owned QA")
        send_text(w, LATER, "Owned QA")
        source, = sessions(w)
        before = routes["counts"](root)
        assert before == [[2,4],[0,0]], before
        image.unlink()
        (w.directory / pdf.filename).unlink()

    with portable["window"](binary, root, evidence, "branch", pids) as w:
        tasks["select_project"](w, PROJECT)
        tasks["enter_session"](w)
        fork(w, anchor)
        copied_image, = large["names"](w, 1)
        assert copied_image != source_image
        copied = large["stored"](root, copied_image)
        assert copied.read_bytes() == large["stored"](root, source_image).read_bytes()
        assert same_pixels(image_bytes(w, SENT), original)
        branches = sessions(w)
        assert len(branches) == 2 and source in branches
        child, = [s for s in branches if s["id"] != source["id"]]
        assert LATER not in [m["text"] for m in child["messages"]]
        assert routes["counts"](root) == before

    with portable["window"](binary, root, evidence, "restored", pids) as w:
        assert sessions(w) == branches
        assert large["names"](w, 1) == [copied_image]
        assert same_pixels(image_bytes(w, SENT), original)
        proof = large["full"](w, copied_image, copied, (192,128))
        docs["source_row"](w)
        routes["choose"](w, "[data-document-source]", "open original PDF page from the restored fork")
        docs["assert_excerpt"](w, pdf)
        w.wait("""const dlg=document.querySelector('[role=dialog][data-state=open]');
            const loc=dlg?.querySelector('[data-document-location]');
            return loc?.getClientRects().length && loc.innerText.includes('page 2') &&
                loc.innerText.includes('lines 2–2');""", "PDF locator inside open source dialog")
        proof["pdfSnapshot"] = w.command("snapshot")["png"]
        w.close_dialog()
        assert routes["counts"](root) == before
        send_text(w, FOLLOW, "Project fork context verified.")
        cite(w, document_id)
        routes["select_model"](w, channel["id"], routes["IMAGE"])
        w.edit(copied_image, "Edit this image again. [qa:fork-version]")
        assert len(large["names"](w, 2)) == 2
        # 两条会话的 PNG 字节完全相同，编辑引用必须定位分支自己的生成消息。
        generated_row = w.wait(f"""const card=[...document.querySelectorAll('[data-generated-image] img')]
            .find(i=>i.alt==={json.dumps(copied_image)});
            return card?.closest('[data-message-id]')?.dataset.messageId;""", "branch result owner")
        assert child["id"] in generated_row and source["id"] not in generated_row
        w.wait(f"""const card=[...document.querySelectorAll('[data-image-edit-reference]')]
            .find(e=>e.dataset.imageEditReference==={json.dumps(Path(copied_image).stem)});
            const link=card?.querySelector('[data-reference-source-link]');
            if(!link||link.disabled)return false; link.focus();link.click();return true;""",
            "locate the edited branch image from its sent reference")
        w.wait(f"""const row=document.querySelector('[data-reference-highlighted]');
            return row?.dataset.messageId==={json.dumps(generated_row)} && document.activeElement===row;""",
            "only the branch result is highlighted and focused")
        routes["choose"](w, ".conversation-reference-return", "return to the branch reference")
        w.wait(f"""return document.activeElement?.matches('[data-reference-source-link]') &&
            document.activeElement.closest('[data-image-edit-reference]')?.dataset.imageEditReference
            ==={json.dumps(Path(copied_image).stem)};""", "focus back on the branch source link")
        assert source in sessions(w)
        after = routes["counts"](root)
        assert after == [[2,7],[0,0]], after
        # 同一个源会话也可以在图片回复本身截断，包含该回复随后投影的工具结果。
        tasks["select_project"](w, PROJECT)
        w.wait(f"""const buttons=[...document.querySelectorAll('.project-overview__sessions button')];
            const b=buttons.find(b=>b.querySelector('span')?.textContent==={json.dumps(source['title'])});
            if(!b)return false;b.click();return true;""", "return to the exact source conversation")
        w.ready()
        photo, = [m for m in source["messages"] if m["role"] == "assistant" and m["id"].startswith("native-image-")]
        fork(w, photo["id"])
        large["wait_for"](lambda: len(sessions(w)) == 3, "second independent branch")
        early, = [s for s in sessions(w) if s["id"] not in (source["id"], child["id"])]
        assert ANCHOR not in [m["text"] for m in early["messages"]]
        early_name, = large["names"](w, 1)
        assert early_name not in (source_image, copied_image)
        assert large["stored"](root, early_name).read_bytes() == copied.read_bytes()
        assert routes["counts"](root) == after
    assert len(set(pids)) == 3
    print(json.dumps({"result":"passed","pids":pids,"counts":after,"forkedImage":proof}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("qa_bundle", type=Path)
    run(parser.parse_args().qa_bundle)
