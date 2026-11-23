"""Guide an operator through real macOS panels and check the isolated native results."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
from runpy import run_path
import tempfile
import uuid

from native_image_file_checks import ATTACH, CHIP, SAVE, fixture_png, image_bytes, same_pixels
from native_upgrade_rollback import file_manifest


upgrade = run_path(str(Path(__file__).with_name("native-upgrade-rehearsal-qa.py")))
routes, projects, legacy = (upgrade[name] for name in ("routes", "projects", "legacy"))
large = upgrade["large"]


def prepare(root):
    backup = root / "旧备份 Copy"
    upgrade["seed"](backup)
    for label in ("空目录 Wrong", "项目 First", "项目 Second", "导出 Output"):
        (root / label).mkdir(mode=0o700)
    (root / "参考 Sample.png").write_bytes(fixture_png())
    (root / "导出 Output" / "同名 Existing.png").write_bytes(b"synthetic collision sentinel")
    return file_manifest(backup)


def operate(window, script, instruction, confirmation="OK"):
    print("\n" + instruction, flush=True)
    # 仅点击应用入口。系统面板内的选择和取消均由操作者完成。
    window.wait(script.replace("b.click()", "setTimeout(()=>b.click(),250)"), "open panel")
    answer = input(f"请在系统面板中完成操作，回到终端输入 {confirmation}。输入其他内容可结束：")
    if answer.strip() != confirmation:
        raise RuntimeError("Operator stopped before confirming this step")


def button(selector):
    return f"const b=document.querySelector({json.dumps(selector)});if(!b||b.disabled)return false;b.click();return true;"


def status(window, project_id):
    return routes["async_read"](window, f"""return (await window.electronAPI.listAgentWorkspaces())
        .find(p=>p.id==={json.dumps(project_id)})?.directoryStatus;""")


def check_binding_identity(window, project_id, folder):
    moved = folder.with_name(folder.name + " moved")
    folder.rename(moved)
    try:
        assert status(window, project_id) == "unavailable"
    finally:
        moved.rename(folder)
    assert status(window, project_id) == "bound"


def run(binary, root, manifest):
    if (binary.name != "tinker-channels-native-qa" or
        plistlib.loads((binary.parent.parent / "Info.plist").read_bytes()).get("CFBundleIdentifier")
            != "com.tinker.channels-native-qa"):
        raise ValueError("Use the dedicated Channels Native QA bundle")
    profile = Path("/private/tmp") / ("tinker-tauri-channels-preview-panels-" + uuid.uuid4().hex)
    backup, first, second = (root / name for name in ("旧备份 Copy", "项目 First", "项目 Second"))
    output = root / "导出 Output"
    existing = output / "同名 Existing.png"
    sentinel = existing.read_bytes()
    saved = output / "新图 Result.png"
    reference = root / "参考 Sample.png"

    w = routes["ChannelWindow"](binary, profile, root, "first")
    try:
        w.wait("return !!document.querySelector('.sidebar-account-trigger')", "workbench")
        channel = upgrade["add_channel"](w, profile, routes["A"], False)
        routes["select_model"](w, channel["id"], routes["IMAGE"])
        baseline = routes["counts"](profile)
        original = projects["state"](w)
        legacy["import_button"](w)
        pick = button("[data-testid=native-session-import]")
        operate(w, pick, "导入会话：在系统面板中点「取消」。")
        w.wait("return !!document.querySelector('[data-testid=native-session-import]:not(:disabled)')", "import picker settled")
        assert projects["state"](w) == original
        operate(w, pick, f"导入会话：选择这个空目录以检验错误提示：{root / '空目录 Wrong'}")
        w.wait("return [...document.querySelectorAll('[role=alert]')].some(e=>e.innerText.includes('agent-sessions.json'))", "invalid backup feedback")
        assert projects["state"](w) == original
        operate(w, pick, f"导入会话：选择备份目录 {backup}")
        legacy["count_report"](w, 3, 0, 0)
        legacy["close_settings"](w)
        sessions, ix = upgrade["imported_projects"](w)
        project_id = sessions[upgrade["A"]][1]
        projects["overview"](w, ix)
        bind = button("[data-testid=project-directory] button")
        idle_binding = "return !!document.querySelector('[data-testid=project-directory] button:not(:disabled)')"
        operate(w, bind, "绑定项目文件夹：点「取消」。")
        w.wait(idle_binding, "binding picker settled")
        assert status(w, project_id) == "unbound"
        operate(w, bind, f"绑定项目文件夹：选择 {first}")
        projects["directory"](w, "bound")
        operate(w, bind, "重新绑定：点「取消」。")
        w.wait(idle_binding, "rebinding picker settled")
        check_binding_identity(w, project_id, first)
        operate(w, bind, f"重新绑定：选择 {second}")
        w.wait(idle_binding, "new binding settled")
        check_binding_identity(w, project_id, second)
        assert status(w, project_id) == "bound"
        assert routes["counts"](profile) == baseline

        projects["open_session"](w, upgrade["A"])
        w.send(large["GENERATE"])
        name, = large["names"](w, 1)
        expected = large["stored"](profile, name).read_bytes()
        counts = routes["counts"](profile)
        assert counts == [[baseline[0][0], baseline[0][1] + 1], baseline[1]]
        operate(w, SAVE, "另存 PNG：点「取消」。")
        assert list(output.iterdir()) == [existing] and existing.read_bytes() == sentinel
        operate(w, SAVE, f"另存到 {existing}。确认看到同名覆盖提示后点「取消」，再关闭保存面板。"
                "如果没有看到覆盖提示，输入 STOP。", "CANCELLED REPLACE")
        assert list(output.iterdir()) == [existing] and existing.read_bytes() == sentinel
        operate(w, SAVE, f"另存到新文件：{saved}")
        large["wait_for"](lambda: saved.is_file() and saved.read_bytes() == expected, "export matches native PNG")
        assert existing.read_bytes() == sentinel

        operate(w, ATTACH, "添加参考图：点「取消」。")
        assert not w.js(f"return !!document.querySelector({json.dumps(CHIP)})")
        operate(w, ATTACH, f"添加这张参考图，保留在输入框中：{reference}")
        assert same_pixels(image_bytes(w, CHIP), reference.read_bytes())
        assert routes["counts"](profile) == counts
        w.quit()
    finally:
        w.stop_if_running()

    # 只重命名脚本刚创建的空目录，检验持久绑定确实指向第二次选择的位置。
    renamed = second.with_name("暂存 Second")
    second.rename(renamed)
    try:
        reopened = routes["ChannelWindow"](binary, profile, root, "reopened")
        try:
            reopened.ready()
            assert w.proc.pid != reopened.proc.pid
            restored, ix = upgrade["imported_projects"](reopened)
            assert restored == sessions and status(reopened, project_id) == "unavailable"
            projects["overview"](reopened, ix)
            projects["directory"](reopened, "unavailable")
            renamed.rename(second)
            assert status(reopened, project_id) == "bound"
            assert file_manifest(backup) == manifest and saved.read_bytes() == expected
            assert routes["counts"](profile) == counts
            reopened.quit()
        finally:
            reopened.stop_if_running()
    finally:
        if renamed.exists() and not second.exists():
            renamed.rename(second)
    result = {"operatorConfirmedSystemPanels": True, "operatorDeclinedOverwritePrompt": True,
              "pids": [w.proc.pid, reopened.proc.pid],
              "importedSessions": len(restored), "backupFilesUnchanged": len(manifest),
              "collisionSentinelUnchanged": existing.read_bytes() == sentinel,
              "exportBytes": len(expected), "exportSha256": hashlib.sha256(expected).hexdigest(),
              "reopenedBindingAfterDirectoryMove": "unavailable", "restoredBinding": "bound",
              "restoreRequestDelta": 0}
    (root / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print("Passed:", root / "summary.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--binary", type=Path, help="Path inside a Channels Native QA .app")
    mode.add_argument("--fixtures-only", action="store_true")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Python assertions must be enabled")
    evidence = Path(tempfile.mkdtemp(dir="/private/tmp", prefix="tinker-tauri-checks-panels-"))
    before = prepare(evidence)
    print("Private synthetic fixtures:", evidence, flush=True)
    if args.binary:
        run(args.binary.resolve(strict=True), evidence, before)
