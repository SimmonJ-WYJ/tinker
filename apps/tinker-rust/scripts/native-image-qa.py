"""Run the generated-image acceptance in two real, isolated native QA windows."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

HERE = Path(__file__).resolve().parent
CARD = "[data-generated-image] .generated-image__preview img"
SENT = "[data-image-edit-reference] .conversation-reference__thumbnail img"
GEN = "Generate an image of a green orchard."
EDIT = "Edit this image to change the background to blue."
FAIL = "Edit this image [image-error]: add a synthetic leaf."


class Window:
    def __init__(self, binary, profile, evidence, label):
        self.directory = evidence / "native-qa" / label
        self.directory.mkdir(mode=0o700, parents=True)
        with (evidence / f"{label}.log").open("w") as log:
            self.proc = subprocess.Popen(
                [binary],
                env={**os.environ, "TINKER_FORMAL_PREVIEW_ROOT": str(profile),
                     "TINKER_NATIVE_QA_DIR": str(self.directory)},
                stdout=log, stderr=subprocess.STDOUT,
            )

    def command(self, action, **args):
        if self.proc.poll() is not None:
            raise RuntimeError(f"QA window exited with {self.proc.returncode}")
        result = subprocess.run(
            ["python3", str(HERE / "native-qa-command.py"), str(self.directory),
             json.dumps({"action": action, **args})],
            text=True, capture_output=True, timeout=25, check=True,
        )
        reply = json.loads(result.stdout)
        if reply["pid"] != self.proc.pid or reply["error"]:
            raise RuntimeError(f"Invalid QA reply: {reply}")
        return reply["result"]

    def js(self, script):
        return self.command("eval", script=script)

    def wait(self, script, label):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = self.js(script)
            if result:
                return result
            time.sleep(.22)
        context = self.js("""return {text:document.body.innerText.slice(-1200),
            files:[...document.querySelectorAll('[data-file-row]')].map(e=>e.textContent),
            dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>[e.dataset.state,getComputedStyle(e).animationName]),
            images:[...document.querySelectorAll('img')].map(i=>[i.alt,i.naturalWidth,i.src.split(':')[0]]).slice(-15)}""")
        raise AssertionError(f"Failed waiting for {label}. Synthetic window: {context}")

    def ready(self):
        self.wait("return !!document.querySelector('.ProseMirror[contenteditable=true]')",
                  "visible chat editor")

    def quit(self):
        try:
            self.command("menu-quit")
        except (RuntimeError, subprocess.SubprocessError):
            if self.proc.poll() is None:
                raise
        if self.proc.wait(timeout=15) != 0:
            raise AssertionError("The QA window failed to quit cleanly")

    def stop_if_running(self):
        if self.proc.poll() is None:
            self.proc.terminate()
            self.proc.wait(timeout=10)

    def send(self, prompt):
        value = json.dumps(prompt)
        self.js(f"""const editor = document.querySelector('.ProseMirror[contenteditable=true]');
            editor.focus(); document.execCommand('insertText', false, {value}); return editor.textContent;""")
        self.wait(f"""const button=document.querySelector('button[aria-label="Send message"],button[aria-label="Send"],button[aria-label="发送消息"],button[aria-label="发送"]');
            const editor=document.querySelector('.ProseMirror[contenteditable=true]');
            if(editor?.textContent!=={value} || !button || button.disabled)return false;
            button.click();return true;""", "enabled visible Send button")

    def cards(self, count):
        return self.wait(f"""const cards=[...document.querySelectorAll('{CARD}')];
            if(cards.length!=={count} || cards.some(img=>!img.complete||!img.naturalWidth||!img.getClientRects().length))return false;
            return cards.map(img=>img.alt);""", f"{count} decoded image cards")

    def edit(self, filename, prompt):
        name = json.dumps(filename)
        self.wait(f"""const img=[...document.querySelectorAll('{CARD}')].find(e=>e.alt==={name});
            const edit=img?.closest('[data-generated-image]')?.querySelector('.generated-image__action');
            if(!edit||edit.disabled)return false; edit.click();return true;""", "Edit from this image")
        self.wait(f"""return [...document.querySelectorAll('[role=status] img')].some(img=>img.alt==={name}&&img.complete&&img.naturalWidth>0);""",
                  "selected reference preview")
        self.send(prompt)

    def sent_thumbnail(self, filename):
        return self.wait(f"""const img=[...document.querySelectorAll('{SENT}')].find(e=>e.alt==={json.dumps(filename)});
            return img?.complete&&img.naturalWidth>0&&img.closest('[data-image-edit-reference]').dataset.imageEditReference;""",
                         "persisted sent reference thumbnail")

    def compare_parent(self, source, child, capture=False):
        names = json.dumps([source, child])
        self.wait(f"""const img=[...document.querySelectorAll('{CARD}')].find(e=>e.alt==={json.dumps(child)});
            const compare=[...(img?.closest('[data-generated-image]')?.querySelectorAll('button')??[])].find(b=>/Compare versions|对比版本|比较版本/i.test(b.textContent));
            if(!compare||compare.disabled)return false; compare.click();return true;""", "Compare versions")
        self.wait(f"""const cards=[...document.querySelectorAll('{CARD}')];
            const compared=[...document.querySelectorAll('[role=dialog][data-state=open] figure img')];
            return compared.length===2 && {names}.every((name,i)=>compared[i].complete &&
              compared[i].naturalWidth && compared[i].src===cards.find(c=>c.alt===name)?.src);""",
                  "comparison against the selected parent version")
        if capture:
            self.wait("""const dlg=document.querySelector('[role=dialog][data-state=open]');
                return dlg && Number(getComputedStyle(dlg).opacity)>=0.99 &&
                  dlg.getAnimations().every(animation=>animation.playState!=='running');""",
                      "settled comparison dialog")
            # WKWebView may return the previous compositor frame immediately after attachment.
            time.sleep(.5)
        screenshot = self.command("snapshot")["png"] if capture else None
        self.close_dialog()
        return screenshot

    def close_dialog(self):
        self.js("""const b=document.querySelector('[role=dialog][data-state=open] button .lucide-x')?.closest('button');
            if(!b)throw Error('Dialog close button missing');b.click();return true;""")
        self.wait("return !document.querySelector('[role=dialog][data-state=open]')", "dialog close")

    def sidebar(self, filename):
        if not self.js("return !!document.querySelector('[data-session-files-actions]')"):
            self.wait("""const b=document.querySelector('button .lucide-panel-right')?.closest('button');
                if(!b)return false; b.click();return true;""", "Open file panel")
        self.wait(f"""const row=[...document.querySelectorAll('[data-file-row]')].find(e=>e.dataset.filePath.endsWith('/'+{json.dumps(filename)}));
            if(!row)return false; row.click();return true;""", "generated file in Session Files")
        self.wait(f"""const img=[...document.querySelectorAll('button img')].find(e=>e.alt==={json.dumps(filename)}&&e.src.startsWith('blob:')&&e.complete&&e.naturalWidth);
            if(!img||img.closest('button').disabled)return false; img.closest('button').click();return true;""", "loaded sidebar image preview")
        self.wait(f"""return [...document.querySelectorAll('[role=dialog][data-state=open] img')].some(e=>e.alt==={json.dumps(filename)}&&e.complete&&e.naturalWidth);""",
                  "enlarged sidebar image")
        for percent in (125, 156, 195):
            self.js("""const zoom=document.querySelector('[role=dialog][data-state=open] .lucide-zoom-in').closest('button');
                if(zoom.disabled)throw Error('Zoom not available');zoom.click();return true;""")
            self.wait(f"""const image=document.querySelector('[role=dialog][data-state=open] img');
                return document.querySelector('[role=dialog][data-state=open] output')?.textContent==='{percent}%' &&
                    Math.round(image.width/image.naturalWidth*100)==={percent};""", "viewer zoom")
        screenshot = self.command("snapshot")["png"]
        self.close_dialog()
        return screenshot


def scenarios(window):
    return [entry["scenario"] for entry in window.command("records")]


def acceptance(binary):
    if not __debug__:
        raise RuntimeError("Native acceptance requires Python assertions")
    if binary.name != "tinker-formal-native-qa" or not binary.is_file():
        raise ValueError("Build the dedicated tinker-formal-native-qa binary first")
    evidence = Path(tempfile.mkdtemp(prefix="tinker-tauri-checks-images-", dir="/private/tmp"))
    profile = Path("/private/tmp") / ("tinker-tauri-formal-preview-images-" + uuid.uuid4().hex)
    print("Evidence:", evidence, flush=True)
    first = Window(binary, profile, evidence, "first")
    try:
        first.ready()
        assert scenarios(first) == []
        first.send(GEN)
        source, = first.cards(1)
        assert scenarios(first) == ["image-generate"]
        first.edit(source, EDIT)
        names = first.cards(2)
        assert len(set(names)) == 2 and source in names
        child = next(n for n in names if n != source)
        parent_id = first.sent_thumbnail(source)
        first_snapshot = first.compare_parent(source, child, capture=True)
        assert scenarios(first) == ["image-generate", "image-edit"]
        first.quit()
    finally:
        first.stop_if_running()

    second = Window(binary, profile, evidence, "reopened")
    try:
        assert second.proc.pid != first.proc.pid
        second.ready()
        assert scenarios(second) == []
        if not second.js(f"return !!document.querySelector('{CARD}')"):
            second.wait("""const entry=document.querySelector('.home-recent-session');
                if(!entry)return false; entry.click();return true;""", "persisted recent session")
        assert set(second.cards(2)) == set(names)
        assert second.sent_thumbnail(source) == parent_id
        lightbox = second.sidebar(child)
        assert scenarios(second) == []
        second.edit(child, FAIL)
        second.wait(f"""return [...document.querySelectorAll('{SENT}')].some(img=>img.alt==={json.dumps(child)}&&img.complete&&img.naturalWidth);""",
                    "sent reference for failed edit")
        deadline = time.monotonic() + 8
        while scenarios(second) != ["image-edit-failed"] and time.monotonic() < deadline:
            time.sleep(.2)
        assert scenarios(second) == ["image-edit-failed"]
        second.wait("return !!document.querySelector('[data-image-task-state=failed]')",
                    "failed edit shown in the conversation")
        assert set(second.cards(2)) == set(names)
        second.edit(source, "Edit this image to add a red apple.")
        final_names = second.cards(3)
        assert set(names).issubset(final_names) and len(set(final_names)) == 3
        last = next(n for n in final_names if n not in names)
        second.compare_parent(source, last)
        assert scenarios(second) == ["image-edit-failed", "image-edit"]
        second.send("Change the background to gold.")
        continued = second.cards(4)
        second.sent_thumbnail(last)
        second.compare_parent(last, next(n for n in continued if n not in final_names))
        assert scenarios(second) == ["image-edit-failed", "image-edit", "image-edit"]
        second.quit()
        result = {"firstPid": first.proc.pid, "reopenedPid": second.proc.pid,
                  "firstRequests": ["image-generate", "image-edit"], "recoveryRequests": 0,
                  "reopenedRequests": ["image-edit-failed", "image-edit", "image-edit"], "resultImages": continued,
                  "sourceImageId": parent_id, "imagesBeforeQuit": first_snapshot,
                  "restoredSidebarLightbox": lightbox}
        (evidence / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2), flush=True)
    finally:
        second.stop_if_running()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path, help="Path to the checkout's native QA binary")
    acceptance(parser.parse_args().binary.resolve(strict=True))
