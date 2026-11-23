"""File-import and Save As acceptance using the native QA window plus scoped picker fixtures."""
import base64
from hashlib import sha256
import json
from pathlib import Path
import struct
import tempfile
import time
import uuid
import zlib


def fixture_png():
    width, height = 72, 48
    image = bytearray()
    for y in range(height):
        image.append(0)
        for x in range(width):
            if (x - 36)**2 + (y - 18)**2 < 13**2:
                rgb = (31, 128, 60)
            elif 33 < x < 39 and 18 < y < 40:
                rgb = (100, 63, 32)
            else:
                rgb = (148, 206, 243) if y < 36 else (128, 176, 67)
            image.extend(rgb)

    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(image)) + chunk(b"IEND", b"")


CHIP = '[role=status] img'
RESULT = '[data-generated-image] .generated-image__preview img'
SENT = '[data-image-edit-reference] .conversation-reference__thumbnail img'
ATTACH = """const b=document.querySelector('button[aria-label="Attach file"],button[aria-label="附加文件"],button[aria-label="添加附件"]');
    if(!b||b.disabled)return false; b.click(); return true;"""
SAVE = """const b=[...document.querySelectorAll('[data-generated-image] button')].find(b=>['Save','保存'].includes(b.textContent.trim()));
    if(!b||b.disabled)return false;b.click();return true;"""


def pick(window, case, script):
    assert window.command("arm-image-picker", choice=case) is True
    window.wait(script, f"{case} control enabled")
    deadline = time.monotonic() + 8
    while not window.command("image-picker-consumed"):
        if time.monotonic() > deadline:
            raise AssertionError(f"QA fixture for {case} was never consumed")
        time.sleep(.15)


def image_bytes(window, selector):
    data = window.wait(f"""const i=document.querySelector({json.dumps(selector)});
        return i?.complete && i.naturalWidth>0 && i.src;""", f"decoded {selector}")
    header, encoded = data.split(",", 1)
    assert header == "data:image/png;base64"
    return base64.b64decode(encoded, validate=True)


def feedback(window, words):
    return window.wait(f"""const a=[...document.querySelectorAll('[data-sonner-toast],[role=alert]')];
        return a.map(e=>e.textContent).find(s=>new RegExp({json.dumps(words)},'i').test(s));""", "visible error feedback")


def acceptance(binary, Window, scenarios):
    if not __debug__ or binary.name != "tinker-formal-native-qa" or not binary.is_file():
        raise ValueError("Use the dedicated native QA binary and Python assertions")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-image-files-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-formal-preview-files-" + uuid.uuid4().hex)
    print("Evidence:", evidence, flush=True)
    first = Window(binary, profile, evidence, "import-export")
    try:
        first.ready()
        assert scenarios(first) == []
        source = first.directory / "qa-orchard.png"
        source_bytes = fixture_png()
        source.write_bytes(source_bytes)
        (first.directory / "qa-invalid.png").write_bytes(b"Not a PNG")
        with (first.directory / "qa-oversized.png").open("xb") as f:
            f.truncate(8 * 1024 * 1024 + 1)
        original_recents = first.js("return document.querySelectorAll('.home-recent-session').length")
        pick(first, "cancel-open", ATTACH)
        first.wait("return !!document.querySelector('button[aria-label=\"Attach file\"]:not(:disabled),button[aria-label=\"添加附件\"]:not(:disabled)')", "picker dismissed")
        assert first.js("return document.querySelectorAll('.home-recent-session').length") == original_recents
        pick(first, "fixture", ATTACH)
        assert image_bytes(first, CHIP) == source_bytes
        pick(first, "cancel-open", ATTACH)
        assert image_bytes(first, CHIP) == source_bytes
        assert not first.js("return !!document.querySelector('[data-sonner-toast][data-type=error]')")
        pick(first, "invalid", ATTACH)
        invalid = feedback(first, "valid PNG|invalid|damaged|decode|corrupt|unsupported|无效|损坏|解码|格式")
        assert image_bytes(first, CHIP) == source_bytes
        pick(first, "oversized", ATTACH)
        oversized = feedback(first, "size|limit|large|MB|超限|上限|过大")
        assert invalid != oversized
        assert image_bytes(first, CHIP) == source_bytes and scenarios(first) == []
        first.send("Edit this image to change the background to blue.")
        first.cards(1)
        assert image_bytes(first, SENT) == source_bytes
        source_id = first.js("return document.querySelector('[data-image-edit-reference]').dataset.imageEditReference")
        output = image_bytes(first, RESULT)
        destination = first.directory / "qa-export.png"
        pick(first, "cancel-save", SAVE)
        assert not destination.exists()
        pick(first, "destination", SAVE)
        deadline = time.monotonic() + 5
        while not destination.is_file() and time.monotonic() < deadline:
            time.sleep(.1)
        assert destination.read_bytes() == output and output != source_bytes
        assert output[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II",output[16:24]) == (72, 48)
        assert source.read_bytes() == source_bytes and scenarios(first) == ["image-edit"]
        first.quit()
    finally:
        first.stop_if_running()

    # Remove only the original synthetic input, after success, to prove relaunch reads managed bytes.
    source.unlink()
    second = Window(binary, profile, evidence, "reopened")
    try:
        assert second.proc.pid != first.proc.pid
        second.ready()
        if not second.js(f"return !!document.querySelector('{RESULT}')"):
            second.wait("""const e=document.querySelector('.home-recent-session');
                if(!e)return false;e.click();return true;""", "reopen saved session")
        second.cards(1)
        assert image_bytes(second, RESULT) == output
        assert image_bytes(second, SENT) == source_bytes
        assert second.js("return document.querySelector('[data-image-edit-reference]').dataset.imageEditReference") == source_id
        second.wait("""const b=[...document.querySelectorAll('[data-image-edit-reference] button')].find(e=>
            /Edit from this image|从这张图|基于此图|从此图/.test(e.textContent+e.getAttribute('aria-label')));
            if(!b||b.disabled)return false;b.click();return true;""", "reuse original imported reference")
        assert image_bytes(second, CHIP) == source_bytes and scenarios(second) == []
        screenshot = second.command("snapshot")["png"]
        second.send("Edit this image to add a yellow sun.")
        second.cards(2)
        assert scenarios(second) == ["image-edit"]
        second.quit()
    finally:
        second.stop_if_running()
    result = {"firstPid":first.proc.pid,"reopenedPid":second.proc.pid,"picker":"QA fixture selection",
              "sourceSize":[72,48],"sourceSha256":sha256(source_bytes).hexdigest(),
              "exportSha256":sha256(output).hexdigest(),"exportByteCount":len(output),
              "invalidFeedback":invalid,"oversizeFeedback":oversized,
              "firstRequests":["image-edit"],"restoreAndReselectRequests":0,"reopenedRequests":["image-edit"],
              "restoredReference":screenshot}
    (evidence/"summary.json").write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2),flush=True)


def system_panels(binary, Window, scenarios):
    """A tester operates the actual AppKit panels; verify the resulting stored/exported bytes."""
    if not __debug__ or binary.name != "tinker-formal-native-qa" or not binary.is_file():
        raise ValueError("Use the dedicated native QA binary and Python assertions")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-system-files-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-formal-preview-files-" + uuid.uuid4().hex)
    window = Window(binary, profile, evidence, "panels")
    try:
        window.ready()
        source = window.directory / "qa-orchard.png"
        source.write_bytes(fixture_png())
        print("Real Open panel: select this synthetic PNG:\n" + str(source), flush=True)
        # Schedule the click so the WebView reply is delivered before the system modal gains focus.
        window.wait(ATTACH.replace("b.click()", "setTimeout(()=>b.click(),100)"), "native attachment action")
        input("Press Return after selecting the named fixture (Ctrl-C aborts the QA run): ")
        assert image_bytes(window, CHIP) == source.read_bytes() and scenarios(window) == []
        window.send("Edit this image to add a yellow sun.")
        window.cards(1)
        output = image_bytes(window, RESULT)
        destination = window.directory / "qa-export.png"
        print("Real Save panel: save to this new path:\n" + str(destination), flush=True)
        window.wait(SAVE.replace("b.click()", "setTimeout(()=>b.click(),100)"), "native save action")
        input("Press Return after confirming Save: ")
        assert destination.read_bytes() == output and scenarios(window) == ["image-edit"]
        window.quit()
        result = {"pid": window.proc.pid, "picker": "macOS Open and Save panels",
                  "sourceSha256": sha256(source.read_bytes()).hexdigest(),
                  "exportSha256": sha256(output).hexdigest(), "exportByteCount": len(output),
                  "providerRequests":["image-edit"]}
        (evidence / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
        print("Evidence:", evidence, json.dumps(result), flush=True)
    finally:
        window.stop_if_running()
