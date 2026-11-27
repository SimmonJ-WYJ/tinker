"""Exercise real AppKit folder and image panels with one isolated project and an owned mock."""
import argparse
import hashlib
import json
from pathlib import Path
from runpy import run_path
import subprocess
import tempfile
import uuid

from native_image_file_checks import CHIP, SENT, image_bytes, same_pixels

HERE = Path(__file__).resolve().parent
portable = run_path(str(HERE / "native-portable-project-qa.py"))
panels = run_path(str(HERE / "native-file-panels-manual.py"))
gate = run_path(str(HERE / "native-macos-release-gate.py"))
docs, tasks, routes, large = (portable[key] for key in ("docs", "tasks", "routes", "large"))
PROJECT = "Reference identity"
REFERENCE = "同名 Reference.jpg"


def make_reference(folder, shade):
    folder.mkdir(mode=0o700)
    path = folder / REFERENCE
    subprocess.run(["bun", "-e", """
        const sharp = require('sharp');
        const v = Number(process.argv[2]);
        await sharp({create:{width:96,height:64,channels:3,background:{r:v,g:v,b:v}}})
          .jpeg({quality:100, chromaSubsampling:'4:4:4'}).toFile(process.argv[1]);""",
        str(path), str(shade)], cwd=HERE.parents[1] / "electron", check=True)
    return path


def physical(w, instruction):
    """The operator confirms the physical interaction; the host verifies dismissal."""
    docs["foreground"](w)
    print("PANEL:", instruction, flush=True)
    if input("Close the real system panel, then enter DONE: ").strip() != "DONE":
        raise AssertionError("System panel interaction incomplete")
    portable["require_sheet"](w, False)


def reference_proof(w, selector, expected, other):
    data = image_bytes(w, selector)
    assert data.startswith(b"\x89PNG\r\n\x1a\n")
    assert same_pixels(data, expected) and not same_pixels(data, other)


def run(binary, evidence):
    profile = evidence.parent / ("tinker-tauri-channels-preview-panels-" + uuid.uuid4().hex)
    first, second = (evidence / s for s in ("First folder", "第二目录 Selected"))
    decoy = make_reference(first, 0)
    selected = make_reference(second, 255)
    white, black = selected.read_bytes(), decoy.read_bytes()
    output = evidence / "导出 Output"
    output.mkdir(mode=0o700)
    pids = []

    with portable["window"](binary, profile, evidence, "first", pids) as w:
        large["setup_channel"](w, profile)
        channel, = routes["catalog"](w)
        baseline = routes["counts"](profile)
        tasks["create_project"](w, PROJECT)
        project_id = portable["snapshot"](w)[PROJECT]["id"]
        assert panels["status"](w, project_id) == "unbound"
        physical(w, f"Bind the project to {first}")
        panels["projects"]["directory"](w, "bound")
        panels["check_binding_identity"](w, project_id, first)
        physical(w, "Open the project folder selector and cancel rebinding")
        panels["check_binding_identity"](w, project_id, first)
        physical(w, f"Rebind the project to {second}")
        panels["check_binding_identity"](w, project_id, second)

        tasks["select_project"](w, PROJECT, new=True)
        routes["select_model"](w, channel["id"], routes["IMAGE"])
        physical(w, "Open Attach file and cancel")
        assert not w.js(f"return !!document.querySelector({json.dumps(CHIP)})")
        physical(w, f"Attach the white JPEG at {selected}")
        reference_proof(w, CHIP, white, black)
        assert routes["counts"](profile) == baseline
        w.send("Edit this image to add a blue band. [qa:selected-jpeg]")
        name, = large["names"](w, 1)
        routes["check_posts"](profile, [[("image-edited", 1)], []])
        reference_proof(w, SENT, white, black)
        ref_id = w.js("return document.querySelector('[data-image-edit-reference]').dataset.imageEditReference")
        assert ref_id
        expected = large["stored"](profile, name).read_bytes()
        counts = routes["counts"](profile)
        existing = output / name
        sentinel = b"isolated overwrite cancellation probe"
        existing.write_bytes(sentinel)
        physical(w, f"Save to {existing}. Cancel Replace, then dismiss Save if still open")
        if input("Type DECLINED only after observing and canceling the replacement alert: ").strip() != "DECLINED":
            raise AssertionError("The system replacement alert was not confirmed")
        assert existing.read_bytes() == sentinel and list(output.iterdir()) == [existing]
        destination = output / "Verified export.png"
        physical(w, f"Save the generated PNG to {destination}")
        large["wait_for"](lambda: destination.is_file(), "new export")
        assert destination.read_bytes() == expected and existing.read_bytes() == sentinel

    selected.rename(second / "moved.jpg")
    with portable["window"](binary, profile, evidence, "reopened", pids) as w:
        assert pids[0] != pids[1]
        tasks["select_project"](w, PROJECT)
        assert portable["snapshot"](w)[PROJECT]["id"] == project_id
        panels["check_binding_identity"](w, project_id, second)
        tasks["enter_session"](w)
        assert large["names"](w, 1) == [name]
        reference_proof(w, SENT, white, black)
        assert w.js("return document.querySelector('[data-image-edit-reference]').dataset.imageEditReference") == ref_id
        assert large["stored"](profile, name).read_bytes() == expected
        assert routes["counts"](profile) == counts
    assert decoy.read_bytes() == black and (second / "moved.jpg").read_bytes() == white
    return {"pids": pids, "sourceSize": [96, 64], "normalizedFormat": "PNG",
            "editRequests": 1, "restartRequests": 0, "exportBytes": len(expected),
            "exportSha256": hashlib.sha256(expected).hexdigest(),
            "preservedCollisionSha256": hashlib.sha256(existing.read_bytes()).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="Freshly staged Channels Native QA .app")
    args = parser.parse_args()
    if not __debug__:
        parser.error("Requires Python assertions")
    binary = gate["check_bundle"](args.app, "qa")
    root = Path(tempfile.mkdtemp(dir="/private/tmp", prefix="tinker-tauri-checks-workspace-files-"))
    print("Evidence:", root, flush=True)
    proof = run(binary, root)
    (root / "summary.json").write_text(json.dumps(proof, indent=2) + "\n")
    print("PASS", json.dumps(proof), flush=True)
