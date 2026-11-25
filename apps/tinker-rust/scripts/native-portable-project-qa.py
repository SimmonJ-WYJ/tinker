"""Round-trip one synthetic project between two isolated Channels QA profiles."""
import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import plistlib
from runpy import run_path
import shutil
import tempfile
import uuid

HERE = Path(__file__).resolve().parent
docs = run_path(str(HERE / "native-project-document-qa.py"))
large = run_path(str(HERE / "native-large-image-qa.py"))
routes, tasks = docs["routes"], docs["tasks"]
SOURCE, EXISTING = "Portable field notes", "Destination notebook"
ARCHIVE = "qa-project.tinkerproject"
SCENARIOS = [docs["MARKDOWN"], docs["PDF_PAGES"]]


def control(name):
    return f'[data-testid="native-project-backup-{name}"]'


def click(w, name):
    routes["choose"](w, control(name), "project backup " + name)


def settings(w):
    routes["choose"](w, ".sidebar-account-trigger", "open Settings")
    routes["named"](w, "[role=dialog] button", ["General", "通用"])
    w.wait(f"return !!document.querySelector('{control('pick')}')", "project backup controls")


def arm(w, choice):
    assert w.command("arm-backup-picker", choice=choice) is True


def snapshot(w):
    return routes["async_read"](w, """const api=window.electronAPI;
        const projects=await api.listAgentWorkspaces(), sessions=await api.listAgentSessions();
        return Object.fromEntries(await Promise.all(projects.map(async p=>[p.name,{id:p.id,
        sessions:await Promise.all(sessions.filter(s=>s.workspaceId===p.id).sort((a,b)=>a.id.localeCompare(b.id))
        .map(async s=>({id:s.id,title:s.title,messages:(await api.getAgentSessionSDKMessages(s.id))
        .filter(m=>['assistant','user'].includes(m.type)).map(m=>({id:m.uuid,role:m.type,
        text:m.message.content.filter(c=>c.type==='text').map(c=>c.text).join('')}))}))) }])));""")


@contextmanager
def window(binary, profile, evidence, label, pids):
    w = routes["ChannelWindow"](binary, profile, evidence, label)
    try:
        pids.append(w.proc.pid)
        w.wait("return !!document.querySelector('.sidebar-account-trigger')", "isolated QA app")
        yield w
        w.quit()
    finally:
        w.stop_if_running()


def system_picker(w, selector, description):
    input(f"QA pid {w.proc.pid} is ready. Bind desktop control to this nonmodal window, then press Enter: ")
    print(description, flush=True)
    # 先让 WKWebView 回传测试命令，再进入 AppKit 模态循环。
    w.wait(f"""const b=document.querySelector({json.dumps(selector)});
        if(!b || b.disabled)return false;setTimeout(()=>b.click(),350);return true;""", "open the physical file panel")
    input("Finish the indicated action on the physical panel, then press Enter: ")


def seed(w, profile, system_panels):
    docs["fixtures"](w.directory, docs["PDF_PAGES"])
    large["setup_channel"](w, profile)
    channel, = routes["catalog"](w)
    tasks["create_project"](w, SOURCE)
    docs["open_documents"](w, "library")
    ids = []
    for scenario in SCENARIOS:
        if system_panels and scenario.page:
            original = docs["documents"](w)
            system_picker(w, "[data-document-import]", "Cancel the PDF open panel.")
            assert docs["documents"](w) == original
            system_picker(w, "[data-document-import]", f"Choose the synthetic PDF {w.directory / scenario.filename}")
            added = w.wait(f"""const ids=[...document.querySelectorAll({json.dumps(docs['ROWS'])})]
                .filter(el=>el.innerText.includes({json.dumps(scenario.filename)}));return ids.length===1 && ids[0].dataset.documentId""",
                "PDF chosen on the system panel")
            ids.append(added)
        else:
            ids.append(docs["import_document"](w, scenario.choice, scenario.filename))
    w.close_dialog()
    for scenario, document_id in zip(SCENARIOS, ids):
        tasks["select_project"](w, SOURCE, new=True)
        routes["select_model"](w, channel["id"], routes["TEXT"])
        docs["open_documents"](w, "composer")
        docs["open_document"](w, document_id)
        if scenario.page:
            docs["select_pdf_page"](w, scenario.page)
        for selector in ("[data-document-start]", "[data-document-end]"):
            routes["input_value"](w, selector, "2")
        routes["choose"](w, "[data-document-preview]", "preview only line two")
        docs["assert_excerpt"](w, scenario)
        routes["choose"](w, "[data-document-cite]", "attach selected lines")
        w.wait("return !!document.querySelector('[data-document-draft]')", "selected source chip")
        w.send(scenario.question)
        docs["require_answer"](w, scenario.answer)
    tasks["select_project"](w, SOURCE, new=True)
    routes["select_model"](w, channel["id"], routes["IMAGE"])
    w.send(large["GENERATE"])
    image, = large["names"](w, 1)
    image_path = large["stored"](profile, image)
    assert image_path.stat().st_size > 512 * 1024
    assert routes["counts"](profile) == [[2, 3], [0, 0]]
    return image, hashlib.sha256(image_path.read_bytes()).hexdigest()


def export(w, project_id, system_panels):
    settings(w)
    selector = control("project")
    w.wait(f"""const s=document.querySelector('{selector}');if(!s||!Array.from(s.options)
        .some(o=>o.value==={json.dumps(project_id)}))return false;s.value={json.dumps(project_id)};
        s.dispatchEvent(new Event('change',{{bubbles:true}}));return true;""", "select only the source project")
    archive = w.directory / ARCHIVE
    if system_panels:
        system_picker(w, control("export"), "Cancel the backup save panel.")
        assert not archive.exists()
        system_picker(w, control("export"), f"Save the project backup at {archive}")
    else:
        arm(w, "fixture")
        click(w, "export")
    large["wait_for"](lambda: archive.is_file() and archive.stat().st_size, "portable archive")
    w.wait(f"return !!document.querySelector('{control('export')}:not(:disabled)')", "archive export finished")
    return archive


def preflight(w, system_panels=False):
    if system_panels:
        system_picker(w, control("pick"), f"Open the backup {w.directory / ARCHIVE}")
    else:
        arm(w, "fixture")
        click(w, "pick")
    w.wait(f"return document.querySelector('{control('preview')}')?.innerText.includes({json.dumps(SOURCE)})",
           "read-only project preview")


def confirm(w):
    click(w, "confirm")
    w.wait(f"return !document.querySelector('{control('preview')}') && !!document.querySelector('{control('status')}')",
           "restore completion status")


def revisit(w, data, image, profile, expected_hash):
    proof = {}
    for index in range(len(data["sessions"])):
        tasks["select_project"](w, SOURCE)
        w.wait(f"""const rows=document.querySelectorAll('.project-overview__sessions button');
            if(rows.length!=={len(data["sessions"])})return false;rows[{index}].click();return true;""",
            "open restored project conversation")
        w.ready()
        question = w.wait("""return document.querySelector('[data-message-role=user]')?.innerText.trim();""",
                          "restored user message")
        scenario = next((s for s in SCENARIOS if s.question in question), None)
        if scenario:
            docs["require_answer"](w, scenario.answer)
            row = docs["source_row"](w)
            page = f"page {scenario.page} · " if scenario.page else ""
            label = f"{scenario.filename} · {page}lines 2–2"
            w.wait(f"return document.querySelector('[data-document-source]')?.getAttribute('aria-label')==={json.dumps(label)}",
                   "restored citation label")
            routes["choose"](w, "[data-document-source]", "open the restored source")
            docs["assert_excerpt"](w, scenario)
            if scenario.page:
                w.wait(f"return document.querySelector('[role=dialog] [data-document-location]')?.innerText.trim()==={json.dumps(label)}",
                       "restored physical page and line")
            proof[scenario.filename] = {"messageId": row, "label": label, "excerpt": scenario.lines[1],
                                        "foreground": w.command("foreground-state")}
            w.close_dialog()
        else:
            assert large["GENERATE"] in question
            assert large["names"](w, 1) == [image]
            path = large["stored"](profile, image)
            assert large["digest"](path) == expected_hash
            proof["image"] = large["full"](w, image, path)
    assert set(proof) == {"image", *(s.filename for s in SCENARIOS)}
    return proof


def acceptance(binary, system_panels):
    if not __debug__ or binary.name != "tinker-channels-native-qa" or not binary.is_file():
        raise ValueError("Use the dedicated Channels native QA executable with assertions enabled")
    assert plistlib.loads((binary.parent.parent / "Info.plist").read_bytes())["CFBundleIdentifier"] == "com.tinker.channels-native-qa"
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-project-portable-", dir="/private/tmp"))
    print("Evidence:", evidence, flush=True)
    src, dst = [Path("/private/tmp") / ("tinker-tauri-channels-preview-portable-" + uuid.uuid4().hex) for _ in range(2)]
    pids = []
    with window(binary, src, evidence, "source", pids) as one:
        image, image_hash = seed(one, src, system_panels)
        state = snapshot(one)[SOURCE]
        assert len(state["sessions"]) == 3
        archive = export(one, state["id"], system_panels)
        assert routes["counts"](src) == [[2, 3], [0, 0]]
    staged = evidence / ARCHIVE
    shutil.copyfile(archive, staged)
    # 移走本轮源数据和导入文件，避免恢复误读原机路径。
    src.rename(evidence / "retained-source-profile")
    one.directory.rename(evidence / "retained-source-inputs")
    with window(binary, dst, evidence, "destination", pids) as two:
        routes["open_settings"](two)
        routes["add_provider"](two, routes["B"], routes["endpoint"](dst, "secondary-"), 2)
        existing_channel, = routes["catalog"](two)
        routes["common"]["close_settings"](two)
        tasks["create_project"](two, EXISTING)
        tasks["select_project"](two, EXISTING, new=True)
        routes["select_model"](two, existing_channel["id"], routes["TEXT"])
        two.send("Keep the local destination notebook intact.")
        docs["require_answer"](two, "Owned QA streamed text completed.")
        tasks["select_project"](two, EXISTING)
        tasks["wait_project_status"](two, "completed")
        destination_baseline = routes["counts"](dst)
        assert destination_baseline == [[0, 0], [2, 1]]
        before = snapshot(two)
        settings(two)
        if system_panels:
            system_picker(two, control("pick"), "Cancel the backup open panel.")
            assert snapshot(two) == before
        chosen_archive = two.directory / ARCHIVE
        chosen_archive.write_bytes(b"not a Tinker project backup")
        arm(two, "fixture")
        click(two, "pick")
        two.wait(f"return document.querySelector('{control('error')}')?.innerText.trim()", "invalid archive rejection")
        assert snapshot(two) == before
        shutil.copyfile(staged, chosen_archive)
        preflight(two, system_panels)
        assert snapshot(two) == before
        two.wait(f"""const el=document.querySelector('{control("preview")}');
            el.scrollIntoView({{block:'center',behavior:'instant'}});
            const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));""",
            "preflight details scrolled into view")
        preview_image = two.command("snapshot")["png"]
        click(two, "cancel")
        assert snapshot(two) == before
        preflight(two)
        confirm(two)
        after = snapshot(two)
        assert after[EXISTING] == before[EXISTING] and SOURCE in after
        def content(project):
            return sorted((s["title"], [(m["role"], m["text"]) for m in s["messages"]]) for s in project["sessions"])
        assert content(after[SOURCE]) == content(state), "Restored titles, roles or content differ"
        assert len({s["id"] for project in after.values() for s in project["sessions"]}) == sum(len(project["sessions"]) for project in after.values())
        preflight(two)
        confirm(two)
        assert snapshot(two) == after and routes["catalog"](two) == [existing_channel]
        assert routes["counts"](dst) == destination_baseline
    with window(binary, dst, evidence, "restarted-destination", pids) as three:
        assert len(set(pids)) == 3 and snapshot(three) == after
        proof = revisit(three, after[SOURCE], image, dst, image_hash)
        assert routes["counts"](dst) == destination_baseline
    report = {"pids": pids, "binarySha256": large["digest"](binary), "archiveSha256": large["digest"](staged),
              "imageSha256": image_hash, "sourceMockCounts": [[2, 3], [0, 0]], "destinationMockCounts": routes["counts"](dst),
              "scope": "HTTP accepted by the two owned loopback listeners per profile",
              "pickers": ("operator-driven native PDF open/cancel, backup save/cancel and backup open/cancel; other selections injected"
                          if system_panels else "fixed synthetic selections in the isolated native QA host"),
              "preflightScreenshot": preview_image, "restoredSourceEvidence": proof}
    (evidence / "summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("--system-panels", action="store_true", help="pause for desktop automation at physical PDF and backup panels")
    args = parser.parse_args()
    acceptance(args.binary.resolve(strict=True), args.system_panels)
