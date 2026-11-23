"""Read two private synthetic copies with the actual Electron storage implementation."""
import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess


REPO = Path(__file__).resolve().parents[3]


def file_manifest(root):
    files = {}
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Expected a private synthetic directory")
    for path in sorted(root.rglob("*")):
        meta = path.lstat()
        if stat.S_ISDIR(meta.st_mode):
            continue
        if not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1:
            raise ValueError("Links and special files are outside this rehearsal")
        if meta.st_size > 8 * 1024 * 1024 or len(files) >= 128:
            raise ValueError("Unexpected synthetic fixture size")
        files[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    if not files:
        raise ValueError("Empty synthetic fixture")
    return files


def verify_roots(source, backup, expected):
    if file_manifest(source) != expected or file_manifest(backup) != expected:
        raise ValueError("Source or rollback copy changed")


def owned_paths(evidence, source):
    if (evidence.parent != Path("/private/tmp")
            or not evidence.name.startswith("tinker-tauri-checks-upgrade-")
            or source.name != "qa-electron-copy"
            or source.parent.parent != evidence / "native-qa"
            or source.resolve() != source):
        raise ValueError("Rollback only accepts the rehearsal's own synthetic source")
    return evidence / "rollback-home", evidence / "legacy-reader.cjs"


def read_with_electron(home, reader):
    binary = REPO / "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    result = subprocess.run([str(binary), str(reader)], cwd=reader.parent, check=True,
                            env={"ASCI_CONFIG_HOME": str(home), "ELECTRON_RUN_AS_NODE": "1",
                                 "CLAUDE_CONFIG_DIR": str(home.parent / "unused-qa-sdk")},
                            timeout=30, capture_output=True, text=True)
    return json.loads(result.stdout)


def begin_rollback(evidence, source):
    home, reader = owned_paths(evidence, source)
    manifest = file_manifest(source)
    home.mkdir(mode=0o700)
    copy = home / ".asci"
    shutil.copytree(source, copy)
    subprocess.run([str(REPO / "node_modules/.bin/esbuild"), "apps/tinker-rust/scripts/legacy-upgrade-reader.ts",
                    "--bundle", "--format=cjs", "--platform=node", "--external:electron",
                    "--external:@anthropic-ai/claude-agent-sdk", "--log-level=error", f"--outfile={reader}"],
                   cwd=REPO, check=True, timeout=60)
    summary = read_with_electron(home, reader)
    verify_roots(source, copy, manifest)
    return {"files": manifest, "electron": summary}


def finish_rollback(evidence, source, baseline):
    home, reader = owned_paths(evidence, source)
    verify_roots(source, home / ".asci", baseline["files"])
    current = read_with_electron(home, reader)
    if current != baseline["electron"]:
        raise ValueError("Electron no longer reads the same projects, messages or attachment")
    verify_roots(source, home / ".asci", baseline["files"])
    canonical = json.dumps(baseline["files"], sort_keys=True, separators=(",", ":"))
    return {"filesPerCopy": len(baseline["files"]), "sha256OfFileManifest": hashlib.sha256(canonical.encode()).hexdigest(),
            "electron": current, "sourceRoot": str(source), "rollbackRoot": str(home / ".asci")}
